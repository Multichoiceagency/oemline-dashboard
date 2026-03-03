<?php
/**
 * ACF Field Groups — Global Options Pages
 *
 * Registers field groups for all 8 ACF Options Pages.
 * Requires ACF PRO with Flexible Content & Repeater.
 */

if (!function_exists('acf_add_local_field_group')) {
    return;
}

// ============================================================
// 3a. GLOBAL: Site Settings
// ============================================================
acf_add_local_field_group([
    'key' => 'group_site_settings',
    'title' => 'Site Settings',
    'fields' => [
        [
            'key' => 'field_ss_company_name',
            'label' => 'Company Name',
            'name' => 'company_name',
            'type' => 'text',
            'default_value' => 'OEMLine',
        ],
        [
            'key' => 'field_ss_company_legal_name',
            'label' => 'Company Legal Name',
            'name' => 'company_legal_name',
            'type' => 'text',
            'default_value' => 'OEMline B.V.',
        ],
        // Contact Info group
        [
            'key' => 'field_ss_contact_info',
            'label' => 'Contact Info',
            'name' => 'contact_info',
            'type' => 'group',
            'layout' => 'block',
            'sub_fields' => [
                ['key' => 'field_ss_ci_street', 'label' => 'Street', 'name' => 'street', 'type' => 'text'],
                ['key' => 'field_ss_ci_postal_code', 'label' => 'Postal Code', 'name' => 'postal_code', 'type' => 'text'],
                ['key' => 'field_ss_ci_city', 'label' => 'City', 'name' => 'city', 'type' => 'text'],
                ['key' => 'field_ss_ci_country', 'label' => 'Country', 'name' => 'country', 'type' => 'text', 'default_value' => 'Nederland'],
                ['key' => 'field_ss_ci_phone', 'label' => 'Phone', 'name' => 'phone', 'type' => 'text'],
                ['key' => 'field_ss_ci_email', 'label' => 'Email', 'name' => 'email', 'type' => 'email'],
                ['key' => 'field_ss_ci_privacy_email', 'label' => 'Privacy Email', 'name' => 'privacy_email', 'type' => 'email'],
            ],
        ],
        // Business Hours repeater
        [
            'key' => 'field_ss_business_hours',
            'label' => 'Business Hours',
            'name' => 'business_hours',
            'type' => 'repeater',
            'layout' => 'table',
            'sub_fields' => [
                ['key' => 'field_ss_bh_days', 'label' => 'Days', 'name' => 'days', 'type' => 'text'],
                ['key' => 'field_ss_bh_hours', 'label' => 'Hours', 'name' => 'hours', 'type' => 'text'],
            ],
        ],
        // Social Media group
        [
            'key' => 'field_ss_social_media',
            'label' => 'Social Media',
            'name' => 'social_media',
            'type' => 'group',
            'layout' => 'block',
            'sub_fields' => [
                ['key' => 'field_ss_sm_facebook', 'label' => 'Facebook', 'name' => 'facebook', 'type' => 'url'],
                ['key' => 'field_ss_sm_instagram', 'label' => 'Instagram', 'name' => 'instagram', 'type' => 'url'],
                ['key' => 'field_ss_sm_linkedin', 'label' => 'LinkedIn', 'name' => 'linkedin', 'type' => 'url'],
                ['key' => 'field_ss_sm_twitter', 'label' => 'Twitter/X', 'name' => 'twitter', 'type' => 'url'],
            ],
        ],
    ],
    'location' => [
        [['param' => 'options_page', 'operator' => '==', 'value' => 'site-settings']],
    ],
]);

// ============================================================
// 3b. GLOBAL: Theme Settings
// ============================================================
$font_choices = [
    'inter' => 'Inter',
    'poppins' => 'Poppins',
    'roboto' => 'Roboto',
    'open-sans' => 'Open Sans',
    'lato' => 'Lato',
    'montserrat' => 'Montserrat',
    'raleway' => 'Raleway',
    'nunito' => 'Nunito',
    'playfair-display' => 'Playfair Display',
    'merriweather' => 'Merriweather',
    'source-sans-pro' => 'Source Sans Pro',
    'ubuntu' => 'Ubuntu',
    'oswald' => 'Oswald',
    'pt-sans' => 'PT Sans',
    'noto-sans' => 'Noto Sans',
    'work-sans' => 'Work Sans',
    'dm-sans' => 'DM Sans',
    'ibm-plex-sans' => 'IBM Plex Sans',
    'barlow' => 'Barlow',
];

acf_add_local_field_group([
    'key' => 'group_theme_settings',
    'title' => 'Theme Settings',
    'fields' => [
        // Fonts group
        [
            'key' => 'field_ts_fonts',
            'label' => 'Fonts',
            'name' => 'fonts',
            'type' => 'group',
            'layout' => 'block',
            'sub_fields' => [
                ['key' => 'field_ts_f_body', 'label' => 'Body Font', 'name' => 'body_font', 'type' => 'select', 'choices' => $font_choices, 'default_value' => 'inter'],
                ['key' => 'field_ts_f_heading', 'label' => 'Heading Font', 'name' => 'heading_font', 'type' => 'select', 'choices' => $font_choices, 'default_value' => 'poppins'],
            ],
        ],
        // Font Sizes group
        [
            'key' => 'field_ts_font_sizes',
            'label' => 'Font Sizes',
            'name' => 'font_sizes',
            'type' => 'group',
            'layout' => 'block',
            'sub_fields' => [
                ['key' => 'field_ts_fs_xsmall', 'label' => 'XSmall', 'name' => 'xsmall', 'type' => 'text', 'default_value' => '0.75rem'],
                ['key' => 'field_ts_fs_small', 'label' => 'Small', 'name' => 'small', 'type' => 'text', 'default_value' => '0.875rem'],
                ['key' => 'field_ts_fs_base', 'label' => 'Base', 'name' => 'base', 'type' => 'text', 'default_value' => '1rem'],
                ['key' => 'field_ts_fs_large', 'label' => 'Large', 'name' => 'large', 'type' => 'text', 'default_value' => '1.125rem'],
                ['key' => 'field_ts_fs_xl', 'label' => 'XL', 'name' => 'xl', 'type' => 'text', 'default_value' => '1.25rem'],
                ['key' => 'field_ts_fs_xxl', 'label' => 'XXL', 'name' => 'xxl', 'type' => 'text', 'default_value' => '1.5rem'],
                ['key' => 'field_ts_fs_xxxl', 'label' => 'XXXL', 'name' => 'xxxl', 'type' => 'text', 'default_value' => '2rem'],
            ],
        ],
        // Colors group
        [
            'key' => 'field_ts_colors',
            'label' => 'Colors',
            'name' => 'colors',
            'type' => 'group',
            'layout' => 'block',
            'sub_fields' => [
                ['key' => 'field_ts_c_primary_50', 'label' => 'Primary 50', 'name' => 'primary_50', 'type' => 'color_picker'],
                ['key' => 'field_ts_c_primary_100', 'label' => 'Primary 100', 'name' => 'primary_100', 'type' => 'color_picker'],
                ['key' => 'field_ts_c_primary_200', 'label' => 'Primary 200', 'name' => 'primary_200', 'type' => 'color_picker'],
                ['key' => 'field_ts_c_primary_300', 'label' => 'Primary 300', 'name' => 'primary_300', 'type' => 'color_picker'],
                ['key' => 'field_ts_c_primary_400', 'label' => 'Primary 400', 'name' => 'primary_400', 'type' => 'color_picker'],
                ['key' => 'field_ts_c_primary_500', 'label' => 'Primary 500', 'name' => 'primary_500', 'type' => 'color_picker'],
                ['key' => 'field_ts_c_primary_600', 'label' => 'Primary 600', 'name' => 'primary_600', 'type' => 'color_picker'],
                ['key' => 'field_ts_c_primary_700', 'label' => 'Primary 700', 'name' => 'primary_700', 'type' => 'color_picker'],
                ['key' => 'field_ts_c_primary_800', 'label' => 'Primary 800', 'name' => 'primary_800', 'type' => 'color_picker'],
                ['key' => 'field_ts_c_primary_900', 'label' => 'Primary 900', 'name' => 'primary_900', 'type' => 'color_picker'],
                ['key' => 'field_ts_c_background', 'label' => 'Background', 'name' => 'background', 'type' => 'color_picker'],
                ['key' => 'field_ts_c_surface', 'label' => 'Surface', 'name' => 'surface', 'type' => 'color_picker'],
                ['key' => 'field_ts_c_text', 'label' => 'Text', 'name' => 'text', 'type' => 'color_picker'],
                ['key' => 'field_ts_c_text_muted', 'label' => 'Text Muted', 'name' => 'text_muted', 'type' => 'color_picker'],
                ['key' => 'field_ts_c_border', 'label' => 'Border', 'name' => 'border', 'type' => 'color_picker'],
                ['key' => 'field_ts_c_success', 'label' => 'Success', 'name' => 'success', 'type' => 'color_picker'],
                ['key' => 'field_ts_c_warning', 'label' => 'Warning', 'name' => 'warning', 'type' => 'color_picker'],
                ['key' => 'field_ts_c_danger', 'label' => 'Danger', 'name' => 'danger', 'type' => 'color_picker'],
                ['key' => 'field_ts_c_link', 'label' => 'Link', 'name' => 'link', 'type' => 'color_picker'],
            ],
        ],
    ],
    'location' => [
        [['param' => 'options_page', 'operator' => '==', 'value' => 'theme-settings']],
    ],
]);

// ============================================================
// 3c. GLOBAL: Homepage — Flexible Content
// ============================================================
$icon_choices = [
    'truck' => 'Truck (Shipping)',
    'headset' => 'Headset (Support)',
    'refresh' => 'Refresh (Returns)',
    'creditcard' => 'Credit Card (Payment)',
    'shield' => 'Shield (Security)',
    'clock' => 'Clock (Fast)',
];

$product_source_choices = [
    'dashboard' => 'Dashboard API (automatic)',
    'manual' => 'Manual (specify article numbers)',
];

acf_add_local_field_group([
    'key' => 'group_homepage',
    'title' => 'Homepage Sections',
    'fields' => [
        [
            'key' => 'field_hp_sections',
            'label' => 'Sections',
            'name' => 'sections',
            'type' => 'flexible_content',
            'button_label' => 'Add Section',
            'layouts' => [
                // Hero
                'layout_hero' => [
                    'key' => 'layout_hp_hero',
                    'name' => 'hero',
                    'label' => 'Hero',
                    'display' => 'block',
                    'sub_fields' => [
                        ['key' => 'field_hp_hero_enabled', 'label' => 'Enabled', 'name' => 'enabled', 'type' => 'true_false', 'default_value' => 1],
                        ['key' => 'field_hp_hero_bg_image', 'label' => 'Background Image', 'name' => 'background_image', 'type' => 'image', 'return_format' => 'url'],
                        ['key' => 'field_hp_hero_bg_image_url', 'label' => 'Background Image URL (fallback)', 'name' => 'background_image_url', 'type' => 'url'],
                        ['key' => 'field_hp_hero_title', 'label' => 'Title', 'name' => 'title', 'type' => 'text', 'default_value' => 'Vind onderdelen voor uw voertuig'],
                        ['key' => 'field_hp_hero_subtitle', 'label' => 'Subtitle', 'name' => 'subtitle', 'type' => 'text', 'default_value' => 'Zoek op kenteken, merk of onderdeelnummer'],
                        ['key' => 'field_hp_hero_show_search', 'label' => 'Show Vehicle Search', 'name' => 'show_vehicle_search', 'type' => 'true_false', 'default_value' => 1],
                        ['key' => 'field_hp_hero_video_desktop', 'label' => 'Video URL (Desktop)', 'name' => 'video_url_desktop', 'type' => 'url'],
                        ['key' => 'field_hp_hero_video_mobile', 'label' => 'Video URL (Mobile)', 'name' => 'video_url_mobile', 'type' => 'url'],
                    ],
                ],
                // Features
                'layout_features' => [
                    'key' => 'layout_hp_features',
                    'name' => 'features',
                    'label' => 'Features',
                    'display' => 'block',
                    'sub_fields' => [
                        ['key' => 'field_hp_feat_enabled', 'label' => 'Enabled', 'name' => 'enabled', 'type' => 'true_false', 'default_value' => 1],
                        [
                            'key' => 'field_hp_feat_items',
                            'label' => 'Items',
                            'name' => 'items',
                            'type' => 'repeater',
                            'max' => 4,
                            'layout' => 'block',
                            'sub_fields' => [
                                ['key' => 'field_hp_feat_icon', 'label' => 'Icon', 'name' => 'icon', 'type' => 'select', 'choices' => $icon_choices],
                                ['key' => 'field_hp_feat_title', 'label' => 'Title', 'name' => 'title', 'type' => 'text'],
                                ['key' => 'field_hp_feat_desc', 'label' => 'Description', 'name' => 'description', 'type' => 'text'],
                            ],
                        ],
                    ],
                ],
                // Category Grid
                'layout_category_grid' => [
                    'key' => 'layout_hp_cat_grid',
                    'name' => 'category_grid',
                    'label' => 'Category Grid',
                    'display' => 'block',
                    'sub_fields' => [
                        ['key' => 'field_hp_cg_enabled', 'label' => 'Enabled', 'name' => 'enabled', 'type' => 'true_false', 'default_value' => 1],
                        ['key' => 'field_hp_cg_title', 'label' => 'Title', 'name' => 'title', 'type' => 'text', 'default_value' => 'Shop by Category'],
                        ['key' => 'field_hp_cg_source', 'label' => 'Source', 'name' => 'source', 'type' => 'select', 'choices' => $product_source_choices, 'default_value' => 'dashboard'],
                        ['key' => 'field_hp_cg_max', 'label' => 'Max Categories', 'name' => 'max_categories', 'type' => 'number', 'default_value' => 8],
                        [
                            'key' => 'field_hp_cg_manual',
                            'label' => 'Manual Categories',
                            'name' => 'manual_categories',
                            'type' => 'repeater',
                            'layout' => 'block',
                            'conditional_logic' => [[['field' => 'field_hp_cg_source', 'operator' => '==', 'value' => 'manual']]],
                            'sub_fields' => [
                                ['key' => 'field_hp_cg_m_name', 'label' => 'Name', 'name' => 'name', 'type' => 'text'],
                                ['key' => 'field_hp_cg_m_image', 'label' => 'Image', 'name' => 'image', 'type' => 'image', 'return_format' => 'url'],
                                ['key' => 'field_hp_cg_m_cat_id', 'label' => 'Dashboard Category ID', 'name' => 'dashboard_category_id', 'type' => 'number'],
                                ['key' => 'field_hp_cg_m_link', 'label' => 'Link (override)', 'name' => 'link', 'type' => 'url'],
                            ],
                        ],
                    ],
                ],
                // Brand Logos
                'layout_brand_logos' => [
                    'key' => 'layout_hp_brand_logos',
                    'name' => 'brand_logos',
                    'label' => 'Brand Logos',
                    'display' => 'block',
                    'sub_fields' => [
                        ['key' => 'field_hp_bl_enabled', 'label' => 'Enabled', 'name' => 'enabled', 'type' => 'true_false', 'default_value' => 1],
                        ['key' => 'field_hp_bl_source', 'label' => 'Source', 'name' => 'source', 'type' => 'select', 'choices' => $product_source_choices, 'default_value' => 'dashboard'],
                        ['key' => 'field_hp_bl_max', 'label' => 'Max Brands', 'name' => 'max_brands', 'type' => 'number', 'default_value' => 24],
                        [
                            'key' => 'field_hp_bl_manual',
                            'label' => 'Manual Brands',
                            'name' => 'manual_brands',
                            'type' => 'repeater',
                            'layout' => 'block',
                            'conditional_logic' => [[['field' => 'field_hp_bl_source', 'operator' => '==', 'value' => 'manual']]],
                            'sub_fields' => [
                                ['key' => 'field_hp_bl_m_name', 'label' => 'Name', 'name' => 'name', 'type' => 'text'],
                                ['key' => 'field_hp_bl_m_logo', 'label' => 'Logo', 'name' => 'logo', 'type' => 'image', 'return_format' => 'url'],
                                ['key' => 'field_hp_bl_m_link', 'label' => 'Link', 'name' => 'link', 'type' => 'url'],
                            ],
                        ],
                    ],
                ],
                // Brand Carousel
                'layout_brand_carousel' => [
                    'key' => 'layout_hp_brand_carousel',
                    'name' => 'brand_carousel',
                    'label' => 'Brand Carousel',
                    'display' => 'block',
                    'sub_fields' => [
                        ['key' => 'field_hp_bc_enabled', 'label' => 'Enabled', 'name' => 'enabled', 'type' => 'true_false', 'default_value' => 1],
                        ['key' => 'field_hp_bc_title', 'label' => 'Title', 'name' => 'title', 'type' => 'text', 'default_value' => 'Onze Merken'],
                        ['key' => 'field_hp_bc_source', 'label' => 'Source', 'name' => 'source', 'type' => 'select', 'choices' => $product_source_choices, 'default_value' => 'dashboard'],
                        [
                            'key' => 'field_hp_bc_manual',
                            'label' => 'Manual Brands',
                            'name' => 'manual_brands',
                            'type' => 'repeater',
                            'layout' => 'block',
                            'conditional_logic' => [[['field' => 'field_hp_bc_source', 'operator' => '==', 'value' => 'manual']]],
                            'sub_fields' => [
                                ['key' => 'field_hp_bc_m_name', 'label' => 'Name', 'name' => 'name', 'type' => 'text'],
                                ['key' => 'field_hp_bc_m_logo', 'label' => 'Logo', 'name' => 'logo', 'type' => 'image', 'return_format' => 'url'],
                                ['key' => 'field_hp_bc_m_link', 'label' => 'Link', 'name' => 'link', 'type' => 'url'],
                            ],
                        ],
                        ['key' => 'field_hp_bc_max', 'label' => 'Max Brands', 'name' => 'max_brands', 'type' => 'number', 'default_value' => 24],
                        ['key' => 'field_hp_bc_show_all', 'label' => 'Show View All', 'name' => 'show_view_all', 'type' => 'true_false', 'default_value' => 1],
                        ['key' => 'field_hp_bc_va_text', 'label' => 'View All Text', 'name' => 'view_all_text', 'type' => 'text', 'default_value' => 'Bekijk alle merken'],
                        ['key' => 'field_hp_bc_va_link', 'label' => 'View All Link', 'name' => 'view_all_link', 'type' => 'url', 'default_value' => '/brands'],
                    ],
                ],
                // Carousel (slides)
                'layout_carousel' => [
                    'key' => 'layout_hp_carousel',
                    'name' => 'carousel',
                    'label' => 'Carousel',
                    'display' => 'block',
                    'sub_fields' => [
                        ['key' => 'field_hp_car_enabled', 'label' => 'Enabled', 'name' => 'enabled', 'type' => 'true_false', 'default_value' => 1],
                        ['key' => 'field_hp_car_autoplay', 'label' => 'Autoplay', 'name' => 'autoplay', 'type' => 'true_false', 'default_value' => 1],
                        ['key' => 'field_hp_car_autoplay_ms', 'label' => 'Autoplay (ms)', 'name' => 'autoplay_ms', 'type' => 'number', 'default_value' => 5000],
                        ['key' => 'field_hp_car_height', 'label' => 'Height', 'name' => 'height', 'type' => 'select', 'choices' => ['small' => 'Small', 'medium' => 'Medium', 'large' => 'Large'], 'default_value' => 'medium'],
                        [
                            'key' => 'field_hp_car_slides',
                            'label' => 'Slides',
                            'name' => 'slides',
                            'type' => 'repeater',
                            'min' => 1,
                            'max' => 12,
                            'layout' => 'block',
                            'sub_fields' => [
                                ['key' => 'field_hp_car_s_image', 'label' => 'Image', 'name' => 'image', 'type' => 'image', 'return_format' => 'url'],
                                ['key' => 'field_hp_car_s_title', 'label' => 'Title', 'name' => 'title', 'type' => 'text'],
                                ['key' => 'field_hp_car_s_subtitle', 'label' => 'Subtitle', 'name' => 'subtitle', 'type' => 'text'],
                                ['key' => 'field_hp_car_s_btn_text', 'label' => 'Button Text', 'name' => 'button_text', 'type' => 'text'],
                                ['key' => 'field_hp_car_s_btn_link', 'label' => 'Button Link', 'name' => 'button_link', 'type' => 'url'],
                                ['key' => 'field_hp_car_s_overlay', 'label' => 'Overlay', 'name' => 'overlay', 'type' => 'true_false', 'default_value' => 1],
                            ],
                        ],
                    ],
                ],
                // Promo Banners
                'layout_promo_banners' => [
                    'key' => 'layout_hp_promo_banners',
                    'name' => 'promo_banners',
                    'label' => 'Promo Banners',
                    'display' => 'block',
                    'sub_fields' => [
                        ['key' => 'field_hp_pb_enabled', 'label' => 'Enabled', 'name' => 'enabled', 'type' => 'true_false', 'default_value' => 1],
                        [
                            'key' => 'field_hp_pb_banners',
                            'label' => 'Banners',
                            'name' => 'banners',
                            'type' => 'repeater',
                            'max' => 3,
                            'layout' => 'block',
                            'sub_fields' => [
                                ['key' => 'field_hp_pb_b_image', 'label' => 'Image', 'name' => 'image', 'type' => 'image', 'return_format' => 'url'],
                                ['key' => 'field_hp_pb_b_title', 'label' => 'Title', 'name' => 'title', 'type' => 'text'],
                                ['key' => 'field_hp_pb_b_subtitle', 'label' => 'Subtitle', 'name' => 'subtitle', 'type' => 'text'],
                                ['key' => 'field_hp_pb_b_btn_text', 'label' => 'Button Text', 'name' => 'button_text', 'type' => 'text'],
                                ['key' => 'field_hp_pb_b_btn_link', 'label' => 'Button Link', 'name' => 'button_link', 'type' => 'url'],
                                ['key' => 'field_hp_pb_b_bg_color', 'label' => 'Background Color', 'name' => 'background_color', 'type' => 'color_picker'],
                            ],
                        ],
                    ],
                ],
                // Product Showcase
                'layout_product_showcase' => [
                    'key' => 'layout_hp_product_showcase',
                    'name' => 'product_showcase',
                    'label' => 'Product Showcase',
                    'display' => 'block',
                    'sub_fields' => [
                        ['key' => 'field_hp_ps_enabled', 'label' => 'Enabled', 'name' => 'enabled', 'type' => 'true_false', 'default_value' => 1],
                        ['key' => 'field_hp_ps_title', 'label' => 'Title', 'name' => 'title', 'type' => 'text', 'default_value' => 'Featured Products'],
                        ['key' => 'field_hp_ps_layout', 'label' => 'Layout', 'name' => 'layout', 'type' => 'select', 'choices' => ['grid' => 'Grid', 'carousel' => 'Carousel', 'deal-zone' => 'Deal Zone'], 'default_value' => 'grid'],
                        ['key' => 'field_hp_ps_subtitle', 'label' => 'Subtitle', 'name' => 'subtitle', 'type' => 'text'],
                        ['key' => 'field_hp_ps_bg_image', 'label' => 'Background Image (Deal Zone)', 'name' => 'background_image', 'type' => 'image', 'return_format' => 'url'],
                        ['key' => 'field_hp_ps_source', 'label' => 'Product Source', 'name' => 'product_source', 'type' => 'select', 'choices' => $product_source_choices, 'default_value' => 'dashboard'],
                        ['key' => 'field_hp_ps_cat_id', 'label' => 'Dashboard Category ID', 'name' => 'dashboard_category_id', 'type' => 'number', 'conditional_logic' => [[['field' => 'field_hp_ps_source', 'operator' => '==', 'value' => 'dashboard']]]],
                        ['key' => 'field_hp_ps_brand', 'label' => 'Dashboard Brand Code', 'name' => 'dashboard_brand_code', 'type' => 'text', 'conditional_logic' => [[['field' => 'field_hp_ps_source', 'operator' => '==', 'value' => 'dashboard']]]],
                        ['key' => 'field_hp_ps_articles', 'label' => 'Article Numbers (comma-separated)', 'name' => 'manual_article_numbers', 'type' => 'text', 'conditional_logic' => [[['field' => 'field_hp_ps_source', 'operator' => '==', 'value' => 'manual']]]],
                        ['key' => 'field_hp_ps_va_link', 'label' => 'View All Link', 'name' => 'view_all_link', 'type' => 'url'],
                        ['key' => 'field_hp_ps_max', 'label' => 'Max Products', 'name' => 'max_products', 'type' => 'number', 'default_value' => 12],
                    ],
                ],
                // Product Columns
                'layout_product_columns' => [
                    'key' => 'layout_hp_product_columns',
                    'name' => 'product_columns',
                    'label' => 'Product Columns',
                    'display' => 'block',
                    'sub_fields' => [
                        ['key' => 'field_hp_pc_enabled', 'label' => 'Enabled', 'name' => 'enabled', 'type' => 'true_false', 'default_value' => 1],
                        [
                            'key' => 'field_hp_pc_columns',
                            'label' => 'Columns',
                            'name' => 'columns',
                            'type' => 'repeater',
                            'min' => 1,
                            'max' => 4,
                            'layout' => 'block',
                            'sub_fields' => [
                                ['key' => 'field_hp_pc_c_title', 'label' => 'Title', 'name' => 'title', 'type' => 'text'],
                                ['key' => 'field_hp_pc_c_source', 'label' => 'Source', 'name' => 'product_source', 'type' => 'select', 'choices' => $product_source_choices, 'default_value' => 'dashboard'],
                                ['key' => 'field_hp_pc_c_cat_id', 'label' => 'Dashboard Category ID', 'name' => 'dashboard_category_id', 'type' => 'number'],
                                ['key' => 'field_hp_pc_c_brand', 'label' => 'Dashboard Brand Code', 'name' => 'dashboard_brand_code', 'type' => 'text'],
                                ['key' => 'field_hp_pc_c_articles', 'label' => 'Article Numbers (comma-separated)', 'name' => 'manual_article_numbers', 'type' => 'text'],
                            ],
                        ],
                        ['key' => 'field_hp_pc_max', 'label' => 'Max Per Column', 'name' => 'max_per_column', 'type' => 'number', 'default_value' => 6],
                    ],
                ],
                // SEO Text
                'layout_seo_text' => [
                    'key' => 'layout_hp_seo_text',
                    'name' => 'seo_text',
                    'label' => 'SEO Text',
                    'display' => 'block',
                    'sub_fields' => [
                        ['key' => 'field_hp_seo_enabled', 'label' => 'Enabled', 'name' => 'enabled', 'type' => 'true_false', 'default_value' => 1],
                        ['key' => 'field_hp_seo_title', 'label' => 'Title', 'name' => 'title', 'type' => 'text'],
                        ['key' => 'field_hp_seo_content', 'label' => 'Content', 'name' => 'content', 'type' => 'textarea'],
                        [
                            'key' => 'field_hp_seo_columns',
                            'label' => 'Columns',
                            'name' => 'columns',
                            'type' => 'repeater',
                            'max' => 4,
                            'layout' => 'block',
                            'sub_fields' => [
                                ['key' => 'field_hp_seo_c_title', 'label' => 'Title', 'name' => 'title', 'type' => 'text'],
                                ['key' => 'field_hp_seo_c_content', 'label' => 'Content', 'name' => 'content', 'type' => 'textarea'],
                                ['key' => 'field_hp_seo_c_link', 'label' => 'Link', 'name' => 'link', 'type' => 'url'],
                                ['key' => 'field_hp_seo_c_link_text', 'label' => 'Link Text', 'name' => 'link_text', 'type' => 'text', 'default_value' => 'Lees meer'],
                            ],
                        ],
                    ],
                ],
                // App Banner
                'layout_app_banner' => [
                    'key' => 'layout_hp_app_banner',
                    'name' => 'app_banner',
                    'label' => 'App Banner',
                    'display' => 'block',
                    'sub_fields' => [
                        ['key' => 'field_hp_ab_enabled', 'label' => 'Enabled', 'name' => 'enabled', 'type' => 'true_false', 'default_value' => 1],
                        ['key' => 'field_hp_ab_title', 'label' => 'Title', 'name' => 'title', 'type' => 'text', 'default_value' => 'Producten kopen via de app is altijd goedkoper...'],
                        ['key' => 'field_hp_ab_subtitle', 'label' => 'Subtitle', 'name' => 'subtitle', 'type' => 'text'],
                        ['key' => 'field_hp_ab_bg_color', 'label' => 'Background Color', 'name' => 'background_color', 'type' => 'color_picker', 'default_value' => '#F36C21'],
                        ['key' => 'field_hp_ab_phone_img', 'label' => 'Phone Image', 'name' => 'phone_image', 'type' => 'image', 'return_format' => 'url'],
                        ['key' => 'field_hp_ab_gplay', 'label' => 'Google Play URL', 'name' => 'google_play_url', 'type' => 'url'],
                        ['key' => 'field_hp_ab_appstore', 'label' => 'App Store URL', 'name' => 'app_store_url', 'type' => 'url'],
                        ['key' => 'field_hp_ab_qr_img', 'label' => 'QR Code Image', 'name' => 'qr_code_image', 'type' => 'image', 'return_format' => 'url'],
                        ['key' => 'field_hp_ab_qr_text', 'label' => 'QR Code Text', 'name' => 'qr_code_text', 'type' => 'text', 'default_value' => 'SCAN OM DE APP TE DOWNLOADEN'],
                    ],
                ],
            ],
        ],
    ],
    'location' => [
        [['param' => 'options_page', 'operator' => '==', 'value' => 'homepage']],
    ],
]);

// ============================================================
// 3d. GLOBAL: Header
// ============================================================
acf_add_local_field_group([
    'key' => 'group_header',
    'title' => 'Header Settings',
    'fields' => [
        // Announcement Bar
        [
            'key' => 'field_hd_announcement',
            'label' => 'Announcement Bar',
            'name' => 'announcement_bar',
            'type' => 'group',
            'layout' => 'block',
            'sub_fields' => [
                ['key' => 'field_hd_ann_enabled', 'label' => 'Enabled', 'name' => 'enabled', 'type' => 'true_false', 'default_value' => 0],
                ['key' => 'field_hd_ann_text', 'label' => 'Text', 'name' => 'text', 'type' => 'text'],
                ['key' => 'field_hd_ann_link_text', 'label' => 'Link Text', 'name' => 'link_text', 'type' => 'text'],
                ['key' => 'field_hd_ann_link_url', 'label' => 'Link URL', 'name' => 'link_url', 'type' => 'url'],
                ['key' => 'field_hd_ann_bg_color', 'label' => 'Background Color', 'name' => 'background_color', 'type' => 'color_picker', 'default_value' => '#F36C21'],
                ['key' => 'field_hd_ann_text_color', 'label' => 'Text Color', 'name' => 'text_color', 'type' => 'color_picker', 'default_value' => '#ffffff'],
                ['key' => 'field_hd_ann_mobile_fs', 'label' => 'Mobile Font Size', 'name' => 'mobile_font_size', 'type' => 'select', 'choices' => ['xs' => 'XS', 'sm' => 'SM', 'base' => 'Base']],
            ],
        ],
        // Top Bar
        [
            'key' => 'field_hd_top_bar',
            'label' => 'Top Bar',
            'name' => 'top_bar',
            'type' => 'group',
            'layout' => 'block',
            'sub_fields' => [
                ['key' => 'field_hd_tb_enabled', 'label' => 'Enabled', 'name' => 'enabled', 'type' => 'true_false', 'default_value' => 1],
                ['key' => 'field_hd_tb_phone', 'label' => 'Phone', 'name' => 'phone', 'type' => 'text', 'default_value' => '(800) 060-0730'],
                ['key' => 'field_hd_tb_tagline', 'label' => 'Tagline', 'name' => 'tagline', 'type' => 'text'],
                [
                    'key' => 'field_hd_tb_links',
                    'label' => 'Links',
                    'name' => 'links',
                    'type' => 'repeater',
                    'layout' => 'table',
                    'sub_fields' => [
                        ['key' => 'field_hd_tb_l_label', 'label' => 'Label', 'name' => 'label', 'type' => 'text'],
                        ['key' => 'field_hd_tb_l_href', 'label' => 'URL', 'name' => 'href', 'type' => 'url'],
                    ],
                ],
            ],
        ],
        // Main Nav
        [
            'key' => 'field_hd_main_nav',
            'label' => 'Main Navigation',
            'name' => 'main_nav',
            'type' => 'group',
            'layout' => 'block',
            'sub_fields' => [
                [
                    'key' => 'field_hd_mn_links',
                    'label' => 'Links',
                    'name' => 'links',
                    'type' => 'repeater',
                    'layout' => 'table',
                    'sub_fields' => [
                        ['key' => 'field_hd_mn_l_label', 'label' => 'Label', 'name' => 'label', 'type' => 'text'],
                        ['key' => 'field_hd_mn_l_href', 'label' => 'URL', 'name' => 'href', 'type' => 'url'],
                        ['key' => 'field_hd_mn_l_highlight', 'label' => 'Highlighted', 'name' => 'is_highlighted', 'type' => 'true_false'],
                    ],
                ],
            ],
        ],
        // Mobile Menu
        [
            'key' => 'field_hd_mobile_menu',
            'label' => 'Mobile Menu',
            'name' => 'mobile_menu',
            'type' => 'group',
            'layout' => 'block',
            'sub_fields' => [
                ['key' => 'field_hd_mm_width', 'label' => 'Width', 'name' => 'width', 'type' => 'select', 'choices' => ['75vw' => '75vw', '80vw' => '80vw', '85vw' => '85vw', '90vw' => '90vw', '95vw' => '95vw', '100vw' => '100vw'], 'default_value' => '85vw'],
                ['key' => 'field_hd_mm_max_width', 'label' => 'Max Width (px)', 'name' => 'max_width', 'type' => 'text', 'default_value' => '320'],
                [
                    'key' => 'field_hd_mm_quick_links',
                    'label' => 'Quick Links',
                    'name' => 'quick_links',
                    'type' => 'repeater',
                    'layout' => 'block',
                    'sub_fields' => [
                        ['key' => 'field_hd_mm_ql_label', 'label' => 'Label', 'name' => 'label', 'type' => 'text'],
                        ['key' => 'field_hd_mm_ql_href', 'label' => 'URL', 'name' => 'href', 'type' => 'url'],
                        ['key' => 'field_hd_mm_ql_icon', 'label' => 'Icon', 'name' => 'icon', 'type' => 'text'],
                        ['key' => 'field_hd_mm_ql_style', 'label' => 'Style', 'name' => 'style', 'type' => 'select', 'choices' => ['default' => 'Default', 'highlighted' => 'Highlighted', 'accent' => 'Accent']],
                    ],
                ],
                ['key' => 'field_hd_mm_footer_btn_text', 'label' => 'Footer Button Text', 'name' => 'footer_button_text', 'type' => 'text', 'default_value' => 'Alle Categorieën Bekijken'],
                ['key' => 'field_hd_mm_footer_btn_link', 'label' => 'Footer Button Link', 'name' => 'footer_button_link', 'type' => 'url', 'default_value' => '/categories'],
                ['key' => 'field_hd_mm_footer_btn_color', 'label' => 'Footer Button Color', 'name' => 'footer_button_color', 'type' => 'color_picker', 'default_value' => '#F36C21'],
            ],
        ],
        // Shipping Badge
        [
            'key' => 'field_hd_shipping_badge',
            'label' => 'Shipping Badge',
            'name' => 'shipping_badge',
            'type' => 'group',
            'layout' => 'block',
            'sub_fields' => [
                ['key' => 'field_hd_sb_enabled', 'label' => 'Enabled', 'name' => 'enabled', 'type' => 'true_false', 'default_value' => 1],
                ['key' => 'field_hd_sb_text', 'label' => 'Text', 'name' => 'text', 'type' => 'text', 'default_value' => 'Gratis verzending'],
                ['key' => 'field_hd_sb_threshold', 'label' => 'Threshold', 'name' => 'threshold', 'type' => 'text', 'default_value' => '€50+'],
            ],
        ],
    ],
    'location' => [
        [['param' => 'options_page', 'operator' => '==', 'value' => 'header']],
    ],
]);

// ============================================================
// 3e. GLOBAL: Footer
// ============================================================
$trust_icon_choices = [
    'retour' => 'Retour',
    'truck' => 'Truck',
    'package' => 'Package',
    'price' => 'Price',
    'quality' => 'Quality',
    'star' => 'Star',
    'clock' => 'Clock',
    'headset' => 'Headset',
];

$payment_method_choices = [
    'ideal' => 'iDEAL',
    'bancontact' => 'Bancontact',
    'visa' => 'Visa',
    'mastercard' => 'Mastercard',
    'amex' => 'American Express',
    'paypal' => 'PayPal',
    'klarna' => 'Klarna',
    'applepay' => 'Apple Pay',
    'googlepay' => 'Google Pay',
    'sofort' => 'SOFORT',
    'giropay' => 'Giropay',
    'eps' => 'EPS',
    'przelewy24' => 'Przelewy24',
    'belfius' => 'Belfius',
    'kbc' => 'KBC',
    'banktransfer' => 'Bank Transfer',
    'creditcard' => 'Credit Card',
    'maestro' => 'Maestro',
    'cartesbancaires' => 'Cartes Bancaires',
];

acf_add_local_field_group([
    'key' => 'group_footer',
    'title' => 'Footer Settings',
    'fields' => [
        ['key' => 'field_ft_use_menu', 'label' => 'Use Menu System', 'name' => 'use_menu_system', 'type' => 'true_false', 'default_value' => 1],
        [
            'key' => 'field_ft_menu_columns',
            'label' => 'Menu Columns',
            'name' => 'menu_columns',
            'type' => 'repeater',
            'layout' => 'block',
            'conditional_logic' => [[['field' => 'field_ft_use_menu', 'operator' => '==', 'value' => '1']]],
            'sub_fields' => [
                ['key' => 'field_ft_mc_menu', 'label' => 'Menu', 'name' => 'menu', 'type' => 'post_object', 'post_type' => ['oemline-menu'], 'return_format' => 'id'],
            ],
        ],
        ['key' => 'field_ft_mobile_accordion', 'label' => 'Mobile Accordion', 'name' => 'mobile_accordion', 'type' => 'true_false', 'default_value' => 1],
        // Contact Section
        [
            'key' => 'field_ft_contact',
            'label' => 'Contact Section',
            'name' => 'contact_section',
            'type' => 'group',
            'layout' => 'block',
            'sub_fields' => [
                ['key' => 'field_ft_ct_title', 'label' => 'Title', 'name' => 'title', 'type' => 'text', 'default_value' => 'Neem Contact Op'],
                ['key' => 'field_ft_ct_desc', 'label' => 'Description', 'name' => 'description', 'type' => 'textarea'],
                ['key' => 'field_ft_ct_phone', 'label' => 'Phone', 'name' => 'phone', 'type' => 'text'],
                ['key' => 'field_ft_ct_email', 'label' => 'Email', 'name' => 'email', 'type' => 'email'],
                ['key' => 'field_ft_ct_location', 'label' => 'Location', 'name' => 'location', 'type' => 'text'],
                ['key' => 'field_ft_ct_hours', 'label' => 'Hours', 'name' => 'hours', 'type' => 'text'],
            ],
        ],
        // Categories Section
        [
            'key' => 'field_ft_categories',
            'label' => 'Categories Section',
            'name' => 'categories_section',
            'type' => 'group',
            'layout' => 'block',
            'sub_fields' => [
                ['key' => 'field_ft_cat_title', 'label' => 'Title', 'name' => 'title', 'type' => 'text', 'default_value' => 'Categorieën'],
                [
                    'key' => 'field_ft_cat_items',
                    'label' => 'Categories',
                    'name' => 'categories',
                    'type' => 'repeater',
                    'layout' => 'table',
                    'sub_fields' => [
                        ['key' => 'field_ft_cat_i_name', 'label' => 'Name', 'name' => 'name', 'type' => 'text'],
                        ['key' => 'field_ft_cat_i_href', 'label' => 'URL', 'name' => 'href', 'type' => 'url'],
                    ],
                ],
                ['key' => 'field_ft_cat_show_brands', 'label' => 'Show All Brands Link', 'name' => 'show_all_brands_link', 'type' => 'true_false', 'default_value' => 1],
            ],
        ],
        // Information Section
        [
            'key' => 'field_ft_info',
            'label' => 'Information Section',
            'name' => 'information_section',
            'type' => 'group',
            'layout' => 'block',
            'sub_fields' => [
                ['key' => 'field_ft_info_title', 'label' => 'Title', 'name' => 'title', 'type' => 'text', 'default_value' => 'Informatie'],
                [
                    'key' => 'field_ft_info_links',
                    'label' => 'Links',
                    'name' => 'links',
                    'type' => 'repeater',
                    'layout' => 'table',
                    'sub_fields' => [
                        ['key' => 'field_ft_info_l_label', 'label' => 'Label', 'name' => 'label', 'type' => 'text'],
                        ['key' => 'field_ft_info_l_href', 'label' => 'URL', 'name' => 'href', 'type' => 'url'],
                    ],
                ],
            ],
        ],
        // Newsletter
        [
            'key' => 'field_ft_newsletter',
            'label' => 'Newsletter',
            'name' => 'newsletter',
            'type' => 'group',
            'layout' => 'block',
            'sub_fields' => [
                ['key' => 'field_ft_nl_enabled', 'label' => 'Enabled', 'name' => 'enabled', 'type' => 'true_false', 'default_value' => 1],
                ['key' => 'field_ft_nl_title', 'label' => 'Title', 'name' => 'title', 'type' => 'text', 'default_value' => 'Nieuwsbrief'],
                ['key' => 'field_ft_nl_desc', 'label' => 'Description', 'name' => 'description', 'type' => 'textarea'],
                ['key' => 'field_ft_nl_btn_text', 'label' => 'Button Text', 'name' => 'button_text', 'type' => 'text', 'default_value' => 'Abonneren'],
                ['key' => 'field_ft_nl_placeholder', 'label' => 'Placeholder', 'name' => 'placeholder', 'type' => 'text', 'default_value' => 'E-mailadres...'],
            ],
        ],
        // Social Media
        [
            'key' => 'field_ft_social',
            'label' => 'Social Media',
            'name' => 'social_media',
            'type' => 'group',
            'layout' => 'block',
            'sub_fields' => [
                ['key' => 'field_ft_sm_title', 'label' => 'Title', 'name' => 'title', 'type' => 'text', 'default_value' => 'Volg ons op sociale media'],
                ['key' => 'field_ft_sm_facebook', 'label' => 'Facebook', 'name' => 'facebook', 'type' => 'url'],
                ['key' => 'field_ft_sm_twitter', 'label' => 'Twitter/X', 'name' => 'twitter', 'type' => 'url'],
                ['key' => 'field_ft_sm_youtube', 'label' => 'YouTube', 'name' => 'youtube', 'type' => 'url'],
                ['key' => 'field_ft_sm_instagram', 'label' => 'Instagram', 'name' => 'instagram', 'type' => 'url'],
            ],
        ],
        // Trust Badges
        [
            'key' => 'field_ft_trust_badges',
            'label' => 'Trust Badges',
            'name' => 'trust_badges',
            'type' => 'repeater',
            'max' => 6,
            'layout' => 'table',
            'sub_fields' => [
                ['key' => 'field_ft_tb_icon', 'label' => 'Icon', 'name' => 'icon', 'type' => 'select', 'choices' => $trust_icon_choices],
                ['key' => 'field_ft_tb_text', 'label' => 'Text', 'name' => 'text', 'type' => 'text'],
            ],
        ],
        // Bottom Bar
        [
            'key' => 'field_ft_bottom_bar',
            'label' => 'Bottom Bar',
            'name' => 'bottom_bar',
            'type' => 'group',
            'layout' => 'block',
            'sub_fields' => [
                ['key' => 'field_ft_bb_lang_sel', 'label' => 'Show Language Selector', 'name' => 'show_language_selector', 'type' => 'true_false', 'default_value' => 1],
                ['key' => 'field_ft_bb_tecdoc', 'label' => 'Show TecDoc Badge', 'name' => 'show_tecdoc_badge', 'type' => 'true_false', 'default_value' => 1],
                ['key' => 'field_ft_bb_credit', 'label' => 'Design Credit', 'name' => 'design_credit', 'type' => 'text', 'default_value' => 'Ontworpen door'],
                ['key' => 'field_ft_bb_credit_link', 'label' => 'Design Credit Link', 'name' => 'design_credit_link', 'type' => 'url'],
                ['key' => 'field_ft_bb_credit_name', 'label' => 'Design Credit Name', 'name' => 'design_credit_name', 'type' => 'text', 'default_value' => 'Multichoice Agency'],
                [
                    'key' => 'field_ft_bb_payment',
                    'label' => 'Payment Methods',
                    'name' => 'payment_methods',
                    'type' => 'repeater',
                    'layout' => 'table',
                    'sub_fields' => [
                        ['key' => 'field_ft_bb_pm_name', 'label' => 'Method', 'name' => 'name', 'type' => 'select', 'choices' => $payment_method_choices],
                        ['key' => 'field_ft_bb_pm_enabled', 'label' => 'Enabled', 'name' => 'enabled', 'type' => 'true_false', 'default_value' => 1],
                    ],
                ],
            ],
        ],
    ],
    'location' => [
        [['param' => 'options_page', 'operator' => '==', 'value' => 'footer']],
    ],
]);

// ============================================================
// 3f. GLOBAL: Klantenservice
// ============================================================
$ks_icon_choices = [
    'box' => 'Box',
    'truck' => 'Truck',
    'refresh' => 'Refresh',
    'creditcard' => 'Credit Card',
    'shield' => 'Shield',
    'headset' => 'Headset',
    'clock' => 'Clock',
    'question' => 'Question',
    'info' => 'Info',
    'wrench' => 'Wrench',
];

acf_add_local_field_group([
    'key' => 'group_klantenservice',
    'title' => 'Klantenservice',
    'fields' => [
        ['key' => 'field_ks_sidebar_title', 'label' => 'Sidebar Title', 'name' => 'sidebar_title', 'type' => 'text', 'default_value' => 'KLANTENSERVICE'],
        // Categories
        [
            'key' => 'field_ks_categories',
            'label' => 'Categories',
            'name' => 'categories',
            'type' => 'repeater',
            'layout' => 'block',
            'sub_fields' => [
                ['key' => 'field_ks_cat_title', 'label' => 'Title', 'name' => 'title', 'type' => 'text'],
                ['key' => 'field_ks_cat_slug', 'label' => 'Slug', 'name' => 'slug', 'type' => 'text'],
                ['key' => 'field_ks_cat_icon', 'label' => 'Icon', 'name' => 'icon', 'type' => 'select', 'choices' => $ks_icon_choices],
                ['key' => 'field_ks_cat_desc', 'label' => 'Description', 'name' => 'description', 'type' => 'textarea'],
                ['key' => 'field_ks_cat_content', 'label' => 'Content', 'name' => 'content', 'type' => 'wysiwyg', 'tabs' => 'all', 'toolbar' => 'full'],
                [
                    'key' => 'field_ks_cat_links',
                    'label' => 'Links',
                    'name' => 'links',
                    'type' => 'repeater',
                    'layout' => 'table',
                    'sub_fields' => [
                        ['key' => 'field_ks_cat_l_label', 'label' => 'Label', 'name' => 'label', 'type' => 'text'],
                        ['key' => 'field_ks_cat_l_href', 'label' => 'URL', 'name' => 'href', 'type' => 'url'],
                    ],
                ],
                [
                    'key' => 'field_ks_cat_faq',
                    'label' => 'FAQ',
                    'name' => 'faq',
                    'type' => 'repeater',
                    'layout' => 'block',
                    'sub_fields' => [
                        ['key' => 'field_ks_cat_faq_q', 'label' => 'Question', 'name' => 'question', 'type' => 'text'],
                        ['key' => 'field_ks_cat_faq_a', 'label' => 'Answer', 'name' => 'answer', 'type' => 'textarea'],
                    ],
                ],
            ],
        ],
        // Extra Sidebar Items
        [
            'key' => 'field_ks_sidebar_items',
            'label' => 'Extra Sidebar Items',
            'name' => 'extra_sidebar_items',
            'type' => 'repeater',
            'layout' => 'table',
            'sub_fields' => [
                ['key' => 'field_ks_si_label', 'label' => 'Label', 'name' => 'label', 'type' => 'text'],
                ['key' => 'field_ks_si_href', 'label' => 'URL', 'name' => 'href', 'type' => 'url'],
                ['key' => 'field_ks_si_icon', 'label' => 'Icon', 'name' => 'icon', 'type' => 'select', 'choices' => $ks_icon_choices],
            ],
        ],
        // Quick Actions
        [
            'key' => 'field_ks_quick_actions',
            'label' => 'Quick Actions',
            'name' => 'quick_actions',
            'type' => 'repeater',
            'layout' => 'table',
            'sub_fields' => [
                ['key' => 'field_ks_qa_label', 'label' => 'Label', 'name' => 'label', 'type' => 'text'],
                ['key' => 'field_ks_qa_query', 'label' => 'Query', 'name' => 'query', 'type' => 'text'],
            ],
        ],
        // Trust Badges
        [
            'key' => 'field_ks_trust_badges',
            'label' => 'Trust Badges',
            'name' => 'trust_badges',
            'type' => 'repeater',
            'layout' => 'table',
            'sub_fields' => [
                ['key' => 'field_ks_tb_icon', 'label' => 'Icon', 'name' => 'icon', 'type' => 'select', 'choices' => $trust_icon_choices],
                ['key' => 'field_ks_tb_bold', 'label' => 'Bold Text', 'name' => 'bold_text', 'type' => 'text'],
                ['key' => 'field_ks_tb_text', 'label' => 'Text', 'name' => 'text', 'type' => 'text'],
            ],
        ],
        // Contact
        ['key' => 'field_ks_contact_title', 'label' => 'Contact Title', 'name' => 'contact_title', 'type' => 'text', 'default_value' => 'Contact'],
        [
            'key' => 'field_ks_contact_methods',
            'label' => 'Contact Methods',
            'name' => 'contact_methods',
            'type' => 'repeater',
            'layout' => 'block',
            'sub_fields' => [
                ['key' => 'field_ks_cm_icon', 'label' => 'Icon', 'name' => 'icon', 'type' => 'select', 'choices' => $ks_icon_choices],
                ['key' => 'field_ks_cm_title', 'label' => 'Title', 'name' => 'title', 'type' => 'text'],
                ['key' => 'field_ks_cm_desc', 'label' => 'Description', 'name' => 'description', 'type' => 'textarea'],
                ['key' => 'field_ks_cm_link', 'label' => 'Link', 'name' => 'link', 'type' => 'url'],
                ['key' => 'field_ks_cm_link_text', 'label' => 'Link Text', 'name' => 'link_text', 'type' => 'text'],
                ['key' => 'field_ks_cm_hours', 'label' => 'Hours', 'name' => 'hours', 'type' => 'text'],
            ],
        ],
        // Chatbot
        [
            'key' => 'field_ks_chatbot',
            'label' => 'Chatbot',
            'name' => 'chatbot',
            'type' => 'group',
            'layout' => 'block',
            'sub_fields' => [
                ['key' => 'field_ks_cb_enabled', 'label' => 'Enabled', 'name' => 'enabled', 'type' => 'true_false', 'default_value' => 1],
                ['key' => 'field_ks_cb_title', 'label' => 'Title', 'name' => 'title', 'type' => 'text', 'default_value' => 'OEM Assistent'],
                ['key' => 'field_ks_cb_subtitle', 'label' => 'Subtitle', 'name' => 'subtitle', 'type' => 'text'],
                ['key' => 'field_ks_cb_welcome', 'label' => 'Welcome Message', 'name' => 'welcome_message', 'type' => 'textarea'],
                ['key' => 'field_ks_cb_placeholder', 'label' => 'Placeholder', 'name' => 'placeholder', 'type' => 'text'],
                ['key' => 'field_ks_cb_system_prompt', 'label' => 'System Prompt', 'name' => 'system_prompt', 'type' => 'textarea'],
                ['key' => 'field_ks_cb_context', 'label' => 'Company Context', 'name' => 'company_context', 'type' => 'textarea'],
                [
                    'key' => 'field_ks_cb_kb',
                    'label' => 'Knowledge Base',
                    'name' => 'knowledge_base',
                    'type' => 'repeater',
                    'layout' => 'block',
                    'sub_fields' => [
                        ['key' => 'field_ks_cb_kb_topic', 'label' => 'Topic', 'name' => 'topic', 'type' => 'text'],
                        ['key' => 'field_ks_cb_kb_answer', 'label' => 'Answer', 'name' => 'answer', 'type' => 'textarea'],
                    ],
                ],
                ['key' => 'field_ks_cb_temp', 'label' => 'Temperature', 'name' => 'temperature', 'type' => 'number', 'min' => 0, 'max' => 1, 'step' => 0.1, 'default_value' => 0.7],
                ['key' => 'field_ks_cb_max_tokens', 'label' => 'Max Tokens', 'name' => 'max_tokens', 'type' => 'number', 'default_value' => 1024],
                ['key' => 'field_ks_cb_max_messages', 'label' => 'Max Messages', 'name' => 'max_messages', 'type' => 'number', 'default_value' => 20],
                ['key' => 'field_ks_cb_lang', 'label' => 'Response Language', 'name' => 'response_language', 'type' => 'select', 'choices' => ['nl' => 'Nederlands', 'en' => 'English', 'de' => 'Deutsch', 'fr' => 'Français', 'auto' => 'Auto-detect'], 'default_value' => 'nl'],
            ],
        ],
        // Notice
        [
            'key' => 'field_ks_notice',
            'label' => 'Notice',
            'name' => 'notice',
            'type' => 'group',
            'layout' => 'block',
            'sub_fields' => [
                ['key' => 'field_ks_n_enabled', 'label' => 'Enabled', 'name' => 'enabled', 'type' => 'true_false', 'default_value' => 1],
                ['key' => 'field_ks_n_icon', 'label' => 'Icon', 'name' => 'icon', 'type' => 'text'],
                ['key' => 'field_ks_n_message', 'label' => 'Message', 'name' => 'message', 'type' => 'textarea'],
                ['key' => 'field_ks_n_variant', 'label' => 'Variant', 'name' => 'variant', 'type' => 'select', 'choices' => ['warning' => 'Warning', 'info' => 'Info', 'success' => 'Success', 'error' => 'Error'], 'default_value' => 'warning'],
            ],
        ],
    ],
    'location' => [
        [['param' => 'options_page', 'operator' => '==', 'value' => 'klantenservice']],
    ],
]);

// ============================================================
// 3g. GLOBAL: Product Page Config
// ============================================================
$tab_key_choices = [
    'spec' => 'Specifications',
    'compatibility' => 'Compatibility',
    'oem' => 'OEM Numbers',
    'manufacturer' => 'Manufacturer',
    'delivery' => 'Delivery',
    'custom' => 'Custom Content',
];

acf_add_local_field_group([
    'key' => 'group_product_page_config',
    'title' => 'Product Page Config',
    'fields' => [
        // Labels
        [
            'key' => 'field_pp_labels',
            'label' => 'Labels',
            'name' => 'labels',
            'type' => 'group',
            'layout' => 'block',
            'sub_fields' => [
                ['key' => 'field_pp_l_add_cart', 'label' => 'Add to Cart Text', 'name' => 'add_to_cart_text', 'type' => 'text', 'default_value' => 'In Winkelwagen'],
                ['key' => 'field_pp_l_req_price', 'label' => 'Request Price Text', 'name' => 'request_price_text', 'type' => 'text', 'default_value' => 'Prijs op aanvraag'],
                ['key' => 'field_pp_l_delivery', 'label' => 'Delivery Text', 'name' => 'delivery_text', 'type' => 'text', 'default_value' => 'Levertijd: 1 - 3 werkdagen'],
                ['key' => 'field_pp_l_contact', 'label' => 'Contact Text', 'name' => 'contact_text', 'type' => 'text', 'default_value' => 'Neem contact met ons op'],
            ],
        ],
        // Tabs
        [
            'key' => 'field_pp_tabs',
            'label' => 'Product Tabs',
            'name' => 'tabs',
            'type' => 'repeater',
            'layout' => 'block',
            'sub_fields' => [
                ['key' => 'field_pp_tab_key', 'label' => 'Tab Key', 'name' => 'key', 'type' => 'select', 'choices' => $tab_key_choices],
                ['key' => 'field_pp_tab_label', 'label' => 'Label', 'name' => 'label', 'type' => 'text'],
                ['key' => 'field_pp_tab_enabled', 'label' => 'Enabled', 'name' => 'enabled', 'type' => 'true_false', 'default_value' => 1],
                ['key' => 'field_pp_tab_content', 'label' => 'Custom Content', 'name' => 'custom_content', 'type' => 'wysiwyg', 'conditional_logic' => [[['field' => 'field_pp_tab_key', 'operator' => '==', 'value' => 'custom']]]],
            ],
        ],
        // Sidebar Sections
        [
            'key' => 'field_pp_sidebar',
            'label' => 'Sidebar Sections',
            'name' => 'sidebar_sections',
            'type' => 'flexible_content',
            'button_label' => 'Add Sidebar Section',
            'layouts' => [
                'layout_fbt' => [
                    'key' => 'layout_pp_fbt',
                    'name' => 'frequently_bought_together',
                    'label' => 'Frequently Bought Together',
                    'sub_fields' => [
                        ['key' => 'field_pp_fbt_enabled', 'label' => 'Enabled', 'name' => 'enabled', 'type' => 'true_false', 'default_value' => 1],
                        ['key' => 'field_pp_fbt_title', 'label' => 'Title', 'name' => 'title', 'type' => 'text'],
                        ['key' => 'field_pp_fbt_max', 'label' => 'Max Products', 'name' => 'max_products', 'type' => 'number', 'default_value' => 4],
                        ['key' => 'field_pp_fbt_source', 'label' => 'Source', 'name' => 'product_source', 'type' => 'select', 'choices' => $product_source_choices],
                        ['key' => 'field_pp_fbt_articles', 'label' => 'Article Numbers', 'name' => 'manual_article_numbers', 'type' => 'text'],
                    ],
                ],
                'layout_trust' => [
                    'key' => 'layout_pp_trust',
                    'name' => 'trust_badges',
                    'label' => 'Trust Badges',
                    'sub_fields' => [
                        ['key' => 'field_pp_trust_enabled', 'label' => 'Enabled', 'name' => 'enabled', 'type' => 'true_false', 'default_value' => 1],
                        [
                            'key' => 'field_pp_trust_badges',
                            'label' => 'Badges',
                            'name' => 'badges',
                            'type' => 'repeater',
                            'layout' => 'block',
                            'sub_fields' => [
                                ['key' => 'field_pp_trust_b_icon', 'label' => 'Icon', 'name' => 'icon', 'type' => 'select', 'choices' => $trust_icon_choices],
                                ['key' => 'field_pp_trust_b_title', 'label' => 'Title', 'name' => 'title', 'type' => 'text'],
                                ['key' => 'field_pp_trust_b_desc', 'label' => 'Description', 'name' => 'description', 'type' => 'text'],
                            ],
                        ],
                    ],
                ],
                'layout_promo' => [
                    'key' => 'layout_pp_promo',
                    'name' => 'promo_banner',
                    'label' => 'Promo Banner',
                    'sub_fields' => [
                        ['key' => 'field_pp_promo_enabled', 'label' => 'Enabled', 'name' => 'enabled', 'type' => 'true_false', 'default_value' => 1],
                        ['key' => 'field_pp_promo_text', 'label' => 'Text', 'name' => 'text', 'type' => 'text'],
                        ['key' => 'field_pp_promo_link', 'label' => 'Link', 'name' => 'link', 'type' => 'url'],
                        ['key' => 'field_pp_promo_bg', 'label' => 'Background Color', 'name' => 'bg_color', 'type' => 'color_picker'],
                        ['key' => 'field_pp_promo_tc', 'label' => 'Text Color', 'name' => 'text_color', 'type' => 'color_picker'],
                    ],
                ],
            ],
        ],
        // Below Product Sections
        [
            'key' => 'field_pp_below',
            'label' => 'Below Product Sections',
            'name' => 'below_product_sections',
            'type' => 'flexible_content',
            'button_label' => 'Add Section Below Product',
            'layouts' => [
                'layout_compat_alert' => [
                    'key' => 'layout_pp_compat',
                    'name' => 'compatibility_alert',
                    'label' => 'Compatibility Alert',
                    'sub_fields' => [
                        ['key' => 'field_pp_ca_enabled', 'label' => 'Enabled', 'name' => 'enabled', 'type' => 'true_false', 'default_value' => 1],
                        ['key' => 'field_pp_ca_title', 'label' => 'Title', 'name' => 'title', 'type' => 'text'],
                        ['key' => 'field_pp_ca_desc', 'label' => 'Description', 'name' => 'description', 'type' => 'textarea'],
                    ],
                ],
                'layout_also_ordered' => [
                    'key' => 'layout_pp_also',
                    'name' => 'customers_also_ordered',
                    'label' => 'Customers Also Ordered',
                    'sub_fields' => [
                        ['key' => 'field_pp_ao_enabled', 'label' => 'Enabled', 'name' => 'enabled', 'type' => 'true_false', 'default_value' => 1],
                        ['key' => 'field_pp_ao_title', 'label' => 'Title', 'name' => 'title', 'type' => 'text'],
                        ['key' => 'field_pp_ao_max', 'label' => 'Max Products', 'name' => 'max_products', 'type' => 'number', 'default_value' => 6],
                        ['key' => 'field_pp_ao_source', 'label' => 'Source', 'name' => 'product_source', 'type' => 'select', 'choices' => $product_source_choices],
                    ],
                ],
                'layout_showcase' => [
                    'key' => 'layout_pp_showcase',
                    'name' => 'product_showcase',
                    'label' => 'Product Showcase',
                    'sub_fields' => [
                        ['key' => 'field_pp_sc_enabled', 'label' => 'Enabled', 'name' => 'enabled', 'type' => 'true_false', 'default_value' => 1],
                        ['key' => 'field_pp_sc_title', 'label' => 'Title', 'name' => 'title', 'type' => 'text'],
                        ['key' => 'field_pp_sc_layout', 'label' => 'Layout', 'name' => 'layout', 'type' => 'select', 'choices' => ['grid' => 'Grid', 'carousel' => 'Carousel']],
                        ['key' => 'field_pp_sc_source', 'label' => 'Source', 'name' => 'product_source', 'type' => 'select', 'choices' => $product_source_choices],
                        ['key' => 'field_pp_sc_max', 'label' => 'Max Products', 'name' => 'max_products', 'type' => 'number', 'default_value' => 12],
                    ],
                ],
                'layout_related' => [
                    'key' => 'layout_pp_related',
                    'name' => 'related_products',
                    'label' => 'Related Products',
                    'sub_fields' => [
                        ['key' => 'field_pp_rel_enabled', 'label' => 'Enabled', 'name' => 'enabled', 'type' => 'true_false', 'default_value' => 1],
                        ['key' => 'field_pp_rel_title', 'label' => 'Title', 'name' => 'title', 'type' => 'text'],
                        ['key' => 'field_pp_rel_highlight', 'label' => 'Title Highlight', 'name' => 'title_highlight', 'type' => 'text'],
                        ['key' => 'field_pp_rel_max', 'label' => 'Max Products', 'name' => 'max_products', 'type' => 'number', 'default_value' => 6],
                    ],
                ],
                'layout_faq' => [
                    'key' => 'layout_pp_faq',
                    'name' => 'product_faq',
                    'label' => 'Product FAQ',
                    'sub_fields' => [
                        ['key' => 'field_pp_faq_enabled', 'label' => 'Enabled', 'name' => 'enabled', 'type' => 'true_false', 'default_value' => 1],
                        ['key' => 'field_pp_faq_title', 'label' => 'Title', 'name' => 'title', 'type' => 'text'],
                        [
                            'key' => 'field_pp_faq_items',
                            'label' => 'Items',
                            'name' => 'items',
                            'type' => 'repeater',
                            'layout' => 'block',
                            'sub_fields' => [
                                ['key' => 'field_pp_faq_q', 'label' => 'Question', 'name' => 'question', 'type' => 'text'],
                                ['key' => 'field_pp_faq_a', 'label' => 'Answer', 'name' => 'answer', 'type' => 'textarea'],
                            ],
                        ],
                    ],
                ],
                'layout_price_cta' => [
                    'key' => 'layout_pp_price_cta',
                    'name' => 'price_cta',
                    'label' => 'Price CTA',
                    'sub_fields' => [
                        ['key' => 'field_pp_pcta_enabled', 'label' => 'Enabled', 'name' => 'enabled', 'type' => 'true_false', 'default_value' => 1],
                        ['key' => 'field_pp_pcta_title', 'label' => 'Title', 'name' => 'title', 'type' => 'text'],
                        ['key' => 'field_pp_pcta_desc', 'label' => 'Description', 'name' => 'description', 'type' => 'textarea'],
                        ['key' => 'field_pp_pcta_btn', 'label' => 'Button Text', 'name' => 'button_text', 'type' => 'text'],
                        ['key' => 'field_pp_pcta_bg', 'label' => 'Background Color', 'name' => 'bg_color', 'type' => 'color_picker'],
                    ],
                ],
                'layout_below_promo' => [
                    'key' => 'layout_pp_below_promo',
                    'name' => 'promo_banner',
                    'label' => 'Promo Banner',
                    'sub_fields' => [
                        ['key' => 'field_pp_bp_enabled', 'label' => 'Enabled', 'name' => 'enabled', 'type' => 'true_false', 'default_value' => 1],
                        ['key' => 'field_pp_bp_text', 'label' => 'Text', 'name' => 'text', 'type' => 'text'],
                        ['key' => 'field_pp_bp_link', 'label' => 'Link', 'name' => 'link', 'type' => 'url'],
                        ['key' => 'field_pp_bp_bg', 'label' => 'Background Color', 'name' => 'bg_color', 'type' => 'color_picker'],
                        ['key' => 'field_pp_bp_tc', 'label' => 'Text Color', 'name' => 'text_color', 'type' => 'color_picker'],
                    ],
                ],
                'layout_below_trust' => [
                    'key' => 'layout_pp_below_trust',
                    'name' => 'trust_badges',
                    'label' => 'Trust Badges',
                    'sub_fields' => [
                        ['key' => 'field_pp_bt_enabled', 'label' => 'Enabled', 'name' => 'enabled', 'type' => 'true_false', 'default_value' => 1],
                        [
                            'key' => 'field_pp_bt_badges',
                            'label' => 'Badges',
                            'name' => 'badges',
                            'type' => 'repeater',
                            'layout' => 'block',
                            'sub_fields' => [
                                ['key' => 'field_pp_bt_b_icon', 'label' => 'Icon', 'name' => 'icon', 'type' => 'select', 'choices' => $trust_icon_choices],
                                ['key' => 'field_pp_bt_b_title', 'label' => 'Title', 'name' => 'title', 'type' => 'text'],
                                ['key' => 'field_pp_bt_b_desc', 'label' => 'Description', 'name' => 'description', 'type' => 'text'],
                            ],
                        ],
                    ],
                ],
            ],
        ],
    ],
    'location' => [
        [['param' => 'options_page', 'operator' => '==', 'value' => 'product-page-config']],
    ],
]);

// ============================================================
// 3h. GLOBAL: Cart Page Config
// ============================================================
acf_add_local_field_group([
    'key' => 'group_cart_page_config',
    'title' => 'Cart Page Config',
    'fields' => [
        // Labels
        [
            'key' => 'field_cp_labels',
            'label' => 'Labels',
            'name' => 'labels',
            'type' => 'group',
            'layout' => 'block',
            'sub_fields' => [
                ['key' => 'field_cp_l_heading', 'label' => 'Heading', 'name' => 'heading', 'type' => 'text', 'default_value' => 'Winkelwagen'],
                ['key' => 'field_cp_l_empty_title', 'label' => 'Empty Cart Title', 'name' => 'empty_cart_title', 'type' => 'text'],
                ['key' => 'field_cp_l_empty_msg', 'label' => 'Empty Cart Message', 'name' => 'empty_cart_message', 'type' => 'text'],
                ['key' => 'field_cp_l_empty_btn', 'label' => 'Empty Cart Button Text', 'name' => 'empty_cart_button_text', 'type' => 'text'],
                ['key' => 'field_cp_l_empty_link', 'label' => 'Empty Cart Button Link', 'name' => 'empty_cart_button_link', 'type' => 'url'],
                ['key' => 'field_cp_l_checkout', 'label' => 'Checkout Button Text', 'name' => 'checkout_button_text', 'type' => 'text', 'default_value' => 'Naar Afrekenen'],
                ['key' => 'field_cp_l_continue', 'label' => 'Continue Shopping Text', 'name' => 'continue_shopping_text', 'type' => 'text', 'default_value' => 'Verder Winkelen'],
            ],
        ],
        // Trust Badges
        [
            'key' => 'field_cp_trust',
            'label' => 'Trust Badges',
            'name' => 'trust_badges',
            'type' => 'repeater',
            'max' => 4,
            'layout' => 'block',
            'sub_fields' => [
                ['key' => 'field_cp_trust_icon', 'label' => 'Icon', 'name' => 'icon', 'type' => 'select', 'choices' => $trust_icon_choices],
                ['key' => 'field_cp_trust_title', 'label' => 'Title', 'name' => 'title', 'type' => 'text'],
                ['key' => 'field_cp_trust_desc', 'label' => 'Description', 'name' => 'description', 'type' => 'text'],
            ],
        ],
        // Promo Banner
        [
            'key' => 'field_cp_promo',
            'label' => 'Promo Banner',
            'name' => 'promo_banner',
            'type' => 'group',
            'layout' => 'block',
            'sub_fields' => [
                ['key' => 'field_cp_pb_enabled', 'label' => 'Enabled', 'name' => 'enabled', 'type' => 'true_false'],
                ['key' => 'field_cp_pb_text', 'label' => 'Text', 'name' => 'text', 'type' => 'text'],
                ['key' => 'field_cp_pb_link', 'label' => 'Link', 'name' => 'link', 'type' => 'url'],
                ['key' => 'field_cp_pb_bg', 'label' => 'Background Color', 'name' => 'bg_color', 'type' => 'color_picker'],
                ['key' => 'field_cp_pb_tc', 'label' => 'Text Color', 'name' => 'text_color', 'type' => 'color_picker'],
            ],
        ],
        // Cross Sell
        [
            'key' => 'field_cp_cross_sell',
            'label' => 'Cross Sell',
            'name' => 'cross_sell',
            'type' => 'group',
            'layout' => 'block',
            'sub_fields' => [
                ['key' => 'field_cp_cs_enabled', 'label' => 'Enabled', 'name' => 'enabled', 'type' => 'true_false', 'default_value' => 0],
                ['key' => 'field_cp_cs_title', 'label' => 'Title', 'name' => 'title', 'type' => 'text', 'default_value' => 'Klanten kochten ook'],
                ['key' => 'field_cp_cs_source', 'label' => 'Product Source', 'name' => 'product_source', 'type' => 'select', 'choices' => $product_source_choices, 'default_value' => 'dashboard'],
                ['key' => 'field_cp_cs_cat_id', 'label' => 'Dashboard Category ID', 'name' => 'dashboard_category_id', 'type' => 'number', 'conditional_logic' => [[['field' => 'field_cp_cs_source', 'operator' => '==', 'value' => 'dashboard']]]],
                ['key' => 'field_cp_cs_articles', 'label' => 'Article Numbers (comma-separated)', 'name' => 'manual_article_numbers', 'type' => 'text', 'conditional_logic' => [[['field' => 'field_cp_cs_source', 'operator' => '==', 'value' => 'manual']]]],
                ['key' => 'field_cp_cs_max', 'label' => 'Max Products', 'name' => 'max_products', 'type' => 'number', 'default_value' => 4],
            ],
        ],
        ['key' => 'field_cp_payment_logos', 'label' => 'Show Payment Logos', 'name' => 'payment_logos', 'type' => 'true_false', 'default_value' => 1],
    ],
    'location' => [
        [['param' => 'options_page', 'operator' => '==', 'value' => 'cart-page-config']],
    ],
]);
