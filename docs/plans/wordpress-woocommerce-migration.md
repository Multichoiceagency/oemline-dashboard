# Plan: WordPress + WooCommerce Docker Service on Coolify

## Context
Replace Payload CMS + Medusa with WordPress + WooCommerce as the single backend for the OEMline storefront. WordPress must replicate ALL functionality currently in Payload CMS (11 collections, 8 globals, 20 content blocks) plus WooCommerce for e-commerce (checkout, cart, payments, tax). The existing Next.js storefront will call WordPress REST API instead of Payload API.

## Architecture
```
Coolify Server (49.13.147.126)
├── PostgreSQL          (existing - OEMline DB)
├── Redis               (existing - caching)
├── Meilisearch         (existing - search)
├── MinIO               (existing - file storage)
├── OEMline API         (existing - Fastify)
├── OEMline Worker      (existing - BullMQ)
├── OEMline Dashboard   (existing - Next.js)
├── MariaDB        ← NEW (WordPress database)
└── WordPress      ← NEW (WooCommerce + Mollie + ACF PRO)
```

### Storefront API mapping (old → new)
```
OLD: Payload API  /api/pages?slug=home     → NEW: WP REST  /wp-json/wp/v2/pages?slug=home
OLD: Payload API  /api/globals/site-settings → NEW: WP REST  /wp-json/acf/v3/options/site-settings
OLD: Payload API  /api/globals/homepage     → NEW: WP REST  /wp-json/acf/v3/options/homepage
OLD: Payload API  /api/globals/header       → NEW: WP REST  /wp-json/acf/v3/options/header
OLD: Payload API  /api/globals/footer       → NEW: WP REST  /wp-json/acf/v3/options/footer
OLD: Payload API  /api/menus                → NEW: WP REST  /wp-json/wp/v2/oemline-menu
OLD: Medusa API   /store/products           → NEW: WC REST  /wp-json/wc/v3/products
OLD: Medusa API   /store/carts              → NEW: WC REST  /wp-json/wc/v3/cart (CoCart)
OLD: OEMline API  /api/storefront/*         → UNCHANGED (TecDoc products stay here)
```

---

## Step 1: Create `wordpress/` directory

### `wordpress/Dockerfile`
Custom image based on `wordpress:6.7-apache`:
- Pre-install plugins via WP-CLI:
  - **WooCommerce** (e-commerce)
  - **Mollie Payments for WooCommerce** (iDEAL + Credit Card)
  - **Advanced Custom Fields PRO** (custom fields + flexible content)
  - **ACF to REST API** (expose ACF in REST)
  - **JWT Authentication for WP REST API** (storefront auth)
  - **CoCart** (headless cart/checkout REST API)
  - **WP REST Cache** (performance)
  - **Custom Post Type UI** (register CPTs without code)
- Copy custom theme `oemline-headless`
- Copy `php.ini` overrides

### `wordpress/php.ini`
```ini
upload_max_filesize = 200M
post_max_size = 200M
memory_limit = 512M
max_execution_time = 300
```

### `wordpress/docker-compose.yml`
Local development: WordPress (8080) + MariaDB (3307) + phpMyAdmin (8081)

### `wordpress/.env.example`
```
WORDPRESS_DB_HOST=mariadb
WORDPRESS_DB_NAME=wordpress
WORDPRESS_DB_USER=wordpress
WORDPRESS_DB_PASSWORD=
WP_HOME=https://wp.oemline.eu
WP_SITEURL=https://wp.oemline.eu
JWT_AUTH_SECRET_KEY=
MOLLIE_API_KEY=live_ypMvCzA8nCG5WcBJNmc7E3VfjDs28H
```

### `wordpress/tax-rates.csv`
All 27 EU VAT rates for WooCommerce bulk import.

---

## Step 2: Headless Theme — `wordpress/theme/oemline-headless/`

Minimal theme (no frontend rendering). All logic in `functions.php`:

### 2a. ACF Options Pages (replaces Payload Globals)

| Payload Global | WP Options Page | Menu Location |
|---------------|-----------------|---------------|
| `site-settings` | Site Settings | OEMline > Site Settings |
| `theme` | Theme Settings | OEMline > Theme |
| `homepage` | Homepage | OEMline > Homepage |
| `header` | Header | OEMline > Header |
| `footer` | Footer | OEMline > Footer |
| `klantenservice` | Klantenservice | OEMline > Klantenservice |
| `product-page-config` | Product Page Config | OEMline > Product Page |
| `cart-page-config` | Cart Page Config | OEMline > Cart Page |

### 2b. Custom Post Types (replaces Payload Collections)

| Payload Collection | WP CPT | Slug |
|-------------------|--------|------|
| `pages` | Pages (built-in) | `page` |
| `media` | Media (built-in) | `attachment` |
| `menus` | OEMline Menu | `oemline-menu` |
| `featured-products` | Featured Product | `featured-product` |
| `featured-categories` | Featured Category | `featured-category` |
| `price-requests` | Price Request | `price-request` |
| `product-description-overrides` | Product Override | `product-override` |
| `medusa-product-extensions` | Product Extension | `product-extension` |
| `seed-status` | (not needed) | — |
| `backups` | (WP has its own) | — |
| `users` | Users (built-in) | `user` |

### 2c. REST API endpoints registered in `functions.php`
- CORS headers for storefront domain
- Custom endpoint: `GET /wp-json/oemline/v1/menus/{location}` (returns menu by location)
- Custom endpoint: `GET /wp-json/oemline/v1/page/{slug}` (returns page + ACF modules)

---

## Step 3: ACF Field Groups — Complete Mapping

### 3a. GLOBAL: Site Settings
*Replaces Payload `site-settings` global*

| ACF Field | Type | Default |
|-----------|------|---------|
| `company_name` | Text | OEMLine |
| `company_legal_name` | Text | OEMline B.V. |
| **contact_info** | Group | |
| ├ `street` | Text | |
| ├ `postal_code` | Text | |
| ├ `city` | Text | |
| ├ `country` | Text | Nederland |
| ├ `phone` | Text | |
| ├ `email` | Email | |
| └ `privacy_email` | Email | |
| **business_hours** | Repeater | |
| ├ `days` | Text | |
| └ `hours` | Text | |
| **social_media** | Group | |
| ├ `facebook` | URL | |
| ├ `instagram` | URL | |
| ├ `linkedin` | URL | |
| └ `twitter` | URL | |

### 3b. GLOBAL: Theme Settings
*Replaces Payload `theme` global*

| ACF Field | Type | Default |
|-----------|------|---------|
| **fonts** | Group | |
| ├ `body_font` | Select (19 fonts) | inter |
| └ `heading_font` | Select (19 fonts) | poppins |
| **font_sizes** | Group | |
| ├ `xsmall` | Text | 0.75rem |
| ├ `small` | Text | 0.875rem |
| ├ `base` | Text | 1rem |
| ├ `large` | Text | 1.125rem |
| ├ `xl` | Text | 1.25rem |
| ├ `xxl` | Text | 1.5rem |
| └ `xxxl` | Text | 2rem |
| **colors** | Group (18 color pickers) | |
| ├ `primary_50` through `primary_900` | Color Picker | |
| ├ `background` | Color Picker | |
| ├ `surface` | Color Picker | |
| ├ `text` | Color Picker | |
| ├ `text_muted` | Color Picker | |
| ├ `border` | Color Picker | |
| ├ `success` | Color Picker | |
| ├ `warning` | Color Picker | |
| ├ `danger` | Color Picker | |
| └ `link` | Color Picker | |

### 3c. GLOBAL: Homepage
*Replaces Payload `homepage` global — uses Flexible Content*

**Field: `sections`** — ACF Flexible Content with these layouts:

#### Layout: `hero`
| Field | Type | Default |
|-------|------|---------|
| `enabled` | True/False | true |
| `background_image` | Image | |
| `background_image_url` | URL | (fallback) |
| `title` | Text | Vind onderdelen voor uw voertuig |
| `subtitle` | Text | Zoek op kenteken, merk of onderdeelnummer |
| `show_vehicle_search` | True/False | true |
| `video_url_desktop` | URL | |
| `video_url_mobile` | URL | |

#### Layout: `features`
| Field | Type | Default |
|-------|------|---------|
| `enabled` | True/False | true |
| **items** | Repeater (max 4) | |
| ├ `icon` | Select (truck/headset/refresh/creditcard/shield/clock) | |
| ├ `title` | Text | |
| └ `description` | Text | |

#### Layout: `category_grid`
| Field | Type | Default |
|-------|------|---------|
| `enabled` | True/False | true |
| `title` | Text | Shop by Category |
| **categories** | Repeater | |
| ├ `source` | Select (manual/collection) | |
| ├ `name` | Text | (if manual) |
| ├ `image` | Image | (if manual) |
| ├ `link_type` | Select (tecdoc/custom) | |
| ├ `tecdoc_category_id` | Number | (if tecdoc) |
| ├ `link` | URL | (if custom) |
| └ `featured_category` | Post Object (featured-category CPT) | (if collection) |

#### Layout: `brand_logos`
| Field | Type | Default |
|-------|------|---------|
| `enabled` | True/False | true |
| `source` | Select (tecdoc/manual) | tecdoc |
| **manual_brands** | Repeater | (if manual) |
| ├ `name` | Text | |
| ├ `logo` | Image | |
| └ `link` | URL | |

#### Layout: `brand_carousel`
| Field | Type | Default |
|-------|------|---------|
| `enabled` | True/False | true |
| `title` | Text | Onze Merken |
| `source` | Select (tecdoc/manual) | tecdoc |
| **manual_brands** | Repeater | (if manual) |
| `max_brands` | Number | 24 |
| `show_view_all` | True/False | true |
| `view_all_text` | Text | Bekijk alle merken |
| `view_all_link` | URL | /brands |

#### Layout: `carousel`
| Field | Type | Default |
|-------|------|---------|
| `enabled` | True/False | true |
| `autoplay` | True/False | true |
| `autoplay_ms` | Number | 5000 |
| `height` | Select (small/medium/large) | medium |
| **slides** | Repeater (1-12) | |
| ├ `image` | Image | |
| ├ `title` | Text | |
| ├ `subtitle` | Text | |
| ├ `button_text` | Text | |
| ├ `button_link` | URL | |
| └ `overlay` | True/False | true |

#### Layout: `promo_banners`
| Field | Type | Default |
|-------|------|---------|
| `enabled` | True/False | true |
| **banners** | Repeater (max 3) | |
| ├ `image` | Image | |
| ├ `title` | Text | |
| ├ `subtitle` | Text | |
| ├ `button_text` | Text | |
| ├ `button_link` | URL | |
| └ `background_color` | Color Picker | |

#### Layout: `product_showcase`
| Field | Type | Default |
|-------|------|---------|
| `enabled` | True/False | true |
| `title` | Text | Featured Products |
| `layout` | Select (grid/carousel/deal-zone) | grid |
| `subtitle` | Text | (if carousel) |
| `background_image` | Image | (if deal-zone) |
| `product_source` | Select (tecdoc/manual/woocommerce) | tecdoc |
| `tecdoc_category_ids` | Text | (if tecdoc) |
| `wc_product_ids` | Text | (if woocommerce, comma-separated) |
| `view_all_link` | URL | (if carousel) |
| `max_products` | Number | 12 |

#### Layout: `product_columns`
| Field | Type | Default |
|-------|------|---------|
| `enabled` | True/False | true |
| **columns** | Repeater (1-4) | |
| ├ `title` | Text | |
| ├ `product_source` | Select (manual/tecdoc/woocommerce) | |
| ├ `tecdoc_category_id` | Number | (if tecdoc) |
| └ `wc_product_ids` | Text | (if woocommerce) |
| `max_per_column` | Number | 6 |

#### Layout: `seo_text`
| Field | Type | Default |
|-------|------|---------|
| `enabled` | True/False | true |
| `title` | Text | |
| `content` | Textarea | |
| **columns** | Repeater (max 4) | |
| ├ `title` | Text | |
| ├ `content` | Textarea | |
| ├ `link` | URL | |
| └ `link_text` | Text | Lees meer |

#### Layout: `app_banner`
| Field | Type | Default |
|-------|------|---------|
| `enabled` | True/False | true |
| `title` | Text | Producten kopen via de app is altijd goedkoper... |
| `subtitle` | Text | |
| `background_color` | Color Picker | #F36C21 |
| `phone_image` | Image | |
| `google_play_url` | URL | |
| `app_store_url` | URL | |
| `qr_code_image` | Image | |
| `qr_code_text` | Text | SCAN OM DE APP TE DOWNLOADEN |

### 3d. GLOBAL: Header
*Replaces Payload `header` global*

| ACF Field | Type | Default |
|-----------|------|---------|
| **announcement_bar** | Group | |
| ├ `enabled` | True/False | false |
| ├ `text` | Text | |
| ├ `link_text` | Text | |
| ├ `link_url` | URL | |
| ├ `background_color` | Color Picker | #F36C21 |
| ├ `text_color` | Color Picker | #ffffff |
| └ `mobile_font_size` | Select (xs/sm/base) | |
| **top_bar** | Group | |
| ├ `enabled` | True/False | true |
| ├ `phone` | Text | (800) 060-0730 |
| ├ `tagline` | Text | |
| └ **links** | Repeater: label + href | |
| **main_nav** | Group | |
| └ **links** | Repeater | |
| │ ├ `label` | Text | |
| │ ├ `href` | URL | |
| │ └ `is_highlighted` | True/False | |
| **mobile_menu** | Group | |
| ├ `width` | Select (75vw-100vw) | 85vw |
| ├ `max_width` | Text | 320 |
| ├ **quick_links** | Repeater: label, href, icon, style | |
| ├ `footer_button_text` | Text | Alle Categorieën Bekijken |
| ├ `footer_button_link` | URL | /categories |
| └ `footer_button_color` | Color Picker | #F36C21 |
| **shipping_badge** | Group | |
| ├ `enabled` | True/False | true |
| ├ `text` | Text | Gratis verzending |
| └ `threshold` | Text | €50+ |

### 3e. GLOBAL: Footer
*Replaces Payload `footer` global*

| ACF Field | Type | Default |
|-----------|------|---------|
| `use_menu_system` | True/False | true |
| **menu_columns** | Repeater | (if use_menu_system) |
| └ `menu` | Post Object (oemline-menu CPT) | |
| `mobile_accordion` | True/False | true |
| **contact_section** | Group | |
| ├ `title` | Text | Neem Contact Op |
| ├ `description` | Textarea | |
| ├ `phone` | Text | |
| ├ `email` | Email | |
| ├ `location` | Text | |
| └ `hours` | Text | |
| **categories_section** | Group | |
| ├ `title` | Text | Categorieën |
| ├ **categories** | Repeater: name + href | |
| └ `show_all_brands_link` | True/False | true |
| **information_section** | Group | |
| ├ `title` | Text | Informatie |
| └ **links** | Repeater: label + href | |
| **newsletter** | Group | |
| ├ `enabled` | True/False | true |
| ├ `title` | Text | Nieuwsbrief |
| ├ `description` | Textarea | |
| ├ `button_text` | Text | Abonneren |
| └ `placeholder` | Text | E-mailadres... |
| **social_media** | Group | |
| ├ `title` | Text | Volg ons op sociale media |
| ├ `facebook` | URL | |
| ├ `twitter` | URL | |
| ├ `youtube` | URL | |
| └ `instagram` | URL | |
| **trust_badges** | Repeater (max 6) | |
| ├ `icon` | Select (retour/truck/package/price/quality/star/clock/headset) | |
| └ `text` | Text | |
| **bottom_bar** | Group | |
| ├ `show_language_selector` | True/False | true |
| ├ `show_tecdoc_badge` | True/False | true |
| ├ `design_credit` | Text | Ontworpen door |
| ├ `design_credit_link` | URL | |
| ├ `design_credit_name` | Text | Multichoice Agency |
| └ **payment_methods** | Repeater: name (select 19 options) + enabled | |

### 3f. GLOBAL: Klantenservice
*Replaces Payload `klantenservice` global*

| ACF Field | Type | Default |
|-----------|------|---------|
| `sidebar_title` | Text | KLANTENSERVICE |
| **categories** | Repeater | |
| ├ `title` | Text | |
| ├ `slug` | Text | |
| ├ `icon` | Select (10 icons) | |
| ├ `description` | Textarea | |
| ├ `content` | WYSIWYG | |
| ├ **links** | Repeater: label + href | |
| └ **faq** | Repeater: question + answer | |
| **extra_sidebar_items** | Repeater: label + href + icon | |
| **quick_actions** | Repeater | |
| ├ `label` | Text | |
| └ `query` | Text | |
| **trust_badges** | Repeater: icon + bold_text + text | |
| `contact_title` | Text | Contact |
| **contact_methods** | Repeater | |
| ├ `icon` | Select | |
| ├ `title` | Text | |
| ├ `description` | Textarea | |
| ├ `link` | URL | |
| ├ `link_text` | Text | |
| └ `hours` | Text | |
| **chatbot** | Group | |
| ├ `enabled` | True/False | true |
| ├ `title` | Text | OEM Assistent |
| ├ `subtitle` | Text | |
| ├ `welcome_message` | Textarea | |
| ├ `placeholder` | Text | |
| ├ `system_prompt` | Textarea | |
| ├ `company_context` | Textarea | |
| ├ **knowledge_base** | Repeater: topic + answer | |
| ├ `temperature` | Number (0-1) | 0.7 |
| ├ `max_tokens` | Number | 1024 |
| ├ `max_messages` | Number | 20 |
| └ `response_language` | Select (nl/en/de/fr/auto) | nl |
| **notice** | Group | |
| ├ `enabled` | True/False | true |
| ├ `icon` | Text | ⚙️ |
| ├ `message` | Textarea | |
| └ `variant` | Select (warning/info/success/error) | warning |

### 3g. GLOBAL: Product Page Config
*Replaces Payload `product-page-config` global*

| ACF Field | Type | Default |
|-----------|------|---------|
| **labels** | Group | |
| ├ `add_to_cart_text` | Text | In Winkelwagen |
| ├ `request_price_text` | Text | Prijs op aanvraag |
| ├ `delivery_text` | Text | Levertijd: 1 - 3 werkdagen |
| └ `contact_text` | Text | Neem contact met ons op |
| **tabs** | Repeater | |
| ├ `key` | Select (spec/compatibility/oem/manufacturer/delivery/custom) | |
| ├ `label` | Text | |
| ├ `enabled` | True/False | true |
| └ `custom_content` | WYSIWYG | (if key=custom) |
| **sidebar_sections** | Flexible Content | |
| ├ Layout: `frequently_bought_together` | enabled, title, max_products, product_source, wc_product_ids | |
| ├ Layout: `trust_badges` | enabled, badges repeater (icon + title + description) | |
| └ Layout: `promo_banner` | enabled, text, link, bg_color, text_color | |
| **below_product_sections** | Flexible Content | |
| ├ Layout: `compatibility_alert` | enabled, title, description | |
| ├ Layout: `customers_also_ordered` | enabled, title, max_products, product_source | |
| ├ Layout: `product_showcase` | enabled, title, layout, product_source, max_products | |
| ├ Layout: `related_products` | enabled, title, title_highlight, max_products | |
| ├ Layout: `product_faq` | enabled, title, items repeater (question + answer) | |
| ├ Layout: `price_cta` | enabled, title, description, button_text, bg_color | |
| ├ Layout: `promo_banner` | (same as sidebar) | |
| └ Layout: `trust_badges` | (same as sidebar) | |

### 3h. GLOBAL: Cart Page Config
*Replaces Payload `cart-page-config` global*

| ACF Field | Type | Default |
|-----------|------|---------|
| **labels** | Group | |
| ├ `heading` | Text | Winkelwagen |
| ├ `empty_cart_title` | Text | |
| ├ `empty_cart_message` | Text | |
| ├ `empty_cart_button_text` | Text | |
| ├ `empty_cart_button_link` | URL | |
| ├ `checkout_button_text` | Text | Naar Afrekenen |
| └ `continue_shopping_text` | Text | Verder Winkelen |
| **trust_badges** | Repeater (max 4): icon + title + description | |
| **promo_banner** | Group: enabled, text, link, bg_color, text_color | |
| **cross_sell** | Group | |
| ├ `enabled` | True/False | false |
| ├ `title` | Text | Klanten kochten ook |
| ├ `product_source` | Select (tecdoc/woocommerce) | |
| ├ `wc_product_ids` | Text | |
| └ `max_products` | Number | 4 |
| `payment_logos` | True/False | true |

### 3i. CPT: Pages (ACF on built-in pages)
*Replaces Payload `pages` collection*

| ACF Field | Type |
|-----------|------|
| `meta_title` | Text |
| `meta_description` | Textarea |
| **hero_section** | Group: heading + subheading |
| **content** | Flexible Content with 12 layouts: |
| ├ `rich_text` | heading + wysiwyg content |
| ├ `feature_grid` | heading + features repeater (title + description) |
| ├ `list_block` | heading + introduction + items repeater |
| ├ `section` | section_title + content (wysiwyg) + subsections repeater |
| ├ `cta` | heading + description + button_text + button_link + variant |
| ├ `contact_info` | show_company_info (true/false) |
| ├ `cs_categories` | categories repeater (id + title + icon + links) |
| ├ `quick_actions` | actions repeater (label + query) |
| ├ `trust_badges` | badges repeater (icon + bold_text + text) |
| ├ `contact_methods` | title + methods repeater (icon + title + description + link + hours) |
| ├ `notice` | icon + message + variant |
| └ `chatbot` | enabled + title + subtitle + welcome_message + placeholder |
| `show_sidebar` | True/False |
| **sidebar** | Flexible Content (if show_sidebar): |
| ├ `sidebar_contact` | title + address + phone + email + hours |
| ├ `sidebar_cta` | title + description + button_text + button_link + variant |
| └ `sidebar_rich_text` | title + wysiwyg content |
| `status` | Select (draft/published) |
| `locale` | Select (nl/fr/en/de) |

### 3j. CPT: OEMline Menus
*Replaces Payload `menus` collection*

| ACF Field | Type |
|-----------|------|
| `location` | Select (header-main, header-secondary, footer-col-1..6, klantenservice-sidebar, etc.) |
| **items** | Repeater | |
| ├ `label` | Text |
| ├ `url` | URL |
| ├ `icon` | Select (13 icons) |
| ├ `open_in_new_tab` | True/False |
| └ **children** | Repeater: label + url + icon + open_in_new_tab |
| `column_title` | Text | (footer menus only) |
| `mobile_accordion` | True/False | true |
| `menu_status` | Select (active/draft) |

### 3k. CPT: Featured Products
*Replaces Payload `featured-products` collection*

| ACF Field | Type |
|-----------|------|
| `article_number` | Text (required) |
| `brand` | Text |
| `data_supplier_id` | Number |
| `display_location` | Checkbox (homepage_top_rated, homepage_bestsellers, homepage_offers, homepage_new, category_featured, search_promoted) |
| `custom_price` | Number |
| `custom_image` | Image |
| `badge` | Select (none/sale/new/hot/bestseller) |
| `display_order` | Number |
| `is_active` | True/False |
| **cached_data** | Group (read-only display): tecdoc_title, tecdoc_brand, category_name, image_url, price, last_synced |

### 3l. CPT: Featured Categories
*Replaces Payload `featured-categories` collection*

| ACF Field | Type |
|-----------|------|
| `tecdoc_category_id` | Number (required) |
| `description` | Textarea |
| `category_image` | Image |
| `icon` | Text (Lucide icon name) |
| `display_order` | Number |
| `is_active` | True/False |
| `show_on_homepage` | True/False |
| `show_in_nav` | True/False |

### 3m. CPT: Price Requests
*Replaces Payload `price-requests` collection*

| ACF Field | Type |
|-----------|------|
| **Tab: Klantgegevens** | |
| ├ `customer_name` | Text |
| ├ `customer_email` | Email (required) |
| ├ `customer_phone` | Text (required) |
| └ `customer_license_plate` | Text (required) |
| **Tab: Product Details** | |
| ├ `article_number` | Text (required) |
| ├ `product_name` | Text |
| ├ `manufacturer` | Text |
| └ `quantity` | Number (default: 1) |
| **Tab: Extra** | |
| ├ `notes` | Textarea |
| ├ `source_url` | URL |
| └ `internal_notes` | Textarea |
| `request_status` | Select (pending/processing/quoted/completed/cancelled) |

### 3n. CPT: Product Description Overrides
*Replaces Payload `product-description-overrides` collection*

| ACF Field | Type |
|-----------|------|
| `tecdoc_article_number` | Text (required) |
| `tecdoc_brand` | Text |
| `main_image` | Image |
| **gallery_images** | Gallery |
| `custom_price` | Number |
| `custom_description` | WYSIWYG |
| `specifications` | WYSIWYG |
| `applicability` | WYSIWYG |
| `original_numbers` | WYSIWYG |
| `manufacturer_info` | WYSIWYG |
| `delivery_time` | Text |
| `extra_info` | WYSIWYG |

### 3o. CPT: Product Extensions (replaces MedusaProductExtensions)
*Now links to WooCommerce products instead of Medusa*

| ACF Field | Type |
|-----------|------|
| `wc_product_id` | Number (WooCommerce product ID) |
| **tecdoc** | Group |
| ├ `category_id` | Text |
| ├ `category_name` | Text |
| ├ `generic_article_id` | Number |
| └ **oem_numbers** | Repeater: number + manufacturer |
| **vehicle** | Group |
| ├ **license_plates** | Repeater |
| │ ├ `plate` | Text |
| │ └ **vehicle_info** | Group: make, model, year, engine, fuel_type, body_type |
| └ **manual_vehicles** | Repeater: make, model, year_from, year_to, engine, variant |
| **specifications** | Group |
| ├ **attributes** | Repeater: name + value + unit |
| ├ `weight` | Number (gram) |
| └ **dimensions** | Group: length + width + height (mm) |
| **product_tabs** | Group |
| ├ **custom_specifications** | Repeater: name + value + unit |
| ├ `compatibility_notes` | Textarea |
| ├ `delivery_info` | Textarea |
| └ `custom_tab_content` | WYSIWYG |
| **seo** | Group: meta_title + meta_description + keywords repeater |

### 3p. WooCommerce Product Custom Fields
*ACF fields on WooCommerce products for auto-parts data*

| ACF Field | Type |
|-----------|------|
| `article_number` | Text |
| `ean` | Text |
| `tecdoc_id` | Text |
| **oem_numbers** | Repeater: number |
| `ic_code` | Text (InterCars TOW_KOD) |
| `vehicle_applicability` | Textarea |
| **tech_specifications** | Repeater: key + value + unit |
| **documents** | Repeater: file (File) + label |

---

## Step 4: WooCommerce Configuration

- Store base: NL, selling to EU + worldwide
- Currency: EUR
- Mollie payment gateway: iDEAL + Credit Card
- Enable guest checkout
- Tax enabled (see Step 5)
- CoCart plugin for headless cart/checkout REST API
- WooCommerce REST API keys for storefront

---

## Step 5: Multi-Country Tax Configuration

| Country | Rate | Name |
|---------|------|------|
| NL | 21% | BTW |
| DE | 19% | MwSt |
| BE | 21% | TVA |
| FR | 20% | TVA |
| AT | 20% | USt |
| IT | 22% | IVA |
| ES | 21% | IVA |
| PL | 23% | VAT |
| CZ | 21% | DPH |
| PT | 23% | IVA |
| SE | 25% | Moms |
| DK | 25% | Moms |
| FI | 25.5% | ALV |
| IE | 23% | VAT |
| LU | 17% | TVA |
| HU | 27% | AFA |
| RO | 19% | TVA |
| BG | 20% | DDS |
| HR | 25% | PDV |
| SK | 20% | DPH |
| SI | 22% | DDV |
| LT | 21% | PVM |
| LV | 21% | PVN |
| EE | 22% | km |
| EL/GR | 24% | FPA |
| CY | 19% | VAT |
| MT | 18% | VAT |

- Zero rate class for B2B intra-EU reverse charge
- Tax based on customer shipping address
- Prices entered excluding tax
- Bulk import via `wordpress/tax-rates.csv`

---

## Step 6: Deploy to Coolify

1. Create MariaDB service (mariadb:11, internal network, persistent volume)
2. Deploy WordPress from `wordpress/Dockerfile`
3. Set environment variables (DB, URLs, JWT secret, Mollie key)
4. Public URL: `https://wp.oemline.eu`
5. Activate theme + all plugins
6. Import tax rates CSV
7. Create pages: Home, About, Contact, Shop, Cart, Checkout, My Account, Klantenservice, Privacy, Terms

---

## Files to Create

| File | Purpose |
|------|---------|
| `wordpress/Dockerfile` | Custom WP image with all plugins |
| `wordpress/docker-compose.yml` | Local dev stack |
| `wordpress/php.ini` | PHP configuration |
| `wordpress/.env.example` | Environment template |
| `wordpress/tax-rates.csv` | EU VAT rates |
| `wordpress/theme/oemline-headless/style.css` | Theme header |
| `wordpress/theme/oemline-headless/functions.php` | Register CPTs, ACF fields, REST endpoints, CORS |
| `wordpress/theme/oemline-headless/index.php` | Blank (headless) |
| `wordpress/theme/oemline-headless/acf-json/` | ACF field group exports (version control) |

---

## Verification

1. WordPress admin at `https://wp.oemline.eu/wp-admin`
2. WooCommerce + Mollie activated and configured
3. ACF PRO activated with all field groups
4. All 8 options pages visible under OEMline menu
5. All 6 CPTs registered and editable
6. Homepage flexible content works (add/remove/reorder modules)
7. REST API returns all ACF data: `GET /wp-json/wp/v2/pages?slug=home&_fields=acf`
8. Global options accessible: `GET /wp-json/acf/v3/options/site-settings`
9. WooCommerce products have auto-parts ACF fields
10. Tax rates for 27 EU countries configured
11. CORS allows storefront domain
12. CoCart headless cart API works
