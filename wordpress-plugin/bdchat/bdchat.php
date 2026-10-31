<?php
/**
 * Plugin Name: BDChat AI Workspace
 * Plugin URI: https://bdchat.app
 * Description: Embeds the BDChat AI workspace into WordPress with Supabase authentication and AI tools.
 * Version: 1.0.0
 * Author: BDChat
 * License: GPL-2.0-or-later
 * Text Domain: bdchat
 */

defined('ABSPATH') || exit;

define('BDCHAT_VERSION', '1.0.0');
define('BDCHAT_PLUGIN_URL', plugin_dir_url(__FILE__));
define('BDCHAT_PLUGIN_PATH', plugin_dir_path(__FILE__));

function bdchat_register_assets() {
    $manifest_path = BDCHAT_PLUGIN_PATH . 'assets/.vite/manifest.json';
    if (!file_exists($manifest_path)) {
        return;
    }

    $manifest = json_decode(file_get_contents($manifest_path), true);
    $entry = $manifest['index.html'] ?? null;
    if (!$entry) {
        return;
    }

    if (!empty($entry['css'])) {
        foreach ($entry['css'] as $index => $css_file) {
            wp_register_style(
                'bdchat-style-' . $index,
                BDCHAT_PLUGIN_URL . 'assets/' . $css_file,
                array(),
                BDCHAT_VERSION
            );
        }
    }

    if (!empty($entry['file'])) {
        wp_register_script(
            'bdchat-app',
            BDCHAT_PLUGIN_URL . 'assets/' . $entry['file'],
            array(),
            BDCHAT_VERSION,
            true
        );
    }
}
add_action('wp_enqueue_scripts', 'bdchat_register_assets');

function bdchat_shortcode() {
    $manifest_path = BDCHAT_PLUGIN_PATH . 'assets/.vite/manifest.json';
    if (!file_exists($manifest_path)) {
        return '<p>BDChat assets are missing. Please reinstall the plugin.</p>';
    }

    $manifest = json_decode(file_get_contents($manifest_path), true);
    $entry = $manifest['index.html'] ?? null;
    if (!$entry) {
        return '<p>BDChat could not load its application files.</p>';
    }

    if (!empty($entry['css'])) {
        foreach ($entry['css'] as $index => $css_file) {
            wp_enqueue_style('bdchat-style-' . $index);
        }
    }
    wp_enqueue_script('bdchat-app');

    return '<div id="bdchat-root" class="bdchat-root" aria-label="BDChat AI workspace"></div>';
}
add_shortcode('bdchat', 'bdchat_shortcode');

function bdchat_add_shortcode_button($editor_id) {
    if (!current_user_can('edit_posts')) {
        return;
    }
    echo '<button type="button" class="button" style="margin:6px 0" onclick="document.execCommand(\'insertText\', false, \'[bdchat]\')">Add BDChat workspace</button>';
}
add_action('media_buttons', 'bdchat_add_shortcode_button');
