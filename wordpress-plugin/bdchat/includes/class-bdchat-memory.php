<?php
if (!defined('ABSPATH')) {
    exit;
}

/**
 * Per-user memory. After each reply, a cheap model lists durable, non-sensitive facts about the user.
 * Facts are stored per user only, never shared with other users.
 * Sensitive topics (politics, religion, health, money, cards, IDs, passwords, minors) are dropped.
 */
class BDChat_Memory
{
    const MAX_FACTS = 30;
    const HOOK = 'bdchat_learn';

    /** Words that mark a fact as sensitive (English and Bangla). Matching facts are never stored. */
    const BLOCK = '/(religio|muslim|hindu|christian|buddhis|islam|politic|party|election|vote|bnp|awami|jamaat|'
        . 'health|disease|diabet|cancer|pregnan|medicin|hospital|depress|illness|therapy|'
        . 'salary|income|loan|bank|credit card|debit card|card number|\\bnid\\b|passport|birth certificate|password|\\bpin\\b|'
        . 'bkash|nagad|rocket|debt|sexual|gay|lesbian|abuse|suicid|self-harm|police|arrest|'
        . '\\bage\\b|years old|minor|school student|'
        . 'ধর্ম|মুসলিম|হিন্দু|খ্রিস্টান|বৌদ্ধ|ইসলাম|রাজনীতি|ভোট|স্বাস্থ্য|অসুস্থ|রোগ|হাসপাতাল|চিকিৎসা|'
        . 'বেতন|ঋণ|ব্যাংক|কার্ড|এনআইডি|পাসপোর্ট|পাসওয়ার্ড|বিকাশ|নগদ|বয়স)/iu';

    public static function table(): string
    {
        global $wpdb;
        return $wpdb->prefix . 'bdchat_memories';
    }

    /** Facts for one user, newest first. */
    public static function facts(int $user_id): array
    {
        global $wpdb;
        $rows = $wpdb->get_col($wpdb->prepare(
            'SELECT fact FROM ' . self::table() . ' WHERE user_id = %d ORDER BY id DESC LIMIT %d',
            $user_id, self::MAX_FACTS));
        return array_values(array_filter(array_map('strval', $rows ?: [])));
    }

    /** Ask a cheap model for durable facts from one exchange, then store the safe ones. Runs in the background. */
    public static function learn(int $user_id, string $user_message, string $reply): void
    {
        if ($user_id <= 0 || trim($user_message) === '') {
            return;
        }
        $classifier = BDChat_Router::classifier_row();
        if (!$classifier) {
            return;
        }
        $instruction = 'Read the exchange. List durable facts about the USER that would help future replies, '
            . 'such as name, job, study, interests, goals, family context, or preferred language. '
            . 'Do NOT include: one-time requests, facts about other people, politics, religion, health, money, bank or card details, '
            . 'ID numbers, passwords, age, or anything sexual or violent. '
            . 'Reply with a JSON array of short strings, in the user\'s language. Reply with [] if nothing qualifies. Nothing else.';
        $res = BDChat_Providers::chat($classifier['model_id'], [
            ['role' => 'system', 'content' => $instruction],
            ['role' => 'user', 'content' => 'User said: ' . mb_substr($user_message, 0, 1200)
                . "\nAssistant replied: " . mb_substr($reply, 0, 600)],
        ], 300, null, null);
        if (is_wp_error($res)) {
            return;
        }
        $content = (string) $res['content'];
        if (!preg_match('/\[.*\]/su', $content, $match)) {
            return;
        }
        $items = json_decode($match[0], true);
        if (!is_array($items)) {
            return;
        }
        $existing = array_map('mb_strtolower', self::facts($user_id));
        global $wpdb;
        foreach ($items as $item) {
            $fact = trim(sanitize_text_field((string) $item));
            $len = mb_strlen($fact);
            if ($len < 3 || $len > 200) {
                continue;
            }
            if (preg_match(self::BLOCK, $fact) || in_array(mb_strtolower($fact), $existing, true)) {
                continue;
            }
            $wpdb->insert(self::table(), ['user_id' => $user_id, 'fact' => $fact]);
            $existing[] = mb_strtolower($fact);
        }
        // Keep only the newest MAX_FACTS per user.
        $wpdb->query($wpdb->prepare(
            'DELETE FROM ' . self::table() . ' WHERE user_id = %d AND id NOT IN ('
            . 'SELECT id FROM (SELECT id FROM ' . self::table() . ' WHERE user_id = %d ORDER BY id DESC LIMIT %d) AS keep_rows)',
            $user_id, $user_id, self::MAX_FACTS));
    }

    /** Queue learning after a reply, so the user does not wait for it. */
    public static function queue(int $user_id, string $user_message, string $reply): void
    {
        if (!wp_next_scheduled(self::HOOK, [$user_id, $user_message, $reply])) {
            wp_schedule_single_event(time(), self::HOOK, [$user_id, $user_message, $reply]);
        }
    }
}
