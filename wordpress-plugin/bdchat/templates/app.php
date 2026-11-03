<?php
/**
 * Full-page template for pages that contain [bdchat]. No theme header or sidebar,
 * so the app fills the whole screen.
 */
if (!defined('ABSPATH')) {
    exit;
}
?><!doctype html>
<html <?php language_attributes(); ?>>
<head>
<meta charset="<?php bloginfo('charset'); ?>">
<meta name="viewport" content="width=device-width, initial-scale=1">
<?php wp_head(); ?>
</head>
<body <?php body_class('bdchat-page'); ?> style="margin:0">
<?php the_content(); ?>
<?php wp_footer(); ?>
</body>
</html>
