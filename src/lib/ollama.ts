/**
 * Backward-compatibility re-exports.
 * New code should import from ./llm.js directly.
 */
export {
  OLLAMA_MODEL,
  ollamaIsAvailable,
  ollamaListModels,
  ollamaPullModel,
} from "./llm.js";

// ollamaGenerate is not re-exported — callers should use llmGenerate from ./llm.js
