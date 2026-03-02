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
      "sort",
      "exactness",
    ],
  });
}
