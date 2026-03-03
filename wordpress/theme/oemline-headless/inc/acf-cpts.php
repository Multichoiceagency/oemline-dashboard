<?php
/**
 * ACF Field Groups — Custom Post Types
 *
 * Registers field groups for Pages, Menus, Featured Products/Categories,
 * Price Requests, Product Overrides, and Product Extensions.
 */

if (!function_exists('acf_add_local_field_group')) {
    return;
}

// ============================================================
// 3i. CPT: Pages (built-in) — ACF fields on WP pages
// ============================================================
acf_add_local_field_group([
    'key' => 'group_pages',
    'title' => 'Page Settings',
    'fields' => [
        // SEO
        ['key' => 'field_pg_meta_title', 'label' => 'Meta Title', 'name' => 'meta_title', 'type' => 'text'],
        ['key' => 'field_pg_meta_desc', 'label' => 'Meta Description', 'name' => 'meta_description', 'type' => 'textarea', 'rows' => 3],
        // Hero Section
        [
            'key' => 'field_pg_hero',
            'label' => 'Hero Section',
            'name' => 'hero_section',
            'type' => 'group',
            'layout' => 'block',
            'sub_fields' => [
                ['key' => 'field_pg_hero_heading', 'label' => 'Heading', 'name' => 'heading', 'type' => 'text'],
                ['key' => 'field_pg_hero_sub', 'label' => 'Subheading', 'name' => 'subheading', 'type' => 'text'],
            ],
        ],
        // Content — Flexible Content with 12 layouts
        [
            'key' => 'field_pg_content',
            'label' => 'Content Blocks',
            'name' => 'content',
            'type' => 'flexible_content',
            'button_label' => 'Add Content Block',
            'layouts' => [
                // Rich Text
                'layout_rich_text' => [
                    'key' => 'layout_pg_rich_text',
                    'name' => 'rich_text',
                    'label' => 'Rich Text',
                    'sub_fields' => [
                        ['key' => 'field_pg_rt_heading', 'label' => 'Heading', 'name' => 'heading', 'type' => 'text'],
                        ['key' => 'field_pg_rt_content', 'label' => 'Content', 'name' => 'content', 'type' => 'wysiwyg', 'tabs' => 'all', 'toolbar' => 'full'],
                    ],
                ],
                // Feature Grid
                'layout_feature_grid' => [
                    'key' => 'layout_pg_feature_grid',
                    'name' => 'feature_grid',
                    'label' => 'Feature Grid',
                    'sub_fields' => [
                        ['key' => 'field_pg_fg_heading', 'label' => 'Heading', 'name' => 'heading', 'type' => 'text'],
                        [
                            'key' => 'field_pg_fg_features',
                            'label' => 'Features',
                            'name' => 'features',
                            'type' => 'repeater',
                            'layout' => 'block',
                            'sub_fields' => [
                                ['key' => 'field_pg_fg_f_title', 'label' => 'Title', 'name' => 'title', 'type' => 'text'],
                                ['key' => 'field_pg_fg_f_desc', 'label' => 'Description', 'name' => 'description', 'type' => 'textarea'],
                            ],
                        ],
                    ],
                ],
                // List Block
                'layout_list_block' => [
                    'key' => 'layout_pg_list_block',
                    'name' => 'list_block',
                    'label' => 'List Block',
                    'sub_fields' => [
                        ['key' => 'field_pg_lb_heading', 'label' => 'Heading', 'name' => 'heading', 'type' => 'text'],
                        ['key' => 'field_pg_lb_intro', 'label' => 'Introduction', 'name' => 'introduction', 'type' => 'textarea'],
                        [
                            'key' => 'field_pg_lb_items',
                            'label' => 'Items',
                            'name' => 'items',
                            'type' => 'repeater',
                            'layout' => 'table',
                            'sub_fields' => [
                                ['key' => 'field_pg_lb_i_text', 'label' => 'Text', 'name' => 'text', 'type' => 'text'],
                            ],
                        ],
                    ],
                ],
                // Section
                'layout_section' => [
                    'key' => 'layout_pg_section',
                    'name' => 'section',
                    'label' => 'Section',
                    'sub_fields' => [
                        ['key' => 'field_pg_sec_title', 'label' => 'Section Title', 'name' => 'section_title', 'type' => 'text'],
                        ['key' => 'field_pg_sec_content', 'label' => 'Content', 'name' => 'content', 'type' => 'wysiwyg'],
                        [
                            'key' => 'field_pg_sec_subs',
                            'label' => 'Subsections',
                            'name' => 'subsections',
                            'type' => 'repeater',
                            'layout' => 'block',
                            'sub_fields' => [
                                ['key' => 'field_pg_sec_s_title', 'label' => 'Title', 'name' => 'title', 'type' => 'text'],
                                ['key' => 'field_pg_sec_s_content', 'label' => 'Content', 'name' => 'content', 'type' => 'wysiwyg'],
                            ],
                        ],
                    ],
                ],
                // CTA
                'layout_cta' => [
                    'key' => 'layout_pg_cta',
                    'name' => 'cta',
                    'label' => 'Call to Action',
                    'sub_fields' => [
                        ['key' => 'field_pg_cta_heading', 'label' => 'Heading', 'name' => 'heading', 'type' => 'text'],
                        ['key' => 'field_pg_cta_desc', 'label' => 'Description', 'name' => 'description', 'type' => 'textarea'],
                        ['key' => 'field_pg_cta_btn_text', 'label' => 'Button Text', 'name' => 'button_text', 'type' => 'text'],
                        ['key' => 'field_pg_cta_btn_link', 'label' => 'Button Link', 'name' => 'button_link', 'type' => 'url'],
                        ['key' => 'field_pg_cta_variant', 'label' => 'Variant', 'name' => 'variant', 'type' => 'select', 'choices' => ['primary' => 'Primary', 'secondary' => 'Secondary', 'outline' => 'Outline']],
                    ],
                ],
                // Contact Info
                'layout_contact_info' => [
                    'key' => 'layout_pg_contact_info',
                    'name' => 'contact_info',
                    'label' => 'Contact Info',
                    'sub_fields' => [
                        ['key' => 'field_pg_ci_show', 'label' => 'Show Company Info', 'name' => 'show_company_info', 'type' => 'true_false', 'default_value' => 1],
                    ],
                ],
                // CS Categories
                'layout_cs_categories' => [
                    'key' => 'layout_pg_cs_cats',
                    'name' => 'cs_categories',
                    'label' => 'CS Categories',
                    'sub_fields' => [
                        [
                            'key' => 'field_pg_csc_cats',
                            'label' => 'Categories',
                            'name' => 'categories',
                            'type' => 'repeater',
                            'layout' => 'block',
                            'sub_fields' => [
                                ['key' => 'field_pg_csc_id', 'label' => 'ID', 'name' => 'id', 'type' => 'text'],
                                ['key' => 'field_pg_csc_title', 'label' => 'Title', 'name' => 'title', 'type' => 'text'],
                                ['key' => 'field_pg_csc_icon', 'label' => 'Icon', 'name' => 'icon', 'type' => 'text'],
                                [
                                    'key' => 'field_pg_csc_links',
                                    'label' => 'Links',
                                    'name' => 'links',
                                    'type' => 'repeater',
                                    'layout' => 'table',
                                    'sub_fields' => [
                                        ['key' => 'field_pg_csc_l_label', 'label' => 'Label', 'name' => 'label', 'type' => 'text'],
                                        ['key' => 'field_pg_csc_l_href', 'label' => 'URL', 'name' => 'href', 'type' => 'url'],
                                    ],
                                ],
                            ],
                        ],
                    ],
                ],
                // Quick Actions
                'layout_quick_actions' => [
                    'key' => 'layout_pg_quick_actions',
                    'name' => 'quick_actions',
                    'label' => 'Quick Actions',
                    'sub_fields' => [
                        [
                            'key' => 'field_pg_qa_actions',
                            'label' => 'Actions',
                            'name' => 'actions',
                            'type' => 'repeater',
                            'layout' => 'table',
                            'sub_fields' => [
                                ['key' => 'field_pg_qa_a_label', 'label' => 'Label', 'name' => 'label', 'type' => 'text'],
                                ['key' => 'field_pg_qa_a_query', 'label' => 'Query', 'name' => 'query', 'type' => 'text'],
                            ],
                        ],
                    ],
                ],
                // Trust Badges
                'layout_trust_badges' => [
                    'key' => 'layout_pg_trust_badges',
                    'name' => 'trust_badges',
                    'label' => 'Trust Badges',
                    'sub_fields' => [
                        [
                            'key' => 'field_pg_tb_badges',
                            'label' => 'Badges',
                            'name' => 'badges',
                            'type' => 'repeater',
                            'layout' => 'table',
                            'sub_fields' => [
                                ['key' => 'field_pg_tb_b_icon', 'label' => 'Icon', 'name' => 'icon', 'type' => 'text'],
                                ['key' => 'field_pg_tb_b_bold', 'label' => 'Bold Text', 'name' => 'bold_text', 'type' => 'text'],
                                ['key' => 'field_pg_tb_b_text', 'label' => 'Text', 'name' => 'text', 'type' => 'text'],
                            ],
                        ],
                    ],
                ],
                // Contact Methods
                'layout_contact_methods' => [
                    'key' => 'layout_pg_contact_methods',
                    'name' => 'contact_methods',
                    'label' => 'Contact Methods',
                    'sub_fields' => [
                        ['key' => 'field_pg_cm_title', 'label' => 'Title', 'name' => 'title', 'type' => 'text'],
                        [
                            'key' => 'field_pg_cm_methods',
                            'label' => 'Methods',
                            'name' => 'methods',
                            'type' => 'repeater',
                            'layout' => 'block',
                            'sub_fields' => [
                                ['key' => 'field_pg_cm_m_icon', 'label' => 'Icon', 'name' => 'icon', 'type' => 'text'],
                                ['key' => 'field_pg_cm_m_title', 'label' => 'Title', 'name' => 'title', 'type' => 'text'],
                                ['key' => 'field_pg_cm_m_desc', 'label' => 'Description', 'name' => 'description', 'type' => 'textarea'],
                                ['key' => 'field_pg_cm_m_link', 'label' => 'Link', 'name' => 'link', 'type' => 'url'],
                                ['key' => 'field_pg_cm_m_hours', 'label' => 'Hours', 'name' => 'hours', 'type' => 'text'],
                            ],
                        ],
                    ],
                ],
                // Notice
                'layout_notice' => [
                    'key' => 'layout_pg_notice',
                    'name' => 'notice',
                    'label' => 'Notice',
                    'sub_fields' => [
                        ['key' => 'field_pg_notice_icon', 'label' => 'Icon', 'name' => 'icon', 'type' => 'text'],
                        ['key' => 'field_pg_notice_msg', 'label' => 'Message', 'name' => 'message', 'type' => 'textarea'],
                        ['key' => 'field_pg_notice_variant', 'label' => 'Variant', 'name' => 'variant', 'type' => 'select', 'choices' => ['warning' => 'Warning', 'info' => 'Info', 'success' => 'Success', 'error' => 'Error']],
                    ],
                ],
                // Chatbot
                'layout_chatbot' => [
                    'key' => 'layout_pg_chatbot',
                    'name' => 'chatbot',
                    'label' => 'Chatbot',
                    'sub_fields' => [
                        ['key' => 'field_pg_chat_enabled', 'label' => 'Enabled', 'name' => 'enabled', 'type' => 'true_false', 'default_value' => 1],
                        ['key' => 'field_pg_chat_title', 'label' => 'Title', 'name' => 'title', 'type' => 'text'],
                        ['key' => 'field_pg_chat_subtitle', 'label' => 'Subtitle', 'name' => 'subtitle', 'type' => 'text'],
                        ['key' => 'field_pg_chat_welcome', 'label' => 'Welcome Message', 'name' => 'welcome_message', 'type' => 'textarea'],
                        ['key' => 'field_pg_chat_placeholder', 'label' => 'Placeholder', 'name' => 'placeholder', 'type' => 'text'],
                    ],
                ],
            ],
        ],
        // Sidebar
        ['key' => 'field_pg_show_sidebar', 'label' => 'Show Sidebar', 'name' => 'show_sidebar', 'type' => 'true_false'],
        [
            'key' => 'field_pg_sidebar',
            'label' => 'Sidebar',
            'name' => 'sidebar',
            'type' => 'flexible_content',
            'button_label' => 'Add Sidebar Block',
            'conditional_logic' => [[['field' => 'field_pg_show_sidebar', 'operator' => '==', 'value' => '1']]],
            'layouts' => [
                'layout_sidebar_contact' => [
                    'key' => 'layout_pg_sb_contact',
                    'name' => 'sidebar_contact',
                    'label' => 'Contact',
                    'sub_fields' => [
                        ['key' => 'field_pg_sbc_title', 'label' => 'Title', 'name' => 'title', 'type' => 'text'],
                        ['key' => 'field_pg_sbc_address', 'label' => 'Address', 'name' => 'address', 'type' => 'textarea'],
                        ['key' => 'field_pg_sbc_phone', 'label' => 'Phone', 'name' => 'phone', 'type' => 'text'],
                        ['key' => 'field_pg_sbc_email', 'label' => 'Email', 'name' => 'email', 'type' => 'email'],
                        ['key' => 'field_pg_sbc_hours', 'label' => 'Hours', 'name' => 'hours', 'type' => 'text'],
                    ],
                ],
                'layout_sidebar_cta' => [
                    'key' => 'layout_pg_sb_cta',
                    'name' => 'sidebar_cta',
                    'label' => 'CTA',
                    'sub_fields' => [
                        ['key' => 'field_pg_sbcta_title', 'label' => 'Title', 'name' => 'title', 'type' => 'text'],
                        ['key' => 'field_pg_sbcta_desc', 'label' => 'Description', 'name' => 'description', 'type' => 'textarea'],
                        ['key' => 'field_pg_sbcta_btn', 'label' => 'Button Text', 'name' => 'button_text', 'type' => 'text'],
                        ['key' => 'field_pg_sbcta_link', 'label' => 'Button Link', 'name' => 'button_link', 'type' => 'url'],
                        ['key' => 'field_pg_sbcta_variant', 'label' => 'Variant', 'name' => 'variant', 'type' => 'select', 'choices' => ['primary' => 'Primary', 'secondary' => 'Secondary', 'outline' => 'Outline']],
                    ],
                ],
                'layout_sidebar_rich_text' => [
                    'key' => 'layout_pg_sb_rt',
                    'name' => 'sidebar_rich_text',
                    'label' => 'Rich Text',
                    'sub_fields' => [
                        ['key' => 'field_pg_sbrt_title', 'label' => 'Title', 'name' => 'title', 'type' => 'text'],
                        ['key' => 'field_pg_sbrt_content', 'label' => 'Content', 'name' => 'content', 'type' => 'wysiwyg'],
                    ],
                ],
            ],
        ],
        // Page Settings
        ['key' => 'field_pg_status', 'label' => 'Status', 'name' => 'page_status', 'type' => 'select', 'choices' => ['draft' => 'Draft', 'published' => 'Published'], 'default_value' => 'published'],
        ['key' => 'field_pg_locale', 'label' => 'Locale', 'name' => 'locale', 'type' => 'select', 'choices' => ['nl' => 'Nederlands', 'fr' => 'Français', 'en' => 'English', 'de' => 'Deutsch'], 'default_value' => 'nl'],
    ],
    'location' => [
        [['param' => 'post_type', 'operator' => '==', 'value' => 'page']],
    ],
]);

// ============================================================
// 3j. CPT: OEMline Menus
// ============================================================
$menu_icon_choices = [
    'home' => 'Home',
    'cart' => 'Cart',
    'user' => 'User',
    'heart' => 'Heart',
    'search' => 'Search',
    'phone' => 'Phone',
    'mail' => 'Mail',
    'truck' => 'Truck',
    'shield' => 'Shield',
    'info' => 'Info',
    'question' => 'Question',
    'star' => 'Star',
    'settings' => 'Settings',
];

acf_add_local_field_group([
    'key' => 'group_menus',
    'title' => 'Menu Settings',
    'fields' => [
        ['key' => 'field_mn_location', 'label' => 'Location', 'name' => 'location', 'type' => 'select', 'choices' => [
            'header-main' => 'Header (Main)',
            'header-secondary' => 'Header (Secondary)',
            'footer-col-1' => 'Footer Column 1',
            'footer-col-2' => 'Footer Column 2',
            'footer-col-3' => 'Footer Column 3',
            'footer-col-4' => 'Footer Column 4',
            'footer-col-5' => 'Footer Column 5',
            'footer-col-6' => 'Footer Column 6',
            'klantenservice-sidebar' => 'Klantenservice Sidebar',
            'mobile-main' => 'Mobile Main',
            'mobile-quick-links' => 'Mobile Quick Links',
        ]],
        [
            'key' => 'field_mn_items',
            'label' => 'Menu Items',
            'name' => 'items',
            'type' => 'repeater',
            'layout' => 'block',
            'sub_fields' => [
                ['key' => 'field_mn_i_label', 'label' => 'Label', 'name' => 'label', 'type' => 'text'],
                ['key' => 'field_mn_i_url', 'label' => 'URL', 'name' => 'url', 'type' => 'url'],
                ['key' => 'field_mn_i_icon', 'label' => 'Icon', 'name' => 'icon', 'type' => 'select', 'choices' => $menu_icon_choices, 'allow_null' => 1],
                ['key' => 'field_mn_i_new_tab', 'label' => 'Open in New Tab', 'name' => 'open_in_new_tab', 'type' => 'true_false'],
                [
                    'key' => 'field_mn_i_children',
                    'label' => 'Children',
                    'name' => 'children',
                    'type' => 'repeater',
                    'layout' => 'table',
                    'sub_fields' => [
                        ['key' => 'field_mn_ic_label', 'label' => 'Label', 'name' => 'label', 'type' => 'text'],
                        ['key' => 'field_mn_ic_url', 'label' => 'URL', 'name' => 'url', 'type' => 'url'],
                        ['key' => 'field_mn_ic_icon', 'label' => 'Icon', 'name' => 'icon', 'type' => 'select', 'choices' => $menu_icon_choices, 'allow_null' => 1],
                        ['key' => 'field_mn_ic_new_tab', 'label' => 'New Tab', 'name' => 'open_in_new_tab', 'type' => 'true_false'],
                    ],
                ],
            ],
        ],
        ['key' => 'field_mn_col_title', 'label' => 'Column Title (footer)', 'name' => 'column_title', 'type' => 'text'],
        ['key' => 'field_mn_accordion', 'label' => 'Mobile Accordion', 'name' => 'mobile_accordion', 'type' => 'true_false', 'default_value' => 1],
        ['key' => 'field_mn_status', 'label' => 'Status', 'name' => 'menu_status', 'type' => 'select', 'choices' => ['active' => 'Active', 'draft' => 'Draft'], 'default_value' => 'active'],
    ],
    'location' => [
        [['param' => 'post_type', 'operator' => '==', 'value' => 'oemline-menu']],
    ],
]);

// ============================================================
// 3k. CPT: Featured Products
// ============================================================
$badge_choices = [
    'none' => 'None',
    'sale' => 'Sale',
    'new' => 'New',
    'hot' => 'Hot',
    'bestseller' => 'Bestseller',
];

$display_location_choices = [
    'homepage_top_rated' => 'Homepage: Top Rated',
    'homepage_bestsellers' => 'Homepage: Bestsellers',
    'homepage_offers' => 'Homepage: Offers',
    'homepage_new' => 'Homepage: New',
    'category_featured' => 'Category: Featured',
    'search_promoted' => 'Search: Promoted',
];

acf_add_local_field_group([
    'key' => 'group_featured_products',
    'title' => 'Featured Product Settings',
    'fields' => [
        ['key' => 'field_fp_article_no', 'label' => 'Article Number', 'name' => 'article_number', 'type' => 'text', 'required' => 1, 'instructions' => 'Looked up via Dashboard API /api/storefront/lookup'],
        ['key' => 'field_fp_brand_code', 'label' => 'Brand Code', 'name' => 'brand_code', 'type' => 'text'],
        ['key' => 'field_fp_dash_id', 'label' => 'Dashboard Product ID', 'name' => 'dashboard_product_id', 'type' => 'number', 'instructions' => 'Auto-populated from Dashboard API lookup'],
        ['key' => 'field_fp_location', 'label' => 'Display Location', 'name' => 'display_location', 'type' => 'checkbox', 'choices' => $display_location_choices],
        ['key' => 'field_fp_custom_price', 'label' => 'Custom Price (override)', 'name' => 'custom_price', 'type' => 'number', 'step' => '0.01'],
        ['key' => 'field_fp_custom_image', 'label' => 'Custom Image (override)', 'name' => 'custom_image', 'type' => 'image', 'return_format' => 'url'],
        ['key' => 'field_fp_badge', 'label' => 'Badge', 'name' => 'badge', 'type' => 'select', 'choices' => $badge_choices, 'default_value' => 'none'],
        ['key' => 'field_fp_order', 'label' => 'Display Order', 'name' => 'display_order', 'type' => 'number', 'default_value' => 0],
        ['key' => 'field_fp_active', 'label' => 'Active', 'name' => 'is_active', 'type' => 'true_false', 'default_value' => 1],
        // Cached Data (read-only display)
        [
            'key' => 'field_fp_cached',
            'label' => 'Cached Data (from Dashboard API)',
            'name' => 'cached_data',
            'type' => 'group',
            'layout' => 'block',
            'instructions' => 'Auto-synced from Dashboard API. Do not edit manually.',
            'sub_fields' => [
                ['key' => 'field_fp_c_desc', 'label' => 'Description', 'name' => 'description', 'type' => 'text', 'readonly' => 1],
                ['key' => 'field_fp_c_brand', 'label' => 'Brand Name', 'name' => 'brand_name', 'type' => 'text', 'readonly' => 1],
                ['key' => 'field_fp_c_category', 'label' => 'Category', 'name' => 'category_name', 'type' => 'text', 'readonly' => 1],
                ['key' => 'field_fp_c_image', 'label' => 'Image URL', 'name' => 'image_url', 'type' => 'url', 'readonly' => 1],
                ['key' => 'field_fp_c_price', 'label' => 'Price', 'name' => 'price', 'type' => 'number', 'readonly' => 1],
                ['key' => 'field_fp_c_stock', 'label' => 'Stock', 'name' => 'stock', 'type' => 'number', 'readonly' => 1],
                ['key' => 'field_fp_c_synced', 'label' => 'Last Synced', 'name' => 'last_synced', 'type' => 'text', 'readonly' => 1],
            ],
        ],
    ],
    'location' => [
        [['param' => 'post_type', 'operator' => '==', 'value' => 'featured-product']],
    ],
]);

// ============================================================
// 3l. CPT: Featured Categories
// ============================================================
acf_add_local_field_group([
    'key' => 'group_featured_categories',
    'title' => 'Featured Category Settings',
    'fields' => [
        ['key' => 'field_fc_cat_id', 'label' => 'Dashboard Category ID', 'name' => 'dashboard_category_id', 'type' => 'number', 'required' => 1, 'instructions' => 'ID from Dashboard API /api/storefront/categories'],
        ['key' => 'field_fc_desc', 'label' => 'Description', 'name' => 'description', 'type' => 'textarea'],
        ['key' => 'field_fc_image', 'label' => 'Category Image', 'name' => 'category_image', 'type' => 'image', 'return_format' => 'url'],
        ['key' => 'field_fc_icon', 'label' => 'Icon (Lucide name)', 'name' => 'icon', 'type' => 'text'],
        ['key' => 'field_fc_order', 'label' => 'Display Order', 'name' => 'display_order', 'type' => 'number', 'default_value' => 0],
        ['key' => 'field_fc_active', 'label' => 'Active', 'name' => 'is_active', 'type' => 'true_false', 'default_value' => 1],
        ['key' => 'field_fc_homepage', 'label' => 'Show on Homepage', 'name' => 'show_on_homepage', 'type' => 'true_false', 'default_value' => 1],
        ['key' => 'field_fc_nav', 'label' => 'Show in Nav', 'name' => 'show_in_nav', 'type' => 'true_false'],
        // Cached Data
        [
            'key' => 'field_fc_cached',
            'label' => 'Cached Data (from Dashboard API)',
            'name' => 'cached_data',
            'type' => 'group',
            'layout' => 'block',
            'instructions' => 'Auto-synced from Dashboard API.',
            'sub_fields' => [
                ['key' => 'field_fc_c_name', 'label' => 'Name', 'name' => 'name', 'type' => 'text', 'readonly' => 1],
                ['key' => 'field_fc_c_count', 'label' => 'Product Count', 'name' => 'product_count', 'type' => 'number', 'readonly' => 1],
                ['key' => 'field_fc_c_children', 'label' => 'Child Count', 'name' => 'child_count', 'type' => 'number', 'readonly' => 1],
            ],
        ],
    ],
    'location' => [
        [['param' => 'post_type', 'operator' => '==', 'value' => 'featured-category']],
    ],
]);

// ============================================================
// 3m. CPT: Price Requests
// ============================================================
acf_add_local_field_group([
    'key' => 'group_price_requests',
    'title' => 'Price Request Details',
    'fields' => [
        // Tab: Customer
        ['key' => 'field_pr_tab_customer', 'label' => 'Klantgegevens', 'name' => '', 'type' => 'tab'],
        ['key' => 'field_pr_name', 'label' => 'Customer Name', 'name' => 'customer_name', 'type' => 'text'],
        ['key' => 'field_pr_email', 'label' => 'Customer Email', 'name' => 'customer_email', 'type' => 'email', 'required' => 1],
        ['key' => 'field_pr_phone', 'label' => 'Customer Phone', 'name' => 'customer_phone', 'type' => 'text', 'required' => 1],
        ['key' => 'field_pr_plate', 'label' => 'License Plate', 'name' => 'customer_license_plate', 'type' => 'text', 'required' => 1],
        // Tab: Product
        ['key' => 'field_pr_tab_product', 'label' => 'Product Details', 'name' => '', 'type' => 'tab'],
        ['key' => 'field_pr_article', 'label' => 'Article Number', 'name' => 'article_number', 'type' => 'text', 'required' => 1],
        ['key' => 'field_pr_product_name', 'label' => 'Product Name', 'name' => 'product_name', 'type' => 'text'],
        ['key' => 'field_pr_manufacturer', 'label' => 'Manufacturer', 'name' => 'manufacturer', 'type' => 'text'],
        ['key' => 'field_pr_quantity', 'label' => 'Quantity', 'name' => 'quantity', 'type' => 'number', 'default_value' => 1],
        // Tab: Extra
        ['key' => 'field_pr_tab_extra', 'label' => 'Extra', 'name' => '', 'type' => 'tab'],
        ['key' => 'field_pr_notes', 'label' => 'Notes', 'name' => 'notes', 'type' => 'textarea'],
        ['key' => 'field_pr_source_url', 'label' => 'Source URL', 'name' => 'source_url', 'type' => 'url'],
        ['key' => 'field_pr_internal', 'label' => 'Internal Notes', 'name' => 'internal_notes', 'type' => 'textarea'],
        // Status
        ['key' => 'field_pr_tab_status', 'label' => 'Status', 'name' => '', 'type' => 'tab'],
        ['key' => 'field_pr_status', 'label' => 'Request Status', 'name' => 'request_status', 'type' => 'select', 'choices' => [
            'pending' => 'Pending',
            'processing' => 'Processing',
            'quoted' => 'Quoted',
            'completed' => 'Completed',
            'cancelled' => 'Cancelled',
        ], 'default_value' => 'pending'],
    ],
    'location' => [
        [['param' => 'post_type', 'operator' => '==', 'value' => 'price-request']],
    ],
]);

// ============================================================
// 3n. CPT: Product Description Overrides
// ============================================================
acf_add_local_field_group([
    'key' => 'group_product_overrides',
    'title' => 'Product Override Settings',
    'fields' => [
        ['key' => 'field_po_article', 'label' => 'TecDoc Article Number', 'name' => 'tecdoc_article_number', 'type' => 'text', 'required' => 1],
        ['key' => 'field_po_brand', 'label' => 'TecDoc Brand', 'name' => 'tecdoc_brand', 'type' => 'text'],
        ['key' => 'field_po_main_image', 'label' => 'Main Image', 'name' => 'main_image', 'type' => 'image', 'return_format' => 'url'],
        ['key' => 'field_po_gallery', 'label' => 'Gallery Images', 'name' => 'gallery_images', 'type' => 'gallery', 'return_format' => 'url'],
        ['key' => 'field_po_price', 'label' => 'Custom Price', 'name' => 'custom_price', 'type' => 'number', 'step' => '0.01'],
        ['key' => 'field_po_description', 'label' => 'Custom Description', 'name' => 'custom_description', 'type' => 'wysiwyg'],
        ['key' => 'field_po_specifications', 'label' => 'Specifications', 'name' => 'specifications', 'type' => 'wysiwyg'],
        ['key' => 'field_po_applicability', 'label' => 'Applicability', 'name' => 'applicability', 'type' => 'wysiwyg'],
        ['key' => 'field_po_original_numbers', 'label' => 'Original Numbers', 'name' => 'original_numbers', 'type' => 'wysiwyg'],
        ['key' => 'field_po_manufacturer_info', 'label' => 'Manufacturer Info', 'name' => 'manufacturer_info', 'type' => 'wysiwyg'],
        ['key' => 'field_po_delivery_time', 'label' => 'Delivery Time', 'name' => 'delivery_time', 'type' => 'text'],
        ['key' => 'field_po_extra_info', 'label' => 'Extra Info', 'name' => 'extra_info', 'type' => 'wysiwyg'],
    ],
    'location' => [
        [['param' => 'post_type', 'operator' => '==', 'value' => 'product-override']],
    ],
]);

// ============================================================
// 3o. CPT: Product Extensions
// ============================================================
acf_add_local_field_group([
    'key' => 'group_product_extensions',
    'title' => 'Product Extension Settings',
    'fields' => [
        ['key' => 'field_pe_article', 'label' => 'Article Number', 'name' => 'article_number', 'type' => 'text', 'required' => 1, 'instructions' => 'Links to Dashboard API product via articleNo'],
        ['key' => 'field_pe_dash_id', 'label' => 'Dashboard Product ID', 'name' => 'dashboard_product_id', 'type' => 'number', 'instructions' => 'Auto-populated from Dashboard API'],
        ['key' => 'field_pe_brand_code', 'label' => 'Brand Code', 'name' => 'brand_code', 'type' => 'text'],
        // Vehicle Group
        [
            'key' => 'field_pe_vehicle',
            'label' => 'Vehicle',
            'name' => 'vehicle',
            'type' => 'group',
            'layout' => 'block',
            'sub_fields' => [
                [
                    'key' => 'field_pe_v_plates',
                    'label' => 'License Plates',
                    'name' => 'license_plates',
                    'type' => 'repeater',
                    'layout' => 'block',
                    'sub_fields' => [
                        ['key' => 'field_pe_vp_plate', 'label' => 'Plate', 'name' => 'plate', 'type' => 'text'],
                        [
                            'key' => 'field_pe_vp_info',
                            'label' => 'Vehicle Info',
                            'name' => 'vehicle_info',
                            'type' => 'group',
                            'layout' => 'block',
                            'sub_fields' => [
                                ['key' => 'field_pe_vi_make', 'label' => 'Make', 'name' => 'make', 'type' => 'text'],
                                ['key' => 'field_pe_vi_model', 'label' => 'Model', 'name' => 'model', 'type' => 'text'],
                                ['key' => 'field_pe_vi_year', 'label' => 'Year', 'name' => 'year', 'type' => 'text'],
                                ['key' => 'field_pe_vi_engine', 'label' => 'Engine', 'name' => 'engine', 'type' => 'text'],
                                ['key' => 'field_pe_vi_fuel', 'label' => 'Fuel Type', 'name' => 'fuel_type', 'type' => 'text'],
                                ['key' => 'field_pe_vi_body', 'label' => 'Body Type', 'name' => 'body_type', 'type' => 'text'],
                            ],
                        ],
                    ],
                ],
                [
                    'key' => 'field_pe_v_manual',
                    'label' => 'Manual Vehicles',
                    'name' => 'manual_vehicles',
                    'type' => 'repeater',
                    'layout' => 'table',
                    'sub_fields' => [
                        ['key' => 'field_pe_vm_make', 'label' => 'Make', 'name' => 'make', 'type' => 'text'],
                        ['key' => 'field_pe_vm_model', 'label' => 'Model', 'name' => 'model', 'type' => 'text'],
                        ['key' => 'field_pe_vm_year_from', 'label' => 'Year From', 'name' => 'year_from', 'type' => 'text'],
                        ['key' => 'field_pe_vm_year_to', 'label' => 'Year To', 'name' => 'year_to', 'type' => 'text'],
                        ['key' => 'field_pe_vm_engine', 'label' => 'Engine', 'name' => 'engine', 'type' => 'text'],
                        ['key' => 'field_pe_vm_variant', 'label' => 'Variant', 'name' => 'variant', 'type' => 'text'],
                    ],
                ],
            ],
        ],
        // Extra Specifications
        [
            'key' => 'field_pe_extra_specs',
            'label' => 'Extra Specifications',
            'name' => 'extra_specifications',
            'type' => 'repeater',
            'layout' => 'table',
            'sub_fields' => [
                ['key' => 'field_pe_es_name', 'label' => 'Name', 'name' => 'name', 'type' => 'text'],
                ['key' => 'field_pe_es_value', 'label' => 'Value', 'name' => 'value', 'type' => 'text'],
                ['key' => 'field_pe_es_unit', 'label' => 'Unit', 'name' => 'unit', 'type' => 'text'],
            ],
        ],
        // Product Tabs
        [
            'key' => 'field_pe_tabs',
            'label' => 'Product Tabs',
            'name' => 'product_tabs',
            'type' => 'group',
            'layout' => 'block',
            'sub_fields' => [
                [
                    'key' => 'field_pe_t_specs',
                    'label' => 'Custom Specifications',
                    'name' => 'custom_specifications',
                    'type' => 'repeater',
                    'layout' => 'table',
                    'sub_fields' => [
                        ['key' => 'field_pe_ts_name', 'label' => 'Name', 'name' => 'name', 'type' => 'text'],
                        ['key' => 'field_pe_ts_value', 'label' => 'Value', 'name' => 'value', 'type' => 'text'],
                        ['key' => 'field_pe_ts_unit', 'label' => 'Unit', 'name' => 'unit', 'type' => 'text'],
                    ],
                ],
                ['key' => 'field_pe_t_compat', 'label' => 'Compatibility Notes', 'name' => 'compatibility_notes', 'type' => 'textarea'],
                ['key' => 'field_pe_t_delivery', 'label' => 'Delivery Info', 'name' => 'delivery_info', 'type' => 'textarea'],
                ['key' => 'field_pe_t_custom', 'label' => 'Custom Tab Content', 'name' => 'custom_tab_content', 'type' => 'wysiwyg'],
            ],
        ],
        // SEO
        [
            'key' => 'field_pe_seo',
            'label' => 'SEO',
            'name' => 'seo',
            'type' => 'group',
            'layout' => 'block',
            'sub_fields' => [
                ['key' => 'field_pe_seo_title', 'label' => 'Meta Title', 'name' => 'meta_title', 'type' => 'text'],
                ['key' => 'field_pe_seo_desc', 'label' => 'Meta Description', 'name' => 'meta_description', 'type' => 'textarea', 'rows' => 3],
                [
                    'key' => 'field_pe_seo_keywords',
                    'label' => 'Keywords',
                    'name' => 'keywords',
                    'type' => 'repeater',
                    'layout' => 'table',
                    'sub_fields' => [
                        ['key' => 'field_pe_seo_kw', 'label' => 'Keyword', 'name' => 'keyword', 'type' => 'text'],
                    ],
                ],
            ],
        ],
    ],
    'location' => [
        [['param' => 'post_type', 'operator' => '==', 'value' => 'product-extension']],
    ],
]);
