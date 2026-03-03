<?php
/**
 * OEMline Headless Theme — functions.php
 *
 * Registers:
 * - ACF Options Pages (replaces Payload Globals)
 * - Custom Post Types (replaces Payload Collections)
 * - REST API endpoints + CORS
 * - ACF field groups programmatically
 */

// ============================================================
// 1. CORS HEADERS — Allow storefront domain
// ============================================================
add_action('rest_api_init', function () {
    remove_filter('rest_pre_serve_request', 'rest_send_cors_headers');
    add_filter('rest_pre_serve_request', function ($value) {
        $origin = get_http_origin();
        $allowed_origins = [
            'https://oemline.eu',
            'https://www.oemline.eu',
            'http://localhost:3000',
            'http://localhost:8000',
        ];

        if (in_array($origin, $allowed_origins, true)) {
            header("Access-Control-Allow-Origin: {$origin}");
        }

        header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
        header('Access-Control-Allow-Headers: Authorization, Content-Type, X-API-Key');
        header('Access-Control-Allow-Credentials: true');

        return $value;
    });
});

// Handle preflight OPTIONS
add_action('init', function () {
    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
        header('Access-Control-Allow-Origin: *');
        header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
        header('Access-Control-Allow-Headers: Authorization, Content-Type, X-API-Key');
        header('Access-Control-Max-Age: 86400');
        status_header(200);
        exit;
    }
});

// ============================================================
// 2. ACF OPTIONS PAGES (replaces Payload Globals)
// ============================================================
if (function_exists('acf_add_options_page')) {

    // Parent page
    acf_add_options_page([
        'page_title'  => 'OEMline Instellingen',
        'menu_title'  => 'OEMline',
        'menu_slug'   => 'oemline-settings',
        'capability'  => 'manage_options',
        'icon_url'    => 'dashicons-store',
        'redirect'    => true,
    ]);

    // Site Settings
    acf_add_options_sub_page([
        'page_title'  => 'Site Settings',
        'menu_title'  => 'Site Settings',
        'menu_slug'   => 'site-settings',
        'parent_slug' => 'oemline-settings',
    ]);

    // Theme Settings
    acf_add_options_sub_page([
        'page_title'  => 'Theme Settings',
        'menu_title'  => 'Theme',
        'menu_slug'   => 'theme-settings',
        'parent_slug' => 'oemline-settings',
    ]);

    // Homepage
    acf_add_options_sub_page([
        'page_title'  => 'Homepage',
        'menu_title'  => 'Homepage',
        'menu_slug'   => 'homepage',
        'parent_slug' => 'oemline-settings',
    ]);

    // Header
    acf_add_options_sub_page([
        'page_title'  => 'Header',
        'menu_title'  => 'Header',
        'menu_slug'   => 'header',
        'parent_slug' => 'oemline-settings',
    ]);

    // Footer
    acf_add_options_sub_page([
        'page_title'  => 'Footer',
        'menu_title'  => 'Footer',
        'menu_slug'   => 'footer',
        'parent_slug' => 'oemline-settings',
    ]);

    // Klantenservice
    acf_add_options_sub_page([
        'page_title'  => 'Klantenservice',
        'menu_title'  => 'Klantenservice',
        'menu_slug'   => 'klantenservice',
        'parent_slug' => 'oemline-settings',
    ]);

    // Product Page Config
    acf_add_options_sub_page([
        'page_title'  => 'Product Page Config',
        'menu_title'  => 'Product Page',
        'menu_slug'   => 'product-page-config',
        'parent_slug' => 'oemline-settings',
    ]);

    // Cart Page Config
    acf_add_options_sub_page([
        'page_title'  => 'Cart Page Config',
        'menu_title'  => 'Cart Page',
        'menu_slug'   => 'cart-page-config',
        'parent_slug' => 'oemline-settings',
    ]);
}

// ============================================================
// 3. CUSTOM POST TYPES (replaces Payload Collections)
// ============================================================
add_action('init', function () {

    // OEMline Menu
    register_post_type('oemline-menu', [
        'labels' => [
            'name'          => 'Menus',
            'singular_name' => 'Menu',
            'add_new_item'  => 'Add New Menu',
            'edit_item'     => 'Edit Menu',
        ],
        'public'       => false,
        'show_ui'      => true,
        'show_in_rest' => true,
        'rest_base'    => 'oemline-menu',
        'menu_icon'    => 'dashicons-menu-alt3',
        'supports'     => ['title', 'custom-fields'],
        'has_archive'  => false,
    ]);

    // Featured Product
    register_post_type('featured-product', [
        'labels' => [
            'name'          => 'Featured Products',
            'singular_name' => 'Featured Product',
            'add_new_item'  => 'Add Featured Product',
            'edit_item'     => 'Edit Featured Product',
        ],
        'public'       => false,
        'show_ui'      => true,
        'show_in_rest' => true,
        'rest_base'    => 'featured-products',
        'menu_icon'    => 'dashicons-star-filled',
        'supports'     => ['title', 'custom-fields'],
        'has_archive'  => false,
    ]);

    // Featured Category
    register_post_type('featured-category', [
        'labels' => [
            'name'          => 'Featured Categories',
            'singular_name' => 'Featured Category',
            'add_new_item'  => 'Add Featured Category',
            'edit_item'     => 'Edit Featured Category',
        ],
        'public'       => false,
        'show_ui'      => true,
        'show_in_rest' => true,
        'rest_base'    => 'featured-categories',
        'menu_icon'    => 'dashicons-category',
        'supports'     => ['title', 'custom-fields'],
        'has_archive'  => false,
    ]);

    // Price Request
    register_post_type('price-request', [
        'labels' => [
            'name'          => 'Price Requests',
            'singular_name' => 'Price Request',
            'add_new_item'  => 'Add Price Request',
            'edit_item'     => 'Edit Price Request',
        ],
        'public'       => false,
        'show_ui'      => true,
        'show_in_rest' => true,
        'rest_base'    => 'price-requests',
        'menu_icon'    => 'dashicons-tag',
        'supports'     => ['title', 'custom-fields'],
        'has_archive'  => false,
    ]);

    // Product Override (description overrides)
    register_post_type('product-override', [
        'labels' => [
            'name'          => 'Product Overrides',
            'singular_name' => 'Product Override',
            'add_new_item'  => 'Add Product Override',
            'edit_item'     => 'Edit Product Override',
        ],
        'public'       => false,
        'show_ui'      => true,
        'show_in_rest' => true,
        'rest_base'    => 'product-overrides',
        'menu_icon'    => 'dashicons-edit-page',
        'supports'     => ['title', 'custom-fields'],
        'has_archive'  => false,
    ]);

    // Product Extension
    register_post_type('product-extension', [
        'labels' => [
            'name'          => 'Product Extensions',
            'singular_name' => 'Product Extension',
            'add_new_item'  => 'Add Product Extension',
            'edit_item'     => 'Edit Product Extension',
        ],
        'public'       => false,
        'show_ui'      => true,
        'show_in_rest' => true,
        'rest_base'    => 'product-extensions',
        'menu_icon'    => 'dashicons-admin-plugins',
        'supports'     => ['title', 'custom-fields'],
        'has_archive'  => false,
    ]);
});

// ============================================================
// 4. CUSTOM REST API ENDPOINTS
// ============================================================
add_action('rest_api_init', function () {

    // GET /wp-json/oemline/v1/menus/{location}
    register_rest_route('oemline/v1', '/menus/(?P<location>[a-z0-9_-]+)', [
        'methods'  => 'GET',
        'callback' => function (WP_REST_Request $request) {
            $location = $request->get_param('location');

            $menus = get_posts([
                'post_type'      => 'oemline-menu',
                'posts_per_page' => 1,
                'meta_query'     => [[
                    'key'   => 'location',
                    'value' => $location,
                ]],
            ]);

            if (empty($menus)) {
                return new WP_REST_Response(['error' => 'Menu not found'], 404);
            }

            $menu = $menus[0];
            $fields = get_fields($menu->ID);

            return new WP_REST_Response([
                'id'       => $menu->ID,
                'title'    => $menu->post_title,
                'location' => $location,
                'items'    => $fields['items'] ?? [],
                'status'   => $fields['menu_status'] ?? 'active',
            ]);
        },
        'permission_callback' => '__return_true',
    ]);

    // GET /wp-json/oemline/v1/page/{slug}
    register_rest_route('oemline/v1', '/page/(?P<slug>[a-z0-9_-]+)', [
        'methods'  => 'GET',
        'callback' => function (WP_REST_Request $request) {
            $slug = $request->get_param('slug');

            $pages = get_posts([
                'post_type'      => 'page',
                'name'           => $slug,
                'posts_per_page' => 1,
                'post_status'    => 'publish',
            ]);

            if (empty($pages)) {
                return new WP_REST_Response(['error' => 'Page not found'], 404);
            }

            $page = $pages[0];
            $fields = get_fields($page->ID);

            return new WP_REST_Response([
                'id'          => $page->ID,
                'title'       => $page->post_title,
                'slug'        => $page->post_name,
                'content'     => apply_filters('the_content', $page->post_content),
                'acf'         => $fields ?: [],
                'modified'    => $page->post_modified,
            ]);
        },
        'permission_callback' => '__return_true',
    ]);

    // GET /wp-json/oemline/v1/globals/{slug}
    // Returns ACF options page data (replaces Payload /api/globals/*)
    register_rest_route('oemline/v1', '/globals/(?P<slug>[a-z0-9_-]+)', [
        'methods'  => 'GET',
        'callback' => function (WP_REST_Request $request) {
            $slug = $request->get_param('slug');

            // Map slug to ACF options page
            $valid_globals = [
                'site-settings',
                'theme-settings',
                'homepage',
                'header',
                'footer',
                'klantenservice',
                'product-page-config',
                'cart-page-config',
            ];

            if (!in_array($slug, $valid_globals, true)) {
                return new WP_REST_Response(['error' => 'Global not found'], 404);
            }

            $fields = get_fields('option');

            return new WP_REST_Response([
                'slug'   => $slug,
                'fields' => $fields ?: [],
            ]);
        },
        'permission_callback' => '__return_true',
    ]);
});

// ============================================================
// 5. DISABLE FRONTEND THEME RENDERING
// ============================================================
add_action('template_redirect', function () {
    if (!is_admin() && !wp_doing_ajax() && !defined('REST_REQUEST')) {
        wp_redirect(admin_url());
        exit;
    }
});

// ============================================================
// 6. ADMIN CUSTOMIZATION
// ============================================================

// Custom admin footer
add_filter('admin_footer_text', function () {
    return 'OEMline CMS — Powered by WordPress + ACF PRO';
});

// Custom login logo
add_action('login_enqueue_scripts', function () {
    echo '<style>
        #login h1 a {
            background-image: none;
            text-indent: 0;
            font-size: 24px;
            font-weight: bold;
            color: #F36C21;
            width: auto;
            height: auto;
        }
        #login h1 a::after {
            content: "OEMline CMS";
        }
    </style>';
});

// ============================================================
// 7. EXPOSE ACF IN REST API FOR ALL CPTs
// ============================================================
add_filter('acf/settings/rest_api_format', function () {
    return 'standard';
});

// ============================================================
// 8. JWT AUTH — Add CORS headers for JWT endpoints
// ============================================================
add_filter('jwt_auth_cors_allow_headers', function ($headers) {
    return 'Access-Control-Allow-Headers, Content-Type, Authorization';
});

// ============================================================
// 9. WOOCOMMERCE — Headless configuration
// ============================================================
add_action('after_setup_theme', function () {
    // Disable WooCommerce frontend styles
    add_filter('woocommerce_enqueue_styles', '__return_empty_array');

    // Disable WooCommerce cart fragments (not needed for headless)
    add_action('wp_enqueue_scripts', function () {
        wp_dequeue_script('wc-cart-fragments');
    }, 100);
});

// Disable WooCommerce shop/archive pages (products come from Dashboard API)
add_filter('woocommerce_get_shop_page_id', '__return_false');

// ============================================================
// 10. ACF JSON SAVE/LOAD POINT
// ============================================================
add_filter('acf/settings/save_json', function () {
    return get_stylesheet_directory() . '/acf-json';
});

add_filter('acf/settings/load_json', function ($paths) {
    $paths[] = get_stylesheet_directory() . '/acf-json';
    return $paths;
});

// ============================================================
// 11. ACF FIELD GROUPS — Programmatic Registration
// ============================================================
add_action('acf/init', function () {
    require_once get_stylesheet_directory() . '/inc/acf-globals.php';
    require_once get_stylesheet_directory() . '/inc/acf-cpts.php';
});
