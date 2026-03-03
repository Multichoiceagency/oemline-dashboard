FROM wordpress:6.9-apache

# Install WP-CLI + unzip + performance tools
RUN apt-get update && apt-get install -y unzip libzip-dev && rm -rf /var/lib/apt/lists/* && \
    curl -O https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar && \
    chmod +x wp-cli.phar && mv wp-cli.phar /usr/local/bin/wp

# Install required PHP extensions for performance
RUN docker-php-ext-install opcache zip

# === Apache Performance Tuning ===
RUN a2enmod headers expires deflate rewrite

# Apache timeout and keepalive config
RUN echo '\
Timeout 600\n\
ProxyTimeout 600\n\
KeepAlive On\n\
MaxKeepAliveRequests 500\n\
KeepAliveTimeout 15\n\
\n\
<IfModule mpm_prefork_module>\n\
    StartServers          5\n\
    MinSpareServers       5\n\
    MaxSpareServers      20\n\
    MaxRequestWorkers   150\n\
    MaxConnectionsPerChild 5000\n\
</IfModule>\n\
' > /etc/apache2/conf-available/oemline-performance.conf && \
    a2enconf oemline-performance

# Enable compression for API responses
RUN echo '\
<IfModule mod_deflate.c>\n\
    AddOutputFilterByType DEFLATE application/json\n\
    AddOutputFilterByType DEFLATE application/javascript\n\
    AddOutputFilterByType DEFLATE text/css\n\
    AddOutputFilterByType DEFLATE text/html\n\
    AddOutputFilterByType DEFLATE text/xml\n\
    AddOutputFilterByType DEFLATE application/xml\n\
    DeflateCompressionLevel 6\n\
</IfModule>\n\
\n\
<IfModule mod_expires.c>\n\
    ExpiresActive On\n\
    ExpiresByType application/json "access plus 5 minutes"\n\
    ExpiresByType image/jpeg "access plus 1 year"\n\
    ExpiresByType image/png "access plus 1 year"\n\
    ExpiresByType image/svg+xml "access plus 1 year"\n\
    ExpiresByType text/css "access plus 1 month"\n\
    ExpiresByType application/javascript "access plus 1 month"\n\
</IfModule>\n\
' > /etc/apache2/conf-available/oemline-compression.conf && \
    a2enconf oemline-compression

# Copy custom php.ini (includes OPcache JIT, memory, timeouts)
COPY php.ini /usr/local/etc/php/conf.d/custom.ini

# Copy custom theme — staged to /opt/oemline so the entrypoint syncs into the persistent volume
COPY theme/oemline-headless /opt/oemline/theme/oemline-headless
# Also copy directly for first-run (before volume is mounted)
COPY theme/oemline-headless /var/www/html/wp-content/themes/oemline-headless

# Install ACF PRO from local zip (licensed plugin)
COPY advanced-custom-fields-pro-6.7.0.2.zip /tmp/acf-pro.zip
RUN mkdir -p /var/www/html/wp-content/plugins /opt/oemline/plugins && \
    unzip -qo /tmp/acf-pro.zip -d /var/www/html/wp-content/plugins/ && \
    cp -r /var/www/html/wp-content/plugins/advanced-custom-fields-pro /opt/oemline/plugins/ && \
    rm -f /tmp/acf-pro.zip

# Download other plugins as zip files (WP-CLI install needs DB, so we download manually)
RUN cd /tmp && \
    curl -sL "https://downloads.wordpress.org/plugin/woocommerce.latest-stable.zip" -o woocommerce.zip && unzip -qo woocommerce.zip -d /var/www/html/wp-content/plugins/ && \
    curl -sL "https://downloads.wordpress.org/plugin/mollie-payments-for-woocommerce.latest-stable.zip" -o mollie.zip && unzip -qo mollie.zip -d /var/www/html/wp-content/plugins/ && \
    curl -sL "https://downloads.wordpress.org/plugin/acf-to-rest-api.latest-stable.zip" -o acf-rest.zip && unzip -qo acf-rest.zip -d /var/www/html/wp-content/plugins/ && \
    curl -sL "https://downloads.wordpress.org/plugin/jwt-authentication-for-wp-rest-api.latest-stable.zip" -o jwt.zip && unzip -qo jwt.zip -d /var/www/html/wp-content/plugins/ && \
    curl -sL "https://downloads.wordpress.org/plugin/cart-rest-api-for-woocommerce.latest-stable.zip" -o cocart.zip && unzip -qo cocart.zip -d /var/www/html/wp-content/plugins/ && \
    curl -sL "https://downloads.wordpress.org/plugin/wp-rest-cache.latest-stable.zip" -o rest-cache.zip && unzip -qo rest-cache.zip -d /var/www/html/wp-content/plugins/ && \
    curl -sL "https://downloads.wordpress.org/plugin/custom-post-type-ui.latest-stable.zip" -o cptui.zip && unzip -qo cptui.zip -d /var/www/html/wp-content/plugins/ && \
    rm -f /tmp/*.zip

# Copy must-use plugins — staged to /opt/oemline so the entrypoint syncs into the persistent volume
COPY mu-plugins/ /opt/oemline/mu-plugins/
# Also copy directly for first-run (before volume is mounted)
COPY mu-plugins/ /var/www/html/wp-content/mu-plugins/

# Copy tax rates CSV for WooCommerce import
COPY tax-rates.csv /var/www/html/wp-content/tax-rates.csv

# Copy custom entrypoint (handles SSL/proxy config)
COPY docker-entrypoint-custom.sh /usr/local/bin/docker-entrypoint-custom.sh
RUN chmod +x /usr/local/bin/docker-entrypoint-custom.sh

# Set permissions
RUN chown -R www-data:www-data /var/www/html/wp-content

EXPOSE 80

ENTRYPOINT ["docker-entrypoint-custom.sh"]
CMD ["apache2-foreground"]
