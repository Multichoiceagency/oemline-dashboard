import type { FastifyInstance } from "fastify";
import { z } from "zod";
import PDFDocument from "pdfkit";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";

const createSchema = z.object({
  code: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/, {
    message: "code must be lowercase alphanumeric with hyphens",
  }),
  name: z.string().min(1).max(200),
  country: z.string().length(2).default("NL"),
  address: z.string().max(500).nullable().optional(),
  sortOrder: z.number().int().min(0).default(0),
  active: z.boolean().default(true),
});

const updateSchema = createSchema.partial();

const setStockSchema = z.object({
  items: z.array(z.object({
    locationId: z.number().int(),
    quantity: z.number().int().min(0).max(1_000_000),
  })).max(100),
});

export async function stockLocationRoutes(app: FastifyInstance) {
  // ── Locations CRUD ─────────────────────────────────────────────────────

  app.get("/locations", async () => {
    const items = await prisma.stockLocation.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    return { items, total: items.length };
  });

  app.post("/locations", async (request, reply) => {
    const body = createSchema.parse(request.body);
    try {
      const created = await prisma.stockLocation.create({ data: body });
      return reply.code(201).send(created);
    } catch (err) {
      if (err instanceof Error && err.message.includes("Unique")) {
        return reply.code(409).send({ error: `Locatie code '${body.code}' bestaat al` });
      }
      throw err;
    }
  });

  app.patch("/locations/:id", async (request, reply) => {
    const id = parseInt((request.params as { id: string }).id, 10);
    const body = updateSchema.parse(request.body);
    const exists = await prisma.stockLocation.findUnique({ where: { id } });
    if (!exists) return reply.code(404).send({ error: "Locatie niet gevonden" });
    const updated = await prisma.stockLocation.update({ where: { id }, data: body });
    return updated;
  });

  app.delete("/locations/:id", async (request, reply) => {
    const id = parseInt((request.params as { id: string }).id, 10);
    const exists = await prisma.stockLocation.findUnique({ where: { id } });
    if (!exists) return reply.code(404).send({ error: "Locatie niet gevonden" });
    // Cascade deletes the per-product stock rows; that's fine — manually-set
    // overrides for a deleted location aren't meaningful anywhere.
    await prisma.stockLocation.delete({ where: { id } });
    return { success: true };
  });

  // ── Per-product per-location stock ─────────────────────────────────────

  /**
   * Returns the full per-location stock breakdown for a single product.
   * Always includes every active location — missing rows render as 0 so the
   * admin UI can present a complete grid without checking which combinations
   * exist in the join table yet.
   */
  app.get("/finalized/:id/stock-locations", async (request, reply) => {
    const productId = parseInt((request.params as { id: string }).id, 10);
    if (!Number.isFinite(productId)) {
      return reply.code(400).send({ error: "Ongeldig product-id" });
    }
    const product = await prisma.productMap.findUnique({
      where: { id: productId },
      select: { id: true, articleNo: true, sku: true, stock: true },
    });
    if (!product) return reply.code(404).send({ error: "Product niet gevonden" });

    const [locations, existing] = await Promise.all([
      prisma.stockLocation.findMany({
        where: { active: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      }),
      prisma.productStock.findMany({ where: { productMapId: productId } }),
    ]);
    const byLocation = new Map(existing.map((e) => [e.locationId, e.quantity]));

    const items = locations.map((loc) => ({
      locationId: loc.id,
      code: loc.code,
      name: loc.name,
      country: loc.country,
      sortOrder: loc.sortOrder,
      quantity: byLocation.get(loc.id) ?? 0,
    }));
    const total = items.reduce((s, i) => s + i.quantity, 0);
    return { product: { id: product.id, articleNo: product.articleNo, sku: product.sku }, items, total };
  });

  /**
   * Replaces the per-location stock for a product in one call.
   *  - upsert each `(productId, locationId)` pair
   *  - sum the items and write the total to product_maps.stock so the
   *    storefront's existing stock_quantity wiring keeps working
   *    without a parallel aggregate step
   */
  app.put("/finalized/:id/stock-locations", async (request, reply) => {
    const productId = parseInt((request.params as { id: string }).id, 10);
    const body = setStockSchema.parse(request.body);

    const product = await prisma.productMap.findUnique({ where: { id: productId } });
    if (!product) return reply.code(404).send({ error: "Product niet gevonden" });

    // Validate all locationIds exist, fail fast — UI shouldn't be able to
    // hit this with garbage but a stale tab might.
    const locIds = body.items.map((i) => i.locationId);
    const validLocs = await prisma.stockLocation.findMany({
      where: { id: { in: locIds } },
      select: { id: true },
    });
    if (validLocs.length !== new Set(locIds).size) {
      return reply.code(400).send({ error: "Een of meer locaties niet (meer) gevonden" });
    }

    const total = body.items.reduce((s, i) => s + i.quantity, 0);

    await prisma.$transaction([
      ...body.items.map((it) =>
        prisma.productStock.upsert({
          where: { productMapId_locationId: { productMapId: productId, locationId: it.locationId } },
          create: { productMapId: productId, locationId: it.locationId, quantity: it.quantity },
          update: { quantity: it.quantity },
        }),
      ),
      // Mirror the sum to product_maps.stock so the storefront, search index,
      // and category counts stay consistent without a separate denormalize step.
      prisma.productMap.update({
        where: { id: productId },
        data: { stock: total, updatedAt: new Date() },
      }),
    ]);

    logger.info({ productId, locations: body.items.length, total }, "Per-location stock updated");
    return { success: true, total };
  });

  /**
   * Per-product stock sheet (PDF). Generated on demand — small enough that
   * caching adds complexity without much win. Suitable as an admin handout
   * or supplier confirmation: shows the article number, brand, total stock,
   * and the per-location breakdown.
   */
  app.get("/finalized/:id/stock.pdf", async (request, reply) => {
    const productId = parseInt((request.params as { id: string }).id, 10);
    if (!Number.isFinite(productId)) {
      return reply.code(400).send({ error: "Ongeldig product-id" });
    }

    const product = await prisma.productMap.findUnique({
      where: { id: productId },
      include: {
        brand: { select: { name: true } },
        supplier: { select: { name: true } },
      },
    });
    if (!product) return reply.code(404).send({ error: "Product niet gevonden" });

    const [locations, existing] = await Promise.all([
      prisma.stockLocation.findMany({
        where: { active: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      }),
      prisma.productStock.findMany({ where: { productMapId: productId } }),
    ]);
    const byLocation = new Map(existing.map((e) => [e.locationId, e.quantity]));

    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const filename = `stock-${product.articleNo.replace(/[^a-zA-Z0-9-]/g, "_")}.pdf`;
    reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `inline; filename="${filename}"`);
    // Stream the PDF straight to the client; reply.send accepts a Readable.
    reply.send(doc as unknown as NodeJS.ReadableStream);

    // Header
    doc.fontSize(20).font("Helvetica-Bold").text("Voorraad-overzicht", { align: "left" });
    doc.moveDown(0.4);
    doc.fontSize(10).font("Helvetica").fillColor("#666")
      .text(`Gegenereerd op ${new Date().toLocaleDateString("nl-NL", {
        day: "2-digit", month: "long", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      })}`);
    doc.fillColor("black").moveDown(1.2);

    // Product card
    doc.fontSize(14).font("Helvetica-Bold").text(product.description || product.articleNo);
    doc.moveDown(0.3);
    doc.fontSize(10).font("Helvetica");
    const facts: [string, string][] = [
      ["Artikelnr.", product.articleNo],
      ["SKU", product.sku],
      ["Merk", product.brand?.name ?? "—"],
      ["Leverancier", product.supplier?.name ?? "—"],
      ["EAN", product.ean ?? "—"],
    ];
    for (const [k, v] of facts) {
      doc.font("Helvetica-Bold").text(`${k}: `, { continued: true })
         .font("Helvetica").text(v);
    }
    doc.moveDown(1);

    // Locations table
    doc.fontSize(12).font("Helvetica-Bold").text("Voorraad per locatie");
    doc.moveDown(0.4);
    const tableTop = doc.y;
    const colWidths = { name: 260, country: 80, qty: 80 };
    const rowH = 22;

    // Header row
    doc.font("Helvetica-Bold").fontSize(10);
    doc.rect(50, tableTop, colWidths.name + colWidths.country + colWidths.qty, rowH).fillAndStroke("#f3f4f6", "#e5e7eb");
    doc.fillColor("black");
    doc.text("Locatie", 56, tableTop + 6, { width: colWidths.name, lineBreak: false });
    doc.text("Land", 56 + colWidths.name, tableTop + 6, { width: colWidths.country, lineBreak: false });
    doc.text("Aantal", 56 + colWidths.name + colWidths.country, tableTop + 6, { width: colWidths.qty, align: "right", lineBreak: false });

    // Body rows
    doc.font("Helvetica").fontSize(10);
    let y = tableTop + rowH;
    let total = 0;
    for (let i = 0; i < locations.length; i++) {
      const loc = locations[i];
      const qty = byLocation.get(loc.id) ?? 0;
      total += qty;
      if (i % 2 === 1) {
        doc.rect(50, y, colWidths.name + colWidths.country + colWidths.qty, rowH).fill("#fafafa");
        doc.fillColor("black");
      }
      doc.text(loc.name, 56, y + 6, { width: colWidths.name - 6, lineBreak: false });
      doc.text(loc.country, 56 + colWidths.name, y + 6, { width: colWidths.country, lineBreak: false });
      doc.text(qty.toString(), 56 + colWidths.name + colWidths.country, y + 6, { width: colWidths.qty - 6, align: "right", lineBreak: false });
      y += rowH;
    }

    // Total row
    doc.rect(50, y, colWidths.name + colWidths.country + colWidths.qty, rowH).fillAndStroke("#fef3c7", "#fcd34d");
    doc.fillColor("black").font("Helvetica-Bold");
    doc.text("Totaal", 56, y + 6, { width: colWidths.name + colWidths.country - 6, lineBreak: false });
    doc.text(total.toString(), 56 + colWidths.name + colWidths.country, y + 6, { width: colWidths.qty - 6, align: "right", lineBreak: false });

    doc.moveDown(3);
    doc.fontSize(8).font("Helvetica").fillColor("#888")
       .text("OEMline — automatisch gegenereerd voorraad-overzicht", { align: "center" });

    doc.end();
  });
}
