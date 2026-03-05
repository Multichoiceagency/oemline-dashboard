import { logger } from "./logger.js";

/**
 * LLM abstraction layer — routes to Kimi (Moonshot API) or Ollama.
 *
 * Provider priority:
 *   1. LLM_PROVIDER=kimi  → always use Kimi (requires KIMI_API_KEY)
 *   2. LLM_PROVIDER=ollama → always use Ollama
 *   3. auto (default)      → Kimi if KIMI_API_KEY set, else Ollama
 *
 * Environment variables:
 *   KIMI_API_KEY       Moonshot platform API key (https://platform.moonshot.cn)
 *   KIMI_MODEL         Model name (default: moonshot-v1-8k)
 *   KIMI_API_URL       API base URL (default: https://api.moonshot.cn/v1)
 *   LLM_PROVIDER       "kimi" | "ollama" | "auto" (default: auto)
 *   OLLAMA_URL         Ollama base URL (default: http://ollama:11434)
 *   OLLAMA_MODEL       Ollama model (default: llama3.2:1b)
 */

const KIMI_API_KEY  = process.env.KIMI_API_KEY ?? "";
const KIMI_API_URL  = process.env.KIMI_API_URL ?? "https://api.moonshot.cn/v1";
export const KIMI_MODEL = process.env.KIMI_MODEL ?? "moonshot-v1-8k";

const OLLAMA_URL    = process.env.OLLAMA_URL   ?? "http://ollama:11434";
// Default to kimi-k2.5 — available on Ollama hub (ollama pull kimi-k2.5)
// Falls back to llama3.2:1b if overridden via OLLAMA_MODEL env var
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "kimi-k2.5";

const LLM_PROVIDER  = process.env.LLM_PROVIDER ?? "auto";

/** Which provider is actually active right now */
export function activeLlmProvider(): "kimi" | "ollama" | "none" {
  if (LLM_PROVIDER === "kimi")  return KIMI_API_KEY ? "kimi" : "none";
  if (LLM_PROVIDER === "ollama") return "ollama";
  return KIMI_API_KEY ? "kimi" : "ollama"; // auto
}

export const LLM_MODEL = activeLlmProvider() === "kimi" ? KIMI_MODEL : OLLAMA_MODEL;

// ─── Kimi (Moonshot OpenAI-compatible) ────────────────────────────────────────

async function kimiIsAvailable(): Promise<boolean> {
  if (!KIMI_API_KEY) return false;
  try {
    const res = await fetch(`${KIMI_API_URL}/models`, {
      headers: { Authorization: `Bearer ${KIMI_API_KEY}` },
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function kimiGenerate(
  prompt: string,
  options: { system?: string; temperature?: number; model?: string }
): Promise<string> {
  const model = options.model ?? KIMI_MODEL;
  const messages: Array<{ role: string; content: string }> = [];

  if (options.system) {
    messages.push({ role: "system", content: options.system });
  }
  messages.push({ role: "user", content: prompt });

  const res = await fetch(`${KIMI_API_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${KIMI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: options.temperature ?? 0.05,
      max_tokens: 2_000,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Kimi API error ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

// ─── Ollama ───────────────────────────────────────────────────────────────────

async function ollamaIsAvailableInternal(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, {
      signal: AbortSignal.timeout(3_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function ollamaGenerate(
  prompt: string,
  options: { system?: string; temperature?: number; model?: string }
): Promise<string> {
  const model = options.model ?? OLLAMA_MODEL;
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      system: options.system,
      stream: false,
      options: { temperature: options.temperature ?? 0.05, num_predict: 2_000 },
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`Ollama generate failed: ${res.status} ${res.statusText}`);
  const data = (await res.json()) as { response: string };
  return data.response.trim();
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Returns true if the configured LLM provider is reachable */
export async function llmIsAvailable(): Promise<boolean> {
  const provider = activeLlmProvider();
  if (provider === "kimi")   return kimiIsAvailable();
  if (provider === "ollama") return ollamaIsAvailableInternal();
  return false;
}

/** Generate text from the active LLM provider */
export async function llmGenerate(
  prompt: string,
  options: { system?: string; temperature?: number; model?: string } = {}
): Promise<string> {
  const provider = activeLlmProvider();
  if (provider === "kimi") {
    return kimiGenerate(prompt, options);
  }
  return ollamaGenerate(prompt, options);
}

/** Status info for the /jobs/llm-status endpoint */
export async function llmStatus(): Promise<{
  provider: string;
  model: string;
  available: boolean;
  kimiConfigured: boolean;
  ollamaUrl: string;
}> {
  const provider = activeLlmProvider();
  const available = await llmIsAvailable();
  return {
    provider,
    model: LLM_MODEL,
    available,
    kimiConfigured: !!KIMI_API_KEY,
    ollamaUrl: OLLAMA_URL,
  };
}

// ─── Ollama-compat exports (used by existing routes) ──────────────────────────
// These keep backward compatibility with existing /jobs/ai-match/ollama-status route.

export async function ollamaIsAvailable(): Promise<boolean> {
  return ollamaIsAvailableInternal();
}

export async function ollamaListModels(): Promise<string[]> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    return (data.models ?? []).map((m) => m.name);
  } catch {
    return [];
  }
}

export async function ollamaPullModel(model: string): Promise<void> {
  logger.info({ model }, "Ollama: ensuring model is available");
  const res = await fetch(`${OLLAMA_URL}/api/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: model, stream: false }),
    signal: AbortSignal.timeout(600_000),
  });
  if (!res.ok) throw new Error(`Ollama pull failed: ${res.status}`);
  logger.info({ model }, "Ollama: model ready");
}
