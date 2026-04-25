import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";

const periodSchema = z.object({
  // Optional period filter — applied to product_maps.updated_at as a proxy
  // for "stock activity in this period". We don't keep a stock-history audit
  // table yet, so this means "products whose stock was last touched within
  // the period" rather than "stock movement during the period".
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  quarter: z.coerce.number().int().min(1).max(4).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
});

function periodWindow(p: z.infer<typeof periodSchema>): { gte: Date; lt: Date } | null {
  if (p.year == null) return null;
  const y = p.year;
  if (p.month != null) {
    return { gte: new Date(Date.UTC(y, p.month - 1, 1)), lt: new Date(Date.UTC(y, p.month, 1)) };
  }
  if (p.quarter != null) {
    const startMonth = (p.quarter - 1) * 3;
    return { gte: new Date(Date.UTC(y, startMonth, 1)), lt: new Date(Date.UTC(y, startMonth + 3, 1)) };
  }
  return { gte: new Date(Date.UTC(y, 0, 1)), lt: new Date(Date.UTC(y + 1, 0, 1)) };
}

export async function analyticsRoutes(app: FastifyInstance) {
  /**
   * Stock analyses overview. Returns a snapshot of the current inventory
   * state (totals, value, breakdowns by location/brand/category) and an
   * optional period filter that scopes the breakdowns to product_maps that
   * were touched within the given year/quarter/month window.
   *
   * Inkoop = sum(price × stock) over the price field on product_maps —
   * that's the wholesale base price stored at sync time, the most accurate
   * "what we paid" signal we have without a separate purchase log.
   */
  app.get("/analytics/stock", async (request) => {
    const period = periodSchema.parse(request.query);
    const window = periodWindow(period);

    const baseWhere: Record<string, unknown> = { status: "active" };
    if (window) {
      baseWhere.updatedAt = { gte: window.gte, lt: window.lt };
    }

    // ── Top-line totals ───────────────────────────────────────────────
    const [
      productCount,
      productsWithStock,
      stockSums,
      perBrand,
      perCategory,
      perLocation,
      monthlyHistory,
    ] = await Promise.all([
      prisma.productMap.count({ where: baseWhere }),
      prisma.productMap.count({ where: { ...baseWhere, stock: { gt: 0 } } }),

      // Total units + sum(price × stock) — uses raw SQL because Prisma can't
      // aggregate a multiplication directly without pulling rows into Node.
      (async () => {
        const periodClause = window
          ? `AND pm.updated_at >= '${window.gte.toISOString()}'::timestamptz
             AND pm.updated_at <  '${window.lt.toISOString()}'::timestamptz`
          : "";
        const rows = await prisma.$queryRawUnsafe<Array<{
          total_units: bigint | null;
          total_value: number | null;
          avg_price: number | null;
        }>>(
          `SELECT
             COALESCE(SUM(pm.stock), 0)::bigint AS total_units,
             COALESCE(SUM(pm.stock * pm.price), 0)::float8 AS total_value,
             AVG(pm.price)::float8 AS avg_price
           FROM product_maps pm
           WHERE pm.status = 'active'
             AND pm.stock IS NOT NULL AND pm.stock > 0
             AND pm.price IS NOT NULL
             ${periodClause}`,
        );
        const r = rows[0] ?? { total_units: 0n, total_value: 0, avg_price: 0 };
        return {
          totalUnits: Number(r.total_units ?? 0),
          totalValue: r.total_value ?? 0,
          avgPrice: r.avg_price ?? 0,
        };
      })(),

      // Top 20 brands by inventory value
      (async () => {
        const periodClause = window
          ? `AND pm.updated_at >= '${window.gte.toISOString()}'::timestamptz
             AND pm.updated_at <  '${window.lt.toISOString()}'::timestamptz`
          : "";
        return prisma.$queryRawUnsafe<Array<{
          brand_id: number;
          brand_name: string;
          brand_code: string;
          product_count: bigint;
          stock_units: bigint;
          stock_value: number;
        }>>(
          `SELECT
             b.id AS brand_id,
             b.name AS brand_name,
             b.code AS brand_code,
             COUNT(pm.id)::bigint AS product_count,
             COALESCE(SUM(pm.stock), 0)::bigint AS stock_units,
             COALESCE(SUM(pm.stock * pm.price), 0)::float8 AS stock_value
           FROM product_maps pm
           JOIN brands b ON b.id = pm.brand_id
           WHERE pm.status = 'active'
             AND pm.stock IS NOT NULL AND pm.stock > 0
             AND pm.price IS NOT NULL
             ${periodClause}
           GROUP BY b.id, b.name, b.code
           ORDER BY stock_value DESC
           LIMIT 20`,
        );
      })(),

      // Top 20 categories by inventory value
      (async () => {
        const periodClause = window
          ? `AND pm.updated_at >= '${window.gte.toISOString()}'::timestamptz
             AND pm.updated_at <  '${window.lt.toISOString()}'::timestamptz`
          : "";
        return prisma.$queryRawUnsafe<Array<{
          category_id: number | null;
          category_name: string | null;
          product_count: bigint;
          stock_units: bigint;
          stock_value: number;
        }>>(
          `SELECT
             c.id AS category_id,
             c.name AS category_name,
             COUNT(pm.id)::bigint AS product_count,
             COALESCE(SUM(pm.stock), 0)::bigint AS stock_units,
             COALESCE(SUM(pm.stock * pm.price), 0)::float8 AS stock_value
           FROM product_maps pm
           LEFT JOIN categories c ON c.id = pm.category_id
           WHERE pm.status = 'active'
             AND pm.stock IS NOT NULL AND pm.stock > 0
             AND pm.price IS NOT NULL
             ${periodClause}
           GROUP BY c.id, c.name
           ORDER BY stock_value DESC
           LIMIT 20`,
        );
      })(),

      // Per-location breakdown (real per-location data from product_stock,
      // ignores the period filter because location quantities don't carry a
      // per-period dimension yet).
      (async () => {
        return prisma.$queryRawUnsafe<Array<{
          location_id: number;
          code: string;
          name: string;
          country: string;
          product_count: bigint;
          total_units: bigint;
          total_value: number;
        }>>(
          `SELECT
             sl.id AS location_id,
             sl.code,
             sl.name,
             sl.country,
             COUNT(DISTINCT ps.product_map_id)::bigint AS product_count,
             COALESCE(SUM(ps.quantity), 0)::bigint AS total_units,
             COALESCE(SUM(ps.quantity * pm.price), 0)::float8 AS total_value
           FROM stock_locations sl
           LEFT JOIN product_stock ps ON ps.location_id = sl.id
           LEFT JOIN product_maps pm ON pm.id = ps.product_map_id AND pm.status = 'active'
           WHERE sl.active = true
           GROUP BY sl.id, sl.code, sl.name, sl.country, sl.sort_order
           ORDER BY sl.sort_order ASC, sl.name ASC`,
        );
      })(),

      // 12-month rolling history of products updated in each month — uses
      // updated_at as a proxy for "last touched". Shows whether stock is
      // moving and where the value lives over time.
      (async () => {
        return prisma.$queryRawUnsafe<Array<{
          bucket: string;
          product_count: bigint;
          stock_units: bigint;
          stock_value: number;
        }>>(
          `WITH months AS (
             SELECT generate_series(
               date_trunc('month', NOW() - INTERVAL '11 months'),
               date_trunc('month', NOW()),
               INTERVAL '1 month'
             )::date AS m
           )
           SELECT
             to_char(months.m, 'YYYY-MM') AS bucket,
             COALESCE(COUNT(pm.id), 0)::bigint AS product_count,
             COALESCE(SUM(pm.stock), 0)::bigint AS stock_units,
             COALESCE(SUM(pm.stock * pm.price), 0)::float8 AS stock_value
           FROM months
           LEFT JOIN product_maps pm
             ON pm.status = 'active'
             AND pm.stock IS NOT NULL AND pm.stock > 0
             AND pm.price IS NOT NULL
             AND date_trunc('month', pm.updated_at) = months.m
           GROUP BY months.m
           ORDER BY months.m ASC`,
        );
      })(),
    ]);

    return {
      period: {
        year: period.year ?? null,
        quarter: period.quarter ?? null,
        month: period.month ?? null,
        scope: window ? "filtered" : "all-time",
      },
      totals: {
        productCount,
        productsWithStock,
        productsWithoutStock: productCount - productsWithStock,
        totalUnits: stockSums.totalUnits,
        totalValue: Math.round(stockSums.totalValue * 100) / 100,
        avgPrice: Math.round(stockSums.avgPrice * 100) / 100,
      },
      perLocation: perLocation.map((r) => ({
        locationId: r.location_id,
        code: r.code,
        name: r.name,
        country: r.country,
        productCount: Number(r.product_count),
        totalUnits: Number(r.total_units),
        totalValue: Math.round(Number(r.total_value) * 100) / 100,
      })),
      perBrand: perBrand.map((r) => ({
        brandId: r.brand_id,
        name: r.brand_name,
        code: r.brand_code,
        productCount: Number(r.product_count),
        stockUnits: Number(r.stock_units),
        stockValue: Math.round(Number(r.stock_value) * 100) / 100,
      })),
      perCategory: perCategory.map((r) => ({
        categoryId: r.category_id,
        name: r.category_name ?? "— Geen categorie",
        productCount: Number(r.product_count),
        stockUnits: Number(r.stock_units),
        stockValue: Math.round(Number(r.stock_value) * 100) / 100,
      })),
      monthlyHistory: monthlyHistory.map((r) => ({
        month: r.bucket,
        productCount: Number(r.product_count),
        stockUnits: Number(r.stock_units),
        stockValue: Math.round(Number(r.stock_value) * 100) / 100,
      })),
    };
  });
}

// Helper kept here in case other routes want to compute the period window the
// same way.
export { periodWindow };

// Mark unused logger import as intentional — kept for future error logging.
void logger;
