import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { redis } from "../lib/redis.js";

const CART_TTL = 60 * 60 * 24 * 7; // 7 days in seconds
const CART_PREFIX = "cart:";

interface CartItem {
  id: string;
  articleNo: string;
  name: string;
  brand: string;
  price: number;
  quantity: number;
  image?: string;
  sku?: string;
}

interface Cart {
  key: string;
  items: CartItem[];
  createdAt: string;
  updatedAt: string;
}

function cartKey(key: string): string {
  return `${CART_PREFIX}${key}`;
}

async function getCart(key: string): Promise<Cart | null> {
  const data = await redis.get(cartKey(key));
  if (!data) return null;
  try {
    return JSON.parse(data) as Cart;
  } catch {
    return null;
  }
}

async function saveCart(cart: Cart): Promise<void> {
  cart.updatedAt = new Date().toISOString();
  await redis.setex(cartKey(cart.key), CART_TTL, JSON.stringify(cart));
}

export async function cartRoutes(app: FastifyInstance) {
  // GET /cart/:key — get cart
  app.get("/cart/:key", async (request, reply) => {
    const { key } = request.params as { key: string };
    const cart = await getCart(key);
    if (!cart) return reply.code(404).send({ error: "Cart not found" });
    return cart;
  });

  // POST /cart/add — add item (creates cart if needed)
  app.post("/cart/add", async (request) => {
    const body = z.object({
      cart_key: z.string().optional(),
      articleNo: z.string(),
      name: z.string(),
      brand: z.string().default(""),
      price: z.number().min(0),
      quantity: z.number().int().min(1).default(1),
      image: z.string().optional(),
      sku: z.string().optional(),
    }).parse(request.body);

    const key = body.cart_key || randomUUID();
    let cart = await getCart(key);

    if (!cart) {
      cart = {
        key,
        items: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    // Check if item already exists — update quantity
    const existing = cart.items.find(
      (i) => i.articleNo.toLowerCase() === body.articleNo.toLowerCase()
    );

    if (existing) {
      existing.quantity += body.quantity;
    } else {
      cart.items.push({
        id: randomUUID(),
        articleNo: body.articleNo,
        name: body.name,
        brand: body.brand,
        price: body.price,
        quantity: body.quantity,
        image: body.image,
        sku: body.sku || body.articleNo,
      });
    }

    await saveCart(cart);
    return { cart_key: key, cart };
  });

  // PUT /cart/:key/items/:itemId — update quantity
  app.put("/cart/:key/items/:itemId", async (request, reply) => {
    const { key, itemId } = request.params as { key: string; itemId: string };
    const { quantity } = z.object({ quantity: z.number().int().min(0) }).parse(request.body);

    const cart = await getCart(key);
    if (!cart) return reply.code(404).send({ error: "Cart not found" });

    if (quantity === 0) {
      cart.items = cart.items.filter((i) => i.id !== itemId);
    } else {
      const item = cart.items.find((i) => i.id === itemId);
      if (!item) return reply.code(404).send({ error: "Item not found" });
      item.quantity = quantity;
    }

    await saveCart(cart);
    return cart;
  });

  // DELETE /cart/:key/items/:itemId — remove item
  app.delete("/cart/:key/items/:itemId", async (request, reply) => {
    const { key, itemId } = request.params as { key: string; itemId: string };
    const cart = await getCart(key);
    if (!cart) return reply.code(404).send({ error: "Cart not found" });

    cart.items = cart.items.filter((i) => i.id !== itemId);
    await saveCart(cart);
    return cart;
  });

  // DELETE /cart/:key — clear cart
  app.delete("/cart/:key", async (request, reply) => {
    const { key } = request.params as { key: string };
    await redis.del(cartKey(key));
    return { ok: true };
  });
}
