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

# Call the original WordPress entrypoint
exec docker-entrypoint.sh "$@"
