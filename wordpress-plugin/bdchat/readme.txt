=== BD ChatGPT ===
Contributors: bdchat
Requires at least: 6.0
Tested up to: 6.6
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPLv2 or later

Multi-model AI chat with WordPress accounts, prepaid credits and an admin panel.

== Setup ==

1. Upload the plugin and activate it.
2. Add these lines to wp-config.php, above "That's all, stop editing":

   define('BDCHAT_OPENROUTER_KEY', 'your-openrouter-key');
   define('BDCHAT_OPENAI_KEY', 'your-openai-key');   // only for image generation

3. Create a page for the app and add the shortcode [bdchat].
4. Admin panel: BD ChatGPT in the WordPress admin menu. Add models, set prices, grant credits, and change sign-up settings there.

== Notes ==

* Sign-up, login and logout use WordPress accounts.
* Credits and chat history are stored in WordPress database tables created on activation.
* Pages with the chat app must not be fully cached, because each user needs a fresh nonce.
