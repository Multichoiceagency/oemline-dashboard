/**
 * OEMline Admin Search — ACF field autocomplete via Dashboard API
 *
 * Adds live search to ACF text fields for:
 * - Article Number fields → searches products
 * - Brand fields → searches brands
 * - Category fields → searches categories
 */
(function ($) {
  'use strict';

  if (!$ || typeof $.fn === 'undefined') return;

  var API_BASE = (window.oemlineAdmin && window.oemlineAdmin.restUrl) || '/wp-json/oemline/v1';
  var NONCE = (window.oemlineAdmin && window.oemlineAdmin.nonce) || '';
  var debounceTimer = {};

  /**
   * ACF field keys/names that should have product search
   */
  var PRODUCT_FIELDS = [
    'tecdoc_article_number',
    'article_number',
    'field_po_article',
    'field_fp_article_no',
    'field_pe_article',
    'field_pr_article',
  ];

  /**
   * ACF field keys/names that should have brand search
   */
  var BRAND_FIELDS = [
    'tecdoc_brand',
    'brand_code',
    'field_po_brand',
    'field_fp_brand_code',
    'field_pe_brand_code',
  ];

  function debounce(key, fn, delay) {
    clearTimeout(debounceTimer[key]);
    debounceTimer[key] = setTimeout(fn, delay || 300);
  }

  function fetchResults(endpoint, query, callback) {
    var url = API_BASE + '/' + endpoint + '?q=' + encodeURIComponent(query);
    $.ajax({
      url: url,
      method: 'GET',
      beforeSend: function (xhr) {
        if (NONCE) xhr.setRequestHeader('X-WP-Nonce', NONCE);
      },
      success: function (data) {
        callback(data);
      },
      error: function () {
        callback(null);
      },
    });
  }

  function createDropdown($input) {
    var $existing = $input.siblings('.oemline-search-dropdown');
    if ($existing.length) return $existing;

    var $dropdown = $('<div class="oemline-search-dropdown"></div>');
    $input.after($dropdown);
    return $dropdown;
  }

  function showProductResults($input, $dropdown, data) {
    $dropdown.empty();
    if (!data || !data.items || data.items.length === 0) {
      $dropdown.html('<div class="oemline-search-empty">Geen producten gevonden</div>');
      $dropdown.show();
      return;
    }

    var items = data.items.slice(0, 15);
    items.forEach(function (product) {
      var price = product.price ? '€' + parseFloat(product.price).toFixed(2) : '';
      var brand = product.brand ? product.brand.name : '';
      var img = product.imageUrl
        ? '<img src="' + product.imageUrl + '" alt="" class="oemline-search-thumb" />'
        : '<div class="oemline-search-thumb oemline-search-nothumb">?</div>';

      var $item = $(
        '<div class="oemline-search-item" data-article="' +
          (product.articleNo || '') +
          '" data-brand="' +
          (product.brand ? product.brand.code : '') +
          '" data-brand-name="' +
          brand +
          '" data-id="' +
          product.id +
          '" data-sku="' +
          (product.sku || '') +
          '">' +
          '<div class="oemline-search-item-left">' +
          img +
          '</div>' +
          '<div class="oemline-search-item-info">' +
          '<div class="oemline-search-item-title">' +
          (product.articleNo || '') +
          (brand ? ' <span class="oemline-search-brand">' + brand + '</span>' : '') +
          '</div>' +
          '<div class="oemline-search-item-desc">' +
          (product.description || product.genericArticle || '') +
          '</div>' +
          '<div class="oemline-search-item-meta">' +
          (product.sku ? 'SKU: ' + product.sku : '') +
          (product.ean ? ' | EAN: ' + product.ean : '') +
          (product.icSku ? ' | IC: ' + product.icSku : '') +
          (price ? ' | ' + price : '') +
          '</div>' +
          '</div>' +
          '</div>'
      );

      $item.on('click', function () {
        var articleNo = $(this).data('article');
        $input.val(articleNo).trigger('change');

        // Also fill in related fields if they exist in the same field group
        var $row = $input.closest('.acf-fields, .acf-field-group');
        if ($row.length) {
          var brandCode = $(this).data('brand');
          var brandName = $(this).data('brand-name');
          var dashId = $(this).data('id');
          var sku = $(this).data('sku');

          // Try to fill brand field
          $row.find('[data-name="tecdoc_brand"] input, [data-name="brand_code"] input').val(brandName || brandCode).trigger('change');
          // Try to fill dashboard product ID
          $row.find('[data-name="dashboard_product_id"] input').val(dashId).trigger('change');
        }

        $dropdown.hide();
      });

      $dropdown.append($item);
    });

    if (data.total > 15) {
      $dropdown.append(
        '<div class="oemline-search-more">En ' + (data.total - 15) + ' meer resultaten...</div>'
      );
    }

    $dropdown.show();
  }

  function showBrandResults($input, $dropdown, data) {
    $dropdown.empty();
    if (!data || !data.items || data.items.length === 0) {
      $dropdown.html('<div class="oemline-search-empty">Geen merken gevonden</div>');
      $dropdown.show();
      return;
    }

    var items = data.items.slice(0, 20);
    items.forEach(function (brand) {
      var logo = brand.logoUrl
        ? '<img src="' + brand.logoUrl + '" alt="" class="oemline-search-thumb" />'
        : '<div class="oemline-search-thumb oemline-search-nothumb">' +
          (brand.name ? brand.name.charAt(0) : '?') +
          '</div>';

      var $item = $(
        '<div class="oemline-search-item" data-code="' +
          (brand.code || '') +
          '" data-name="' +
          (brand.name || '') +
          '">' +
          '<div class="oemline-search-item-left">' +
          logo +
          '</div>' +
          '<div class="oemline-search-item-info">' +
          '<div class="oemline-search-item-title">' +
          (brand.name || '') +
          '</div>' +
          '<div class="oemline-search-item-meta">' +
          (brand.productCount ? brand.productCount + ' producten' : '') +
          (brand.code ? ' | Code: ' + brand.code : '') +
          '</div>' +
          '</div>' +
          '</div>'
      );

      $item.on('click', function () {
        $input.val($(this).data('name')).trigger('change');
        $dropdown.hide();
      });

      $dropdown.append($item);
    });

    $dropdown.show();
  }

  function initFieldSearch($input, type) {
    if ($input.data('oemline-search-init')) return;
    $input.data('oemline-search-init', true);

    var $dropdown = createDropdown($input);
    var fieldId = $input.attr('id') || Math.random().toString(36).slice(2);

    $input.on('input keyup', function () {
      var val = $(this).val().trim();
      if (val.length < 2) {
        $dropdown.hide();
        return;
      }

      debounce(fieldId, function () {
        if (type === 'product') {
          fetchResults('search/products', val, function (data) {
            showProductResults($input, $dropdown, data);
          });
        } else if (type === 'brand') {
          fetchResults('search/brands', val, function (data) {
            showBrandResults($input, $dropdown, data);
          });
        }
      });
    });

    $input.on('focus', function () {
      var val = $(this).val().trim();
      if (val.length >= 2 && $dropdown.children().length > 0) {
        $dropdown.show();
      }
    });

    // Close dropdown when clicking outside
    $(document).on('click', function (e) {
      if (!$(e.target).closest($input.parent()).length) {
        $dropdown.hide();
      }
    });
  }

  function isProductField($field) {
    var name = $field.data('name') || '';
    var key = $field.data('key') || '';
    return PRODUCT_FIELDS.indexOf(name) !== -1 || PRODUCT_FIELDS.indexOf(key) !== -1;
  }

  function isBrandField($field) {
    var name = $field.data('name') || '';
    var key = $field.data('key') || '';
    return BRAND_FIELDS.indexOf(name) !== -1 || BRAND_FIELDS.indexOf(key) !== -1;
  }

  /**
   * Initialize search on ACF fields when they are ready.
   * Uses acf/ready_field action for new fields and scans existing ones.
   */
  function init() {
    // Hook into ACF field ready event
    if (window.acf && acf.addAction) {
      acf.addAction('ready_field/type=text', function (field) {
        var $wrap = field.$el || $(field.el);
        var $input = $wrap.find('input[type="text"]');
        if (!$input.length) return;

        if (isProductField($wrap)) {
          initFieldSearch($input, 'product');
        } else if (isBrandField($wrap)) {
          initFieldSearch($input, 'brand');
        }
      });
    }

    // Also scan existing fields (in case ACF is already loaded)
    setTimeout(function () {
      $('.acf-field[data-type="text"]').each(function () {
        var $wrap = $(this);
        var $input = $wrap.find('input[type="text"]');
        if (!$input.length) return;

        if (isProductField($wrap)) {
          initFieldSearch($input, 'product');
        } else if (isBrandField($wrap)) {
          initFieldSearch($input, 'brand');
        }
      });
    }, 500);
  }

  $(document).ready(init);
})(jQuery);
