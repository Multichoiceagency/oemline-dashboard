import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";

// Default settings values
const DEFAULTS: Record<string, string> = {
  tax_rate: "21",
  margin_percentage: "0",
  // Storefront-facing discount applied AFTER margin and BEFORE tax. So a 10 here
  // means: customer sees (base × (1+margin) × 0.9) ex VAT, then × (1+taxRate).
  // Set 0 to disable globally.
  discount_percentage: "0",
  currency: "EUR",
  output_api_url: "",
  output_api_key: "",
  auto_push_enabled: "false",
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
       VALUES ('tax_rate', $1, NOW()), ('margin_percentage', $2, NOW()),
              ('discount_percentage', $3, NOW()), ('currency', $4, NOW())
       ON CONFLICT (key) DO NOTHING`,
      DEFAULTS.tax_rate,
      DEFAULTS.margin_percentage,
      DEFAULTS.discount_percentage,
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
      discountPercentage: parseFloat(settings.discount_percentage ?? "0"),
      currency: settings.currency,
      outputApiUrl: settings.output_api_url ?? "",
      outputApiKey: settings.output_api_key ?? "",
      autoPushEnabled: settings.auto_push_enabled === "true",
    };
  });

  // PATCH /settings - Update settings
  app.patch("/settings", async (request) => {
    const schema = z.object({
      taxRate: z.number().min(0).max(100).optional(),
      marginPercentage: z.number().min(0).max(1000).optional(),
      discountPercentage: z.number().min(0).max(99).optional(),
      currency: z.string().min(1).max(10).optional(),
      outputApiUrl: z.string().max(500).optional(),
      outputApiKey: z.string().max(200).optional(),
      autoPushEnabled: z.boolean().optional(),
    });

    const body = schema.parse(request.body);

    const updates: { key: string; value: string }[] = [];
    if (body.taxRate !== undefined) updates.push({ key: "tax_rate", value: String(body.taxRate) });
    if (body.marginPercentage !== undefined) updates.push({ key: "margin_percentage", value: String(body.marginPercentage) });
    if (body.discountPercentage !== undefined) updates.push({ key: "discount_percentage", value: String(body.discountPercentage) });
    if (body.currency !== undefined) updates.push({ key: "currency", value: body.currency });
    if (body.outputApiUrl !== undefined) updates.push({ key: "output_api_url", value: body.outputApiUrl });
    if (body.outputApiKey !== undefined) updates.push({ key: "output_api_key", value: body.outputApiKey });
    if (body.autoPushEnabled !== undefined) updates.push({ key: "auto_push_enabled", value: String(body.autoPushEnabled) });

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
      discountPercentage: parseFloat(settings.discount_percentage ?? "0"),
      currency: settings.currency,
      outputApiUrl: settings.output_api_url ?? "",
      outputApiKey: settings.output_api_key ?? "",
      autoPushEnabled: settings.auto_push_enabled === "true",
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
    const discountPct = parseFloat(settings.discount_percentage ?? "0") / 100;

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
        discountPercentage: parseFloat(settings.discount_percentage ?? "0"),
      },
      preview: products.map((p) => {
        const basePrice = p.price ?? 0;
        const withMargin = basePrice * (1 + marginPct);
        const afterDiscount = withMargin * (1 - discountPct);
        const withTax = afterDiscount * (1 + taxRate);
        return {
          articleNo: p.articleNo,
          brand: p.brand.name,
          description: p.description,
          basePrice: Math.round(basePrice * 100) / 100,
          withMargin: Math.round(withMargin * 100) / 100,
          afterDiscount: Math.round(afterDiscount * 100) / 100,
          withTax: Math.round(withTax * 100) / 100,
          currency: p.currency ?? "EUR",
        };
      }),
    };
  });
}

// Export helpers for use in finalized route
export { getSetting, getAllSettings };
