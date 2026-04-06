import { MeiliSearch } from "meilisearch";
import { config } from "../config.js";

export const meili = new MeiliSearch({
  host: config.MEILI_URL,
  apiKey: config.MEILI_MASTER_KEY,
});

export const PRODUCTS_INDEX = "products";

export async function ensureProductsIndex(): Promise<void> {
  const index = meili.index(PRODUCTS_INDEX);

  await meili.createIndex(PRODUCTS_INDEX, { primaryKey: "id" }).catch(() => {});

  await index.updateSettings({
    searchableAttributes: [
      "sku",
      "brand",
      "articleNo",
      "ean",
      "oem",
      "oemNumbers",
      "description",
      "genericArticle",
      "category",
      "supplierName",
    ],
    filterableAttributes: [
      "supplier",
      "brand",
      "brandCode",
      "articleKey",
      "ean",
      "tecdocId",
      "oem",
      "status",
      "category",
      "categoryCode",
      "genericArticle",
      "currency",
    ],
    sortableAttributes: [
      "brand",
      "sku",
      "price",
      "stock",
      "weight",
      "createdAt",
      "updatedAt",
    ],
    rankingRules: [
      "words",
      "typo",
      "proximity",
      "attribute",
      // Price > 0 first (prefer products with a known price)
      "price:desc",
      // Higher stock first (prefer products in stock)
      "stock:desc",
      "sort",
      "exactness",
    ],
    // Dedupliceren: 1 resultaat per uniek brand+articleNo combinatie.
    // Voorkomt dat hetzelfde product van meerdere suppliers dubbel verschijnt.
    // Meilisearch kiest het hoogst gerankte document (met prijs > zonder prijs).
    distinctAttribute: "articleKey",
  });
}
