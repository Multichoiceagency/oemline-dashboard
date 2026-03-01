import type { SupplierAdapter } from "./base.js";
import { IntercarsAdapter } from "./intercars.js";
import { PartsPointAdapter } from "./partspoint.js";
import { TecDocAdapter } from "./tecdoc.js";
import { prisma } from "../lib/prisma.js";
import { decryptCredentials } from "../lib/crypto.js";
import { logger } from "../lib/logger.js";

type AdapterConstructor = new (apiUrl: string, apiKey: string, timeout?: number) => SupplierAdapter;

const ADAPTER_MAP: Record<string, AdapterConstructor> = {
  intercars: IntercarsAdapter,
  partspoint: PartsPointAdapter,
  tecdoc: TecDocAdapter,
};

const adapterCache = new Map<string, { adapter: SupplierAdapter; updatedAt: Date }>();

export function registerAdapterType(type: string, constructor: AdapterConstructor): void {
  ADAPTER_MAP[type] = constructor;
}

export async function loadAdaptersFromDb(): Promise<void> {
  const suppliers = await prisma.supplier.findMany({
    where: { active: true },
    orderBy: { priority: "asc" },
  });

  const activeCodes = new Set<string>();

  for (const supplier of suppliers) {
    activeCodes.add(supplier.code);

    const cached = adapterCache.get(supplier.code);
    if (cached && cached.updatedAt >= supplier.updatedAt) {
      continue;
    }

    const Constructor = ADAPTER_MAP[supplier.adapterType];
    if (!Constructor) {
      logger.warn({ code: supplier.code, type: supplier.adapterType }, "Unknown adapter type");
      continue;
    }

    let credentials = "";
    try {
      credentials = decryptCredentials(supplier.credentials);
    } catch {
      // Fallback: credentials stored as plaintext (e.g. during initial setup)
      credentials = supplier.credentials;
    }

    adapterCache.set(supplier.code, {
      adapter: new Constructor(supplier.baseUrl, credentials),
      updatedAt: supplier.updatedAt,
    });

    logger.info({ code: supplier.code, type: supplier.adapterType }, "Adapter loaded");
  }

  // Remove adapters for deactivated suppliers
  for (const code of adapterCache.keys()) {
    if (!activeCodes.has(code)) {
      adapterCache.delete(code);
      logger.info({ code }, "Adapter removed (supplier deactivated)");
    }
  }
}

export function getAdapter(code: string): SupplierAdapter | undefined {
  return adapterCache.get(code)?.adapter;
}

export function getAllAdapters(): SupplierAdapter[] {
  return Array.from(adapterCache.values()).map((c) => c.adapter);
}

export function getActiveAdapterCodes(): string[] {
  return Array.from(adapterCache.keys());
}
