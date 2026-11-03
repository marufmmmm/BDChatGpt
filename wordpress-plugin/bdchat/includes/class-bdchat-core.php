<?php
if (!defined('ABSPATH')) {
    exit;
}

/** Settings helper: one option array, defaults filled in. */
class BDChat_Settings
{
    public static function get(string $key, $default = null)
    {
        $all = get_option('bdchat_settings', []);
        return $all[$key] ?? $default;
    }

    public static function all(): array
    {
        return array_merge(self::defaults(), get_option('bdchat_settings', []));
    }

    private static function defaults(): array
    {
        return ['smart_ai_cost_tier' => 'low', 'usd_to_bdt_rate' => 127, 'signup_enabled' => 1, 'signup_bonus' => 100, 'company_context' => '', 'markup_pct' => 50, 'smart_mode' => 'auto'];
    }

    public static function set(string $key, $value): void
    {
        $all = get_option('bdchat_settings', []);
        $all[$key] = $value;
        update_option('bdchat_settings', $all);
    }
}

/** Credit wallet. Every balance change is one atomic SQL statement. */
class BDChat_Credits
{
    public static function table(): string
    {
        global $wpdb;
        return $wpdb->prefix . 'bdchat_wallets';
    }

    public static function ledger(): string
    {
        global $wpdb;
        return $wpdb->prefix . 'bdchat_ledger';
    }

    public static function balance(int $user_id): int
    {
        global $wpdb;
        $v = $wpdb->get_var($wpdb->prepare('SELECT balance FROM ' . self::table() . ' WHERE user_id = %d', $user_id));
        return $v === null ? 0 : (int) $v;
    }

    public static function used(int $user_id): int
    {
        global $wpdb;
        $v = $wpdb->get_var($wpdb->prepare('SELECT used FROM ' . self::table() . ' WHERE user_id = %d', $user_id));
        return $v === null ? 0 : (int) $v;
    }

    /** Take $amount only if the balance covers it. */
    public static function reserve(int $user_id, int $amount, string $model, string $note): bool
    {
        global $wpdb;
        if ($amount <= 0) {
            return true;
        }
        $n = $wpdb->query($wpdb->prepare(
            'UPDATE ' . self::table() . ' SET balance = balance - %d, used = used + %d
             WHERE user_id = %d AND balance >= %d',
            $amount, $amount, $user_id, $amount
        ));
        if ($n !== 1) {
            return false;
        }
        self::log($user_id, -$amount, 'charge', $model, $note);
        return true;
    }

    /** Give back credits (refund, unused reservation, admin grant). */
    public static function add(int $user_id, int $amount, string $type, string $model, string $note): void
    {
        global $wpdb;
        if ($amount <= 0) {
            return;
        }
        // Only refunds give back "used"; grants and bonuses do not change it.
        $used_change = $type === 'refund' ? -$amount : 0;
        $wpdb->query($wpdb->prepare(
            'INSERT INTO ' . self::table() . ' (user_id, balance, used) VALUES (%d, %d, 0)
             ON DUPLICATE KEY UPDATE balance = balance + VALUES(balance), used = GREATEST(used + %d, 0)',
            $user_id, $amount, $used_change
        ));
        self::log($user_id, $amount, $type, $model, $note);
    }

    public static function grant(int $user_id, int $amount, string $note): void
    {
        self::add($user_id, $amount, 'grant', '', $note);
    }

    public static function welcome_bonus(int $user_id): void
    {
        $bonus = (int) BDChat_Settings::get('signup_bonus', 0);
        if ($bonus > 0) {
            self::add($user_id, $bonus, 'bonus', '', 'Sign-up bonus');
        }
    }

    public static function history(int $user_id, int $limit = 50): array
    {
        global $wpdb;
        return $wpdb->get_results($wpdb->prepare(
            'SELECT id, delta, type, model, description, created_at FROM ' . self::ledger()
            . ' WHERE user_id = %d ORDER BY id DESC LIMIT %d',
            $user_id, $limit
        ), ARRAY_A) ?: [];
    }

    private static function log(int $user_id, int $delta, string $type, string $model, string $note): void
    {
        global $wpdb;
        $wpdb->insert(self::ledger(), [
            'user_id' => $user_id, 'delta' => $delta, 'type' => $type,
            'model' => substr($model, 0, 190), 'description' => substr($note, 0, 255),
        ]);
    }
}

/** Price formula: USD per 1M tokens, converted to BDT, then credits with a multiplier and a minimum. */
class BDChat_Pricing
{
    /** Credits per message right now, including any scheduled price change that has started. */
    public static function effective_fixed(array $m): int
    {
        $fixed = (int) ($m['fixed_credits'] ?? 0);
        $next = (int) ($m['next_fixed_credits'] ?? 0);
        $from = (string) ($m['next_credits_from'] ?? '');
        if ($next > 0 && $from !== '') {
            $tz = wp_timezone();
            if (new DateTime('now', $tz) >= new DateTime($from, $tz)) {
                return $next;
            }
        }
        return $fixed;
    }

    /** Credits for one web search (OpenRouter, about $0.007 per search). Charged on every search-enabled model. */
    public static function search_credits(): int
    {
        $rate = max(1, (float) BDChat_Settings::get('usd_to_bdt_rate', 127));
        return max(1, (int) ceil(0.007 / (0.40 / $rate)));
    }

    /** Credits for one reply: model price, plus the search charge when web search is on for that model. */
    public static function chat_credits(array $m, int $in, int $out): int
    {
        $base = self::base_credits($m, $in, $out);
        return $base + (BDChat_Service::web_effective($m) ? self::search_credits() : 0);
    }

    private static function base_credits(array $m, int $in, int $out): int
    {
        $fixed = self::effective_fixed($m);
        if ($fixed > 0) {
            return $fixed;
        }
        $usd = ($in * (float) $m['input_cost_per_mtok'] + $out * (float) $m['output_cost_per_mtok']) / 1000000;
        return self::to_credits($m, $usd);
    }

    public static function image_credits(array $m): int
    {
        return self::to_credits($m, (float) $m['image_cost_per_image']);
    }

    private static function to_credits(array $m, float $usd): int
    {
        $bdt = $usd * (float) BDChat_Settings::get('usd_to_bdt_rate', 127);
        $credits = (int) ceil($bdt * (float) $m['credit_multiplier']);
        return max((int) $m['minimum_credits'], $credits);
    }
}

/** Outbound calls. Keys come from wp-config.php, never from the browser. */
class BDChat_Providers
{
    /**
     * @param array<int, array{role:string, content:string}> $messages
     * @return array{content:string, model:string, input_tokens:int, output_tokens:int}|WP_Error
     */
    /** OpenRouter's built-in web search (the server tool shown in the OpenRouter panel: Auto, Medium). */
    const SEARCH_TOOL = ['type' => 'openrouter:web_search', 'parameters' => ['engine' => 'exa', 'max_results' => 5, 'search_context_size' => 'medium']];

    public static function chat(string $model_id, array $messages, int $max_tokens, ?string $cost_tier = null, ?array $allowed = null, bool $web = false)
    {
        $or_key = BDChat_Keys::get('openrouter');
        if ($or_key === '') {
            return new WP_Error('bdchat_no_key', 'OpenRouter key is not configured.', ['status' => 500]);
        }
        $body = ['model' => $model_id, 'messages' => $messages, 'max_tokens' => $max_tokens];
        if ($web) {
            $body['tools'] = [self::SEARCH_TOOL];
        }
        if ($model_id === 'openrouter/auto') {
            $plugin = ['id' => 'auto-router'];
            if ($cost_tier) {
                $plugin['cost_tier'] = $cost_tier;
            }
            if ($allowed) {
                $plugin['allowed_models'] = $allowed;
            }
            $body['plugins'] = [$plugin];
        }
        $res = wp_remote_post('https://openrouter.ai/api/v1/chat/completions', [
            'timeout' => 90,
            'headers' => ['Content-Type' => 'application/json', 'Authorization' => 'Bearer ' . $or_key],
            'body' => wp_json_encode($body),
        ]);
        if (is_wp_error($res)) {
            return $res;
        }
        $code = wp_remote_retrieve_response_code($res);
        $data = json_decode((string) wp_remote_retrieve_body($res), true);
        if ($code < 200 || $code >= 300 || !is_array($data)) {
            return new WP_Error('bdchat_upstream', 'The AI provider returned an error. Please try again.', ['status' => 502]);
        }
        return [
            'content' => (string) ($data['choices'][0]['message']['content'] ?? ''),
            'model' => (string) ($data['model'] ?? $model_id),
            'input_tokens' => (int) ($data['usage']['prompt_tokens'] ?? 0),
            'output_tokens' => (int) ($data['usage']['completion_tokens'] ?? 0),
            'citations' => self::citations_from($data['choices'][0]['message']['annotations'] ?? []),
        ];
    }

    /** Web citations (url + title) from an OpenRouter annotations list. */
    public static function citations_from($annotations): array
    {
        $out = [];
        $seen = [];
        foreach ((array) $annotations as $note) {
            $cite = is_array($note) ? ($note['url_citation'] ?? null) : null;
            if (is_array($cite) && !empty($cite['url']) && !isset($seen[$cite['url']])) {
                $seen[$cite['url']] = true;
                $out[] = ['url' => (string) $cite['url'], 'title' => (string) ($cite['title'] ?? $cite['url'])];
            }
        }
        return $out;
    }

    /**
     * Streams one model reply. Each piece of text is passed to $on_delta as it arrives.
     * Returns the same shape as chat(), or WP_Error if no text came back.
     */
    public static function chat_stream(string $model_id, array $messages, int $max_tokens, callable $on_delta, bool $web = false)
    {
        $or_key = BDChat_Keys::get('openrouter');
        if ($or_key === '') {
            return new WP_Error('bdchat_no_key', 'OpenRouter key is not configured.', ['status' => 500]);
        }
        if (!function_exists('curl_init')) {
            $res = self::chat($model_id, $messages, $max_tokens, null, null, $web);
            if (!is_wp_error($res) && $res['content'] !== '') {
                $on_delta($res['content']);
            }
            return $res;
        }
        $payload = [
            'model' => $model_id,
            'messages' => $messages,
            'max_tokens' => $max_tokens,
            'stream' => true,
            'usage' => ['include' => true],
        ];
        if ($web) {
            $payload['tools'] = [self::SEARCH_TOOL];
        }
        $body = wp_json_encode($payload);
        $buffer = '';
        $finish = '';
        $content = '';
        $model = $model_id;
        $in = 0;
        $out = 0;
        $citations = [];
        $ch = curl_init('https://openrouter.ai/api/v1/chat/completions');
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Authorization: Bearer ' . $or_key, 'Accept: text/event-stream'],
            CURLOPT_CONNECTTIMEOUT => 15,
            CURLOPT_TIMEOUT => 120,
            CURLOPT_WRITEFUNCTION => function ($handle, $chunk) use (&$buffer, &$content, &$model, &$in, &$out, &$citations, &$finish, $on_delta) {
                $buffer .= $chunk;
                $on_delta(''); // heartbeat: keeps the browser connection alive while the model works
                while (($pos = strpos($buffer, "\n")) !== false) {
                    $line = trim(substr($buffer, 0, $pos));
                    $buffer = substr($buffer, $pos + 1);
                    if (strpos($line, 'data:') !== 0) {
                        continue;
                    }
                    $json = trim(substr($line, 5));
                    if ($json === '' || $json === '[DONE]') {
                        continue;
                    }
                    $data = json_decode($json, true);
                    if (!is_array($data)) {
                        continue;
                    }
                    if (!empty($data['model'])) {
                        $model = (string) $data['model'];
                    }
                    if (!empty($data['choices'][0]['finish_reason'])) {
                        $finish = (string) $data['choices'][0]['finish_reason'];
                    }
                    foreach ((array) ($data['choices'][0]['delta']['annotations'] ?? []) as $note) {
                        $cite = $note['url_citation'] ?? null;
                        if (is_array($cite) && !empty($cite['url'])) {
                            $citations[(string) $cite['url']] = (string) ($cite['title'] ?? $cite['url']);
                        }
                    }
                    $piece = (string) ($data['choices'][0]['delta']['content'] ?? '');
                    if ($piece !== '') {
                        $content .= $piece;
                        $on_delta($piece);
                    }
                    if (!empty($data['usage'])) {
                        $in = (int) ($data['usage']['prompt_tokens'] ?? 0);
                        $out = (int) ($data['usage']['completion_tokens'] ?? 0);
                    }
                }
                return strlen($chunk);
            },
        ]);
        $ok = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        if ($content === '' || $ok === false || $code < 200 || $code >= 300) {
            if ($content === '') {
                return new WP_Error('bdchat_upstream', 'The AI provider returned an error. Please try again.', ['status' => 502]);
            }
        }
        $list = [];
        foreach ($citations as $url => $title) {
            $list[] = ['url' => (string) $url, 'title' => (string) $title];
        }
        return ['content' => $content, 'model' => $model, 'input_tokens' => $in, 'output_tokens' => $out, 'citations' => $list, 'finish' => $finish];
    }

    /** @return array{url:string, model:string}|WP_Error */
    public static function image(string $model_id, string $prompt)
    {
        $oa_key = BDChat_Keys::get('openai');
        if ($oa_key === '') {
            return new WP_Error('bdchat_no_key', 'Image generation key is not configured.', ['status' => 500]);
        }
        $res = wp_remote_post('https://api.openai.com/v1/images/generations', [
            'timeout' => 120,
            'headers' => ['Content-Type' => 'application/json', 'Authorization' => 'Bearer ' . $oa_key],
            'body' => wp_json_encode(['model' => $model_id, 'prompt' => $prompt, 'n' => 1, 'size' => '1024x1024']),
        ]);
        if (is_wp_error($res)) {
            return $res;
        }
        $code = wp_remote_retrieve_response_code($res);
        $data = json_decode((string) wp_remote_retrieve_body($res), true);
        $url = $data['data'][0]['url'] ?? '';
        if ($code < 200 || $code >= 300 || $url === '') {
            return new WP_Error('bdchat_upstream', 'Image generation failed. Please try again.', ['status' => 502]);
        }
        return ['url' => (string) $url, 'model' => $model_id];
    }
}

/** Models table access. */
class BDChat_Models
{
    public static function table(): string
    {
        global $wpdb;
        return $wpdb->prefix . 'bdchat_models';
    }

    /** Groups shown to users in the model picker. */
    public static function provider_labels(): array
    {
        return [
            'openrouter' => 'Smart AI',
            'openai' => 'ChatGPT Plus',
            'anthropic' => 'Claude',
            'google' => 'Gemini',
            'x-ai' => 'Grok',
            'moonshotai' => 'Kimi',
            'deepseek' => 'DeepSeek',
        ];
    }

    public static function provider_label(string $provider): string
    {
        return self::provider_labels()[$provider] ?? ucfirst($provider);
    }

    /** Environment names shown to users. Each one routes only within its own provider's models. */
    public static function environment_names(): array
    {
        return [
            'openai' => 'Smart GPT',
            'anthropic' => 'Smart Claude',
            'google' => 'Smart Gemini',
            'x-ai' => 'Smart Grok',
            'deepseek' => 'Smart DeepSeek',
            'moonshotai' => 'Smart Kimi',
        ];
    }

    /** Active chat models for one provider group (used by that environment's router). */
    public static function env_pool(string $provider): array
    {
        global $wpdb;
        return $wpdb->get_results($wpdb->prepare(
            'SELECT * FROM ' . self::table() . " WHERE kind = 'chat' AND is_active = 1 AND provider = %s ORDER BY sort_order, id",
            $provider
        ), ARRAY_A) ?: [];
    }

    /** Active chat models the admin has allowed Smart AI to use. */
    public static function smart_pool(): array
    {
        global $wpdb;
        return $wpdb->get_results(
            'SELECT * FROM ' . self::table() . " WHERE kind = 'chat' AND is_active = 1 AND auto_router_enabled = 1 AND provider <> 'openrouter' ORDER BY sort_order, id",
            ARRAY_A
        ) ?: [];
    }

    public static function active(string $kind): array
    {
        global $wpdb;
        return $wpdb->get_results($wpdb->prepare(
            'SELECT * FROM ' . self::table() . ' WHERE kind = %s AND is_active = 1 ORDER BY sort_order, id', $kind
        ), ARRAY_A) ?: [];
    }

    public static function find_active_by_id(int $id): ?array
    {
        global $wpdb;
        $row = $wpdb->get_row($wpdb->prepare(
            'SELECT * FROM ' . self::table() . ' WHERE id = %d AND is_active = 1', $id
        ), ARRAY_A);
        return $row ?: null;
    }

    public static function find_by_model_id(string $model_id): ?array
    {
        global $wpdb;
        $row = $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . self::table() . ' WHERE model_id = %s', $model_id), ARRAY_A);
        return $row ?: null;
    }
}

/**
 * Chat and image flows: reserve credits, call the provider, settle to the real cost.
 * The reservation is refunded in full on any failure, using try/finally.
 */
class BDChat_Service
{
    /** Per-request tool switches from the chat panel. Web search defaults on; datetime defaults off. */
    public static bool $web_on = true;
    /** Set when the question needs web facts (Smart AI): search runs whatever the model's own flag says. */
    public static bool $web_forced = false;

    /** Web search for this reply: the user's switch is on and the question needs current facts. Works for every model. */
    public static function web_effective(array $m): bool
    {
        return self::$web_on && self::$web_forced;
    }
    public static bool $datetime_on = false;
    public static bool $fetch_on = true;
    public static bool $advisor_on = false;
    public static bool $fusion_on = false;
    public static bool $subagent_on = false;

    /** Models used by the extra Smart AI tools. Only active catalog models are used, so each call is priced. */
    const FUSION_MODELS = ['anthropic/claude-sonnet-5.5', 'openai/gpt-6.1-sol', 'google/gemini-3.1-pro-preview'];
    const FUSION_MERGE_MODEL = 'anthropic/claude-sonnet-5.5';
    const ADVISOR_MODEL = 'anthropic/claude-opus-5.5';

    public static function chat(int $user_id, array $messages, string $mode, ?int $selected_id, ?int $thread_id, ?string $env = null, string $language = 'auto', array $tools = [])
    {
        self::$web_on = !isset($tools['webSearch']) || (bool) $tools['webSearch'];
        self::$web_forced = false;
        self::$datetime_on = !empty($tools['datetime']);
        self::$fetch_on = !isset($tools['webFetch']) || (bool) $tools['webFetch'];
        self::$advisor_on = !empty($tools['advisor']);
        self::$fusion_on = !empty($tools['fusion']);
        self::$subagent_on = !empty($tools['subagent']);
        $clean = self::clean_messages($messages);
        if (is_wp_error($clean)) {
            return $clean;
        }
        if (self::$fetch_on) {
            $clean = self::with_fetched_pages($clean);
        }
        $language = BDChat_Router::normalize_language($language);

        if (!BDChat_Retention::can_start_thread($user_id, $thread_id)) {
            return BDChat_Retention::limit_error();
        }

        if ($mode === 'manual' && $selected_id) {
            $picked = BDChat_Models::find_active_by_id($selected_id);
            if (!$picked || $picked['kind'] !== 'chat') {
                return new WP_Error('bdchat_model', 'Selected model is not available.', ['status' => 400]);
            }
            if (!(int) $picked['manual_selection_enabled']) {
                return new WP_Error('bdchat_model', 'This model is not available for manual selection.', ['status' => 403]);
            }
            return self::run_manual($user_id, $picked, $clean, $thread_id, $language, $mode);
        }

        // Smart AI uses the same routing as the provider groups: a quick classifier picks the model,
        // then up to three models from the Smart pool are tried in order. The auto router is no longer used.
        return self::run_smart($user_id, $clean, $thread_id, $env, $language);
    }

    /**
     * Web Fetch: links in the latest user message are read on the server and their text is added to that message.
     * wp_safe_remote_get blocks private and local addresses. Only the first two links are read, each capped at 6000 characters.
     */
    private static function with_fetched_pages(array $clean): array
    {
        $idx = null;
        for ($i = count($clean) - 1; $i >= 0; $i--) {
            if ($clean[$i]['role'] === 'user') {
                $idx = $i;
                break;
            }
        }
        if ($idx === null) {
            return $clean;
        }
        preg_match_all('#https?://[^\s<>"\']+#i', $clean[$idx]['content'], $found);
        $urls = array_slice(array_unique($found[0]), 0, 2);
        $extra = '';
        foreach ($urls as $url) {
            $url = rtrim($url, '.,;:!?)]');
            $text = self::fetch_page_text($url);
            if ($text !== '') {
                $extra .= "\n\n[Content of {$url}]\n" . $text;
            }
        }
        if ($extra !== '') {
            $clean[$idx]['content'] .= $extra;
        }
        return $clean;
    }

    private static function fetch_page_text(string $url): string
    {
        $res = wp_safe_remote_get($url, ['timeout' => 10, 'redirection' => 3, 'limit_response_size' => 1048576]);
        if (is_wp_error($res) || wp_remote_retrieve_response_code($res) !== 200) {
            return '';
        }
        $html = (string) wp_remote_retrieve_body($res);
        $html = preg_replace('#<(script|style)[^>]*>.*?</\1>#is', ' ', $html);
        $text = trim((string) preg_replace('/\s+/u', ' ', wp_strip_all_tags((string) $html, true)));
        return mb_substr($text, 0, 6000);
    }

    /**
     * Streaming chat: the same routing, limits and billing as chat(), but each piece of the reply is sent
     * to $emit while it is written. Events: status (text), delta (text), done (final reply), error (message).
     */
    public static function stream_chat(int $user_id, array $messages, string $mode, ?int $selected_id, ?int $thread_id, ?string $env, string $language, array $tools, callable $emit)
    {
        self::$web_on = !isset($tools['webSearch']) || (bool) $tools['webSearch'];
        self::$web_forced = false;
        self::$datetime_on = !empty($tools['datetime']);
        self::$fetch_on = !isset($tools['webFetch']) || (bool) $tools['webFetch'];
        $clean = self::clean_messages($messages);
        $needs_web_dbg = null;
        $doc_req = false;
        if (is_wp_error($clean)) {
            return $clean;
        }
        $language = BDChat_Router::normalize_language($language);
        if (!BDChat_Retention::can_start_thread($user_id, $thread_id)) {
            return BDChat_Retention::limit_error();
        }
        if (self::$fetch_on) {
            $clean = self::with_fetched_pages($clean);
        }

        $is_manual = $mode === 'manual' && (bool) $selected_id;
        $env_label = null;
        $display_mode = null;
        $candidates = [];
        $reserve = 0;
        $ledger = 'Smart AI';

        if ($is_manual) {
            $picked = BDChat_Models::find_active_by_id($selected_id);
            if (!$picked || $picked['kind'] !== 'chat') {
                return new WP_Error('bdchat_model', 'Selected model is not available.', ['status' => 400]);
            }
            if (!(int) $picked['manual_selection_enabled']) {
                return new WP_Error('bdchat_model', 'This model is not available for manual selection.', ['status' => 403]);
            }
            // Every model can search: the question decides, using the keyword check (no extra classifier call here).
            self::$web_forced = self::$web_on && BDChat_Router::web_hint(self::last_user_text($clean));
            if (self::$web_forced) {
                $emit(['t' => 'status', 'text' => 'Searching the web']);
            }
            $candidates = [$picked];
            $ledger = $picked['model_id'];
            // Web search for every model: on when the switch is on and the question needs current facts.
            self::$web_on = self::$web_on && BDChat_Router::web_hint(self::last_user_text($clean));
            self::$web_forced = self::$web_on;
            $reserve = BDChat_Pricing::chat_credits($picked, self::estimate_input($clean), min((int) $picked['max_output_tokens'], 1000));
        } else {
            $names = BDChat_Models::environment_names();
            $key = ($env && $env !== 'smart' && isset($names[$env])) ? $env : 'smart';
            $env_label = $key === 'smart' ? 'Smart AI' : $names[$key];
            $display_mode = $key === 'smart' ? 'Smart AI' : null;
            $pool = $key === 'smart' ? BDChat_Models::smart_pool() : BDChat_Models::env_pool($key);
            if (!$pool) {
                return new WP_Error('bdchat_model', "{$env_label} has no active models yet.", ['status' => 503]);
            }

            $emit(['t' => 'status', 'text' => 'Choosing the best model']);
            $est_in = self::estimate_input($clean);
            $classifier = BDChat_Router::classifier_row();
            // The keyword check always runs, so a long-document label cannot switch search off.
            $needs_web = BDChat_Router::web_hint(self::last_user_text($clean));
            if (BDChat_Router::long_document_check($clean)) {
                $label = 'long_document';
            } elseif ($classifier) {
                [$label, , , $needs_web] = BDChat_Router::classify($clean, $classifier);
                $needs_web_dbg = (bool) $needs_web;
            } else {
                $label = 'standard';
                $needs_web = BDChat_Router::web_hint(self::last_user_text($clean));
            }
            self::$web_on = self::$web_on && $needs_web;
            self::$web_forced = self::$web_on;
            if (self::$web_on) {
                $emit(['t' => 'status', 'text' => 'Searching the web']);
            }

            // Questions that need web facts go to the stronger models, which use search results well.
            $doc_req = BDChat_Router::doc_hint(self::last_user_text($clean));
            $list = BDChat_Router::candidates(($needs_web || $doc_req) ? 'complex' : $label, $pool, $key);
            if (!$needs_web && !$doc_req && in_array($label, ['simple', 'standard'], true)) {
                $list = BDChat_Router::fast_first($list);
            }
            $balance = BDChat_Credits::balance($user_id);
            $affordable = [];
            foreach ($list as $m) {
                $est = BDChat_Pricing::chat_credits($m, $est_in, min((int) $m['max_output_tokens'], 1000));
                if ($est <= $balance) {
                    $affordable[] = ['row' => $m, 'est' => $est];
                }
            }
            if (!$affordable) {
                return self::insufficient($user_id, $list ? BDChat_Pricing::chat_credits($list[0], $est_in, 1000) : 1);
            }
            $reserve = $affordable[0]['est'];
            foreach ($affordable as $a) {
                if ($a['est'] <= $reserve) {
                    $candidates[] = $a['row'];
                }
            }
            $ledger = 'router';
            // Current facts needed and the Web search switch is on: answer through OpenRouter's auto router with web search (':online'),
            // as the build that worked did. Everyday questions keep the fast-model list above, with no search.
            $switch_on = !isset($tools['webSearch']) || (bool) $tools['webSearch'];
            if ($needs_web && $switch_on && $affordable) {
                $auto = $affordable[0]['row'];
                $auto['model_id'] = 'openrouter/auto:online';
                $auto['display_name'] = 'Smart AI';
                array_unshift($candidates, $auto);
            }
        }

        if ($reserve < 1 || !BDChat_Credits::reserve($user_id, $reserve, $ledger, 'Reserve: ' . ($env_label ?? 'Reply'))) {
            return self::insufficient($user_id, max(1, $reserve));
        }

        $settled = false;
        try {
            // Search runs inside the answer call (OpenRouter's server tool), so the reply never waits on a separate step.
            $sources = null;
            $research_credits = 0;
            $msgs = self::with_system($clean, $language, $user_id);
            // When this reply uses web search, tell the model what to search for. The note goes to the model only, not into the saved chat.
            if (self::$web_on && self::$web_forced && $msgs) {
                $last_i = count($msgs) - 1;
                if (($msgs[$last_i]['role'] ?? '') === 'user' && is_string($msgs[$last_i]['content'] ?? null)) {
                    $msgs[$last_i]['content'] .= "\n\n(Search note: this question needs current facts. Search for today's news and facts for Bangladesh as of " . wp_date('j F Y') . ". For a news question, answer with the actual news headlines and one short line on each. Do not write about how to write headlines or about unrelated articles. Answer in the same language as the question.)";
                }
            }
            $emit(['t' => 'status', 'text' => 'Writing the answer']);

            $result = null;
            $chosen = null;
            $tried = 0;
            $dbg_flags = (self::$web_on ? '1' : '0') . (self::$web_forced ? '1' : '0') . ($is_manual ? 'M' : 'A') . count($candidates);
            foreach ($candidates as $m) {
                if ($tried >= 3) {
                    break;
                }
                $tried++;
                $started = false;
                $res = BDChat_Providers::chat_stream($m['model_id'], $msgs, $doc_req ? max((int) $m['max_output_tokens'], 12000) : (int) $m['max_output_tokens'],
                    function (string $piece) use ($emit, &$started) {
                        if ($piece === '') {
                            $emit(['t' => 'ping']);
                            return;
                        }
                        $started = true;
                        $emit(['t' => 'delta', 'text' => $piece]);
                    }, self::web_effective($m) && !str_ends_with($m['model_id'], ':online'));
                if (!is_wp_error($res)) {
                    $result = $res;
                    $chosen = $m;
                    // The answer was cut off by the length limit: ask for the rest, up to two more rounds.
                    $rounds = 0;
                    while (($result['finish'] ?? '') === 'length' && $rounds < 2) {
                        $rounds++;
                        $more_msgs = array_merge($msgs, [
                            ['role' => 'assistant', 'content' => $result['content']],
                            ['role' => 'user', 'content' => 'Continue exactly where you stopped. Do not repeat anything already written.'],
                        ]);
                        $more = BDChat_Providers::chat_stream($m['model_id'], $more_msgs, (int) $m['max_output_tokens'],
                            function (string $piece) use ($emit) {
                                $emit($piece === '' ? ['t' => 'ping'] : ['t' => 'delta', 'text' => $piece]);
                            }, false);
                        if (is_wp_error($more)) {
                            break;
                        }
                        $result['content'] .= $more['content'];
                        $result['input_tokens'] = (int) $result['input_tokens'] + (int) $more['input_tokens'];
                        $result['output_tokens'] = (int) $result['output_tokens'] + (int) $more['output_tokens'];
                        $result['finish'] = $more['finish'] ?? '';
                    }
                    break;
                }
                if ($started) {
                    break; // text was already shown; do not switch model in the middle of an answer
                }
            }
            if (!$result) {
                return new WP_Error('bdchat_upstream', 'The AI models did not answer. Please try again.', ['status' => 502]);
            }

            $content = BDChat_Router::strip_model_sources(BDChat_Router::plain_text($result['content']));
            // Real sources from the search, when the web was used. The model's own list is removed above.
            $cites = $sources ?? array_slice($result['citations'] ?? [], 0, 5);
            if ($cites) {
                $content .= "\n\nSources\n" . implode("\n", array_map(fn($c) => $c['url'], $cites));
            }
            $actual = BDChat_Pricing::chat_credits($chosen, $result['input_tokens'], $result['output_tokens']) + $research_credits;
            self::settle($user_id, $reserve, $actual, $chosen['model_id']);
            $settled = true;
            $name = $display_mode ?? $chosen['display_name'];
            $thread_id = self::save_turn($user_id, $thread_id, $clean, $content, $name, $actual, null);
            $reply = self::reply($user_id, $content, $name, $is_manual ? null : $env_label, $is_manual ? 'manual' : 'auto', $result, $actual, $thread_id);
            if (current_user_can('manage_options')) {
                // Admin-only check line: shows whether search ran and which model answered. Customers never see this.
                $reply['debug'] = [
                    'search' => (bool) self::web_effective($chosen) || $sources !== null,
                    'citations' => count($result['citations'] ?? []),
                    'model' => (string) $chosen['model_id'],
                    'flags' => $dbg_flags,
                    'switch' => !isset($tools['webSearch']) || (bool) $tools['webSearch'] ? 'on' : 'off',
                    'hint' => BDChat_Router::web_hint(self::last_user_text($clean)) ? 'yes' : 'no',
                    'needs' => $needs_web_dbg === null ? 'n/a' : ($needs_web_dbg ? 'yes' : 'no'),
                ];
            }
            $emit(['t' => 'done', 'result' => $reply]);
            return $reply;
        } finally {
            if (!$settled) {
                BDChat_Credits::add($user_id, $reserve, 'refund', $ledger, 'Refund: request failed');
            }
        }
    }

    /**
     * Search step (cheap model with web search), then read up to three of the pages on the server.
     * Returns the messages with the research added to the last question, and the sources, or null if nothing was found.
     */
    private static function research(array $clean): ?array
    {
        $question = self::last_user_text($clean);
        if ($question === '') {
            return null;
        }
        $finder = BDChat_Router::classifier_row();
        $finder_id = $finder ? $finder['model_id'] : self::FAST_MODEL_FALLBACK;
        $found = BDChat_Providers::chat($finder_id, [
            ['role' => 'system', 'content' => 'Search the web for the question. Reply with 2 to 4 short sentences with the key current facts and their dates. Never say you cannot search.'],
            ['role' => 'user', 'content' => $question],
        ], 300, null, null, true);
        if (is_wp_error($found)) {
            return null;
        }
        $summary = trim((string) $found['content']);
        $pages = [];
        foreach (array_slice($found['citations'] ?? [], 0, 3) as $c) {
            $text = self::fetch_page_text($c['url']);
            if ($text !== '') {
                $pages[] = ['url' => $c['url'], 'title' => $c['title'], 'text' => $text];
            }
        }
        $cites = $found['citations'] ?? [];
        if ($summary === '' && !$pages) {
            return null;
        }
        $block = "\n\n[Web research for this question, read just now]\nSearch summary: " . $summary;
        foreach ($pages as $p) {
            $block .= "\n\n[Page: {$p['title']} ({$p['url']})]\n" . $p['text'];
        }
        for ($i = count($clean) - 1; $i >= 0; $i--) {
            if ($clean[$i]['role'] === 'user') {
                $clean[$i]['content'] .= $block;
                break;
            }
        }
        $sources = [];
        foreach ($pages ?: array_slice($cites, 0, 3) as $c) {
            $sources[] = ['url' => $c['url'], 'title' => $c['title']];
        }
        return ['clean' => $clean, 'sources' => $sources];
    }

    /** Used for the search step when no classifier model is active. */
    const FAST_MODEL_FALLBACK = 'google/gemini-3.8-flash';

    private static function last_user_text(array $clean): string
    {
        for ($i = count($clean) - 1; $i >= 0; $i--) {
            if ($clean[$i]['role'] === 'user') {
                return $clean[$i]['content'];
            }
        }
        return '';
    }

    /** Price of one USD of real model cost in credits, with the owner's markup. 1 credit = ৳0.40. */
    public static function credits_for_usd(float $usd): int
    {
        $markup = 1 + max(0, (float) BDChat_Settings::get('markup_pct', 50)) / 100;
        $rate = max(1, (float) BDChat_Settings::get('usd_to_bdt_rate', 127));
        $credit_usd = 0.40 / $rate;
        return max(1, (int) ceil(($usd * $markup) / $credit_usd));
    }

    /** Real USD cost of one reply, from the catalog price of the model that answered. Unknown models use a high fallback price. */
    public static function real_usd(array $res): float
    {
        $row = BDChat_Models::find_by_model_id($res['model']);
        $in = $row ? (float) $row['input_cost_per_mtok'] : 10.0;
        $out = $row ? (float) $row['output_cost_per_mtok'] : 40.0;
        return ($res['input_tokens'] * $in + $res['output_tokens'] * $out) / 1000000;
    }

    /**
     * Smart AI as an auto router: OpenRouter picks the model. The user sees only "Smart AI".
     * The bill is the real cost of the model that answered, plus the owner's markup.
     */
    /** OpenRouter web search cost per request (default engine, up to 10 results). Added to Smart AI's real cost. */
    const WEB_SEARCH_USD = 0.007;

    private static function active_model(string $id): bool
    {
        $row = BDChat_Models::find_by_model_id($id);
        return (bool) ($row && (int) $row['is_active']);
    }

    /** One model call, with its real cost and tokens added to the running totals. */
    private static function call_model(string $model_id, array $msgs, int $max, float &$usd, int &$in, int &$out)
    {
        $res = BDChat_Providers::chat($model_id, $msgs, $max, null, null);
        if (is_wp_error($res)) {
            return $res;
        }
        $usd += self::real_usd($res);
        $in += (int) $res['input_tokens'];
        $out += (int) $res['output_tokens'];
        return $res;
    }

    /**
     * Smart AI as an auto router, with optional extra tools:
     * Subagent (a cheap model writes notes first), Fusion (three models answer, one merges), Advisor (a stronger model improves the draft).
     * The bill is the real cost of every model call, plus the owner's markup. The user sees only "Smart AI".
     */
    private static function run_smart_auto(int $user_id, array $clean, ?int $thread_id, string $language)
    {
        $subagent = self::$subagent_on ? BDChat_Router::classifier_row() : null;
        $fusion = [];
        if (self::$fusion_on) {
            $fusion = array_values(array_filter(self::FUSION_MODELS, fn($id) => self::active_model($id)));
            $fusion = count($fusion) >= 2 ? $fusion : [];
        }
        $advisor = !$fusion && self::$advisor_on && self::active_model(self::ADVISOR_MODEL);
        $calls = 1 + ($subagent ? 1 : 0) + ($fusion ? count($fusion) + 1 : ($advisor ? 1 : 0));

        $balance = BDChat_Credits::balance($user_id);
        $reserve = min(20 * $calls, $balance);
        if ($reserve < 1 || !BDChat_Credits::reserve($user_id, $reserve, 'Smart AI', 'Reserve: Smart AI')) {
            return self::insufficient($user_id, 1);
        }
        $settled = false;
        try {
            $usd = 0.0;
            $in = 0;
            $out = 0;
            $web_suffix = self::$web_on ? ':online' : '';

            // Subagent: a cheap model drafts working notes. If it fails, the reply continues without notes.
            $notes = '';
            if ($subagent) {
                $last = '';
                for ($i = count($clean) - 1; $i >= 0; $i--) {
                    if ($clean[$i]['role'] === 'user') {
                        $last = $clean[$i]['content'];
                        break;
                    }
                }
                $r = self::call_model($subagent['model_id'], [
                    ['role' => 'system', 'content' => 'Prepare short working notes (at most 200 words): the key facts, steps and risks for answering the user. Do not invent facts. Plain text only.'],
                    ['role' => 'user', 'content' => $last],
                ], 400, $usd, $in, $out);
                if (!is_wp_error($r)) {
                    $notes = trim((string) $r['content']);
                }
            }

            $msgs = self::with_system($clean, $language, $user_id);
            if ($notes !== '') {
                array_splice($msgs, 1, 0, [['role' => 'system', 'content' => "Working notes prepared for this question (use them where they help; they are not verified sources):\n" . $notes]]);
            }

            if ($fusion) {
                // Fusion: each model answers, then one model merges the answers into the best one.
                $answers = [];
                foreach ($fusion as $mid) {
                    if (self::$web_on) {
                        $usd += self::WEB_SEARCH_USD;
                    }
                    $r = self::call_model($mid . $web_suffix, $msgs, 2000, $usd, $in, $out);
                    if (!is_wp_error($r)) {
                        $answers[] = BDChat_Router::plain_text((string) $r['content']);
                    }
                }
                if (count($answers) < 2) {
                    return new WP_Error('bdchat_upstream', 'The AI models did not answer. Please try again.', ['status' => 502]);
                }
                $merge = "Several AI models answered the same question. Write the single best answer: keep what they agree on, fix mistakes, and drop anything unsupported. Keep the user's language and the formatting rules.\n\n";
                foreach ($answers as $n => $text) {
                    $merge .= '--- Answer ' . ($n + 1) . " ---\n" . $text . "\n\n";
                }
                $final = self::call_model(self::FUSION_MERGE_MODEL, array_merge($msgs, [['role' => 'user', 'content' => $merge]]), 4000, $usd, $in, $out);
                if (is_wp_error($final)) {
                    return $final;
                }
            } else {
                $main_id = self::$web_on ? 'openrouter/auto:online' : 'openrouter/auto';
                $final = self::call_model($main_id, $msgs, 4000, $usd, $in, $out);
                if (is_wp_error($final)) {
                    // The auto router failed or timed out: try the best-fit models from the Smart pool, one after another.
                    $final = self::fallback_answer($msgs, $usd, $in, $out);
                    if (is_wp_error($final)) {
                        return $final;
                    }
                }
                if (self::$web_on) {
                    $usd += self::WEB_SEARCH_USD;
                }
                if ($advisor) {
                    // Advisor: a stronger model improves the draft. If it fails, the draft is kept.
                    $draft = BDChat_Router::plain_text((string) $final['content']);
                    $adv = self::call_model(self::ADVISOR_MODEL, array_merge($msgs, [['role' => 'user', 'content' => "Here is a draft answer to the question above:\n\n" . $draft . "\n\nImprove it where needed: fix errors, make it clearer and more complete. Keep the same language and formatting rules. Reply with the final answer only."]]), 4000, $usd, $in, $out);
                    if (!is_wp_error($adv)) {
                        $final = $adv;
                    }
                }
            }

            $content = BDChat_Router::plain_text((string) $final['content']);
            $actual = self::credits_for_usd($usd);
            $totals = ['model' => $final['model'], 'input_tokens' => $in, 'output_tokens' => $out];
            self::settle($user_id, $reserve, $actual, 'Smart AI');
            $settled = true;
            self::log_route($user_id, $totals, $actual, $usd);
            $thread_id = self::save_turn($user_id, $thread_id, $clean, $content, 'Smart AI', $actual, null);
            return self::reply($user_id, $content, 'Smart AI', 'Smart AI', 'auto', $totals, $actual, $thread_id);
        } finally {
            if (!$settled) {
                BDChat_Credits::add($user_id, $reserve, 'refund', 'Smart AI', 'Refund: request failed');
            }
        }
    }

    /** Smart AI backup when the auto router fails: up to two active Smart pool models, cheapest suitable first. */
    private static function fallback_answer(array $msgs, float &$usd, int &$in, int &$out)
    {
        $pool = BDChat_Models::smart_pool();
        $list = $pool ? BDChat_Router::candidates('standard', $pool, 'smart') : [];
        foreach (array_slice($list, 0, 2) as $m) {
            if (self::web_effective($m)) {
                $usd += self::WEB_SEARCH_USD;
            }
            $max = min((int) $m['max_output_tokens'] ?: 4000, 4000);
            $r = self::call_model(self::api_id($m), $msgs, $max, $usd, $in, $out);
            if (!is_wp_error($r)) {
                return $r;
            }
        }
        return new WP_Error('bdchat_upstream', 'The AI models did not answer. Please try again.', ['status' => 502]);
    }

    /** Admin-only record of which model answered Smart AI and what it cost. Never shown to users. */
    private static function log_route(int $user_id, array $res, int $credits, float $usd): void
    {
        global $wpdb;
        $wpdb->insert($wpdb->prefix . 'bdchat_route_log', [
            'user_id' => $user_id, 'model_id' => substr($res['model'], 0, 190),
            'input_tokens' => (int) $res['input_tokens'], 'output_tokens' => (int) $res['output_tokens'],
            'real_usd' => round($usd, 6), 'credits' => $credits,
        ]);
    }

    /** One chosen model answers. Reserve, call, settle to the real cost, refund on failure. */
    private static function run_manual(int $user_id, array $model, array $clean, ?int $thread_id, string $language, string $mode)
    {
        self::$web_forced = self::$web_on && BDChat_Router::web_hint(self::last_user_text($clean));
        $est_in = self::estimate_input($clean);
        $reserve = BDChat_Pricing::chat_credits($model, $est_in, min((int) $model['max_output_tokens'], 1000));
        $label = $model['display_name'];
        if (!BDChat_Credits::reserve($user_id, $reserve, $model['model_id'], "Reserve: {$label}")) {
            return self::insufficient($user_id, $reserve);
        }
        $settled = false;
        try {
            $result = BDChat_Providers::chat(self::api_id($model), self::with_system($clean, $language, $user_id),
                (int) $model['max_output_tokens'], null, null);
            if (is_wp_error($result)) {
                return $result;
            }
            $content = BDChat_Router::plain_text($result['content']);
            $actual = BDChat_Pricing::chat_credits($model, $result['input_tokens'], $result['output_tokens']);
            self::settle($user_id, $reserve, $actual, $model['model_id']);
            $settled = true;
            $thread_id = self::save_turn($user_id, $thread_id, $clean, $content, $model['display_name'], $actual, null);
            return self::reply($user_id, $content, $model['display_name'], null, $mode, $result, $actual, $thread_id);
        } finally {
            if (!$settled) {
                BDChat_Credits::add($user_id, $reserve, 'refund', $model['model_id'], 'Refund: request failed');
            }
        }
    }

    /** Smart AI or a Smart environment: classify, choose from the table, fall back on failure. */
    private static function run_smart(int $user_id, array $clean, ?int $thread_id, ?string $env, string $language)
    {
        $names = BDChat_Models::environment_names();
        $key = ($env && $env !== 'smart' && isset($names[$env])) ? $env : 'smart';
        $env_label = $key === 'smart' ? 'Smart AI' : $names[$key];
        $pool = $key === 'smart' ? BDChat_Models::smart_pool() : BDChat_Models::env_pool($key);
        if (!$pool) {
            return new WP_Error('bdchat_model', "{$env_label} has no active models yet.", ['status' => 503]);
        }

        // 1. Classify (or use the long-document rule for very long input).
        $est_in = self::estimate_input($clean);
        $classifier = BDChat_Router::classifier_row();
        $cls_reserve = 0; // classification is a platform cost, not charged to the user
        $needs_web = false;
        if (BDChat_Router::long_document_check($clean)) {
            $label = 'long_document';
            $cls_in = $cls_out = 0;
        } elseif ($classifier) {
            [$label, $cls_in, $cls_out, $needs_web] = BDChat_Router::classify($clean, $classifier);
        } else {
            // No classifier is active: use the keyword check so current-news questions still search.
            $label = 'standard';
            $cls_in = $cls_out = 0;
            $last_user = '';
            for ($i = count($clean) - 1; $i >= 0; $i--) {
                if ($clean[$i]['role'] === 'user') {
                    $last_user = $clean[$i]['content'];
                    break;
                }
            }
            $needs_web = BDChat_Router::web_hint($last_user);
        }
        $cls_cost = 0;
        // Web search runs only when the question needs current facts, and the Web search switch is on.
        self::$web_on = self::$web_on && $needs_web;
        self::$web_forced = self::$web_on;

        // 2. Candidates for this label, limited to the environment's models. Everyday questions try fast models first.
        $candidates = BDChat_Router::candidates($needs_web ? 'complex' : $label, $pool, $key);
        if (!$needs_web && in_array($label, ['simple', 'standard'], true)) {
            $candidates = BDChat_Router::fast_first($candidates);
        }
        $balance = BDChat_Credits::balance($user_id);

        // 3. Keep only candidates the user can afford; never reserve more than the balance.
        $affordable = [];
        foreach ($candidates as $m) {
            $est = BDChat_Pricing::chat_credits($m, $est_in, min((int) $m['max_output_tokens'], 1000)) + $cls_reserve;
            if ($est <= $balance) {
                $affordable[] = ['row' => $m, 'est' => $est];
            }
        }
        if (!$affordable) {
            return self::insufficient($user_id, $candidates ? BDChat_Pricing::chat_credits($candidates[0], $est_in, 1000) : 1);
        }

        $reserve = $affordable[0]['est'];
        if (!BDChat_Credits::reserve($user_id, $reserve, 'router', "Reserve: {$env_label}")) {
            return self::insufficient($user_id, $reserve);
        }

        // 4. Try up to three candidates in order. Each one must still fit the reserve.
        $settled = false;
        try {
            $msgs = self::with_system($clean, $language, $user_id);
            $result = null;
            $chosen = null;
            $tried = 0;
            foreach ($affordable as $item) {
                if ($tried >= 3) {
                    break;
                }
                $m = $item['row'];
                if ($item['est'] > $reserve) {
                    continue;
                }
                $tried++;
                $res = BDChat_Providers::chat(self::api_id($m), $msgs, (int) $m['max_output_tokens'], null, null);
                if (!is_wp_error($res)) {
                    $result = $res;
                    $chosen = $m;
                    break;
                }
            }
            if (!$result) {
                return new WP_Error('bdchat_upstream', 'The AI models did not answer. Please try again.', ['status' => 502]);
            }

            $content = BDChat_Router::plain_text($result['content']);
            $actual = BDChat_Pricing::chat_credits($chosen, $result['input_tokens'], $result['output_tokens']) + $cls_cost;
            self::settle($user_id, $reserve, $actual, $chosen['model_id']);
            $settled = true;
            // Users never see the real model name for Smart AI.
            $shown = $key === 'smart' ? 'Smart AI' : $chosen['display_name'];
            $thread_id = self::save_turn($user_id, $thread_id, $clean, $content, $shown, $actual, null);
            return self::reply($user_id, $content, $shown, $env_label, 'auto', $result, $actual, $thread_id);
        } finally {
            if (!$settled) {
                BDChat_Credits::add($user_id, $reserve, 'refund', 'router', 'Refund: request failed');
            }
        }
    }

    /** Model ID sent to OpenRouter. Web search adds OpenRouter's ':online' suffix. */
    private static function api_id(array $m): string
    {
        return self::web_effective($m) ? $m['model_id'] . ':online' : $m['model_id'];
    }

    private static function settle(int $user_id, int $reserve, int $actual, string $model_id): void
    {
        if ($actual < $reserve) {
            BDChat_Credits::add($user_id, $reserve - $actual, 'refund', $model_id, 'Settlement refund');
        } elseif ($actual > $reserve) {
            if (!BDChat_Credits::reserve($user_id, $actual - $reserve, $model_id, 'Settlement charge')) {
                error_log("BDChat: could not charge settlement difference for user {$user_id}");
            }
        }
    }

    private static function reply(int $user_id, string $content, string $model, ?string $env_label, string $mode, array $result, int $actual, $thread_id): array
    {
        return [
            'content' => $content,
            'imageUrl' => null,
            'model' => $model,
            'mode' => $mode,
            'environment' => $env_label,
            'usage' => ['inputTokens' => $result['input_tokens'], 'outputTokens' => $result['output_tokens'],
                'totalTokens' => $result['input_tokens'] + $result['output_tokens']],
            'credits' => ['charged' => $actual, 'remaining' => BDChat_Credits::balance($user_id)],
            'threadId' => $thread_id,
            'messageId' => self::$last_message_id,
        ];
    }

    private static function insufficient(int $user_id, int $required): WP_Error
    {
        return new WP_Error('bdchat_insufficient', 'Insufficient credits. Please add more credits to continue.', [
            'status' => 402, 'required' => $required, 'available' => BDChat_Credits::balance($user_id),
        ]);
    }

    private static function estimate_input(array $clean): int
    {
        $tokens = 300;
        foreach ($clean as $m) {
            $tokens += (int) ceil(mb_strlen($m['content']) / 3);
        }
        return $tokens;
    }

    /** Put the reply-language and plain-text instructions in front of the conversation. */
    private static function with_system(array $clean, string $language, int $user_id = 0): array
    {
        $msgs = array_values(array_filter($clean, fn($m) => $m['role'] !== 'system'));
        $system = BDChat_Router::system_prompt($language);
        $facts = trim((string) BDChat_Settings::get('company_context', ''));
        $system .= ' Do not invent names, people, dates, numbers, places, prices or events. '
            . 'Facts from web search results count as given. Use them, and never say you cannot access the internet or live news. '
            . 'If a fact is needed and is in neither the instructions below nor the web search results, say briefly which part is missing, without asking the user to paste it.';
        $about = $user_id ? BDChat_Memory::facts($user_id) : [];
        if ($about) {
            $system .= "\n\nWhat you know about this user (use it naturally when relevant, do not list it back unless asked):\n- " . implode("\n- ", $about);
        }
        if (self::$datetime_on) {
            $system .= "\n\nCurrent date and time (Bangladesh, Asia/Dhaka): " . wp_date('l, j F Y, H:i', null, new DateTimeZone('Asia/Dhaka')) . '.';
        }
        if ($facts !== '') {
            $system .= "\n\nFacts about the organisation and its programmes (use these; they are true):\n" . $facts;
        }
        array_unshift($msgs, ['role' => 'system', 'content' => $system]);
        return $msgs;
    }

    public static function image(int $user_id, string $prompt, ?int $selected_id, ?int $thread_id)
    {
        $model = $selected_id ? BDChat_Models::find_active_by_id($selected_id) : null;
        if (!$model || $model['kind'] !== 'image') {
            return new WP_Error('bdchat_model', 'Select an image model.', ['status' => 400]);
        }
        $prompt = trim($prompt);
        if ($prompt === '' || mb_strlen($prompt) > 4000) {
            return new WP_Error('bdchat_bad_request', 'Prompt must be 1 to 4000 characters.', ['status' => 400]);
        }

        $cost = BDChat_Pricing::image_credits($model);
        if (!BDChat_Credits::reserve($user_id, $cost, $model['model_id'], "Image: {$model['display_name']}")) {
            return new WP_Error('bdchat_insufficient', 'Insufficient credits. Please add more credits to continue.', [
                'status' => 402, 'required' => $cost, 'available' => BDChat_Credits::balance($user_id),
            ]);
        }

        $settled = false;
        try {
            $result = BDChat_Providers::image($model['model_id'], $prompt);
            if (is_wp_error($result)) {
                return $result;
            }
            $settled = true;
            $thread_id = self::save_turn($user_id, $thread_id, [['role' => 'user', 'content' => $prompt]],
                '', $model['display_name'], $cost, $result['url']);
            return [
                'content' => '',
                'imageUrl' => $result['url'],
                'model' => $model['display_name'],
                'mode' => 'manual',
                'usage' => ['inputTokens' => 0, 'outputTokens' => 0, 'totalTokens' => 0],
                'credits' => ['charged' => $cost, 'remaining' => BDChat_Credits::balance($user_id)],
                'threadId' => $thread_id,
            ];
        } finally {
            if (!$settled) {
                BDChat_Credits::add($user_id, $cost, 'refund', $model['model_id'], 'Refund: image failed');
            }
        }
    }

    private static function clean_messages(array $messages)
    {
        if (count($messages) === 0) {
            return new WP_Error('bdchat_bad_request', 'Send at least one message.', ['status' => 400]);
        }
        // Long chats: keep the newest 60 messages. The model still gets the recent context.
        if (count($messages) > 60) {
            $messages = array_slice($messages, -60);
        }
        $out = [];
        foreach ($messages as $m) {
            $role = is_array($m) ? ($m['role'] ?? '') : '';
            if (!in_array($role, ['user', 'assistant', 'system'], true)) {
                return new WP_Error('bdchat_bad_request', 'Invalid message role.', ['status' => 400]);
            }
            $content = (string) ($m['content'] ?? '');
            if (mb_strlen($content) > 20000) {
                return new WP_Error('bdchat_bad_request', 'A message is too long.', ['status' => 400]);
            }
            $out[] = ['role' => $role, 'content' => $content];
        }
        // Many models need the conversation to start with the user's message.
        while ($out && $out[0]['role'] === 'assistant') {
            array_shift($out);
        }
        return $out;
    }

    /** Store the last user message and the reply in a thread. Returns the thread id. */
    public static int $last_message_id = 0;

    private static function save_turn(int $user_id, ?int $thread_id, array $messages, string $reply, string $model, int $credits, ?string $image_url): int
    {
        global $wpdb;
        $t = $wpdb->prefix . 'bdchat_threads';
        $m = $wpdb->prefix . 'bdchat_messages';
        $last_user = '';
        foreach (array_reverse($messages) as $msg) {
            if ($msg['role'] === 'user') {
                $last_user = $msg['content'];
                break;
            }
        }
        if (!$thread_id) {
            $wpdb->insert($t, ['user_id' => $user_id, 'title' => mb_substr($last_user ?: 'New chat', 0, 60)]);
            $thread_id = (int) $wpdb->insert_id;
        } else {
            $owned = $wpdb->get_var($wpdb->prepare("SELECT id FROM {$t} WHERE id = %d AND user_id = %d", $thread_id, $user_id));
            if (!$owned) {
                $wpdb->insert($t, ['user_id' => $user_id, 'title' => mb_substr($last_user ?: 'New chat', 0, 60)]);
                $thread_id = (int) $wpdb->insert_id;
            }
        }
        $wpdb->insert($m, ['thread_id' => $thread_id, 'user_id' => $user_id, 'role' => 'user', 'content' => $last_user]);
        $wpdb->insert($m, ['thread_id' => $thread_id, 'user_id' => $user_id, 'role' => 'assistant',
            'content' => $reply, 'model' => $model, 'credits' => $credits, 'image_url' => $image_url]);
        self::$last_message_id = (int) $wpdb->insert_id;
        $wpdb->update($t, ['updated_at' => current_time('mysql')], ['id' => $thread_id]);
        BDChat_Memory::queue($user_id, $last_user, $reply);
        return $thread_id;
    }
}
