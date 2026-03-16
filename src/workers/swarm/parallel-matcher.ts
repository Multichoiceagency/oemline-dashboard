import { prisma, refreshIcUniqueArticles } from "../../lib/prisma.js";
import { logger } from "../../lib/logger.js";

interface MatchResult {
  product_id: number;
  tow_kod: string;
  ic_ean: string | null;
  ic_weight: number | null;
}

interface PhaseResult {
  phase: string;
  matches: number;
  durationMs: number;
}

const BATCH_UPDATE_SIZE = 500;

async function updateMatches(matches: MatchResult[], phaseName: string): Promise<number> {
  if (matches.length === 0) return 0;

  let updated = 0;
  for (let i = 0; i < matches.length; i += BATCH_UPDATE_SIZE) {
    const batch = matches.slice(i, i + BATCH_UPDATE_SIZE);
    const cases = batch.map((m) => `WHEN ${m.product_id} THEN '${m.tow_kod.replace(/'/g, "''")}'`).join(" ");
    const eanCases = batch.map((m) => `WHEN ${m.product_id} THEN ${m.ic_ean ? `'${m.ic_ean.replace(/'/g, "''")}'` : "NULL"}`).join(" ");
    const weightCases = batch.map((m) => `WHEN ${m.product_id} THEN ${m.ic_weight ?? "NULL"}`).join(" ");
    const ids = batch.map((m) => m.product_id).join(",");

    await prisma.$executeRawUnsafe(
      `UPDATE product_maps SET
        ic_sku = CASE id ${cases} END,
        ic_matched_at = NOW(),
        ean = CASE id ${eanCases} ELSE ean END,
        weight = CASE id ${weightCases} ELSE weight END
      WHERE id IN (${ids}) AND ic_sku IS NULL`
    );
    updated += batch.length;
  }

  logger.info({ phase: phaseName, matches: updated }, `Phase ${phaseName} matches stored`);
  return updated;
}

export async function runPhase0(): Promise<PhaseResult> {
  const start = Date.now();
  const matches = await prisma.$queryRawUnsafe<MatchResult[]>(
    `SELECT DISTINCT ON (pm.id)
      pm.id as product_id,
      im.tow_kod,
      im.ean as ic_ean,
      im.weight as ic_weight
    FROM product_maps pm
    JOIN brands b ON b.id = pm.brand_id
    JOIN supplier_brand_rules sbr ON sbr.brand_id = b.id AND sbr.active = true
    JOIN intercars_mappings im ON
      im.normalized_article_number = pm.normalized_article_no
      AND UPPER(im.manufacturer) = sbr.supplier_brand
    WHERE pm.status = 'active' AND pm.ic_sku IS NULL
    ORDER BY pm.id`
  );
  await updateMatches(matches, "0-aliases");
  return { phase: "0-aliases", matches: matches.length, durationMs: Date.now() - start };
}

export async function runPhase1A(): Promise<PhaseResult> {
  const start = Date.now();
  const matches = await prisma.$queryRawUnsafe<MatchResult[]>(
    `SELECT DISTINCT ON (pm.id)
      pm.id as product_id,
      im.tow_kod,
      im.ean as ic_ean,
      im.weight as ic_weight
    FROM product_maps pm
    JOIN brands b ON b.id = pm.brand_id
    JOIN intercars_mappings im ON
      im.normalized_article_number = pm.normalized_article_no
      AND (
        UPPER(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g')) = UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g'))
        OR (
          LENGTH(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g')) >= 2
          AND UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g'))
            LIKE UPPER(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g')) || '%'
        )
        OR (
          LENGTH(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g')) >= 2
          AND UPPER(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g'))
            LIKE UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g')) || '%'
        )
      )
    WHERE pm.status = 'active' AND pm.ic_sku IS NULL
    ORDER BY pm.id`
  );
  await updateMatches(matches, "1A-brand");
  return { phase: "1A-brand", matches: matches.length, durationMs: Date.now() - start };
}

export async function runPhase1B(): Promise<PhaseResult> {
  const start = Date.now();
  const matches = await prisma.$queryRawUnsafe<MatchResult[]>(
    `SELECT DISTINCT ON (pm.id)
      pm.id as product_id,
      im.tow_kod,
      im.ean as ic_ean,
      im.weight as ic_weight
    FROM product_maps pm
    JOIN intercars_mappings im ON
      pm.ean IS NOT NULL
      AND im.ean IS NOT NULL
      AND LENGTH(pm.ean) >= 8
      AND UPPER(TRIM(pm.ean)) = UPPER(TRIM(im.ean))
    WHERE pm.status = 'active' AND pm.ic_sku IS NULL
    ORDER BY pm.id`
  );
  await updateMatches(matches, "1B-ean");
  return { phase: "1B-ean", matches: matches.length, durationMs: Date.now() - start };
}

export async function runPhase1C(): Promise<PhaseResult> {
  const start = Date.now();
  const matches = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL work_mem = '256MB'`);
    return tx.$queryRawUnsafe<MatchResult[]>(
      `SELECT DISTINCT ON (pm.id)
        pm.id as product_id,
        im.tow_kod,
        im.ean as ic_ean,
        im.weight as ic_weight
      FROM product_maps pm
      JOIN intercars_mappings im ON
        pm.tecdoc_id IS NOT NULL
        AND im.tecdoc_prod IS NOT NULL
        AND CAST(pm.tecdoc_id AS TEXT) = CAST(im.tecdoc_prod AS TEXT)
      WHERE pm.status = 'active' AND pm.ic_sku IS NULL
      ORDER BY pm.id`
    );
  }, { timeout: 120_000 });
  await updateMatches(matches, "1C-tecdoc");
  return { phase: "1C-tecdoc", matches: matches.length, durationMs: Date.now() - start };
}

export async function runPhase1D(): Promise<PhaseResult> {
  const start = Date.now();
  const matches = await prisma.$queryRawUnsafe<MatchResult[]>(
    `SELECT
      pm.id AS product_id,
      ua.tow_kod,
      ua.ic_ean,
      ua.ic_weight
    FROM product_maps pm
    JOIN ic_unique_articles ua ON ua.norm_article = pm.normalized_article_no
    WHERE pm.status = 'active' AND pm.ic_sku IS NULL
    ORDER BY pm.id`
  );
  await updateMatches(matches, "1D-unique");
  return { phase: "1D-unique", matches: matches.length, durationMs: Date.now() - start };
}

/**
 * Run all matching phases in parallel swarm pattern.
 * Phase 0 runs first (uses supplier_brand_rules), then 1A-1D run in parallel.
 * Each phase only updates products that don't have ic_sku yet.
 */
export async function runParallelMatching(): Promise<{
  totalMatches: number;
  totalDurationMs: number;
  phases: PhaseResult[];
}> {
  const startTime = Date.now();
  
  logger.info("Starting parallel IC matching swarm");

  // Refresh materialized view first (needed for Phase 1D)
  await refreshIcUniqueArticles();

  // Phase 0 first (uses supplier_brand_rules - most reliable matches)
  const phase0Result = await runPhase0();

  // Run remaining phases in parallel - they're independent and use row-level locking
  const [phase1A, phase1B, phase1C, phase1D] = await Promise.all([
    runPhase1A(),
    runPhase1B(),
    runPhase1C(),
    runPhase1D(),
  ]);

  const phases = [phase0Result, phase1A, phase1B, phase1C, phase1D];
  const totalMatches = phases.reduce((sum, p) => sum + p.matches, 0);
  const totalDurationMs = Date.now() - startTime;

  logger.info({
    totalMatches,
    totalDurationMs,
    phases: phases.map(p => ({ phase: p.phase, matches: p.matches, ms: p.durationMs })),
  }, "Parallel IC matching completed");

  return { totalMatches, totalDurationMs, phases };
}
