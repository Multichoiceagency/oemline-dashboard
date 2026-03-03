<?php
/**
 * Plugin Name: OEMline Auto-Setup
 * Description: Automatically activates the oemline-headless theme and required plugins on first load.
 * Version: 1.0.0
 * Author: OEMline
 *
 * This is a must-use plugin — it runs automatically without needing manual activation.
 */

// Auto-activate oemline-headless theme if not already active
add_action('after_setup_theme', function () {
    $target_theme = 'oemline-headless';
    $current_theme = get_option('stylesheet');

    if ($current_theme !== $target_theme) {
        $theme = wp_get_theme($target_theme);
        if ($theme->exists()) {
            switch_theme($target_theme);
            error_log("[OEMline] Auto-activated theme: {$target_theme}");
        }
    }
}, 1);

// Auto-activate required plugins
add_action('admin_init', function () {
    $required_plugins = [
        'advanced-custom-fields-pro/acf.php',
        'woocommerce/woocommerce.php',
        'mollie-payments-for-woocommerce/mollie-payments-for-woocommerce.php',
        'acf-to-rest-api/class-acf-to-rest-api.php',
        'jwt-authentication-for-wp-rest-api/jwt-authentication-for-wp-rest-api.php',
        'cart-rest-api-for-woocommerce/cart-rest-api-for-woocommerce.php',
        'wp-rest-cache/wp-rest-cache.php',
        'custom-post-type-ui/custom-post-type-ui.php',
    ];

    $active_plugins = get_option('active_plugins', []);
    $changed = false;

    foreach ($required_plugins as $plugin) {
        if (!in_array($plugin, $active_plugins, true)) {
            $plugin_file = WP_PLUGIN_DIR . '/' . $plugin;
            if (file_exists($plugin_file)) {
                $active_plugins[] = $plugin;
                $changed = true;
                error_log("[OEMline] Auto-activated plugin: {$plugin}");
            }
        }
    }

    if ($changed) {
        update_option('active_plugins', $active_plugins);
    }
});

// Register CPTs directly in mu-plugin as fallback (in case theme activation fails)
add_action('init', function () {
    // Only register if theme hasn't already registered them
    if (post_type_exists('featured-product')) {
        return;
    }

    $cpts = [
        'oemline-menu' => [
            'name' => 'Menus',
            'singular' => 'Menu',
            'icon' => 'dashicons-menu-alt3',
            'rest_base' => 'oemline-menu',
        ],
        'featured-product' => [
            'name' => 'Featured Products',
            'singular' => 'Featured Product',
            'icon' => 'dashicons-star-filled',
            'rest_base' => 'featured-products',
        ],
        'featured-category' => [
            'name' => 'Featured Categories',
            'singular' => 'Featured Category',
            'icon' => 'dashicons-category',
            'rest_base' => 'featured-categories',
        ],
        'price-request' => [
            'name' => 'Price Requests',
            'singular' => 'Price Request',
            'icon' => 'dashicons-tag',
            'rest_base' => 'price-requests',
        ],
        'product-override' => [
            'name' => 'Product Overrides',
            'singular' => 'Product Override',
            'icon' => 'dashicons-edit-page',
            'rest_base' => 'product-overrides',
        ],
        'product-extension' => [
            'name' => 'Product Extensions',
            'singular' => 'Product Extension',
            'icon' => 'dashicons-admin-plugins',
            'rest_base' => 'product-extensions',
        ],
    ];

    foreach ($cpts as $slug => $config) {
        register_post_type($slug, [
            'labels' => [
                'name'          => $config['name'],
                'singular_name' => $config['singular'],
                'add_new_item'  => 'Add ' . $config['singular'],
                'edit_item'     => 'Edit ' . $config['singular'],
            ],
            'public'       => false,
            'show_ui'      => true,
            'show_in_rest' => true,
            'rest_base'    => $config['rest_base'],
            'menu_icon'    => $config['icon'],
            'supports'     => ['title', 'custom-fields'],
            'has_archive'  => false,
        ]);
    }
}, 5); // Priority 5 = before theme's init which runs at 10
