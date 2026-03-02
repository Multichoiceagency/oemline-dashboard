import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";

// Default settings values
const DEFAULTS: Record<string, string> = {
  tax_rate: "21",
  margin_percentage: "0",
  currency: "EUR",
};

// In-memory cache for settings (60s TTL)
let settingsCache: { data: Record<string, string>; expiresAt: number } | null = null;
const SETTINGS_CACHE_TTL = 60_000;

function invalidateSettingsCache() {
  settingsCache = null;
}

async function getSetting(key: string): Promise<string> {
  const all = await getAllSettings();
  return all[key] ?? DEFAULTS[key] ?? "";
}

async function getAllSettings(): Promise<Record<string, string>> {
  if (settingsCache && Date.now() < settingsCache.expiresAt) {
    return { ...settingsCache.data };
  }
  try {
    const rows = await prisma.setting.findMany();
    const result = { ...DEFAULTS };
    for (const row of rows) {
      result[row.key] = row.value;
    }
    settingsCache = { data: result, expiresAt: Date.now() + SETTINGS_CACHE_TTL };
    return { ...result };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function settingsRoutes(app: FastifyInstance) {
  // Seed defaults if not present (uses ON CONFLICT DO NOTHING — safe for concurrent starts)
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO settings (key, value, updated_at)
       VALUES ('tax_rate', $1, NOW()), ('margin_percentage', $2, NOW()), ('currency', $3, NOW())
       ON CONFLICT (key) DO NOTHING`,
      DEFAULTS.tax_rate,
      DEFAULTS.margin_percentage,
      DEFAULTS.currency
    );
  } catch (err) {
    logger.warn({ err }, "Failed to seed default settings (table may not exist yet)");
  }

  // GET /settings - Get all settings
  app.get("/settings", async () => {
    const settings = await getAllSettings();
    return {
      taxRate: parseFloat(settings.tax_rate),
      marginPercentage: parseFloat(settings.margin_percentage),
      currency: settings.currency,
    };
  });

  // PATCH /settings - Update settings
  app.patch("/settings", async (request) => {
    const schema = z.object({
      taxRate: z.number().min(0).max(100).optional(),
      marginPercentage: z.number().min(0).max(1000).optional(),
      currency: z.string().min(1).max(10).optional(),
    });

    const body = schema.parse(request.body);

    const updates: { key: string; value: string }[] = [];
    if (body.taxRate !== undefined) updates.push({ key: "tax_rate", value: String(body.taxRate) });
    if (body.marginPercentage !== undefined) updates.push({ key: "margin_percentage", value: String(body.marginPercentage) });
    if (body.currency !== undefined) updates.push({ key: "currency", value: body.currency });

    if (updates.length > 0) {
      await prisma.$transaction(
        updates.map(({ key, value }) =>
          prisma.setting.upsert({
            where: { key },
            update: { value },
            create: { key, value },
          })
        )
      );
    }

    invalidateSettingsCache();
    const settings = await getAllSettings();
    logger.info({ settings: body }, "Settings updated");

    return {
      taxRate: parseFloat(settings.tax_rate),
      marginPercentage: parseFloat(settings.margin_percentage),
      currency: settings.currency,
    };
  });

  // GET /settings/pricing-preview - Preview how pricing would look with current settings
  app.get("/settings/pricing-preview", async (request) => {
    const querySchema = z.object({
      limit: z.coerce.number().int().min(1).max(20).default(5),
    });
    const { limit } = querySchema.parse(request.query);

    const settings = await getAllSettings();
    const taxRate = parseFloat(settings.tax_rate) / 100;
    const marginPct = parseFloat(settings.margin_percentage) / 100;

    const products = await prisma.productMap.findMany({
      where: { status: "active", price: { not: null } },
      take: limit,
      orderBy: { updatedAt: "desc" },
      include: {
        brand: { select: { name: true } },
      },
    });

    return {
      settings: {
        taxRate: parseFloat(settings.tax_rate),
        marginPercentage: parseFloat(settings.margin_percentage),
      },
      preview: products.map((p) => {
        const basePrice = p.price ?? 0;
        const withMargin = basePrice * (1 + marginPct);
        const withTax = withMargin * (1 + taxRate);
        return {
          articleNo: p.articleNo,
          brand: p.brand.name,
          description: p.description,
          basePrice: Math.round(basePrice * 100) / 100,
          withMargin: Math.round(withMargin * 100) / 100,
          withTax: Math.round(withTax * 100) / 100,
          currency: p.currency ?? "EUR",
        };
      }),
    };
  });
}

// Export helpers for use in finalized route
export { getSetting, getAllSettings };
