<?php
// Headless theme — no frontend rendering.
// All content is served via REST API to the Next.js storefront.
wp_redirect(home_url('/wp-admin'));
exit;
