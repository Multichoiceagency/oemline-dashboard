FROM wordpress:6.7-apache

# Install WP-CLI
RUN curl -O https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar \
    && chmod +x wp-cli.phar \
    && mv wp-cli.phar /usr/local/bin/wp

# Install required PHP extensions
RUN docker-php-ext-install opcache

# Copy custom php.ini
COPY php.ini /usr/local/etc/php/conf.d/custom.ini

# Copy custom theme
COPY theme/oemline-headless /var/www/html/wp-content/themes/oemline-headless

# Install plugins via WP-CLI at build time (download only, activation happens at runtime)
RUN mkdir -p /var/www/html/wp-content/plugins && \
    wp plugin install woocommerce --allow-root --path=/var/www/html 2>/dev/null || true && \
    wp plugin install mollie-payments-for-woocommerce --allow-root --path=/var/www/html 2>/dev/null || true && \
    wp plugin install acf-to-rest-api --allow-root --path=/var/www/html 2>/dev/null || true && \
    wp plugin install jwt-authentication-for-wp-rest-api --allow-root --path=/var/www/html 2>/dev/null || true && \
    wp plugin install cart-rest-api-for-woocommerce --allow-root --path=/var/www/html 2>/dev/null || true && \
    wp plugin install wp-rest-cache --allow-root --path=/var/www/html 2>/dev/null || true && \
    wp plugin install custom-post-type-ui --allow-root --path=/var/www/html 2>/dev/null || true

# ACF PRO must be installed manually (licensed plugin) — see README
# Download from https://www.advancedcustomfields.com/my-account/

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
