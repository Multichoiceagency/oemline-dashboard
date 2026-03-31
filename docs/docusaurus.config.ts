import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'OEMline API Documentation',
  tagline: 'Auto Parts Platform — API Reference & Integration Guide',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: 'https://docs.oemline.eu',
  baseUrl: '/',

  organizationName: 'Multichoiceagency',
  projectName: 'oemline-dashboard',

  onBrokenLinks: 'throw',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  scripts: [
    {
      src: '/js/google-translate.js',
      async: true,
    },
    {
      src: 'https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit',
      async: true,
    },
  ],

  clientModules: [
    './src/clientModules/googleTranslate.ts',
  ],

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/Multichoiceagency/oemline-dashboard/tree/main/docs/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/oemline-social-card.jpg',
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'OEMline',
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'apiSidebar',
          position: 'left',
          label: 'API Reference',
        },
        {
          type: 'docSidebar',
          sidebarId: 'guidesSidebar',
          position: 'left',
          label: 'Guides',
        },
        {
          href: 'https://github.com/Multichoiceagency/oemline-dashboard',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Documentation',
          items: [
            { label: 'API Reference', to: '/docs/api/overview' },
            { label: 'Getting Started', to: '/docs/guides/getting-started' },
            { label: 'Suppliers', to: '/docs/api/suppliers' },
          ],
        },
        {
          title: 'External APIs',
          items: [
            { label: 'TecDoc', to: '/docs/api/tecdoc' },
            { label: 'InterCars', to: '/docs/api/intercars' },
            { label: 'DIEDERICHS', to: '/docs/api/diederichs' },
            { label: 'VAN WEZEL', to: '/docs/api/vanwezel' },
          ],
        },
        {
          title: 'Platform',
          items: [
            { label: 'Dashboard', href: 'https://dashboard-ww0wc4swcso8w484s48cgw4s.oemline.eu' },
            { label: 'API', href: 'https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/health' },
          ],
        },
      ],
      copyright: `Copyright ${new Date().getFullYear()} OEMline / Dejavu Cars. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json', 'typescript'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
