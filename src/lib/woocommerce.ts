import { logger } from "./logger.js";

/**
 * WooCommerce REST API v3 client — just what we need to create orders.
 *
 * Credentials come from env (WOOCOMMERCE_URL, *_CONSUMER_KEY,
 * *_CONSUMER_SECRET). Basic-auth over HTTPS is WC's standard.
 */

const URL = process.env.WOOCOMMERCE_URL ?? "";
const KEY = process.env.WOOCOMMERCE_CONSUMER_KEY ?? "";
const SECRET = process.env.WOOCOMMERCE_CONSUMER_SECRET ?? "";

export function isWooCommerceConfigured(): boolean {
  return !!(URL && KEY && SECRET);
}

function authHeader(): string {
  return "Basic " + Buffer.from(`${KEY}:${SECRET}`).toString("base64");
}

export interface WcLineItem {
  sku?: string;
  product_id?: number;
  name?: string;
  quantity: number;
  price?: string; // WC expects string
  total?: string;
  meta_data?: Array<{ key: string; value: string }>;
}

export interface WcOrderInput {
  billing: {
    first_name: string;
    last_name: string;
    email: string;
    phone?: string;
    address_1: string;
    city: string;
    postcode: string;
    country: string;
  };
  shipping?: WcOrderInput["billing"];
  line_items: WcLineItem[];
  customer_note?: string;
  status?: "pending" | "on-hold" | "processing";
  meta_data?: Array<{ key: string; value: string }>;
}

export interface WcOrderResponse {
  id: number;
  number: string;
  status: string;
  total: string;
  currency: string;
  order_key: string;
  permalink?: string;
  date_created: string;
}

export async function createWooCommerceOrder(order: WcOrderInput): Promise<WcOrderResponse> {
  if (!isWooCommerceConfigured()) {
    throw new Error("WooCommerce not configured — set WOOCOMMERCE_URL/KEY/SECRET in env");
  }

  const endpoint = `${URL.replace(/\/$/, "")}/orders`;
  const body = JSON.stringify({
    status: order.status ?? "pending",
    set_paid: false,
    billing: order.billing,
    shipping: order.shipping ?? order.billing,
    line_items: order.line_items,
    customer_note: order.customer_note,
    meta_data: order.meta_data,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body,
      signal: controller.signal,
    });

    const raw = await res.text();
    if (!res.ok) {
      logger.error({ status: res.status, body: raw.slice(0, 500) }, "WooCommerce order creation failed");
      throw new Error(`WooCommerce ${res.status}: ${raw.slice(0, 200)}`);
    }

    return JSON.parse(raw) as WcOrderResponse;
  } finally {
    clearTimeout(timer);
  }
}
