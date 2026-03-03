#!/bin/bash
set -e

# Inject custom wp-config lines for headless/proxy setup
# This runs BEFORE the default WordPress entrypoint
export WORDPRESS_CONFIG_EXTRA="
define('WP_HOME', 'https://wp.oemline.eu');
define('WP_SITEURL', 'https://wp.oemline.eu');
define('FORCE_SSL_ADMIN', true);
if (isset(\$_SERVER['HTTP_X_FORWARDED_PROTO']) && \$_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https') {
    \$_SERVER['HTTPS'] = 'on';
}
define('WP_MEMORY_LIMIT', '512M');
define('WP_MAX_MEMORY_LIMIT', '512M');
define('JWT_AUTH_SECRET_KEY', '${JWT_AUTH_SECRET_KEY:-oemline-jwt-secret-2026-secure}');
define('JWT_AUTH_CORS_ENABLE', true);
"

# Copy theme + mu-plugins from build into persistent volume on every startup.
# This ensures code updates are applied even when the volume persists.
echo "[OEMline] Syncing theme and mu-plugins into persistent volume..."

# Copy our theme (overwrite existing files but keep any user-added files)
if [ -d /opt/oemline/theme/oemline-headless ]; then
    mkdir -p /var/www/html/wp-content/themes/oemline-headless
    cp -r /opt/oemline/theme/oemline-headless/. /var/www/html/wp-content/themes/oemline-headless/
    echo "[OEMline] Theme synced"
fi

# Copy mu-plugins
if [ -d /opt/oemline/mu-plugins ]; then
    mkdir -p /var/www/html/wp-content/mu-plugins
    cp -r /opt/oemline/mu-plugins/. /var/www/html/wp-content/mu-plugins/
    echo "[OEMline] MU-plugins synced"
fi

# Ensure ACF plugin exists in the persistent volume
if [ -d /opt/oemline/plugins/advanced-custom-fields ] && [ ! -d /var/www/html/wp-content/plugins/advanced-custom-fields ]; then
    mkdir -p /var/www/html/wp-content/plugins
    cp -r /opt/oemline/plugins/advanced-custom-fields /var/www/html/wp-content/plugins/
    echo "[OEMline] ACF plugin installed"
fi

# Fix ownership
chown -R www-data:www-data /var/www/html/wp-content/themes/oemline-headless 2>/dev/null || true
chown -R www-data:www-data /var/www/html/wp-content/mu-plugins 2>/dev/null || true
chown -R www-data:www-data /var/www/html/wp-content/plugins/advanced-custom-fields 2>/dev/null || true

echo "[OEMline] Sync complete"

# Call the original WordPress entrypoint
exec docker-entrypoint.sh "$@"
