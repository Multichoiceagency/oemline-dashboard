import type {ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

import styles from './index.module.css';

function HomepageHeader() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className={clsx('hero hero--primary', styles.heroBanner)}>
      <div className="container">
        <Heading as="h1" className="hero__title">
          {siteConfig.title}
        </Heading>
        <p className="hero__subtitle">{siteConfig.tagline}</p>
        <div className={styles.buttons}>
          <Link
            className="button button--secondary button--lg"
            to="/docs/api/overview">
            API Reference
          </Link>
          <Link
            className="button button--secondary button--lg"
            style={{marginLeft: '1rem'}}
            to="/docs/guides/getting-started">
            Getting Started
          </Link>
        </div>
      </div>
    </header>
  );
}

const features = [
  {
    title: 'Storefront API',
    description: 'Products, brands, and categories ready for your storefront. 100 brands, 1.6M+ products with real-time pricing and stock.',
    link: '/docs/api/storefront-products',
  },
  {
    title: 'Multi-Supplier',
    description: 'TecDoc catalog, InterCars pricing/stock, DIEDERICHS and VAN WEZEL with their own APIs and price lists.',
    link: '/docs/api/suppliers',
  },
  {
    title: 'Smart Matching',
    description: '5-priority matching engine with IC CSV mapping (565K rows), multi-phase auto-matching, and manual match tools.',
    link: '/docs/api/matching',
  },
];

export default function Home(): ReactNode {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout
      title="OEMline API Docs"
      description="OEMline Auto Parts Platform — API Reference and Integration Guide">
      <HomepageHeader />
      <main>
        <section style={{padding: '2rem 0'}}>
          <div className="container">
            <div className="row">
              {features.map((f, i) => (
                <div key={i} className="col col--4" style={{marginBottom: '1rem'}}>
                  <div className="card" style={{padding: '1.5rem', height: '100%'}}>
                    <Heading as="h3">
                      <Link to={f.link}>{f.title}</Link>
                    </Heading>
                    <p>{f.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </Layout>
  );
}
