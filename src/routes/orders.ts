import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { redis } from "../lib/redis.js";
import { logger } from "../lib/logger.js";
import { createWooCommerceOrder, isWooCommerceConfigured } from "../lib/woocommerce.js";

const CART_PREFIX = "cart:";

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
