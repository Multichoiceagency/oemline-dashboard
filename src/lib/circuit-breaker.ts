import { logger } from "./logger.js";

type CircuitState = "closed" | "open" | "half-open";

interface CircuitBreakerOptions {
  failureThreshold: number;
  recoveryTimeMs: number;
  halfOpenMaxAttempts: number;
}

const DEFAULT_OPTIONS: CircuitBreakerOptions = {
  failureThreshold: 5,
  recoveryTimeMs: 30_000,
  halfOpenMaxAttempts: 2,
};

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failureCount = 0;
  private lastFailureTime = 0;
  private halfOpenAttempts = 0;
  private readonly name: string;
  private readonly options: CircuitBreakerOptions;

  constructor(name: string, options?: Partial<CircuitBreakerOptions>) {
    this.name = name;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "open") {
      if (Date.now() - this.lastFailureTime >= this.options.recoveryTimeMs) {
        this.state = "half-open";
        this.halfOpenAttempts = 0;
        logger.info({ circuit: this.name }, "Circuit half-open, testing recovery");
      } else {
        throw new CircuitOpenError(this.name);
      }
    }

    if (this.state === "half-open" && this.halfOpenAttempts >= this.options.halfOpenMaxAttempts) {
      this.trip();
      throw new CircuitOpenError(this.name);
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  isOpen(): boolean {
    return this.state === "open";
  }

  getState(): CircuitState {
    return this.state;
  }

  private onSuccess(): void {
    if (this.state === "half-open") {
      logger.info({ circuit: this.name }, "Circuit recovered, closing");
    }
    this.failureCount = 0;
    this.halfOpenAttempts = 0;
    this.state = "closed";
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === "half-open") {
      this.halfOpenAttempts++;
    }

    if (this.failureCount >= this.options.failureThreshold) {
      this.trip();
    }
  }

  private trip(): void {
    this.state = "open";
    logger.warn(
      { circuit: this.name, failures: this.failureCount },
      "Circuit opened — supplier calls suspended"
    );
  }
}

export class CircuitOpenError extends Error {
  constructor(name: string) {
    super(`Circuit breaker '${name}' is open — supplier temporarily unavailable`);
    this.name = "CircuitOpenError";
  }
}
