import { logger } from "./logger.js";

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://ollama:11434";
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "llama3.2:1b";

/**
 * Check if Ollama is reachable (fast timeout, non-blocking).
 */
export async function ollamaIsAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, {
      signal: AbortSignal.timeout(3_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Generate a text response from Ollama (non-streaming).
 */
export async function ollamaGenerate(
  prompt: string,
  options: { model?: string; system?: string; temperature?: number } = {}
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
      options: {
        temperature: options.temperature ?? 0.05,
        num_predict: 1_000,
      },
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`Ollama generate failed: ${res.status} ${res.statusText}`);
  const data = (await res.json()) as { response: string };
  return data.response.trim();
}

/**
 * Pull a model if not already available (idempotent).
 * Streams progress — waits until fully downloaded.
 */
export async function ollamaPullModel(model: string): Promise<void> {
  logger.info({ model }, "Ollama: ensuring model is available");
  const res = await fetch(`${OLLAMA_URL}/api/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: model, stream: false }),
    signal: AbortSignal.timeout(600_000), // 10 min — first pull can be slow
  });
  if (!res.ok) throw new Error(`Ollama pull failed: ${res.status}`);
  logger.info({ model }, "Ollama: model ready");
}

/**
 * List models currently loaded on the Ollama instance.
 */
export async function ollamaListModels(): Promise<string[]> {
  const res = await fetch(`${OLLAMA_URL}/api/tags`, {
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { models?: Array<{ name: string }> };
  return (data.models ?? []).map((m) => m.name);
}
