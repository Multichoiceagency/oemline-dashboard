FROM wordpress:6.9-apache

# Install WP-CLI + unzip
RUN apt-get update && apt-get install -y unzip && rm -rf /var/lib/apt/lists/* && \
    curl -O https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar && \
    chmod +x wp-cli.phar && mv wp-cli.phar /usr/local/bin/wp

# Install required PHP extensions
RUN docker-php-ext-install opcache

# Copy custom php.ini
COPY php.ini /usr/local/etc/php/conf.d/custom.ini

# Copy custom theme
COPY theme/oemline-headless /var/www/html/wp-content/themes/oemline-headless

# Download plugins directly as zip files (WP-CLI install needs DB, so we download manually)
RUN mkdir -p /var/www/html/wp-content/plugins && cd /tmp && \
    curl -sL "https://downloads.wordpress.org/plugin/woocommerce.latest-stable.zip" -o woocommerce.zip && unzip -qo woocommerce.zip -d /var/www/html/wp-content/plugins/ && \
    curl -sL "https://downloads.wordpress.org/plugin/mollie-payments-for-woocommerce.latest-stable.zip" -o mollie.zip && unzip -qo mollie.zip -d /var/www/html/wp-content/plugins/ && \
    curl -sL "https://downloads.wordpress.org/plugin/acf-to-rest-api.latest-stable.zip" -o acf-rest.zip && unzip -qo acf-rest.zip -d /var/www/html/wp-content/plugins/ && \
    curl -sL "https://downloads.wordpress.org/plugin/jwt-authentication-for-wp-rest-api.latest-stable.zip" -o jwt.zip && unzip -qo jwt.zip -d /var/www/html/wp-content/plugins/ && \
    curl -sL "https://downloads.wordpress.org/plugin/cart-rest-api-for-woocommerce.latest-stable.zip" -o cocart.zip && unzip -qo cocart.zip -d /var/www/html/wp-content/plugins/ && \
    curl -sL "https://downloads.wordpress.org/plugin/wp-rest-cache.latest-stable.zip" -o rest-cache.zip && unzip -qo rest-cache.zip -d /var/www/html/wp-content/plugins/ && \
    curl -sL "https://downloads.wordpress.org/plugin/custom-post-type-ui.latest-stable.zip" -o cptui.zip && unzip -qo cptui.zip -d /var/www/html/wp-content/plugins/ && \
    rm -f /tmp/*.zip

# ACF PRO must be installed manually (licensed plugin)
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
