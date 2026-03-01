import type {
  SupplierSearchParams,
  SupplierProduct,
  SupplierCatalogItem,
} from "../types/index.js";
import { CircuitBreaker } from "../lib/circuit-breaker.js";

export interface SupplierAdapter {
  readonly name: string;
  readonly code: string;
  readonly circuitBreaker: CircuitBreaker;

  search(params: SupplierSearchParams): Promise<SupplierProduct[]>;
  getPrice(sku: string): Promise<{ price: number; currency: string } | null>;
  getStock(sku: string): Promise<{ quantity: number; available: boolean } | null>;
  syncCatalog(cursor?: string): AsyncGenerator<SupplierCatalogItem[], void, unknown>;
}

export abstract class BaseSupplierAdapter implements SupplierAdapter {
  abstract readonly name: string;
  abstract readonly code: string;

  readonly circuitBreaker: CircuitBreaker;
  protected apiUrl: string;
  protected apiKey: string;
  protected timeout: number;

  constructor(apiUrl: string, apiKey: string, timeout = 1500) {
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
    this.timeout = timeout;
    this.circuitBreaker = new CircuitBreaker(this.constructor.name, {
      failureThreshold: 5,
      recoveryTimeMs: 30_000,
      halfOpenMaxAttempts: 2,
    });
  }

  abstract search(params: SupplierSearchParams): Promise<SupplierProduct[]>;
  abstract getPrice(sku: string): Promise<{ price: number; currency: string } | null>;
  abstract getStock(sku: string): Promise<{ quantity: number; available: boolean } | null>;
  abstract syncCatalog(cursor?: string): AsyncGenerator<SupplierCatalogItem[], void, unknown>;

  protected async fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
    return this.circuitBreaker.execute(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout);

      try {
        const response = await fetch(url, {
          ...init,
          signal: controller.signal,
        });

        if (response.status >= 500) {
          throw new Error(`Supplier returned ${response.status}`);
        }

        return response;
      } finally {
        clearTimeout(timer);
      }
    });
  }
}
