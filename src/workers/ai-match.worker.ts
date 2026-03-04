import { Job } from "bullmq";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { ollamaIsAvailable, ollamaGenerate, OLLAMA_MODEL } from "../lib/ollama.js";

export interface AiMatchJobData {
  /** Min matching article numbers to auto-add alias without LLM review (default: 20) */
  autoApplyThreshold?: number;
  /** Min matching article numbers to send to LLM for confirmation (default: 3) */
  llmMinThreshold?: number;
  /** LLM confidence score (0-100) required to auto-add a suggestion (default: 85) */
  llmConfidenceThreshold?: number;
}

export interface AiMatchResult {
  candidatesFound: number;
  autoAdded: number;
  llmAdded: number;
  llmSkipped: number;
  icMatchTriggered: boolean;
}

/**
 * AI Match worker: discovers missing brand aliases using article number overlap analysis.
 *
 * Strategy:
 *   Phase A (code-only, no AI):
 *     - Find IC manufacturers that share normalized article numbers with unmatched TecDoc brands
 *     - Auto-add pairs with >= autoApplyThreshold overlapping articles (high confidence)
 *
 *   Phase B (Ollama LLM, optional):
 *     - For candidates with 3-19 overlapping articles, ask Ollama to confirm equivalence
 *     - e.g. "Is 'KAYABA' the same auto parts brand as 'KYB'?" → YES → add alias
 *     - Falls back gracefully if Ollama is not available
 *
 * Result: new entries in supplier_brand_rules → picked up by ic-match Phase 0
 *         → significantly increases IC-linked product count
 */
export async function processAiMatchJob(job: Job<AiMatchJobData>): Promise<AiMatchResult> {
  const {
    autoApplyThreshold = 20,
    llmMinThreshold = 3,
    llmConfidenceThreshold = 85,
  } = job.data ?? {};

  logger.info({ autoApplyThreshold, llmMinThreshold }, "AI match: starting brand alias discovery");

  // Get intercars supplier ID
  const intercarsSupplier = await prisma.supplier.findUnique({
    where: { code: "intercars" },
    select: { id: true },
  });
  if (!intercarsSupplier) {
    logger.warn("AI match: InterCars supplier not found");
    return { candidatesFound: 0, autoAdded: 0, llmAdded: 0, llmSkipped: 0, icMatchTriggered: false };
  }

  // ── Phase A: SQL-based brand alias candidate discovery ──────────────────────
  // For every unmatched product_map, find IC manufacturer entries sharing the same
  // normalized article number. Group by TecDoc brand × IC manufacturer.
  type Candidate = {
    tecdoc_brand: string;
    brand_id: number;
    ic_manufacturer: string;
    matching_articles: bigint | number;
  };

  const candidates = await prisma.$queryRawUnsafe<Candidate[]>(
    `SELECT
       b.name          AS tecdoc_brand,
       b.id            AS brand_id,
       im.manufacturer AS ic_manufacturer,
       COUNT(*)        AS matching_articles
     FROM product_maps pm
     JOIN brands b ON b.id = pm.brand_id
     JOIN intercars_mappings im
       ON UPPER(regexp_replace(im.article_number, '[^a-zA-Z0-9]', '', 'g'))
        = UPPER(regexp_replace(pm.article_no,     '[^a-zA-Z0-9]', '', 'g'))
     WHERE pm.ic_sku IS NULL
       AND pm.status = 'active'
       AND pm.article_no IS NOT NULL
       AND pm.article_no != ''
       -- Exclude pairs already in supplier_brand_rules
       AND NOT EXISTS (
         SELECT 1 FROM supplier_brand_rules sbr
         WHERE sbr.supplier_id = $1
           AND sbr.brand_id = b.id
           AND UPPER(sbr.supplier_brand) = UPPER(im.manufacturer)
       )
       -- Exclude pairs where brand and IC manufacturer are already the same
       AND UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g'))
         != UPPER(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g'))
     GROUP BY b.name, b.id, im.manufacturer
     HAVING COUNT(*) >= $2
     ORDER BY matching_articles DESC
     LIMIT 200`,
    intercarsSupplier.id,
    llmMinThreshold
  );

  const candidatesFound = candidates.length;
  logger.info({ candidatesFound }, "AI match: brand alias candidates identified");
  await job.updateProgress(20);

  let autoAdded = 0;
  const pendingForLlm: Candidate[] = [];

  for (const c of candidates) {
    const count = Number(c.matching_articles);
    if (count >= autoApplyThreshold) {
      // High confidence — add immediately
      const added = await upsertBrandAlias(intercarsSupplier.id, c.brand_id, c.ic_manufacturer);
      if (added) {
        autoAdded++;
        logger.info(
          { tecdocBrand: c.tecdoc_brand, icManufacturer: c.ic_manufacturer, articles: count },
          "AI match: auto-added brand alias"
        );
      }
    } else {
      pendingForLlm.push(c);
    }
  }

  logger.info({ autoAdded, pendingForLlm: pendingForLlm.length }, "AI match Phase A complete");
  await job.updateProgress(50);

  // ── Phase B: LLM confirmation for medium-confidence candidates ──────────────
  let llmAdded = 0;
  let llmSkipped = 0;

  if (pendingForLlm.length > 0) {
    const available = await ollamaIsAvailable();
    if (available) {
      logger.info({ model: OLLAMA_MODEL, candidates: pendingForLlm.length }, "AI match: starting LLM confirmation");
      const result = await confirmWithLlm(
        pendingForLlm,
        intercarsSupplier.id,
        llmConfidenceThreshold
      );
      llmAdded = result.added;
      llmSkipped = result.skipped;
    } else {
      llmSkipped = pendingForLlm.length;
      logger.info("AI match: Ollama not available — LLM phase skipped");
    }
  }

  await job.updateProgress(90);

  // Trigger ic-match to immediately use the new aliases
  let icMatchTriggered = false;
  if (autoAdded + llmAdded > 0) {
    const { icMatchQueue } = await import("./queues.js");
    await icMatchQueue.add(
      "ic-match-after-ai",
      { supplierCode: "intercars" },
      { priority: 1, jobId: "ic-match-after-ai-dedup" }
    );
    icMatchTriggered = true;
    logger.info({ newAliases: autoAdded + llmAdded }, "AI match: triggered ic-match with new aliases");
  }

  await job.updateProgress(100);
  logger.info({ candidatesFound, autoAdded, llmAdded, llmSkipped, icMatchTriggered }, "AI match complete");
  return { candidatesFound, autoAdded, llmAdded, llmSkipped, icMatchTriggered };
}

async function upsertBrandAlias(supplierId: number, brandId: number, icManufacturer: string): Promise<boolean> {
  try {
    const result = await prisma.$executeRawUnsafe(
      `INSERT INTO supplier_brand_rules (supplier_id, brand_id, supplier_brand, active, created_at, updated_at)
       VALUES ($1, $2, $3, true, NOW(), NOW())
       ON CONFLICT (supplier_id, supplier_brand) DO NOTHING`,
      supplierId,
      brandId,
      icManufacturer.toUpperCase()
    );
    return result > 0;
  } catch (err) {
    logger.warn({ err, icManufacturer }, "AI match: failed to insert brand alias");
    return false;
  }
}

async function confirmWithLlm(
  candidates: Array<{ tecdoc_brand: string; brand_id: number; ic_manufacturer: string; matching_articles: bigint | number }>,
  supplierId: number,
  confidenceThreshold: number
): Promise<{ added: number; skipped: number }> {
  const BATCH = 15; // LLM handles 15 pairs per call — keeps prompt small
  let added = 0;
  let skipped = 0;

  for (let i = 0; i < candidates.length; i += BATCH) {
    const batch = candidates.slice(i, i + BATCH);

    const pairList = batch
      .map((c, idx) => `${idx + 1}. TecDoc:"${c.tecdoc_brand}" vs IC:"${c.ic_manufacturer}" (${Number(c.matching_articles)} shared article numbers)`)
      .join("\n");

    const prompt =
      `You are an automotive parts catalog expert. Are these brand name pairs referring to the same manufacturer?\n\n` +
      pairList +
      `\n\nRespond ONLY with a JSON array (no explanation):\n[{"idx":1,"same":true,"confidence":95},...]`;

    try {
      const raw = await ollamaGenerate(prompt, {
        system: "You are an automotive parts expert. Respond only with valid JSON, no extra text.",
        temperature: 0.05,
      });

      // Extract JSON array from response (LLMs sometimes add surrounding text)
      const jsonMatch = raw.match(/\[[\s\S]*?\]/);
      if (!jsonMatch) {
        logger.warn({ raw: raw.slice(0, 200) }, "AI match: could not parse LLM JSON");
        skipped += batch.length;
        continue;
      }

      const results = JSON.parse(jsonMatch[0]) as Array<{
        idx: number;
        same: boolean;
        confidence: number;
      }>;

      for (const r of results) {
        const c = batch[r.idx - 1];
        if (!c) continue;

        if (r.same && r.confidence >= confidenceThreshold) {
          const ok = await upsertBrandAlias(supplierId, c.brand_id, c.ic_manufacturer);
          if (ok) {
            added++;
            logger.info(
              { tecdocBrand: c.tecdoc_brand, icManufacturer: c.ic_manufacturer, confidence: r.confidence },
              "AI match: LLM confirmed brand alias"
            );
          }
        } else {
          skipped++;
        }
      }
    } catch (err) {
      logger.warn({ err }, "AI match: LLM batch failed, skipping");
      skipped += batch.length;
    }

    // Gentle rate limit between LLM calls
    if (i + BATCH < candidates.length) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  return { added, skipped };
}
