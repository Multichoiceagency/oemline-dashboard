import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { llmGenerate, activeLlmProvider, LLM_MODEL } from "../lib/llm.js";
import { logger } from "../lib/logger.js";

const chatSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().max(4000),
  })).min(1).max(20),
});

/**
 * Pre-fetch a small dashboard context bundle the assistant can reason over
 * without needing tool calls. Keeps each request self-contained and fast.
 */
async function loadDashboardContext() {
  const [
    totals,
    topBrands,
    topCategories,
    locations,
    recentLowStock,
  ] = await Promise.all([
    prisma.$queryRawUnsafe<Array<{
      total_products: bigint;
      with_stock: bigint;
      total_units: bigint;
      total_value: number;
    }>>(
      `SELECT
         COUNT(*)::bigint AS total_products,
         SUM(CASE WHEN stock > 0 THEN 1 ELSE 0 END)::bigint AS with_stock,
         COALESCE(SUM(CASE WHEN stock > 0 THEN stock ELSE 0 END), 0)::bigint AS total_units,
         COALESCE(SUM(CASE WHEN stock > 0 AND price IS NOT NULL THEN stock * price ELSE 0 END), 0)::float8 AS total_value
       FROM product_maps WHERE status = 'active'`,
    ),
    prisma.$queryRawUnsafe<Array<{ name: string; product_count: bigint; stock_value: number }>>(
      `SELECT b.name, COUNT(pm.id)::bigint AS product_count,
              COALESCE(SUM(pm.stock * pm.price), 0)::float8 AS stock_value
       FROM product_maps pm JOIN brands b ON b.id = pm.brand_id
       WHERE pm.status = 'active' AND pm.stock > 0 AND pm.price IS NOT NULL
       GROUP BY b.name ORDER BY stock_value DESC LIMIT 10`,
    ),
    prisma.$queryRawUnsafe<Array<{ name: string | null; product_count: bigint }>>(
      `SELECT c.name, COUNT(pm.id)::bigint AS product_count
       FROM product_maps pm LEFT JOIN categories c ON c.id = pm.category_id
       WHERE pm.status = 'active' AND pm.stock > 0
       GROUP BY c.name ORDER BY product_count DESC LIMIT 10`,
    ),
    prisma.stockLocation.findMany({ where: { active: true }, select: { code: true, name: true, country: true } }),
    prisma.$queryRawUnsafe<Array<{ article_no: string; description: string; brand: string; stock: number }>>(
      `SELECT pm.article_no, pm.description, b.name AS brand, pm.stock
       FROM product_maps pm JOIN brands b ON b.id = pm.brand_id
       WHERE pm.status = 'active' AND pm.stock > 0 AND pm.stock <= 5
       ORDER BY pm.stock ASC LIMIT 10`,
    ),
  ]);
  return {
    totals: totals[0]
      ? {
          totalProducts: Number(totals[0].total_products),
          withStock: Number(totals[0].with_stock),
          totalUnits: Number(totals[0].total_units),
          totalValue: Math.round((totals[0].total_value ?? 0) * 100) / 100,
        }
      : null,
    topBrands: topBrands.map((b) => ({
      name: b.name,
      productCount: Number(b.product_count),
      stockValue: Math.round(Number(b.stock_value) * 100) / 100,
    })),
    topCategories: topCategories.map((c) => ({
      name: c.name ?? "— Geen categorie",
      productCount: Number(c.product_count),
    })),
    locations,
    recentLowStock,
  };
}

function formatContextForPrompt(ctx: Awaited<ReturnType<typeof loadDashboardContext>>): string {
  const lines: string[] = [];
  if (ctx.totals) {
    lines.push(
      `## Voorraad (snapshot)
- Totaal actieve producten: ${ctx.totals.totalProducts.toLocaleString("nl-NL")}
- Producten op voorraad (>0): ${ctx.totals.withStock.toLocaleString("nl-NL")}
- Totaal stuks op voorraad: ${ctx.totals.totalUnits.toLocaleString("nl-NL")}
- Totale inkoopwaarde voorraad: € ${ctx.totals.totalValue.toLocaleString("nl-NL", { minimumFractionDigits: 2 })}`,
    );
  }
  if (ctx.locations.length > 0) {
    lines.push(
      `## Voorraadlocaties\n${ctx.locations
        .map((l) => `- ${l.name} (${l.code}, ${l.country})`)
        .join("\n")}`,
    );
  }
  if (ctx.topBrands.length > 0) {
    lines.push(
      `## Top 10 merken op voorraadwaarde\n${ctx.topBrands
        .map((b, i) => `${i + 1}. ${b.name} — ${b.productCount} producten, € ${b.stockValue.toLocaleString("nl-NL", { minimumFractionDigits: 2 })}`)
        .join("\n")}`,
    );
  }
  if (ctx.topCategories.length > 0) {
    lines.push(
      `## Top 10 categorieën op product-aantal\n${ctx.topCategories
        .map((c, i) => `${i + 1}. ${c.name} — ${c.productCount} producten`)
        .join("\n")}`,
    );
  }
  if (ctx.recentLowStock.length > 0) {
    lines.push(
      `## Producten met lage voorraad (≤5)\n${ctx.recentLowStock
        .map((p) => `- ${p.brand} ${p.article_no}: ${p.stock} stuks — ${p.description.slice(0, 60)}`)
        .join("\n")}`,
    );
  }
  return lines.join("\n\n");
}

const SYSTEM_PROMPT = `Je bent **OEMLine Assistant**, een interne dashboard-helper voor het OEMLine auto-onderdelen platform. Je beantwoordt vragen van administrators over voorraad, producten, merken, categorieën en orders.

Belangrijk:
- Antwoord altijd in het Nederlands, beknopt en zakelijk.
- Gebruik de meegeleverde "Dashboard context" hieronder als bron van waarheid voor cijfers, totalen en lijsten.
- Als de gevraagde informatie niet in de context staat, zeg dat je het niet zeker weet en suggereer in welke pagina van het dashboard de admin het kan vinden (bijv. /voorraad, /finalized, /brands).
- Verzin geen producten, prijzen of voorraad-aantallen die niet in de context staan.
- Voor zoekvragen ("welke remblokken hebben we van X?") suggereer je /finalized?q=… of /voorraad met een filter.
- Tabellen mogen via simpele markdown.
- Een goede tip eindigt met een concrete vervolgactie of link.`;

export async function assistantRoutes(app: FastifyInstance) {
  app.post("/assistant/chat", async (request, reply) => {
    const { messages } = chatSchema.parse(request.body);
    const provider = activeLlmProvider();
    if (provider === "none") {
      return reply.code(503).send({
        error: "Geen LLM beschikbaar — stel KIMI_API_KEY in of zorg dat OLLAMA_URL bereikbaar is",
      });
    }

    const context = await loadDashboardContext();
    const contextText = formatContextForPrompt(context);

    // Build a single prompt: context + conversation history. Most local
    // Ollama models work better with a flat prompt than with role-tagged
    // chat messages, and Kimi accepts both. We render the conversation as
    // "User: …\nAssistant: …" turns and end with the latest user message.
    const turns = messages
      .map((m) => `${m.role === "user" ? "Gebruiker" : "Assistent"}: ${m.content}`)
      .join("\n\n");
    const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const prompt = `### Dashboard context\n${contextText}\n\n### Gesprek\n${turns}\n\n### Laatste vraag\n${lastUser}\n\n### Antwoord (Nederlands, kort)`;

    try {
      const reply = await llmGenerate(prompt, {
        system: SYSTEM_PROMPT,
        temperature: 0.2,
      });
      return {
        reply,
        provider,
        model: LLM_MODEL,
        contextSummary: {
          totalProducts: context.totals?.totalProducts ?? 0,
          totalValue: context.totals?.totalValue ?? 0,
          locations: context.locations.length,
        },
      };
    } catch (err) {
      logger.warn({ err }, "Assistant LLM call failed");
      return reply.code(502).send({
        error: err instanceof Error ? err.message : "LLM-aanroep mislukt",
      });
    }
  });

  // Lightweight status endpoint so the chat UI can show whether the
  // assistant is actually wired up before the user types.
  app.get("/assistant/status", async () => {
    const provider = activeLlmProvider();
    return {
      provider,
      model: LLM_MODEL,
      available: provider !== "none",
    };
  });
}
