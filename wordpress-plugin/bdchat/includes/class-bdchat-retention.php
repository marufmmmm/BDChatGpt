<?php
if (!defined('ABSPATH')) {
    exit;
}

/**
 * Chat limits and history retention.
 * - Each user can keep up to 400 chat threads. At 400, new chats are blocked until one is deleted.
 * - Chat history is kept while the subscription is active, and for 3 months after it ends.
 *   The subscription end date is stored per user in 'bdchat_sub_ended' (Y-m-d). Users with no end date are never purged.
 */
class BDChat_Retention
{
    const MAX_THREADS = 400;
    const KEEP_DAYS_AFTER_END = 90; // about 3 months
    const META_SUB_ENDED = 'bdchat_sub_ended';
    const CRON_HOOK = 'bdchat_daily_retention';

    /** Whether this request may start a new thread (no thread id, or a thread the user does not own). */
    public static function can_start_thread(int $user_id, ?int $thread_id): bool
    {
        global $wpdb;
        $t = $wpdb->prefix . 'bdchat_threads';
        if ($thread_id) {
            $owned = $wpdb->get_var($wpdb->prepare("SELECT id FROM {$t} WHERE id = %d AND user_id = %d", $thread_id, $user_id));
            if ($owned) {
                return true;
            }
        }
        $count = (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM {$t} WHERE user_id = %d", $user_id));
        return $count < self::MAX_THREADS;
    }

    public static function limit_error(): WP_Error
    {
        return new WP_Error('bdchat_thread_limit',
            'You have reached the limit of ' . self::MAX_THREADS . ' chats. Delete an old chat to start a new one.',
            ['status' => 409]);
    }

    /** Record when a user's subscription ended. The payment system will call this. */
    public static function mark_subscription_ended(int $user_id, string $date_ymd): void
    {
        update_user_meta($user_id, self::META_SUB_ENDED, $date_ymd);
    }

    /** Delete chat history for users whose subscription ended more than 3 months ago. */
    public static function purge_expired(): int
    {
        global $wpdb;
        $cutoff = gmdate('Y-m-d', strtotime('-' . self::KEEP_DAYS_AFTER_END . ' days'));
        $users = get_users([
            'meta_key' => self::META_SUB_ENDED,
            'meta_value' => $cutoff,
            'meta_compare' => '<=',
            'fields' => 'ID',
            'number' => 500,
        ]);
        $purged = 0;
        foreach ($users as $uid) {
            $uid = (int) $uid;
            $wpdb->query($wpdb->prepare("DELETE FROM {$wpdb->prefix}bdchat_messages WHERE user_id = %d", $uid));
            $wpdb->query($wpdb->prepare("DELETE FROM {$wpdb->prefix}bdchat_threads WHERE user_id = %d", $uid));
            delete_user_meta($uid, self::META_SUB_ENDED);
            $purged++;
        }
        return $purged;
    }

    public static function schedule(): void
    {
        if (!wp_next_scheduled(self::CRON_HOOK)) {
            wp_schedule_event(time() + HOUR_IN_SECONDS, 'daily', self::CRON_HOOK);
        }
    }

    public static function unschedule(): void
    {
        $ts = wp_next_scheduled(self::CRON_HOOK);
        if ($ts) {
            wp_unschedule_event($ts, self::CRON_HOOK);
        }
    }
}
