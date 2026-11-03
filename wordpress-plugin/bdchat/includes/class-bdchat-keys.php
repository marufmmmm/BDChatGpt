<?php
if (!defined('ABSPATH')) {
    exit;
}

/**
 * API key settings page, protected by a 6-digit PIN.
 * - The PIN is stored only as a bcrypt hash. It is never shown again.
 * - Keys are encrypted with AES-256 using the site's AUTH_KEY before they are saved.
 * - wp-config.php constants still work and take priority, for later.
 */
class BDChat_Keys
{
    const PIN_OPTION = 'bdchat_pin_hash';
    const KEYS_OPTION = 'bdchat_keys_enc';
    const UNLOCK_MINUTES = 15;
    const MAX_FAILS = 5;
    const LOCK_MINUTES = 15;
    const PAGE = 'bdchat-keys';

    /** Names used in the form, mapped to the wp-config constant they replace. */
    const KEYS = [
        'openrouter' => ['label' => 'OpenRouter API key', 'constant' => 'BDCHAT_OPENROUTER_KEY', 'help' => 'Used for all chat models (Smart AI and the environments).'],
        'openai' => ['label' => 'OpenAI API key', 'constant' => 'BDCHAT_OPENAI_KEY', 'help' => 'Used for image generation.'],
    ];

    public static function register(): void
    {
        add_action('admin_menu', [self::class, 'menu']);
        add_action('admin_post_bdchat_pin_set', [self::class, 'handle_pin_set']);
        add_action('admin_post_bdchat_pin_unlock', [self::class, 'handle_unlock']);
        add_action('admin_post_bdchat_pin_change', [self::class, 'handle_pin_change']);
        add_action('admin_post_bdchat_keys_save', [self::class, 'handle_keys_save']);
        add_action('admin_post_bdchat_lock', [self::class, 'handle_lock']);
    }

    public static function menu(): void
    {
        add_submenu_page('bdchat-admin', 'API Keys', 'API Keys', 'manage_options', self::PAGE, [self::class, 'render']);
    }

    /* ---------- keys ---------- */

    /** Key value for 'openrouter' or 'openai': wp-config constant first, then the saved encrypted key. */
    public static function get(string $name): string
    {
        $constant = self::KEYS[$name]['constant'] ?? '';
        if ($constant && defined($constant) && (string) constant($constant) !== '') {
            return (string) constant($constant);
        }
        $all = get_option(self::KEYS_OPTION, []);
        if (is_array($all) && !empty($all[$name])) {
            return self::decrypt((string) $all[$name]);
        }
        return '';
    }

    public static function is_set(string $name): bool
    {
        return self::get($name) !== '';
    }

    public static function save(string $name, string $value): void
    {
        $all = get_option(self::KEYS_OPTION, []);
        if (!is_array($all)) {
            $all = [];
        }
        $all[$name] = self::encrypt($value);
        update_option(self::KEYS_OPTION, $all, false);
    }

    private static function cipher_key(): string
    {
        $secret = defined('AUTH_KEY') ? AUTH_KEY : 'bdchat-fallback';
        return hash('sha256', $secret . '|bdchat-keys', true);
    }

    public static function encrypt(string $value): string
    {
        $iv = random_bytes(16);
        $cipher = openssl_encrypt($value, 'aes-256-cbc', self::cipher_key(), OPENSSL_RAW_DATA, $iv);
        return base64_encode($iv . $cipher);
    }

    public static function decrypt(string $stored): string
    {
        $raw = base64_decode($stored, true);
        if ($raw === false || strlen($raw) <= 16) {
            return '';
        }
        $plain = openssl_decrypt(substr($raw, 16), 'aes-256-cbc', self::cipher_key(), OPENSSL_RAW_DATA, substr($raw, 0, 16));
        return $plain === false ? '' : $plain;
    }

    private static function mask(string $value): string
    {
        return $value === '' ? '' : '•••• ' . substr($value, -4);
    }

    /* ---------- PIN ---------- */

    public static function pin_is_set(): bool
    {
        return (string) get_option(self::PIN_OPTION, '') !== '';
    }

    public static function valid_pin(string $pin): bool
    {
        return (bool) preg_match('/^\d{6}$/', $pin);
    }

    public static function set_pin(string $pin): void
    {
        update_option(self::PIN_OPTION, password_hash($pin, PASSWORD_BCRYPT), false);
    }

    private static function locked_key(): string
    {
        return 'bdchat_pin_locked_' . get_current_user_id();
    }

    private static function fails_key(): string
    {
        return 'bdchat_pin_fails_' . get_current_user_id();
    }

    public static function is_locked_out(): bool
    {
        return (bool) get_transient(self::locked_key());
    }

    /** Returns true only when the PIN matches. Counts failures and locks after too many. */
    public static function check_pin(string $pin): bool
    {
        if (self::is_locked_out()) {
            return false;
        }
        $hash = (string) get_option(self::PIN_OPTION, '');
        if ($hash !== '' && self::valid_pin($pin) && password_verify($pin, $hash)) {
            delete_transient(self::fails_key());
            return true;
        }
        $fails = (int) get_transient(self::fails_key()) + 1;
        set_transient(self::fails_key(), $fails, self::LOCK_MINUTES * MINUTE_IN_SECONDS);
        if ($fails >= self::MAX_FAILS) {
            set_transient(self::locked_key(), 1, self::LOCK_MINUTES * MINUTE_IN_SECONDS);
            delete_transient(self::fails_key());
        }
        return false;
    }

    public static function unlock(): void
    {
        set_transient('bdchat_unlocked_' . get_current_user_id(), 1, self::UNLOCK_MINUTES * MINUTE_IN_SECONDS);
    }

    public static function lock(): void
    {
        delete_transient('bdchat_unlocked_' . get_current_user_id());
    }

    public static function is_unlocked(): bool
    {
        return (bool) get_transient('bdchat_unlocked_' . get_current_user_id());
    }

    /* ---------- handlers ---------- */

    private static function guard(): void
    {
        if (!current_user_can('manage_options')) {
            wp_die('Not allowed.');
        }
        check_admin_referer('bdchat_keys');
    }

    private static function back(string $message = '', string $type = 'ok'): void
    {
        if ($message !== '') {
            set_transient('bdchat_keys_flash_' . get_current_user_id(), ['m' => $message, 't' => $type], 60);
        }
        wp_safe_redirect(admin_url('admin.php?page=' . self::PAGE));
        exit;
    }

    public static function handle_pin_set(): void
    {
        self::guard();
        $pin = sanitize_text_field(wp_unslash($_POST['pin'] ?? ''));
        $confirm = sanitize_text_field(wp_unslash($_POST['pin_confirm'] ?? ''));
        if (self::pin_is_set()) {
            self::back('A PIN is already set.', 'err');
        }
        if (!self::valid_pin($pin)) {
            self::back('The PIN must be exactly 6 digits.', 'err');
        }
        if ($pin !== $confirm) {
            self::back('The two PINs do not match.', 'err');
        }
        self::set_pin($pin);
        self::unlock();
        self::back('PIN set. Keep it safe: it cannot be shown again.');
    }

    public static function handle_unlock(): void
    {
        self::guard();
        if (self::is_locked_out()) {
            self::back('Too many wrong attempts. Try again in ' . self::LOCK_MINUTES . ' minutes.', 'err');
        }
        $pin = sanitize_text_field(wp_unslash($_POST['pin'] ?? ''));
        if (!self::check_pin($pin)) {
            self::back('Wrong PIN.', 'err');
        }
        self::unlock();
        self::back('Unlocked.');
    }

    public static function handle_pin_change(): void
    {
        self::guard();
        if (!self::is_unlocked()) {
            self::back('Unlock first.', 'err');
        }
        $old = sanitize_text_field(wp_unslash($_POST['old_pin'] ?? ''));
        $new = sanitize_text_field(wp_unslash($_POST['new_pin'] ?? ''));
        if (!self::check_pin($old)) {
            self::back('Current PIN is wrong.', 'err');
        }
        if (!self::valid_pin($new)) {
            self::back('The new PIN must be exactly 6 digits.', 'err');
        }
        self::set_pin($new);
        self::back('PIN changed.');
    }

    public static function handle_keys_save(): void
    {
        self::guard();
        if (!self::is_unlocked()) {
            self::back('Unlock with your PIN first.', 'err');
        }
        $saved = [];
        foreach (self::KEYS as $name => $info) {
            $value = trim(sanitize_text_field(wp_unslash($_POST[$name] ?? '')));
            if ($value === '') {
                continue; // blank means "keep the current key"
            }
            self::save($name, $value);
            $saved[] = $info['label'];
        }
        self::back($saved ? 'Saved: ' . implode(', ', $saved) . '.' : 'Nothing to save. Leave a box blank to keep its current key.');
    }

    public static function handle_lock(): void
    {
        self::guard();
        self::lock();
        self::back('Locked.');
    }

    /* ---------- page ---------- */

    public static function render(): void
    {
        if (!current_user_can('manage_options')) {
            wp_die('Not allowed.');
        }
        $uid = get_current_user_id();
        $flash = get_transient('bdchat_keys_flash_' . $uid);
        delete_transient('bdchat_keys_flash_' . $uid);

        echo '<div class="wrap"><h1>BD ChatGPT API Keys</h1>';
        if (is_array($flash)) {
            $color = $flash['t'] === 'err' ? '#b91c1c' : '#0f766e';
            echo '<div style="padding:10px 14px;border-radius:8px;background:#f8fafc;border:1px solid #e2e8f0;color:' . esc_attr($color) . ';margin:12px 0;max-width:640px">'
                . esc_html($flash['m']) . '</div>';
        }

        if (!self::pin_is_set()) {
            self::render_set_pin();
        } elseif (!self::is_unlocked()) {
            self::render_unlock();
        } else {
            self::render_keys();
        }
        echo '</div>';
    }

    private static function box_style(): string
    {
        return 'max-width:640px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin-top:12px';
    }

    private static function field_style(): string
    {
        return 'width:100%;max-width:460px;height:38px;padding:0 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px';
    }

    private static function button_style(): string
    {
        return 'height:38px;padding:0 16px;border-radius:8px;border:0;background:#0f766e;color:#fff;font-weight:600;cursor:pointer';
    }

    private static function render_set_pin(): void
    {
        echo '<div style="' . self::box_style() . '"><h2>Set your PIN</h2>';
        echo '<p>Choose a 6-digit PIN. You will need it to view or change the API keys.</p>';
        echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
        wp_nonce_field('bdchat_keys');
        echo '<input type="hidden" name="action" value="bdchat_pin_set">';
        echo '<p><label>New PIN (6 digits)<br><input type="password" name="pin" inputmode="numeric" maxlength="6" pattern="\d{6}" required style="' . self::field_style() . '"></label></p>';
        echo '<p><label>Confirm PIN<br><input type="password" name="pin_confirm" inputmode="numeric" maxlength="6" pattern="\d{6}" required style="' . self::field_style() . '"></label></p>';
        echo '<button type="submit" style="' . self::button_style() . '">Set PIN</button></form></div>';
    }

    private static function render_unlock(): void
    {
        echo '<div style="' . self::box_style() . '"><h2>Enter your PIN</h2>';
        if (self::is_locked_out()) {
            echo '<p style="color:#b91c1c">Too many wrong attempts. Try again in ' . self::LOCK_MINUTES . ' minutes.</p></div>';
            return;
        }
        echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
        wp_nonce_field('bdchat_keys');
        echo '<input type="hidden" name="action" value="bdchat_pin_unlock">';
        echo '<p><label>PIN<br><input type="password" name="pin" inputmode="numeric" maxlength="6" required autofocus style="' . self::field_style() . '"></label></p>';
        echo '<button type="submit" style="' . self::button_style() . '">Unlock</button></form></div>';
    }

    private static function render_keys(): void
    {
        echo '<div style="' . self::box_style() . '"><h2>Keys</h2>';
        echo '<p style="color:#64748b">Keys are stored encrypted. Leave a box empty to keep the saved key.</p>';
        echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
        wp_nonce_field('bdchat_keys');
        echo '<input type="hidden" name="action" value="bdchat_keys_save">';
        foreach (self::KEYS as $name => $info) {
            $status = self::is_set($name) ? 'Saved: ' . self::mask(self::get($name)) : 'Not set';
            $source = (defined($info['constant']) && (string) constant($info['constant']) !== '') ? ' (set in wp-config.php)' : '';
            echo '<p><label><strong>' . esc_html($info['label']) . '</strong><br>';
            echo '<input type="password" name="' . esc_attr($name) . '" autocomplete="off" placeholder="' . esc_attr($status . $source) . '" style="' . self::field_style() . '"></label><br>';
            echo '<span style="color:#64748b;font-size:12px">' . esc_html($info['help']) . '</span></p>';
        }
        echo '<button type="submit" style="' . self::button_style() . '">Save keys</button></form>';

        echo '<hr style="margin:20px 0;border:0;border-top:1px solid #e2e8f0">';
        echo '<h3>Change PIN</h3><form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
        wp_nonce_field('bdchat_keys');
        echo '<input type="hidden" name="action" value="bdchat_pin_change">';
        echo '<p><input type="password" name="old_pin" placeholder="Current PIN" inputmode="numeric" maxlength="6" required style="' . self::field_style() . '"></p>';
        echo '<p><input type="password" name="new_pin" placeholder="New PIN (6 digits)" inputmode="numeric" maxlength="6" required style="' . self::field_style() . '"></p>';
        echo '<button type="submit" style="' . self::button_style() . '">Change PIN</button></form>';

        echo '<hr style="margin:20px 0;border:0;border-top:1px solid #e2e8f0">';
        echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
        wp_nonce_field('bdchat_keys');
        echo '<input type="hidden" name="action" value="bdchat_lock">';
        echo '<button type="submit" style="height:38px;padding:0 16px;border-radius:8px;border:1px solid #cbd5e1;background:#fff;font-weight:600;cursor:pointer">Lock now</button></form>';
        echo '</div>';
    }
}
