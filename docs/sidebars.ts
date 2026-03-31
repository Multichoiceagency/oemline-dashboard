import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  apiSidebar: [
    'api/overview',
    {
      type: 'category',
      label: 'Authentication',
      items: ['api/authentication'],
    },
    {
      type: 'category',
      label: 'Storefront API',
      items: [
        'api/storefront-products',
        'api/storefront-brands',
        'api/storefront-categories',
      ],
    },
    {
      type: 'category',
      label: 'Supplier APIs',
      items: [
        'api/suppliers',
        'api/tecdoc',
        'api/intercars',
        'api/diederichs',
        'api/vanwezel',
      ],
    },
    {
      type: 'category',
      label: 'Pricing & Matching',
      items: [
        'api/pricing',
        'api/matching',
        'api/finalized',
      ],
    },
    {
      type: 'category',
      label: 'Management',
      items: [
        'api/brands',
        'api/categories',
        'api/settings',
        'api/jobs',
      ],
    },
  ],
  guidesSidebar: [
    'guides/getting-started',
    'guides/architecture',
    'guides/deployment',
    'guides/adding-supplier',
  ],
};

export default sidebars;
