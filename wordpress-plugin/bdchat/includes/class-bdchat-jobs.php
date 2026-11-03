<?php
if (!defined('ABSPATH')) {
    exit;
}

/**
 * Background replies. The app starts a job and gets a job id at once. It then checks the job every 2 seconds.
 * Each check is a short request, so slow replies no longer hit the server's gateway timeout (504).
 * The work runs in a non-blocking loopback request, with a WP-Cron fallback if that loopback is blocked.
 */
class BDChat_Jobs
{
    const NS = 'bdchat/v1';
    const HOOK = 'bdchat_run_job';
    const TTL = 3600;

    public static function register(): void
    {
        add_action('rest_api_init', [self::class, 'routes']);
        add_action(self::HOOK, [self::class, 'run'], 10, 1);
    }

    public static function routes(): void
    {
        $user = 'is_user_logged_in';
        register_rest_route(self::NS, '/chat/start', ['methods' => 'POST', 'callback' => [self::class, 'start_chat'], 'permission_callback' => $user]);
        register_rest_route(self::NS, '/image/start', ['methods' => 'POST', 'callback' => [self::class, 'start_image'], 'permission_callback' => $user]);
        register_rest_route(self::NS, '/job', ['methods' => 'GET', 'callback' => [self::class, 'status'], 'permission_callback' => $user]);
        register_rest_route(self::NS, '/job/run', ['methods' => 'POST', 'callback' => [self::class, 'run_now'], 'permission_callback' => '__return_true']);
    }

    private static function store_key(string $id): string
    {
        return 'bdchat_job_' . $id;
    }

    private static function run_key(string $id): string
    {
        return hash_hmac('sha256', $id, wp_salt('auth'));
    }

    public static function start_chat(WP_REST_Request $r)
    {
        return self::start('chat', [
            'messages' => (array) $r->get_param('messages'),
            'mode' => (string) $r->get_param('mode'),
            'selectedModelId' => (int) $r->get_param('selectedModelId') ?: null,
            'environment' => (string) $r->get_param('environment'),
            'language' => (string) $r->get_param('language'),
            'threadId' => (int) $r->get_param('threadId') ?: null,
            'tools' => (array) $r->get_param('tools'),
        ]);
    }

    public static function start_image(WP_REST_Request $r)
    {
        return self::start('image', [
            'prompt' => (string) $r->get_param('prompt'),
            'selectedModelId' => (int) $r->get_param('selectedModelId') ?: null,
            'threadId' => (int) $r->get_param('threadId') ?: null,
        ]);
    }

    private static function start(string $type, array $params): array
    {
        $id = wp_generate_password(24, false);
        set_transient(self::store_key($id), [
            'status' => 'queued',
            'queued_at' => time(),
            'type' => $type,
            'user_id' => get_current_user_id(),
            'params' => $params,
        ], self::TTL);

        // Fallback in case the loopback below is blocked on this host.
        wp_schedule_single_event(time() + 60, self::HOOK, [$id]);
        // Start the work in a request that nobody waits for.
        wp_remote_post(rest_url(self::NS . '/job/run'), [
            'timeout' => 0.01,
            'blocking' => false,
            'headers' => ['Content-Type' => 'application/json'],
            'body' => wp_json_encode(['jobId' => $id, 'key' => self::run_key($id)]),
        ]);
        return ['jobId' => $id];
    }

    public static function run_now(WP_REST_Request $r)
    {
        $id = sanitize_text_field((string) $r->get_param('jobId'));
        $key = (string) $r->get_param('key');
        if ($id === '' || !hash_equals(self::run_key($id), $key)) {
            return new WP_Error('bdchat_job', 'Not allowed.', ['status' => 403]);
        }
        self::run($id);
        return ['ok' => true];
    }

    /** Run one queued job. Safe to call twice: a job only runs once. */
    public static function run(string $id): void
    {
        $job = get_transient(self::store_key($id));
        if (!is_array($job) || ($job['status'] ?? '') !== 'queued') {
            return;
        }
        $job['status'] = 'running';
        $job['started_at'] = time();
        set_transient(self::store_key($id), $job, self::TTL);

        ignore_user_abort(true);
        if (function_exists('set_time_limit')) {
            @set_time_limit(300);
        }

        $uid = (int) $job['user_id'];
        $p = (array) $job['params'];
        try {
            if ($job['type'] === 'image') {
                $res = BDChat_Service::image($uid, (string) $p['prompt'], $p['selectedModelId'] ?: null, $p['threadId'] ?: null);
            } else {
                $res = BDChat_Service::chat(
                    $uid,
                    (array) $p['messages'],
                    (string) $p['mode'] ?: 'auto',
                    $p['selectedModelId'] ?: null,
                    $p['threadId'] ?: null,
                    $p['environment'] ? sanitize_key((string) $p['environment']) : null,
                    BDChat_Router::normalize_language((string) $p['language']),
                    (array) $p['tools']
                );
            }
        } catch (\Throwable $e) {
            error_log('BDChat job failed: ' . $e->getMessage());
            $res = new WP_Error('bdchat_failed', 'The reply failed. Please try again.', ['status' => 500]);
        }

        if (is_wp_error($res)) {
            $job['status'] = 'error';
            $job['error'] = $res->get_error_message();
        } else {
            $job['status'] = 'done';
            $job['result'] = $res;
        }
        unset($job['params']);
        set_transient(self::store_key($id), $job, self::TTL);
    }

    public static function status(WP_REST_Request $r)
    {
        $id = sanitize_text_field((string) $r->get_param('jobId'));
        $job = get_transient(self::store_key($id));
        if (!is_array($job) || (int) $job['user_id'] !== get_current_user_id()) {
            return new WP_Error('bdchat_job', 'Reply not found.', ['status' => 404]);
        }
        // Running for more than 4 minutes: the PHP process was stopped by the host. Report it instead of waiting forever.
        if ($job['status'] === 'running' && time() - (int) ($job['started_at'] ?? time()) > 240) {
            $job['status'] = 'error';
            $job['error'] = 'The reply stopped unexpectedly. Please try again.';
            set_transient(self::store_key($id), $job, self::TTL);
        }
        // Still queued after 15 seconds: the background start did not happen. Run it here, so the reply always moves on.
        if ($job['status'] === 'queued' && time() - (int) ($job['queued_at'] ?? 0) >= 15) {
            self::run($id);
            $job = get_transient(self::store_key($id));
        }
        $out = ['status' => $job['status']];
        if ($job['status'] === 'done') {
            $out['result'] = $job['result'];
        }
        if ($job['status'] === 'error') {
            $out['error'] = $job['error'];
        }
        return $out;
    }
}
