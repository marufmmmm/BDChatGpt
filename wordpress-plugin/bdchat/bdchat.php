<?php
/**
 * Plugin Name: BD ChatGPT
 * Description: Multi-model AI chat for WordPress with WordPress login, prepaid credits, and an admin panel.
 * Version: 1.0.0
 * Requires at least: 6.0
 * Requires PHP: 7.4
 * Text Domain: bdchat
 * License: GPL-2.0-or-later
 */

if (!defined('ABSPATH')) {
    exit;
}

define('BDCHAT_VERSION', '1.0.0');
define('BDCHAT_DB_VERSION', '9');
define('BDCHAT_DIR', plugin_dir_path(__FILE__));
define('BDCHAT_URL', plugin_dir_url(__FILE__));

require_once BDCHAT_DIR . 'includes/class-bdchat-core.php';
require_once BDCHAT_DIR . 'includes/class-bdchat-keys.php';
require_once BDCHAT_DIR . 'includes/class-bdchat-router.php';
require_once BDCHAT_DIR . 'includes/class-bdchat-rest.php';
require_once BDCHAT_DIR . 'includes/class-bdchat-retention.php';
require_once BDCHAT_DIR . 'includes/class-bdchat-memory.php';
require_once BDCHAT_DIR . 'includes/class-bdchat-jobs.php';

register_activation_hook(__FILE__, 'bdchat_activate');
add_action('plugins_loaded', 'bdchat_maybe_upgrade');
add_action('init', 'bdchat_home_setup_once');
add_action('rest_api_init', ['BDChat_REST', 'register_routes']);
add_action('user_register', ['BDChat_Credits', 'welcome_bonus']);
add_action('admin_menu', 'bdchat_admin_menu');
add_shortcode('bdchat', 'bdchat_shortcode');
add_filter('template_include', 'bdchat_template');
add_action('wp_enqueue_scripts', 'bdchat_enqueue_front');
add_filter('script_loader_tag', 'bdchat_module_tag', 10, 3);
add_action('init', [BDChat_Retention::class, 'schedule']);
add_action(BDChat_Retention::CRON_HOOK, [BDChat_Retention::class, 'purge_expired']);
add_action(BDChat_Memory::HOOK, [BDChat_Memory::class, 'learn'], 10, 3);
register_deactivation_hook(__FILE__, [BDChat_Retention::class, 'unschedule']);
add_action('admin_enqueue_scripts', 'bdchat_enqueue_admin');
BDChat_Keys::register();
BDChat_Jobs::register();

function bdchat_activate(): void
{
    bdchat_install();
    bdchat_setup_home_page();
}

/**
 * Creates a "BD ChatGPT" page containing [bdchat] (if no page has it yet)
 * and sets it as the site's home page. Runs once, on activation.
 */
function bdchat_setup_home_page(): void
{
    $page_id = 0;
    $pages = get_pages(['post_status' => 'publish']);
    foreach ($pages as $page) {
        if (has_shortcode($page->post_content, 'bdchat')) {
            $page_id = (int) $page->ID;
            break;
        }
    }
    if (!$page_id) {
        $page_id = (int) wp_insert_post([
            'post_title' => 'BD ChatGPT',
            'post_name' => 'bdchat',
            'post_content' => '[bdchat]',
            'post_status' => 'publish',
            'post_type' => 'page',
        ]);
    }
    if ($page_id) {
        update_option('show_on_front', 'page');
        update_option('page_on_front', $page_id);
    }
}

function bdchat_maybe_upgrade(): void
{
    if (get_option('bdchat_db_version') !== BDCHAT_DB_VERSION) {
        bdchat_install();
    }
}

/** Once WordPress is fully loaded, create the BD ChatGPT home page if it is missing. */
function bdchat_home_setup_once(): void
{
    if (get_option('bdchat_home_done')) {
        return;
    }
    bdchat_setup_home_page();
    update_option('bdchat_home_done', 1);
}

function bdchat_install(): void
{
    global $wpdb;
    require_once ABSPATH . 'wp-admin/includes/upgrade.php';
    $c = $wpdb->get_charset_collate();

    dbDelta("CREATE TABLE {$wpdb->prefix}bdchat_wallets (
        user_id BIGINT UNSIGNED NOT NULL,
        balance INT NOT NULL DEFAULT 0,
        used INT NOT NULL DEFAULT 0,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id)
    ) {$c};");

    dbDelta("CREATE TABLE {$wpdb->prefix}bdchat_ledger (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id BIGINT UNSIGNED NOT NULL,
        delta INT NOT NULL,
        type VARCHAR(20) NOT NULL,
        model VARCHAR(190) NOT NULL DEFAULT '',
        description VARCHAR(255) NOT NULL DEFAULT '',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY user_id (user_id)
    ) {$c};");

    dbDelta("CREATE TABLE {$wpdb->prefix}bdchat_models (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        model_id VARCHAR(190) NOT NULL,
        provider VARCHAR(40) NOT NULL,
        display_name VARCHAR(120) NOT NULL,
        kind VARCHAR(10) NOT NULL DEFAULT 'chat',
        input_cost_per_mtok DECIMAL(12,4) NOT NULL DEFAULT 0,
        output_cost_per_mtok DECIMAL(12,4) NOT NULL DEFAULT 0,
        image_cost_per_image DECIMAL(12,4) NOT NULL DEFAULT 0,
        credit_multiplier DECIMAL(6,2) NOT NULL DEFAULT 2.00,
        minimum_credits INT NOT NULL DEFAULT 1,
        max_output_tokens INT NOT NULL DEFAULT 4096,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        manual_selection_enabled TINYINT(1) NOT NULL DEFAULT 1,
        auto_router_enabled TINYINT(1) NOT NULL DEFAULT 0,
        fixed_credits INT NOT NULL DEFAULT 0,
        next_fixed_credits INT NOT NULL DEFAULT 0,
        next_credits_from DATETIME NULL,
        web_search TINYINT(1) NOT NULL DEFAULT 0,
        sort_order INT NOT NULL DEFAULT 0,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY model_id (model_id)
    ) {$c};");

    dbDelta("CREATE TABLE {$wpdb->prefix}bdchat_threads (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id BIGINT UNSIGNED NOT NULL,
        title VARCHAR(120) NOT NULL DEFAULT 'New chat',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY user_id (user_id)
    ) {$c};");

    dbDelta("CREATE TABLE {$wpdb->prefix}bdchat_messages (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        thread_id BIGINT UNSIGNED NOT NULL,
        user_id BIGINT UNSIGNED NOT NULL,
        role VARCHAR(12) NOT NULL,
        content LONGTEXT NOT NULL,
        model VARCHAR(120) NOT NULL DEFAULT '',
        credits INT NOT NULL DEFAULT 0,
        image_url TEXT NULL,
        feedback TINYINT NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY thread_id (thread_id)
    ) {$c};");

    dbDelta("CREATE TABLE {$wpdb->prefix}bdchat_route_log (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id BIGINT UNSIGNED NOT NULL,
        model_id VARCHAR(190) NOT NULL,
        input_tokens INT NOT NULL DEFAULT 0,
        output_tokens INT NOT NULL DEFAULT 0,
        real_usd DECIMAL(12,6) NOT NULL DEFAULT 0,
        credits INT NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY user_id (user_id)
    ) {$c};");

    dbDelta("CREATE TABLE {$wpdb->prefix}bdchat_memories (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id BIGINT UNSIGNED NOT NULL,
        fact VARCHAR(255) NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY user_id (user_id)
    ) {$c};");

    // Smart AI is always present; admins cannot pick it manually.
    global $wpdb;
    $smart = $wpdb->prefix . 'bdchat_models';
    if (!$wpdb->get_var($wpdb->prepare("SELECT id FROM {$smart} WHERE model_id = %s", 'openrouter/auto'))) {
        $wpdb->insert($smart, [
            'model_id' => 'openrouter/auto', 'provider' => 'openrouter', 'display_name' => 'Smart AI',
            'kind' => 'chat', 'minimum_credits' => 1, 'manual_selection_enabled' => 0, 'sort_order' => 0,
        ]);
    }

    // Model catalog. Credits per message are fixed per model (owner's credit table).
    // [model_id, provider, name, input $/1M, output $/1M, fixed credits per message]
    // Models in this list are switched on and added to Smart AI on upgrade.
    $catalog = [
        ['openai/gpt-6-luna', 'openai', 'GPT-6 Luna', 0.10, 0.50, 1],
        ['openai/gpt-6.1-terra', 'openai', 'GPT-6.1 Terra', 1.00, 5.00, 6],
        ['openai/gpt-6.1-sol', 'openai', 'GPT-6.1 Sol', 2.00, 10.00, 12],
        ['openai/gpt-6-astra', 'openai', 'GPT-6 Astra', 10.00, 50.00, 55],
        ['google/gemini-3.1-flash-lite', 'google', 'Gemini 3.1 Flash Lite', 0.25, 1.50, 2],
        ['google/gemini-3.8-flash', 'google', 'Gemini 3.8 Flash', 0.75, 3.75, 4],
        ['google/gemini-3.1-pro-preview', 'google', 'Gemini 3.1 Pro (preview)', 2.00, 12.00, 13],
        ['google/gemini-4-argon', 'google', 'Gemini 4 Argon', 2.00, 10.00, 12],
        ['anthropic/claude-sonnet-5.5', 'anthropic', 'Claude Sonnet 5.5', 2.00, 10.00, 15],
        ['anthropic/claude-opus-5.5', 'anthropic', 'Claude Opus 5.5', 4.00, 20.00, 30],
        ['x-ai/grok-build-0.1', 'x-ai', 'Grok Build 0.1', 1.00, 2.00, 3],
        ['x-ai/grok-4.3', 'x-ai', 'Grok 4.3', 1.25, 2.50, 4],
        ['x-ai/grok-4.7', 'x-ai', 'Grok 4.7', 2.00, 6.00, 8],
        ['deepseek/deepseek-flash', 'deepseek', 'DeepSeek Flash', 0.15, 0.60, 1],
        ['deepseek/deepseek-v4-pro', 'deepseek', 'DeepSeek V4 Pro', 0.66, 1.98, 3],
    ];
    foreach ($catalog as [$mid, $prov, $name, $in, $out, $fixed]) {
        $row = $wpdb->get_row($wpdb->prepare("SELECT id FROM {$smart} WHERE model_id = %s", $mid), ARRAY_A);
        $data = [
            'provider' => $prov, 'display_name' => $name, 'kind' => 'chat',
            'input_cost_per_mtok' => $in, 'output_cost_per_mtok' => $out, 'fixed_credits' => $fixed,
            'is_active' => 1, 'manual_selection_enabled' => 1, 'auto_router_enabled' => 1,
        ];
        if ($row) {
            $wpdb->update($smart, $data, ['id' => (int) $row['id']]);
        } else {
            $wpdb->insert($smart, array_merge(['model_id' => $mid], $data));
        }
    }
    // One-time: turn web search on for every chat model (admin can still switch any model off).
    if (!get_option('bdchat_web_all_v1')) {
        $wpdb->query("UPDATE {$smart} SET web_search = 1 WHERE kind = 'chat' AND model_id <> 'openrouter/auto'");
        update_option('bdchat_web_all_v1', 1);
    }

    // Scheduled credit price changes (owner's dates, site timezone).
    $wpdb->update($smart, ['next_fixed_credits' => 24, 'next_credits_from' => '2026-12-01 00:00:00'], ['model_id' => 'google/gemini-4-argon']);
    $wpdb->update($smart, ['next_fixed_credits' => 8, 'next_credits_from' => '2027-01-01 00:00:00'], ['model_id' => 'google/gemini-3.8-flash']);

    // Earlier test model that is not in the owner's list: switch it off.
    $wpdb->update($smart, ['is_active' => 0, 'auto_router_enabled' => 0], ['model_id' => 'openai/gpt-4o-mini']);

    add_option('bdchat_settings', [
        'smart_ai_cost_tier' => 'low',
        'usd_to_bdt_rate' => 127,
        'signup_enabled' => 1,
        'signup_bonus' => 100,
    ]);

    update_option('bdchat_db_version', BDCHAT_DB_VERSION);
}

function bdchat_admin_menu(): void
{
    add_menu_page('BD ChatGPT', 'BD ChatGPT', 'manage_options', 'bdchat-admin',
        'bdchat_admin_page', 'dashicons-format-chat', 26);
}

function bdchat_admin_page(): void
{
    echo '<div class="wrap" style="margin:0;padding:0"><div id="root" data-bdchat-view="admin"></div></div>';
}

function bdchat_shortcode(): string
{
    if (!is_user_logged_in()) {
        return '<div id="root" data-bdchat-view="login"></div>';
    }
    return '<div id="root" data-bdchat-view="app"></div>';
}

/** Localised data the React app reads on load. */
function bdchat_boot_data(): array
{
    return [
        'restUrl' => esc_url_raw(rest_url('bdchat/v1/')),
        'nonce' => wp_create_nonce('wp_rest'),
        'loginUrl' => wp_login_url(home_url('/')),
        'logoutUrl' => wp_logout_url(home_url('/')),
    ];
}

function bdchat_enqueue_front(): void
{
    // Load the app only on pages that contain the [bdchat] shortcode.
    global $post;
    if (is_a($post, 'WP_Post') && has_shortcode($post->post_content, 'bdchat')) {
        bdchat_enqueue_bundle();
    }
}

function bdchat_enqueue_admin(string $hook): void
{
    if ($hook === 'toplevel_page_bdchat-admin') {
        bdchat_enqueue_bundle();
    }
}

function bdchat_enqueue_bundle(): void
{
    $manifest_path = BDCHAT_DIR . 'assets/.vite/manifest.json';
    if (!file_exists($manifest_path)) {
        return;
    }
    $manifest = json_decode((string) file_get_contents($manifest_path), true);
    $entry = $manifest['index.html'] ?? null;
    if (!$entry) {
        return;
    }
    foreach ($entry['css'] ?? [] as $i => $css) {
        wp_enqueue_style('bdchat-css-' . $i, BDCHAT_URL . 'assets/' . $css, [], BDCHAT_VERSION);
    }
    wp_enqueue_style('bdchat-layout', BDCHAT_URL . 'css/bdchat-layout.css', [], BDCHAT_VERSION);
    wp_enqueue_script('bdchat-app', BDCHAT_URL . 'assets/' . $entry['file'], [], BDCHAT_VERSION, true);
    wp_localize_script('bdchat-app', 'BDCHAT', bdchat_boot_data());
}

/** The app bundle is an ES module (it is split into chunks), so it must load as type="module". */
function bdchat_module_tag(string $tag, string $handle, string $src): string
{
    if ($handle === 'bdchat-app' && strpos($tag, 'type=') === false) {
        return str_replace('<script ', '<script type="module" ', $tag);
    }
    return $tag;
}

/** Pages with [bdchat] use a full-page template: no theme header, no sidebar. */
function bdchat_template(string $template): string
{
    if (is_singular('page')) {
        global $post;
        if (is_a($post, 'WP_Post') && has_shortcode($post->post_content, 'bdchat')) {
            return BDCHAT_DIR . 'templates/app.php';
        }
    }
    return $template;
}
