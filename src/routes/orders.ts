import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { redis } from "../lib/redis.js";
import { logger } from "../lib/logger.js";
import { createWooCommerceOrder, isWooCommerceConfigured } from "../lib/woocommerce.js";

const CART_PREFIX = "cart:";

const manualItemSchema = z.object({
  articleNo: z.string().min(1),
  name: z.string().min(1).max(500),
  brand: z.string().max(200).default(""),
  price: z.number().min(0),
  quantity: z.number().int().min(1).max(9999),
  sku: z.string().optional(),
  image: z.string().optional(),
});

/**
 * Optional vehicle snapshot captured from the dashboard's RDW kenteken
 * lookup. Only the plate is required — the rest mirrors KentekenResponse
 * but is sent collapsed so we can persist it on the WC meta + order
 * note without re-fetching RDW server-side.
 */
const manualVehicleSchema = z.object({
  plate: z.string().min(1).max(20),
  brand: z.string().max(200).optional().nullable(),
  model: z.string().max(200).optional().nullable(),
  year: z.number().int().nullable().optional(),
  fuel: z.string().max(100).optional().nullable(),
  cc: z.number().int().nullable().optional(),
}).optional();

const manualOrderSchema = z.object({
  customer: z.object({
    firstName: z.string().min(1).max(100),
    lastName: z.string().min(1).max(100),
    email: z.string().email().max(200),
    phone: z.string().max(50).optional(),
    address: z.string().min(1).max(200),
    city: z.string().min(1).max(100),
    postcode: z.string().min(1).max(20),
    country: z.string().length(2).default("NL"),
  }),
  items: z.array(manualItemSchema).min(1).max(100),
  note: z.string().max(1000).optional(),
  vehicle: manualVehicleSchema,
});

function formatVehicleSummary(v: NonNullable<z.infer<typeof manualVehicleSchema>>): string {
  const parts: string[] = [];
  if (v.brand) parts.push(v.brand);
  if (v.model) parts.push(v.model);
  const meta: string[] = [];
  if (v.year != null) meta.push(String(v.year));
  if (v.fuel) meta.push(v.fuel);
  if (v.cc != null) meta.push(`${v.cc}cc`);
  const head = parts.join(" ").trim();
  const tail = meta.length ? ` (${meta.join(", ")})` : "";
  return `${v.plate}${head ? ` — ${head}${tail}` : ""}`;
}

const checkoutSchema = z.object({
  cartKey: z.string().min(1),
  customer: z.object({
    firstName: z.string().min(1).max(100),
    lastName: z.string().min(1).max(100),
    email: z.string().email().max(200),
    phone: z.string().max(50).optional(),
    address: z.string().min(1).max(200),
    city: z.string().min(1).max(100),
    postcode: z.string().min(1).max(20),
    country: z.string().length(2).default("NL"),
  }),
  note: z.string().max(1000).optional(),
});

interface RedisCartItem {
  id: string;
  articleNo: string;
  name: string;
  brand: string;
  price: number;
  quantity: number;
  sku?: string;
  image?: string;
}

interface RedisCart {
  key: string;
  items: RedisCartItem[];
}

/**
 * Map WooCommerce's status vocabulary to ours.
 *  pending/on-hold          → pending
 *  processing               → processing
 *  completed                → completed
 *  cancelled/refunded/failed→ cancelled (failed reserved for our own push-failures)
 */
function mapWcStatus(wc: string): "pending" | "processing" | "completed" | "cancelled" | "failed" {
  const s = (wc || "").toLowerCase().replace(/^wc-/, "");
  if (s === "completed") return "completed";
  if (s === "processing") return "processing";
  if (s === "pending" || s === "on-hold") return "pending";
  if (s === "cancelled" || s === "refunded") return "cancelled";
  return "pending";
}

export async function orderRoutes(app: FastifyInstance) {
  /**
   * Create an order from a cart: persist locally + push to WooCommerce.
   *
   * The local Order row is the source of truth even if WC returns an error;
   * we save with status='failed' + errorMessage so the dashboard can show
   * what went wrong and retry is possible.
   */
  app.post("/orders/checkout", async (request, reply) => {
    const body = checkoutSchema.parse(request.body);

    // Load cart from Redis
    const raw = await redis.get(`${CART_PREFIX}${body.cartKey}`);
    if (!raw) return reply.code(404).send({ error: "Cart not found or expired" });
    const cart = JSON.parse(raw) as RedisCart;
    if (!cart.items?.length) {
      return reply.code(400).send({ error: "Cart is empty" });
    }

    const total = cart.items.reduce((s, i) => s + i.price * i.quantity, 0);

    // Persist Order immediately with status=pending so even WC outage
    // leaves an auditable trail.
    const order = await prisma.order.create({
      data: {
        cartKey: body.cartKey,
        status: "pending",
        total,
        currency: "EUR",
        customerEmail: body.customer.email,
        customerName: `${body.customer.firstName} ${body.customer.lastName}`.trim(),
        customerPhone: body.customer.phone,
        shipping: {
          street: body.customer.address,
          city: body.customer.city,
          postcode: body.customer.postcode,
          country: body.customer.country,
        },
        items: cart.items as unknown as object,
        note: body.note,
      },
    });

    if (!isWooCommerceConfigured()) {
      return reply.code(503).send({
        error: "WooCommerce not configured",
        orderId: order.id,
        note: "Order saved locally but no WC endpoint. Configure WOOCOMMERCE_URL/KEY/SECRET and retry.",
      });
    }

    try {
      const wc = await createWooCommerceOrder({
        status: "pending",
        billing: {
          first_name: body.customer.firstName,
          last_name: body.customer.lastName,
          email: body.customer.email,
          phone: body.customer.phone,
          address_1: body.customer.address,
          city: body.customer.city,
          postcode: body.customer.postcode,
          country: body.customer.country,
        },
        line_items: cart.items.map((i) => ({
          sku: i.sku ?? i.articleNo,
          name: i.name,
          quantity: i.quantity,
          price: i.price.toFixed(2),
          total: (i.price * i.quantity).toFixed(2),
          meta_data: [
            { key: "brand", value: i.brand },
            { key: "articleNo", value: i.articleNo },
          ],
        })),
        customer_note: body.note,
        meta_data: [{ key: "dashboard_order_id", value: String(order.id) }],
      });

      const updated = await prisma.order.update({
        where: { id: order.id },
        data: {
          wcOrderId: wc.id,
          wcOrderUrl: wc.permalink ?? null,
          status: "processing",
        },
      });

      // Clear cart — order is now in WC
      await redis.del(`${CART_PREFIX}${body.cartKey}`);

      logger.info({ orderId: order.id, wcOrderId: wc.id, total }, "Order pushed to WooCommerce");

      return {
        ok: true,
        orderId: updated.id,
        wcOrderId: wc.id,
        wcOrderNumber: wc.number,
        wcOrderUrl: wc.permalink ?? null,
        total,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await prisma.order.update({
        where: { id: order.id },
        data: { status: "failed", errorMessage: msg },
      });
      logger.warn({ orderId: order.id, err: msg }, "WooCommerce order push failed");
      return reply.code(502).send({
        error: "WooCommerce push failed",
        orderId: order.id,
        message: msg,
      });
    }
  });

  /**
   * Create an order from a direct items list (no Redis cart involved).
   *
   * Used by the admin "Nieuwe bestelling" form in the dashboard. Same
   * Order row + WC push + failed-retry semantics as /checkout; only the
   * source of items differs.
   */
  app.post("/orders/manual", async (request, reply) => {
    const body = manualOrderSchema.parse(request.body);

    const total = body.items.reduce((s, i) => s + i.price * i.quantity, 0);

    // Prepend the vehicle line to the customer note when the operator
    // captured a kenteken — keeps it visible to whoever picks the order
    // without needing to dig into meta_data.
    const vehicleSummary = body.vehicle ? formatVehicleSummary(body.vehicle) : null;
    const composedNote = vehicleSummary
      ? `Kenteken: ${vehicleSummary}${body.note ? `\n\n${body.note}` : ""}`
      : body.note;

    const order = await prisma.order.create({
      data: {
        cartKey: null,
        status: "pending",
        total,
        currency: "EUR",
        customerEmail: body.customer.email,
        customerName: `${body.customer.firstName} ${body.customer.lastName}`.trim(),
        customerPhone: body.customer.phone,
        shipping: {
          street: body.customer.address,
          city: body.customer.city,
          postcode: body.customer.postcode,
          country: body.customer.country,
        },
        items: body.items.map((i) => ({
          id: crypto.randomUUID(),
          articleNo: i.articleNo,
          name: i.name,
          brand: i.brand,
          price: i.price,
          quantity: i.quantity,
          sku: i.sku,
          image: i.image,
        })) as unknown as object,
        note: composedNote,
      },
    });

    if (!isWooCommerceConfigured()) {
      return reply.code(503).send({
        error: "WooCommerce not configured",
        orderId: order.id,
        note: "Order saved locally but no WC endpoint.",
      });
    }

    try {
      const wc = await createWooCommerceOrder({
        status: "pending",
        billing: {
          first_name: body.customer.firstName,
          last_name: body.customer.lastName,
          email: body.customer.email,
          phone: body.customer.phone,
          address_1: body.customer.address,
          city: body.customer.city,
          postcode: body.customer.postcode,
          country: body.customer.country,
        },
        line_items: body.items.map((i) => ({
          sku: i.sku ?? i.articleNo,
          name: i.name,
          quantity: i.quantity,
          price: i.price.toFixed(2),
          total: (i.price * i.quantity).toFixed(2),
          meta_data: [
            { key: "brand", value: i.brand },
            { key: "articleNo", value: i.articleNo },
          ],
        })),
        customer_note: composedNote,
        meta_data: [
          { key: "dashboard_order_id", value: String(order.id) },
          { key: "source", value: "manual-dashboard" },
          ...(body.vehicle
            ? [
                { key: "kenteken", value: body.vehicle.plate },
                { key: "vehicle", value: JSON.stringify(body.vehicle) },
              ]
            : []),
        ],
      });

      const updated = await prisma.order.update({
        where: { id: order.id },
        data: { wcOrderId: wc.id, wcOrderUrl: wc.permalink ?? null, status: "processing" },
      });

      logger.info({ orderId: order.id, wcOrderId: wc.id, total, source: "manual" }, "Manual order pushed to WooCommerce");

      return {
        ok: true,
        orderId: updated.id,
        wcOrderId: wc.id,
        wcOrderNumber: wc.number,
        wcOrderUrl: wc.permalink ?? null,
        total,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await prisma.order.update({
        where: { id: order.id },
        data: { status: "failed", errorMessage: msg },
      });
      logger.warn({ orderId: order.id, err: msg }, "Manual order WC push failed");
      return reply.code(502).send({
        error: "WooCommerce push failed",
        orderId: order.id,
        message: msg,
      });
    }
  });

  app.get("/orders", async (request) => {
    const q = z
      .object({
        status: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        page: z.coerce.number().int().min(1).default(1),
      })
      .parse(request.query);

    const where = q.status ? { status: q.status } : undefined;
    const [items, total] = await Promise.all([
      prisma.order.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      prisma.order.count({ where }),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  });

  app.get("/orders/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const order = await prisma.order.findUnique({ where: { id: parseInt(id, 10) } });
    if (!order) return reply.code(404).send({ error: "Not found" });
    return order;
  });

  /**
   * WooCommerce webhook receiver for order lifecycle events.
   *
   * Configure in WC: Settings → Advanced → Webhooks → add:
   *   Topic:      Order updated (or "Order created / updated / deleted" — each)
   *   Delivery:   https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api/orders/webhook/woocommerce
   *   Secret:     set WOOCOMMERCE_WEBHOOK_SECRET env var to the same value
   *
   * WC signs the payload with HMAC-SHA256 base64 in X-WC-Webhook-Signature.
   * We verify that header before trusting the body. Missing secret in env =>
   * signature check is skipped (dev mode).
   */
  app.post("/orders/webhook/woocommerce", async (request, reply) => {
    const headers = request.headers as Record<string, string | undefined>;
    const event = headers["x-wc-webhook-event"] ?? "";
    const signature = headers["x-wc-webhook-signature"] ?? "";
    const rawBody = JSON.stringify(request.body ?? {});

    // Matches the WOOCOMMERCE_* env var prefix used for the REST credentials.
    // Old WC_WEBHOOK_SECRET is still honored for backwards compat.
    const secret = process.env.WOOCOMMERCE_WEBHOOK_SECRET ?? process.env.WC_WEBHOOK_SECRET;
    if (secret) {
      const crypto = await import("node:crypto");
      const expected = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
      if (expected !== signature) {
        return reply.code(401).send({ error: "Invalid webhook signature" });
      }
    }

    const body = (request.body ?? {}) as {
      id?: number;
      status?: string;
      number?: string;
      meta_data?: Array<{ key: string; value: string }>;
    };
    const wcOrderId = body.id;
    if (!wcOrderId) {
      return reply.code(400).send({ error: "Missing order id" });
    }

    // Find our Order either by wc_order_id or via meta_data.dashboard_order_id
    let localId: number | null = null;
    const metaRef = body.meta_data?.find((m) => m.key === "dashboard_order_id");
    if (metaRef?.value) {
      const parsed = parseInt(String(metaRef.value), 10);
      if (Number.isFinite(parsed)) localId = parsed;
    }

    const order = localId
      ? await prisma.order.findUnique({ where: { id: localId } })
      : await prisma.order.findFirst({ where: { wcOrderId } });

    if (!order) {
      logger.warn({ wcOrderId, event }, "WC webhook: no matching dashboard order");
      return { ok: true, matched: false, note: "No local order found for this WC id" };
    }

    const newStatus = mapWcStatus(body.status ?? "");
    if (order.status === newStatus && order.wcOrderId === wcOrderId) {
      return { ok: true, matched: true, orderId: order.id, changed: false };
    }

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: { status: newStatus, wcOrderId },
    });
    logger.info({ orderId: order.id, wcOrderId, oldStatus: order.status, newStatus, event }, "WC webhook updated order");
    return { ok: true, matched: true, orderId: updated.id, status: updated.status, changed: true };
  });

  app.post("/orders/:id/retry", async (request, reply) => {
    const { id } = request.params as { id: string };
    const order = await prisma.order.findUnique({ where: { id: parseInt(id, 10) } });
    if (!order) return reply.code(404).send({ error: "Not found" });
    if (order.status !== "failed") {
      return reply.code(400).send({ error: `Order is not failed (status=${order.status})` });
    }
    const items = order.items as unknown as RedisCartItem[];
    const ship = order.shipping as unknown as {
      street: string; city: string; postcode: string; country: string;
    };

    try {
      const [firstName, ...rest] = order.customerName.split(" ");
      const wc = await createWooCommerceOrder({
        status: "pending",
        billing: {
          first_name: firstName,
          last_name: rest.join(" ") || firstName,
          email: order.customerEmail,
          phone: order.customerPhone ?? undefined,
          address_1: ship.street,
          city: ship.city,
          postcode: ship.postcode,
          country: ship.country,
        },
        line_items: items.map((i) => ({
          sku: i.sku ?? i.articleNo,
          name: i.name,
          quantity: i.quantity,
          price: i.price.toFixed(2),
          total: (i.price * i.quantity).toFixed(2),
          meta_data: [
            { key: "brand", value: i.brand },
            { key: "articleNo", value: i.articleNo },
          ],
        })),
        customer_note: order.note ?? undefined,
        meta_data: [{ key: "dashboard_order_id", value: String(order.id) }],
      });

      const updated = await prisma.order.update({
        where: { id: order.id },
        data: {
          wcOrderId: wc.id,
          wcOrderUrl: wc.permalink ?? null,
          status: "processing",
          errorMessage: null,
        },
      });
      return { ok: true, wcOrderId: wc.id, orderId: updated.id };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await prisma.order.update({
        where: { id: order.id },
        data: { errorMessage: msg },
      });
      return reply.code(502).send({ error: "WooCommerce push failed", message: msg });
    }
  });
}
