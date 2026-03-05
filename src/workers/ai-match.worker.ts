import { Job } from "bullmq";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { llmIsAvailable, llmGenerate, activeLlmProvider, LLM_MODEL } from "../lib/llm.js";

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
 * Rich system context describing the OEMline platform for the LLM.
 * Gives the model enough context to make accurate brand alias decisions.
 */
const OEMLINE_SYSTEM_CONTEXT = `\
You are a specialized agent for the OEMline automotive parts catalog platform.

PLATFORM CONTEXT:
OEMline aggregates automotive parts from multiple suppliers into a unified catalog:
- TecDoc (1M+ products): Main European parts catalog — uses official manufacturer brand names
- InterCars (565K mappings): European parts distributor — uses their own brand naming conventions
- Diederichs (~46K products): Specializes in HELLA body parts
- Van Wezel (~27K products): Body panels, front-end parts, air conditioning components

MATCHING CHALLENGE:
The same parts manufacturer may appear under DIFFERENT names in TecDoc vs InterCars:
- TecDoc uses official ISO/international brand names (e.g., "KAYABA", "VALEO", "NGK")
- InterCars uses their catalog names, often abbreviated or localized
  (e.g., "KYB" for KAYABA, "VALEO" matches, "NGK" matches)
- Subsidiaries, rebrands, and OEM relationships add further complexity

COMMON AUTOMOTIVE BRAND ALIAS PATTERNS you should recognize:
- Abbreviations: KAYABA→KYB, GATES→GAT, VALEO→VAL
- Regional names: HELLA DE = HELLA, BOSAL BE = BOSAL
- Parent/child: BEHR is owned by MAHLE → sometimes listed as "BEHR HELLA"
- OEM cross-brands: TRW is now ZF but old parts still listed as TRW
- Spelling variants: FEBI BILSTEIN = FEBI, BILSTEIN = FEBI BILSTEIN
- Country suffixes: TEXTAR NL, TEXTAR DE → same brand
- Catalogue codes: Some IC entries have codes prefixed (WEZ=Van Wezel, TYC=TYC)

EVIDENCE PROVIDED: Each pair includes the count of SHARED article numbers (exact match
after stripping non-alphanumeric chars). Higher counts = stronger evidence they're the same brand.

YOUR TASK: Determine if each pair refers to the SAME automotive parts manufacturer.
Respond ONLY with a JSON array — no explanation, no markdown, no extra text.`;

/**
 * AI Match worker: discovers missing brand aliases using article number overlap analysis.
 *
 * Strategy:
 *   Phase A (code-only, no AI):
 *     - Find IC manufacturers that share normalized article numbers with unmatched TecDoc brands
 *     - Auto-add pairs with >= autoApplyThreshold overlapping articles (high confidence)
 *
 *   Phase B (LLM confirmation — Kimi K2.5 or Ollama fallback):
 *     - For candidates with 3-19 overlapping articles, ask LLM to confirm equivalence
 *     - LLM has full OEMline context for better brand disambiguation
 *     - Batch size: 50 pairs per call (Kimi has large context window)
 *     - Falls back gracefully if LLM is not available
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

  logger.info(
    { autoApplyThreshold, llmMinThreshold, llmProvider: activeLlmProvider(), llmModel: LLM_MODEL },
    "AI match: starting brand alias discovery"
  );

  const intercarsSupplier = await prisma.supplier.findUnique({
    where: { code: "intercars" },
    select: { id: true },
  });
  if (!intercarsSupplier) {
    logger.warn("AI match: InterCars supplier not found");
    return { candidatesFound: 0, autoAdded: 0, llmAdded: 0, llmSkipped: 0, icMatchTriggered: false };
  }

  // ── Phase A: SQL-based brand alias candidate discovery ──────────────────────
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
       AND NOT EXISTS (
         SELECT 1 FROM supplier_brand_rules sbr
         WHERE sbr.supplier_id = $1
           AND sbr.brand_id = b.id
           AND UPPER(sbr.supplier_brand) = UPPER(im.manufacturer)
       )
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
    const available = await llmIsAvailable();
    if (available) {
      logger.info(
        { provider: activeLlmProvider(), model: LLM_MODEL, candidates: pendingForLlm.length },
        "AI match: starting LLM confirmation"
      );
      const result = await confirmWithLlm(pendingForLlm, intercarsSupplier.id, llmConfidenceThreshold);
      llmAdded   = result.added;
      llmSkipped = result.skipped;
    } else {
      llmSkipped = pendingForLlm.length;
      logger.info(
        { provider: activeLlmProvider() },
        "AI match: LLM not available — confirmation phase skipped"
      );
    }
  }

  await job.updateProgress(90);

  // Trigger ic-match to immediately apply the new aliases
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
  // Kimi has a large context window — use 50 pairs per batch (vs 15 for Ollama)
  const BATCH = activeLlmProvider() === "kimi" ? 50 : 15;
  let added = 0;
  let skipped = 0;

  for (let i = 0; i < candidates.length; i += BATCH) {
    const batch = candidates.slice(i, i + BATCH);

    const pairList = batch
      .map(
        (c, idx) =>
          `${idx + 1}. TecDoc:"${c.tecdoc_brand}" vs IC:"${c.ic_manufacturer}" ` +
          `(${Number(c.matching_articles)} shared article numbers)`
      )
      .join("\n");

    const prompt =
      `Analyze these automotive brand name pairs from the OEMline catalog.\n\n` +
      `Are these pairs the SAME manufacturer?\n\n` +
      pairList +
      `\n\nRespond ONLY with a JSON array:\n` +
      `[{"idx":1,"same":true,"confidence":95,"reason":"abbreviation"},...]`;

    try {
      const raw = await llmGenerate(prompt, {
        system: OEMLINE_SYSTEM_CONTEXT,
        temperature: 0.05,
      });

      // Extract JSON array — LLMs sometimes wrap in markdown
      const jsonMatch = raw.match(/\[[\s\S]*?\]/);
      if (!jsonMatch) {
        logger.warn({ raw: raw.slice(0, 300), provider: activeLlmProvider() }, "AI match: could not parse LLM JSON");
        skipped += batch.length;
        continue;
      }

      const results = JSON.parse(jsonMatch[0]) as Array<{
        idx: number;
        same: boolean;
        confidence: number;
        reason?: string;
      }>;

      for (const r of results) {
        const c = batch[r.idx - 1];
        if (!c) continue;

        if (r.same && r.confidence >= confidenceThreshold) {
          const ok = await upsertBrandAlias(supplierId, c.brand_id, c.ic_manufacturer);
          if (ok) {
            added++;
            logger.info(
              {
                tecdocBrand: c.tecdoc_brand,
                icManufacturer: c.ic_manufacturer,
                confidence: r.confidence,
                reason: r.reason,
                provider: activeLlmProvider(),
              },
              "AI match: LLM confirmed brand alias"
            );
          }
        } else {
          skipped++;
        }
      }
    } catch (err) {
      logger.warn({ err, provider: activeLlmProvider() }, "AI match: LLM batch failed, skipping");
      skipped += batch.length;
    }

    // Rate limit between batches (Kimi allows faster calls)
    if (i + BATCH < candidates.length) {
      const delay = activeLlmProvider() === "kimi" ? 100 : 300;
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  return { added, skipped };
}
