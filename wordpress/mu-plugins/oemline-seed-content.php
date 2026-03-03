<?php
/**
 * OEMline Content Seeder
 *
 * Seeds WordPress with default content for klantenservice, homepage, header, footer,
 * and static pages. Only runs once (sets an option flag after completion).
 *
 * Triggered by visiting: /wp-admin/admin.php?page=oemline-seed
 * Or automatically on first admin load if ACF PRO is installed and content hasn't been seeded yet.
 */

// Auto-seed on first admin load if ACF is available and not yet seeded.
// Uses acf/init (priority 20) to ensure ACF options pages are registered first.
add_action('acf/init', function () {
    if (!is_admin()) return;
    if (!function_exists('update_field')) return;
    // Run seed if never seeded, or re-run if version changed (to fix incomplete seeds)
    $seed_version = '3'; // Bump this to force re-seed (v3: re-seed with ACF PRO for proper repeater storage)
    $current_version = get_option('oemline_seed_version', '0');
    if (get_option('oemline_content_seeded') && $current_version === $seed_version) return;
    oemline_run_seed();
    update_option('oemline_seed_version', $seed_version);
}, 20);

// REST API endpoint to trigger seed remotely
add_action('rest_api_init', function () {
    register_rest_route('oemline/v1', '/seed', [
        'methods'  => 'POST',
        'callback' => function () {
            if (!function_exists('update_field')) {
                return new WP_REST_Response(['error' => 'ACF PRO not active'], 500);
            }
            $result = oemline_run_seed();
            return new WP_REST_Response([
                'success' => $result,
                'seeded_at' => get_option('oemline_content_seeded', null),
            ]);
        },
        'permission_callback' => function () {
            return current_user_can('manage_options');
        },
    ]);

    // GET endpoint to check seed status (no auth required)
    register_rest_route('oemline/v1', '/seed/status', [
        'methods'  => 'GET',
        'callback' => function () {
            return new WP_REST_Response([
                'seeded' => (bool) get_option('oemline_content_seeded'),
                'seeded_at' => get_option('oemline_content_seeded', null),
                'acf_active' => function_exists('update_field'),
            ]);
        },
        'permission_callback' => '__return_true',
    ]);
});

// Add admin menu item for manual seeding
add_action('admin_menu', function () {
    add_submenu_page(
        'oemline-settings',
        'Content Seeder',
        'Seed Content',
        'manage_options',
        'oemline-seed',
        'oemline_seed_page'
    );
});

function oemline_seed_page() {
    if (!current_user_can('manage_options')) return;

    $seeded = get_option('oemline_content_seeded', false);
    $message = '';

    if (isset($_POST['oemline_seed_now']) && wp_verify_nonce($_POST['_wpnonce'], 'oemline_seed')) {
        $result = oemline_run_seed();
        $message = $result ? '<div class="notice notice-success"><p>Content succesvol geïmporteerd!</p></div>' :
                             '<div class="notice notice-error"><p>Er is een fout opgetreden. Controleer of ACF PRO actief is.</p></div>';
        $seeded = get_option('oemline_content_seeded', false);
    }

    ?>
    <div class="wrap">
        <h1>OEMline Content Seeder</h1>
        <?php echo $message; ?>
        <div class="card" style="max-width:600px;padding:20px;">
            <?php if ($seeded): ?>
                <p><strong>Status:</strong> <span style="color:green;">Content is al geïmporteerd op <?php echo esc_html($seeded); ?></span></p>
                <form method="post">
                    <?php wp_nonce_field('oemline_seed'); ?>
                    <input type="hidden" name="oemline_seed_now" value="1" />
                    <p><button type="submit" class="button" onclick="return confirm('Weet u zeker dat u de content opnieuw wilt importeren? Dit overschrijft bestaande data.');">Opnieuw importeren</button></p>
                </form>
            <?php else: ?>
                <p>Dit importeert alle standaard content (klantenservice, homepage, header, footer, pagina's) naar WordPress.</p>
                <p><strong>Vereist:</strong> ACF PRO moet geïnstalleerd en actief zijn.</p>
                <form method="post">
                    <?php wp_nonce_field('oemline_seed'); ?>
                    <input type="hidden" name="oemline_seed_now" value="1" />
                    <p><button type="submit" class="button button-primary">Content Importeren</button></p>
                </form>
            <?php endif; ?>
        </div>
    </div>
    <?php
}

function oemline_run_seed(): bool {
    if (!function_exists('update_field')) {
        error_log('[OEMline Seed] ACF not available');
        return false;
    }

    try {
        oemline_seed_site_settings();
        oemline_seed_header();
        oemline_seed_footer();
        oemline_seed_klantenservice();
        oemline_seed_homepage();
        oemline_seed_pages();
        oemline_seed_menus();

        update_option('oemline_content_seeded', date('Y-m-d H:i:s'));
        return true;
    } catch (Exception $e) {
        error_log('[OEMline Seed] Error: ' . $e->getMessage());
        return false;
    }
}

// ─── SITE SETTINGS ───
function oemline_seed_site_settings() {
    update_field('company_name', 'OEMline', 'option');
    update_field('legal_name', 'OEMline B.V.', 'option');
    update_field('contact', [
        'street'       => '',
        'postal_code'  => '',
        'city'         => 'Nederland',
        'country'      => 'NL',
        'phone'        => '+31 (0) 85 060 3',
        'email'        => 'info@oemline.eu',
        'privacy_email'=> 'privacy@oemline.eu',
    ], 'option');
    update_field('social_media', [
        'facebook'  => '',
        'instagram' => '',
        'linkedin'  => '',
        'twitter'   => '',
    ], 'option');
}

// ─── HEADER ───
function oemline_seed_header() {
    update_field('announcement_bar', [
        'enabled'          => true,
        'text'             => 'Gratis verzending vanaf €50 | Levertijd 1-3 werkdagen',
        'link'             => '/store',
        'background_color' => '#1a1a2e',
        'text_color'       => '#ffffff',
    ], 'option');

    update_field('top_bar', [
        'phone'   => '+31 (0) 85 060 3',
        'tagline' => 'De specialist in auto-onderdelen',
        'links'   => [
            ['label' => 'Klantenservice', 'url' => '/klantenservice'],
            ['label' => 'Contact', 'url' => '/contact'],
            ['label' => 'Track & Trace', 'url' => '/track-trace'],
        ],
    ], 'option');

    update_field('main_nav', [
        'links' => [
            ['label' => 'Alle onderdelen', 'url' => '/store', 'highlight' => false],
            ['label' => 'Merken', 'url' => '/brands', 'highlight' => false],
            ['label' => 'Categorieën', 'url' => '/categories', 'highlight' => false],
            ['label' => 'Aanbiedingen', 'url' => '/store?hasPrice=true', 'highlight' => true],
        ],
    ], 'option');

    update_field('shipping_badge', [
        'enabled'   => true,
        'text'      => 'Gratis verzending vanaf €50',
        'threshold' => 50,
    ], 'option');
}

// ─── FOOTER ───
function oemline_seed_footer() {
    update_field('newsletter', [
        'enabled'     => true,
        'title'       => 'Blijf op de hoogte',
        'description' => 'Ontvang exclusieve aanbiedingen en het laatste nieuws.',
        'button_text' => 'Aanmelden',
    ], 'option');

    update_field('trust_badges', [
        ['icon' => 'truck', 'text' => 'Gratis verzending vanaf €50'],
        ['icon' => 'shield', 'text' => '2 jaar garantie'],
        ['icon' => 'return', 'text' => '30 dagen retour'],
        ['icon' => 'lock', 'text' => 'Veilig betalen'],
    ], 'option');

    update_field('footer_social', [
        'facebook'  => '',
        'twitter'   => '',
        'youtube'   => '',
        'instagram' => '',
    ], 'option');
}

// ─── KLANTENSERVICE ───
function oemline_seed_klantenservice() {
    $categories = [
        [
            'title'       => 'Bestellen & Betalen',
            'slug'        => 'bestellen-betalen',
            'icon'        => 'shopping-cart',
            'description' => 'Alles over bestellingen plaatsen en betaalmethoden.',
            'content'     => '<h3>Hoe bestel ik?</h3><p>Zoek het gewenste onderdeel via de zoekbalk of categorieën. Voeg het toe aan uw winkelwagen en volg het bestelproces.</p><h3>Betaalmethoden</h3><p>Wij accepteren iDEAL, creditcard, PayPal, Klarna en bankoverschrijving.</p>',
            'faq' => [
                ['question' => 'Welke betaalmethoden accepteren jullie?', 'answer' => 'Wij accepteren iDEAL, creditcard (Visa/Mastercard), PayPal, Klarna (achteraf betalen) en bankoverschrijving.'],
                ['question' => 'Kan ik achteraf betalen?', 'answer' => 'Ja, via Klarna kunt u achteraf betalen. U heeft dan 14 dagen de tijd om te betalen.'],
                ['question' => 'Is betalen bij jullie veilig?', 'answer' => 'Ja, alle betalingen worden verwerkt via beveiligde verbindingen (SSL) en PCI-gecertificeerde betalingsproviders.'],
            ],
        ],
        [
            'title'       => 'Verzending & Levering',
            'slug'        => 'verzending-levering',
            'icon'        => 'truck',
            'description' => 'Informatie over verzendkosten en levertijden.',
            'content'     => '<h3>Levertijden</h3><p>De meeste bestellingen worden binnen 1-3 werkdagen geleverd.</p><h3>Verzendkosten</h3><p>Gratis verzending vanaf €50. Onder €50 betaalt u €4,95 verzendkosten.</p>',
            'faq' => [
                ['question' => 'Hoe lang duurt de levering?', 'answer' => 'De meeste bestellingen worden binnen 1-3 werkdagen geleverd. Bij speciale bestellingen kan dit langer duren.'],
                ['question' => 'Zijn er verzendkosten?', 'answer' => 'Gratis verzending bij bestellingen vanaf €50. Onder €50 betaalt u €4,95 verzendkosten.'],
                ['question' => 'Kan ik mijn bestelling volgen?', 'answer' => 'Ja, u ontvangt een track & trace code per e-mail zodra uw bestelling is verzonden.'],
            ],
        ],
        [
            'title'       => 'Retourneren & Garantie',
            'slug'        => 'retourneren-garantie',
            'icon'        => 'refresh-cw',
            'description' => 'Hoe retourneer ik een product en wat is de garantie?',
            'content'     => '<h3>Retourneren</h3><p>U heeft 30 dagen bedenktijd. Het product moet ongebruikt en in originele verpakking zijn.</p><h3>Garantie</h3><p>Op alle onderdelen zit minimaal 2 jaar garantie.</p>',
            'faq' => [
                ['question' => 'Hoe retourneer ik een product?', 'answer' => 'Neem contact op met onze klantenservice voor een retourlabel. Stuur het product ongebruikt en in originele verpakking terug.'],
                ['question' => 'Hoelang heb ik retourrecht?', 'answer' => 'U heeft 30 dagen bedenktijd na ontvangst van uw bestelling.'],
                ['question' => 'Hoe lang is de garantie?', 'answer' => 'Op alle onderdelen zit minimaal 2 jaar garantie.'],
            ],
        ],
        [
            'title'       => 'Mijn Account',
            'slug'        => 'mijn-account',
            'icon'        => 'user',
            'description' => 'Beheer uw account, bestellingen en persoonlijke gegevens.',
            'content'     => '<h3>Account aanmaken</h3><p>Maak een account aan om uw bestellingen te volgen en sneller te bestellen.</p>',
            'faq' => [
                ['question' => 'Hoe maak ik een account aan?', 'answer' => 'Klik op "Account" in het menu en kies "Registreren". Vul uw gegevens in en u kunt direct bestellen.'],
                ['question' => 'Ik ben mijn wachtwoord vergeten', 'answer' => 'Klik op "Wachtwoord vergeten" op de inlogpagina. U ontvangt een e-mail om uw wachtwoord opnieuw in te stellen.'],
            ],
        ],
        [
            'title'       => 'Producten & Compatibiliteit',
            'slug'        => 'producten-compatibiliteit',
            'icon'        => 'settings',
            'description' => 'Hoe weet ik of een onderdeel past op mijn auto?',
            'content'     => '<h3>Compatibiliteit</h3><p>Alle onderdelen zijn gekoppeld aan specifieke voertuigen via TecDoc-data. Selecteer uw voertuig om alleen passende onderdelen te zien.</p>',
            'faq' => [
                ['question' => 'Hoe weet ik of een onderdeel past op mijn auto?', 'answer' => 'Voer uw kenteken in of selecteer uw auto handmatig. Wij tonen dan alleen onderdelen die gegarandeerd passen.'],
                ['question' => 'Wat is het verschil tussen OE en aftermarket onderdelen?', 'answer' => 'OE (Original Equipment) onderdelen zijn gemaakt door de originele fabrikant. Aftermarket onderdelen zijn van andere kwaliteitsfabrikanten en bieden vaak een betere prijs-kwaliteitverhouding.'],
            ],
        ],
        [
            'title'       => 'Technische Ondersteuning',
            'slug'        => 'technische-ondersteuning',
            'icon'        => 'tool',
            'description' => 'Hulp bij technische vragen over onderdelen.',
            'content'     => '<h3>Technische vragen</h3><p>Heeft u een technische vraag? Neem contact op met onze specialisten.</p>',
            'faq' => [
                ['question' => 'Bieden jullie technisch advies?', 'answer' => 'Ja, onze productspecialisten staan klaar om u te helpen met technische vragen over onderdelen en compatibiliteit.'],
            ],
        ],
        [
            'title'       => 'Prijzen & Aanbiedingen',
            'slug'        => 'prijzen-aanbiedingen',
            'icon'        => 'tag',
            'description' => 'Informatie over prijzen, kortingen en aanbiedingen.',
            'content'     => '<h3>Prijzen</h3><p>Alle prijzen zijn inclusief BTW. Wij bieden scherpe prijzen op alle onderdelen.</p>',
            'faq' => [
                ['question' => 'Zijn de prijzen inclusief BTW?', 'answer' => 'Ja, alle prijzen op onze website zijn inclusief 21% BTW.'],
                ['question' => 'Bieden jullie volumekorting?', 'answer' => 'Ja, neem contact met ons op voor grote bestellingen. Wij maken graag een offerte op maat.'],
            ],
        ],
        [
            'title'       => 'Zakelijk Bestellen',
            'slug'        => 'zakelijk-bestellen',
            'icon'        => 'briefcase',
            'description' => 'Informatie voor zakelijke klanten en garages.',
            'content'     => '<h3>Zakelijk account</h3><p>Als zakelijke klant profiteert u van speciale kortingen en snelle levering.</p>',
            'faq' => [
                ['question' => 'Kan ik zakelijk bestellen?', 'answer' => 'Ja, neem contact op met onze sales afdeling voor een zakelijk account met speciale voorwaarden.'],
            ],
        ],
        [
            'title'       => 'Contact',
            'slug'        => 'contact',
            'icon'        => 'phone',
            'description' => 'Neem contact met ons op.',
            'content'     => '<h3>Contact</h3><p>E-mail: info@oemline.eu</p><p>Telefoon: +31 (0) 85 060 3</p><p>Openingstijden: Ma-Vr 9:00-17:00</p>',
            'faq' => [],
        ],
    ];

    update_field('sidebar_title', 'Klantenservice', 'option');
    update_field('categories', $categories, 'option');
    update_field('contact_title', 'Hulp nodig?', 'option');
    update_field('contact_methods', [
        ['type' => 'email', 'label' => 'E-mail', 'value' => 'info@oemline.eu', 'icon' => 'mail'],
        ['type' => 'phone', 'label' => 'Telefoon', 'value' => '+31 (0) 85 060 3', 'icon' => 'phone'],
    ], 'option');
    update_field('chatbot', [
        'title'           => 'OEMline Assistent',
        'welcome_message' => 'Hallo! Ik ben de OEMline assistent. Hoe kan ik u helpen?',
        'system_prompt'   => 'Je bent een behulpzame klantenservice medewerker van OEMline, een Nederlandse webshop voor auto-onderdelen.',
        'temperature'     => 0.7,
        'max_tokens'      => 500,
    ], 'option');
    update_field('ks_trust_badges', [
        ['icon' => 'truck', 'text' => 'Gratis verzending vanaf €50'],
        ['icon' => 'shield', 'text' => '2 jaar garantie'],
        ['icon' => 'return', 'text' => '30 dagen retour'],
        ['icon' => 'lock', 'text' => 'Veilig betalen'],
    ], 'option');
}

// ─── HOMEPAGE ───
function oemline_seed_homepage() {
    $sections = [
        [
            'acf_fc_layout' => 'hero',
            'title'         => 'Auto-onderdelen voor elke auto',
            'subtitle'      => 'Meer dan 1 miljoen onderdelen. Scherpe prijzen. Snel geleverd.',
            'show_vehicle_search' => true,
        ],
        [
            'acf_fc_layout' => 'features',
            'items' => [
                ['icon' => 'truck', 'title' => 'Gratis Verzending', 'description' => 'Bij bestellingen vanaf €50'],
                ['icon' => 'shield', 'title' => '2 Jaar Garantie', 'description' => 'Op alle onderdelen'],
                ['icon' => 'return', 'title' => '30 Dagen Retour', 'description' => 'Gratis retourneren'],
                ['icon' => 'lock', 'title' => 'Veilig Betalen', 'description' => 'iDEAL, PayPal & meer'],
            ],
        ],
        [
            'acf_fc_layout' => 'category_grid',
            'source'        => 'dashboard',
            'max_categories' => 8,
        ],
        [
            'acf_fc_layout' => 'brand_carousel',
            'source'        => 'dashboard',
            'max_brands'    => 20,
            'show_view_all' => true,
        ],
        [
            'acf_fc_layout' => 'seo_text',
            'title'   => 'OEMline - Uw specialist in auto-onderdelen',
            'content' => '<p>Bij OEMline vindt u meer dan 1 miljoen auto-onderdelen van alle topmerken. Of u nu op zoek bent naar remschijven, filters, uitlaatdelen of verlichting, wij hebben het in ons assortiment. Alle onderdelen worden geleverd met minimaal 2 jaar garantie.</p>',
        ],
    ];

    update_field('homepage_sections', $sections, 'option');
}

// ─── STATIC PAGES ───
function oemline_seed_pages() {
    $pages_data = [
        [
            'title'   => 'Over Ons',
            'slug'    => 'over-ons',
            'content' => '<h2>Over OEMline</h2><p>OEMline is dé specialist in auto-onderdelen in Nederland. Met meer dan 1 miljoen onderdelen in ons assortiment bieden wij de grootste keuze tegen de scherpste prijzen.</p><h3>Onze missie</h3><p>Wij maken het eenvoudig om het juiste auto-onderdeel te vinden, te bestellen en snel geleverd te krijgen.</p>',
        ],
        [
            'title'   => 'Privacy Policy',
            'slug'    => 'privacy-policy',
            'content' => '<h2>Privacybeleid</h2><p>OEMline respecteert uw privacy en verwerkt persoonsgegevens in overeenstemming met de AVG (Algemene Verordening Gegevensbescherming).</p><h3>Welke gegevens verzamelen wij?</h3><p>Wij verzamelen alleen gegevens die nodig zijn voor het verwerken van uw bestelling: naam, adres, e-mailadres en telefoonnummer.</p>',
        ],
        [
            'title'   => 'Algemene Voorwaarden',
            'slug'    => 'algemene-voorwaarden',
            'content' => '<h2>Algemene Voorwaarden</h2><p>Deze algemene voorwaarden zijn van toepassing op alle bestellingen bij OEMline.</p>',
        ],
        [
            'title'   => 'Verzendbeleid',
            'slug'    => 'verzendbeleid',
            'content' => '<h2>Verzendbeleid</h2><p>Gratis verzending bij bestellingen vanaf €50. Standaard verzendkosten: €4,95.</p><h3>Levertijden</h3><p>1-3 werkdagen voor onderdelen op voorraad.</p>',
        ],
        [
            'title'   => 'Retourbeleid',
            'slug'    => 'retourbeleid',
            'content' => '<h2>Retourbeleid</h2><p>U heeft 30 dagen bedenktijd na ontvangst van uw bestelling.</p><h3>Voorwaarden</h3><ul><li>Product moet ongebruikt zijn</li><li>Originele verpakking moet intact zijn</li><li>Retourneren is gratis</li></ul>',
        ],
        [
            'title'   => 'Contact',
            'slug'    => 'contact',
            'content' => '<h2>Contact</h2><p>Heeft u vragen? Neem gerust contact met ons op.</p><p><strong>E-mail:</strong> info@oemline.eu</p><p><strong>Telefoon:</strong> +31 (0) 85 060 3</p><p><strong>Openingstijden:</strong> Maandag t/m vrijdag 9:00 - 17:00</p>',
        ],
    ];

    foreach ($pages_data as $page_data) {
        $existing = get_page_by_path($page_data['slug']);
        if (!$existing) {
            wp_insert_post([
                'post_type'    => 'page',
                'post_title'   => $page_data['title'],
                'post_name'    => $page_data['slug'],
                'post_content' => $page_data['content'],
                'post_status'  => 'publish',
            ]);
        }
    }
}

// ─── MENUS ───
function oemline_seed_menus() {
    $menus = [
        [
            'title'    => 'Header Main Menu',
            'location' => 'header-main',
            'items'    => [
                ['label' => 'Alle onderdelen', 'url' => '/store', 'icon' => '', 'new_tab' => false, 'children' => []],
                ['label' => 'Merken', 'url' => '/brands', 'icon' => '', 'new_tab' => false, 'children' => []],
                ['label' => 'Categorieën', 'url' => '/categories', 'icon' => '', 'new_tab' => false, 'children' => []],
                ['label' => 'Aanbiedingen', 'url' => '/store?hasPrice=true', 'icon' => 'tag', 'new_tab' => false, 'children' => []],
            ],
        ],
        [
            'title'    => 'Footer Klantenservice',
            'location' => 'footer-col-1',
            'items'    => [
                ['label' => 'Klantenservice', 'url' => '/klantenservice', 'icon' => '', 'new_tab' => false, 'children' => []],
                ['label' => 'Contact', 'url' => '/contact', 'icon' => '', 'new_tab' => false, 'children' => []],
                ['label' => 'Verzending', 'url' => '/verzendbeleid', 'icon' => '', 'new_tab' => false, 'children' => []],
                ['label' => 'Retourneren', 'url' => '/retourbeleid', 'icon' => '', 'new_tab' => false, 'children' => []],
            ],
        ],
        [
            'title'    => 'Footer Informatie',
            'location' => 'footer-col-2',
            'items'    => [
                ['label' => 'Over Ons', 'url' => '/over-ons', 'icon' => '', 'new_tab' => false, 'children' => []],
                ['label' => 'Privacy Policy', 'url' => '/privacy-policy', 'icon' => '', 'new_tab' => false, 'children' => []],
                ['label' => 'Algemene Voorwaarden', 'url' => '/algemene-voorwaarden', 'icon' => '', 'new_tab' => false, 'children' => []],
            ],
        ],
        [
            'title'    => 'Klantenservice Sidebar',
            'location' => 'klantenservice-sidebar',
            'items'    => [
                ['label' => 'Bestellen & Betalen', 'url' => '/klantenservice/bestellen-betalen', 'icon' => 'shopping-cart', 'new_tab' => false, 'children' => []],
                ['label' => 'Verzending & Levering', 'url' => '/klantenservice/verzending-levering', 'icon' => 'truck', 'new_tab' => false, 'children' => []],
                ['label' => 'Retourneren & Garantie', 'url' => '/klantenservice/retourneren-garantie', 'icon' => 'refresh-cw', 'new_tab' => false, 'children' => []],
                ['label' => 'Mijn Account', 'url' => '/klantenservice/mijn-account', 'icon' => 'user', 'new_tab' => false, 'children' => []],
                ['label' => 'Contact', 'url' => '/klantenservice/contact', 'icon' => 'phone', 'new_tab' => false, 'children' => []],
            ],
        ],
        [
            'title'    => 'Mobile Main Menu',
            'location' => 'mobile-main',
            'items'    => [
                ['label' => 'Alle onderdelen', 'url' => '/store', 'icon' => 'package', 'new_tab' => false, 'children' => []],
                ['label' => 'Merken', 'url' => '/brands', 'icon' => 'award', 'new_tab' => false, 'children' => []],
                ['label' => 'Categorieën', 'url' => '/categories', 'icon' => 'grid', 'new_tab' => false, 'children' => []],
                ['label' => 'Klantenservice', 'url' => '/klantenservice', 'icon' => 'headphones', 'new_tab' => false, 'children' => []],
            ],
        ],
    ];

    foreach ($menus as $menu_data) {
        // Check if menu already exists
        $existing = get_posts([
            'post_type'      => 'oemline-menu',
            'posts_per_page' => 1,
            'meta_query'     => [['key' => 'location', 'value' => $menu_data['location']]],
        ]);

        if (!empty($existing)) {
            // Update existing menu if items are missing
            $post_id = $existing[0]->ID;
            if (function_exists('update_field')) {
                $current_items = get_field('items', $post_id);
                if (empty($current_items)) {
                    update_field('items', $menu_data['items'], $post_id);
                    update_field('menu_status', 'active', $post_id);
                }
            }
            continue;
        }

        $post_id = wp_insert_post([
            'post_type'   => 'oemline-menu',
            'post_title'  => $menu_data['title'],
            'post_status' => 'publish',
        ]);

        if ($post_id && !is_wp_error($post_id)) {
            if (function_exists('update_field')) {
                update_field('location', $menu_data['location'], $post_id);
                update_field('items', $menu_data['items'], $post_id);
                update_field('menu_status', 'active', $post_id);
            } else {
                update_post_meta($post_id, 'location', $menu_data['location']);
            }
        }
    }
}
