<?php
if (!defined('ABSPATH')) {
    exit;
}

/**
 * REST API for the React app. Namespace: /wp-json/bdchat/v1
 * Login, sign-up and logout use WordPress accounts.
 */
class BDChat_REST
{
    const NS = 'bdchat/v1';

    public static function register_routes(): void
    {
        $user = 'is_user_logged_in';
        $admin = [self::class, 'can_admin'];

        register_rest_route(self::NS, '/me', ['methods' => 'GET', 'callback' => [self::class, 'me'], 'permission_callback' => $user]);
        register_rest_route(self::NS, '/auth/login', ['methods' => 'POST', 'callback' => [self::class, 'login'], 'permission_callback' => '__return_true']);
        register_rest_route(self::NS, '/auth/register', ['methods' => 'POST', 'callback' => [self::class, 'register'], 'permission_callback' => '__return_true']);
        register_rest_route(self::NS, '/auth/logout', ['methods' => 'POST', 'callback' => [self::class, 'logout'], 'permission_callback' => $user]);
        register_rest_route(self::NS, '/models', ['methods' => 'GET', 'callback' => [self::class, 'models'], 'permission_callback' => $user]);
        register_rest_route(self::NS, '/chat', ['methods' => 'POST', 'callback' => [self::class, 'chat'], 'permission_callback' => $user]);
        register_rest_route(self::NS, '/chat/stream', ['methods' => 'POST', 'callback' => [self::class, 'chat_stream'], 'permission_callback' => $user]);
        register_rest_route(self::NS, '/admin/routing', [
            ['methods' => 'GET', 'callback' => [self::class, 'admin_routing_get'], 'permission_callback' => $admin],
            ['methods' => 'POST', 'callback' => [self::class, 'admin_routing_save'], 'permission_callback' => $admin],
        ]);
        register_rest_route(self::NS, '/environments', ['methods' => 'GET', 'callback' => [self::class, 'environments'], 'permission_callback' => $user]);
        register_rest_route(self::NS, '/image', ['methods' => 'POST', 'callback' => [self::class, 'image'], 'permission_callback' => $user]);
        register_rest_route(self::NS, '/threads', ['methods' => 'GET', 'callback' => [self::class, 'threads'], 'permission_callback' => $user]);
        register_rest_route(self::NS, '/feedback', ['methods' => 'POST', 'callback' => [self::class, 'feedback'], 'permission_callback' => $user]);
        register_rest_route(self::NS, '/threads/(?P<id>\d+)', ['methods' => 'GET', 'callback' => [self::class, 'thread'], 'permission_callback' => $user]);
        register_rest_route(self::NS, '/transactions', ['methods' => 'GET', 'callback' => [self::class, 'transactions'], 'permission_callback' => $user]);

        register_rest_route(self::NS, '/admin/stats', ['methods' => 'GET', 'callback' => [self::class, 'admin_stats'], 'permission_callback' => $admin]);
        register_rest_route(self::NS, '/admin/models', [
            ['methods' => 'GET', 'callback' => [self::class, 'admin_models_list'], 'permission_callback' => $admin],
            ['methods' => 'POST', 'callback' => [self::class, 'admin_models_save'], 'permission_callback' => $admin],
        ]);
        register_rest_route(self::NS, '/admin/models/(?P<id>\d+)', ['methods' => 'DELETE', 'callback' => [self::class, 'admin_models_delete'], 'permission_callback' => $admin]);
        register_rest_route(self::NS, '/admin/keys', ['methods' => 'GET', 'callback' => [self::class, 'admin_keys'], 'permission_callback' => $admin]);
        register_rest_route(self::NS, '/admin/users', ['methods' => 'GET', 'callback' => [self::class, 'admin_users'], 'permission_callback' => $admin]);
        register_rest_route(self::NS, '/admin/credits/grant', ['methods' => 'POST', 'callback' => [self::class, 'admin_grant'], 'permission_callback' => $admin]);
        register_rest_route(self::NS, '/admin/settings', [
            ['methods' => 'GET', 'callback' => [self::class, 'admin_settings_get'], 'permission_callback' => $admin],
            ['methods' => 'POST', 'callback' => [self::class, 'admin_settings_save'], 'permission_callback' => $admin],
        ]);
    }

    public static function can_admin(): bool
    {
        return current_user_can('manage_options');
    }

    private static function user_payload(WP_User $u): array
    {
        return ['id' => (int) $u->ID, 'name' => $u->display_name, 'email' => $u->user_email, 'isAdmin' => user_can($u, 'manage_options')];
    }

    private static function fail(string $msg, int $status): WP_Error
    {
        return new WP_Error('bdchat_error', $msg, ['status' => $status]);
    }

    /* ---------- account ---------- */

    public static function me(): array
    {
        $u = wp_get_current_user();
        return ['user' => self::user_payload($u),
            'credits' => ['balance' => BDChat_Credits::balance($u->ID), 'used' => BDChat_Credits::used($u->ID)]];
    }

    public static function login(WP_REST_Request $r)
    {
        $ip = substr(md5((string) ($_SERVER['REMOTE_ADDR'] ?? 'x')), 0, 12);
        $key = 'bdchat_login_' . $ip;
        $attempts = (int) get_transient($key);
        if ($attempts >= 10) {
            return self::fail('Too many attempts. Try again in 15 minutes.', 429);
        }
        $email = sanitize_email((string) $r->get_param('email'));
        $password = (string) $r->get_param('password');
        $user = $email ? get_user_by('email', $email) : false;
        if (!$user || !wp_check_password($password, $user->user_pass, $user->ID)) {
            set_transient($key, $attempts + 1, 15 * MINUTE_IN_SECONDS);
            return self::fail('Email or password is incorrect.', 401);
        }
        delete_transient($key);
        wp_set_current_user($user->ID);
        wp_set_auth_cookie($user->ID, true);
        return ['user' => self::user_payload($user), 'nonce' => wp_create_nonce('wp_rest')];
    }

    public static function register(WP_REST_Request $r)
    {
        if (!(int) BDChat_Settings::get('signup_enabled', 1)) {
            return self::fail('New sign-ups are currently closed.', 403);
        }
        $name = sanitize_text_field((string) $r->get_param('name'));
        $email = sanitize_email((string) $r->get_param('email'));
        $password = (string) $r->get_param('password');
        if ($name === '' || mb_strlen($name) > 80) {
            return self::fail('Enter your name.', 400);
        }
        if (!is_email($email)) {
            return self::fail('Enter a valid email address.', 400);
        }
        if (strlen($password) < 8) {
            return self::fail('Password must be at least 8 characters.', 400);
        }
        if (email_exists($email)) {
            return self::fail('An account with this email already exists.', 409);
        }
        $id = wp_insert_user(['user_login' => $email, 'user_email' => $email, 'user_pass' => $password,
            'display_name' => $name, 'role' => 'subscriber']);
        if (is_wp_error($id)) {
            return self::fail('Could not create the account. Please try again.', 500);
        }
        // The welcome bonus is granted by the user_register hook in bdchat.php.
        $user = get_user_by('id', $id);
        wp_set_current_user($user->ID);
        wp_set_auth_cookie($user->ID, true);
        return ['user' => self::user_payload($user), 'nonce' => wp_create_nonce('wp_rest')];
    }

    public static function logout()
    {
        wp_logout();
        return ['ok' => true];
    }

    /* ---------- chat ---------- */

    /** Row -> the field names the React screens use. */
    public static function shape(array $m): array
    {
        return [
            'id' => (string) $m['id'],
            'model_id' => $m['model_id'],
            'display_name' => $m['display_name'],
            'provider' => $m['provider'],
            'provider_label' => BDChat_Models::provider_label($m['provider']),
            'tier' => 'standard',
            'input_cost_per_mtok' => (float) $m['input_cost_per_mtok'],
            'output_cost_per_mtok' => (float) $m['output_cost_per_mtok'],
            'image_cost_per_image' => (float) $m['image_cost_per_image'],
            'credit_multiplier' => (float) $m['credit_multiplier'],
            'minimum_credits' => (int) $m['minimum_credits'],
            'max_output_tokens' => (int) $m['max_output_tokens'],
            'is_active' => (bool) $m['is_active'],
            'manual_selection_enabled' => (bool) $m['manual_selection_enabled'],
            'sort_order' => (int) $m['sort_order'],
            'supports_chat' => $m['kind'] === 'chat',
            'supports_image' => $m['kind'] === 'image',
            'supports_reasoning' => false,
            'supports_web' => false,
            'supports_coding' => false,
            'max_context' => 0,
            'fallback_priority' => 99,
            'auto_router_enabled' => (bool) ($m['auto_router_enabled'] ?? 0),
            'fixed_credits' => (int) ($m['fixed_credits'] ?? 0),
            'next_fixed_credits' => (int) ($m['next_fixed_credits'] ?? 0),
            'next_credits_from' => $m['next_credits_from'] ? substr((string) $m['next_credits_from'], 0, 16) : '',
            'web_search' => (bool) ($m['web_search'] ?? 0),
            'auto_router_priority' => 99,
            'profit_margin_target' => 0.5,
            'usd_to_bdt_rate' => (float) BDChat_Settings::get('usd_to_bdt_rate', 127),
        ];
    }

    /** Streams the reply as newline-separated JSON events, so the text appears while it is written. */
    public static function chat_stream(WP_REST_Request $r)
    {
        ignore_user_abort(true);
        if (function_exists('set_time_limit')) {
            @set_time_limit(300);
        }
        while (ob_get_level() > 0) {
            @ob_end_flush();
        }
        header('Content-Type: application/x-ndjson; charset=utf-8');
        header('Cache-Control: no-cache, no-store, must-revalidate');
        header('X-Accel-Buffering: no');
        $emit = function (array $event) {
            echo wp_json_encode($event) . "\n";
            flush();
        };
        $res = BDChat_Service::stream_chat(get_current_user_id(), (array) $r->get_param('messages'),
            (string) $r->get_param('mode') ?: 'auto', (int) $r->get_param('selectedModelId') ?: null,
            (int) $r->get_param('threadId') ?: null, $r->get_param('environment') ? sanitize_key((string) $r->get_param('environment')) : null,
            BDChat_Router::normalize_language((string) $r->get_param('language')), (array) $r->get_param('tools'), $emit);
        if (is_wp_error($res)) {
            $emit(['t' => 'error', 'message' => $res->get_error_message()]);
        }
        exit;
    }

    public static function models(): array
    {
        return array_map([self::class, 'shape'], array_merge(BDChat_Models::active('chat'), BDChat_Models::active('image')));
    }

    public static function chat(WP_REST_Request $r)
    {
        // Multi-model tools (Fusion, Advisor, Subagent) can take a while. Keep running if the browser disconnects,
        // so the reserved credits are still settled or refunded.
        if (function_exists('set_time_limit')) {
            @set_time_limit(180);
        }
        ignore_user_abort(true);
        $res = BDChat_Service::chat(get_current_user_id(), (array) $r->get_param('messages'),
            (string) $r->get_param('mode') ?: 'auto', (int) $r->get_param('selectedModelId') ?: null,
            (int) $r->get_param('threadId') ?: null, $r->get_param('environment') ? sanitize_key((string) $r->get_param('environment')) : null,
            BDChat_Router::normalize_language((string) $r->get_param('language')),
            (array) $r->get_param('tools'));
        return $res;
    }

    /** Environments a user can pick (Smart AI, plus one per provider group that has active models). */
    public static function environments(): array
    {
        $out = [['key' => 'smart', 'name' => 'Smart AI']];
        foreach (BDChat_Models::environment_names() as $key => $name) {
            if (BDChat_Models::env_pool($key)) {
                $out[] = ['key' => $key, 'name' => $name];
            }
        }
        return $out;
    }

    public static function image(WP_REST_Request $r)
    {
        $res = BDChat_Service::image(get_current_user_id(), (string) $r->get_param('prompt'),
            (int) $r->get_param('selectedModelId') ?: null, (int) $r->get_param('threadId') ?: null);
        return $res;
    }

    /** Thumbs up (1) / down (-1) / clear (0) on one of the user's own assistant messages. */
    public static function feedback(WP_REST_Request $r)
    {
        global $wpdb;
        $id = (int) $r->get_param('messageId');
        $value = (int) $r->get_param('value');
        if (!in_array($value, [-1, 0, 1], true)) {
            return new WP_Error('bdchat_feedback', 'Invalid feedback.', ['status' => 400]);
        }
        $wpdb->update($wpdb->prefix . 'bdchat_messages', ['feedback' => $value],
            ['id' => $id, 'user_id' => get_current_user_id(), 'role' => 'assistant']);
        return ['ok' => true];
    }

    public static function threads(): array
    {
        global $wpdb;
        $t = $wpdb->prefix . 'bdchat_threads';
        return $wpdb->get_results($wpdb->prepare(
            "SELECT id, title, updated_at FROM {$t} WHERE user_id = %d ORDER BY updated_at DESC LIMIT 400",
            get_current_user_id()), ARRAY_A) ?: [];
    }

    public static function thread(WP_REST_Request $r)
    {
        global $wpdb;
        $t = $wpdb->prefix . 'bdchat_threads';
        $m = $wpdb->prefix . 'bdchat_messages';
        $uid = get_current_user_id();
        $id = (int) $r['id'];
        $owned = $wpdb->get_var($wpdb->prepare("SELECT id FROM {$t} WHERE id = %d AND user_id = %d", $id, $uid));
        if (!$owned) {
            return self::fail('Chat not found.', 404);
        }
        return $wpdb->get_results($wpdb->prepare(
            "SELECT role, content, model, credits, image_url AS imageUrl, created_at FROM {$m}
             WHERE thread_id = %d ORDER BY id ASC", $id), ARRAY_A) ?: [];
    }

    public static function transactions(WP_REST_Request $r): array
    {
        $limit = min(100, max(1, (int) ($r->get_param('limit') ?: 20)));
        return BDChat_Credits::history(get_current_user_id(), $limit);
    }

    /* ---------- admin ---------- */

    public static function admin_stats(): array
    {
        global $wpdb;
        $w = BDChat_Credits::table();
        $l = BDChat_Credits::ledger();
        return [
            'users' => (int) count_users()['total_users'],
            'creditsIssued' => (int) $wpdb->get_var("SELECT COALESCE(SUM(delta),0) FROM {$l} WHERE type IN ('grant','bonus')"),
            'creditsUsed' => (int) $wpdb->get_var("SELECT COALESCE(SUM(used),0) FROM {$w}"),
            'creditsOutstanding' => (int) $wpdb->get_var("SELECT COALESCE(SUM(balance),0) FROM {$w}"),
        ];
    }

    public static function admin_models_list(): array
    {
        global $wpdb;
        $rows = $wpdb->get_results('SELECT * FROM ' . BDChat_Models::table() . ' ORDER BY kind, sort_order, id', ARRAY_A) ?: [];
        return array_map([self::class, 'shape'], $rows);
    }

    public static function admin_models_save(WP_REST_Request $r)
    {
        global $wpdb;
        $table = BDChat_Models::table();
        $id = (int) $r->get_param('id');
        $model_id = sanitize_text_field((string) $r->get_param('model_id'));
        $kind = $r->get_param('kind') === 'image' ? 'image' : 'chat';
        if ($model_id === '' || strlen($model_id) > 190) {
            return self::fail('Enter the OpenRouter or provider model ID.', 400);
        }
        $data = [
            'model_id' => $model_id,
            'provider' => sanitize_key((string) $r->get_param('provider')) ?: 'openrouter',
            'display_name' => sanitize_text_field((string) $r->get_param('display_name')) ?: $model_id,
            'kind' => $kind,
            'input_cost_per_mtok' => max(0, (float) $r->get_param('input_cost_per_mtok')),
            'output_cost_per_mtok' => max(0, (float) $r->get_param('output_cost_per_mtok')),
            'image_cost_per_image' => max(0, (float) $r->get_param('image_cost_per_image')),
            'credit_multiplier' => max(0.01, (float) ($r->get_param('credit_multiplier') ?: 2)),
            'minimum_credits' => max(1, (int) ($r->get_param('minimum_credits') ?: 1)),
            'max_output_tokens' => min(32000, max(1, (int) ($r->get_param('max_output_tokens') ?: 4096))),
            'is_active' => $r->get_param('is_active') ? 1 : 0,
            'manual_selection_enabled' => $r->get_param('manual_selection_enabled') ? 1 : 0,
            'auto_router_enabled' => $r->get_param('auto_router_enabled') ? 1 : 0,
            'fixed_credits' => max(0, (int) $r->get_param('fixed_credits')),
            'next_fixed_credits' => max(0, (int) $r->get_param('next_fixed_credits')),
            'next_credits_from' => ($r->get_param('next_credits_from') ? sanitize_text_field((string) $r->get_param('next_credits_from')) : null),
            'web_search' => $r->get_param('web_search') ? 1 : 0,
            'sort_order' => (int) $r->get_param('sort_order'),
        ];
        if ($id) {
            $existing = $wpdb->get_row($wpdb->prepare("SELECT model_id FROM {$table} WHERE id = %d", $id), ARRAY_A);
            if (!$existing) {
                return self::fail('Model not found.', 404);
            }
            if ($existing['model_id'] === 'openrouter/auto') {
                $data['model_id'] = 'openrouter/auto';
                $data['provider'] = 'openrouter';
                $data['manual_selection_enabled'] = 0;
            }
            $wpdb->update($table, $data, ['id' => $id]);
        } else {
            if (BDChat_Models::find_by_model_id($model_id)) {
                return self::fail('That model ID is already registered.', 409);
            }
            $wpdb->insert($table, $data);
            $id = (int) $wpdb->insert_id;
        }
        return ['id' => $id];
    }

    public static function admin_models_delete(WP_REST_Request $r)
    {
        global $wpdb;
        $table = BDChat_Models::table();
        $id = (int) $r['id'];
        $row = $wpdb->get_row($wpdb->prepare("SELECT model_id FROM {$table} WHERE id = %d", $id), ARRAY_A);
        if (!$row) {
            return self::fail('Model not found.', 404);
        }
        if ($row['model_id'] === 'openrouter/auto') {
            return self::fail('Smart AI cannot be deleted. Disable it instead.', 400);
        }
        $wpdb->delete($table, ['id' => $id]);
        return ['deleted' => true];
    }

    /** Only reports whether each key is set. The values are never sent to the browser. */
    public static function admin_keys(): array
    {
        return [
            'OPENROUTER_API_KEY' => BDChat_Keys::is_set('openrouter'),
            'OPENAI_API_KEY' => BDChat_Keys::is_set('openai'),
        ];
    }

    public static function admin_users(WP_REST_Request $r): array
    {
        $search = sanitize_text_field((string) $r->get_param('search'));
        $args = ['number' => 50, 'search' => $search ? '*' . $search . '*' : '', 'search_columns' => ['user_email', 'display_name']];
        $out = [];
        foreach (get_users($args) as $u) {
            $out[] = ['id' => (int) $u->ID, 'name' => $u->display_name, 'email' => $u->user_email,
                'balance' => BDChat_Credits::balance($u->ID), 'used' => BDChat_Credits::used($u->ID)];
        }
        return $out;
    }

    public static function admin_grant(WP_REST_Request $r)
    {
        $uid = (int) $r->get_param('userId');
        $amount = (int) $r->get_param('amount');
        if (!get_user_by('id', $uid)) {
            return self::fail('User not found.', 404);
        }
        if ($amount <= 0 || $amount > 1000000) {
            return self::fail('Amount must be between 1 and 1,000,000.', 400);
        }
        $note = sanitize_text_field((string) ($r->get_param('note') ?: 'Admin grant'));
        BDChat_Credits::grant($uid, $amount, $note);
        return ['balance' => BDChat_Credits::balance($uid)];
    }

    public static function admin_routing_get(): array
    {
        return ['labels' => BDChat_Router::LABELS, 'envs' => BDChat_Router::all_tables()];
    }

    public static function admin_routing_save(WP_REST_Request $r): array
    {
        $env = sanitize_key((string) $r->get_param('env'));
        $raw = $r->get_param('routing');
        BDChat_Router::save_table($env, is_array($raw) ? $raw : []);
        return ['labels' => BDChat_Router::LABELS, 'envs' => BDChat_Router::all_tables()];
    }

    public static function admin_settings_get(): array
    {
        return BDChat_Settings::all();
    }

    public static function admin_settings_save(WP_REST_Request $r): array
    {
        $tiers = ['low', 'medium', 'high', 'xhigh', 'max'];
        $tier = (string) $r->get_param('smart_ai_cost_tier');
        if (in_array($tier, $tiers, true)) {
            BDChat_Settings::set('smart_ai_cost_tier', $tier);
        }
        BDChat_Settings::set('usd_to_bdt_rate', max(1, (float) $r->get_param('usd_to_bdt_rate')));
        BDChat_Settings::set('signup_enabled', $r->get_param('signup_enabled') ? 1 : 0);
        BDChat_Settings::set('signup_bonus', max(0, min(100000, (int) $r->get_param('signup_bonus'))));
        BDChat_Settings::set('markup_pct', max(0, min(1000, (float) $r->get_param('markup_pct'))));
        BDChat_Settings::set('company_context', substr(sanitize_textarea_field((string) $r->get_param('company_context')), 0, 6000));
        return BDChat_Settings::all();
    }
}
