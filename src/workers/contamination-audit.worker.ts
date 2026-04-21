import { Job } from "bullmq";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { NORMALIZED_ALIASES, MANUAL_ALIASES_FULL, normalizeBrand } from "../lib/ic-brand-aliases.js";

export interface ContaminationAuditJobData {
  /** If true, actually null out dirty rows. Default false (audit only). */
  apply?: boolean;
  /**
   * If dryRun finds more than this many dirty rows, skip auto-apply even if
   * apply=true. Safety valve against runaway cleanup from a bad alias edit.
   */
  maxAutoApply?: number;
}

export interface ContaminationAuditResult {
  dirtyRowsFound: number;
  legitRowsKept: number;
  dirtyPairs: number;
  legitPairs: number;
  applied: boolean;
  affected?: number;
  skippedReason?: string;
}

/**
 * Periodic audit + optional auto-cleanup of IC cross-contamination.
 *
 * Runs the same alias-aware logic as POST /admin/products/cleanup-contamination
 * directly against the DB (no HTTP round-trip) and applies the cleanup when
 * it finds fewer than maxAutoApply rows — large spikes are more likely to be
 * a bad alias edit than genuine drift, so we stop and alert instead.
 */
export async function processContaminationAuditJob(
  job: Job<ContaminationAuditJobData>
): Promise<ContaminationAuditResult> {
  const apply = job.data.apply ?? false;
  const maxAutoApply = job.data.maxAutoApply ?? 10_000;
  const start = Date.now();

  // Build legit-alias set from MANUAL_ALIASES_FULL + NORMALIZED_ALIASES + supplier_brand_rules
  const legitPairs = new Set<string>();
  for (const [icName, tdName] of Object.entries(MANUAL_ALIASES_FULL)) {
    legitPairs.add(`${normalizeBrand(tdName)}|${normalizeBrand(icName)}`);
  }
  for (const [icNorm, tdNorm] of Object.entries(NORMALIZED_ALIASES)) {
    legitPairs.add(`${tdNorm}|${icNorm}`);
  }
  try {
    const rules = await prisma.$queryRawUnsafe<Array<{
      brand_name: string; supplier_brand: string;
    }>>(
      `SELECT b.name AS brand_name, sbr.supplier_brand
         FROM supplier_brand_rules sbr
         JOIN suppliers s ON s.id = sbr.supplier_id
         JOIN brands b ON b.id = sbr.brand_id
        WHERE s.code = 'intercars' AND sbr.active = true`
    );
    for (const r of rules) {
      legitPairs.add(`${normalizeBrand(r.brand_name)}|${normalizeBrand(r.supplier_brand)}`);
    }
  } catch (err) {
    logger.warn({ err }, "audit: could not read supplier_brand_rules");
  }

  // Aggregate brand-pair mismatches in a single transaction so SET LOCAL applies.
  const pairs = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL max_parallel_workers_per_gather = 0`);
    await tx.$executeRawUnsafe(`SET LOCAL work_mem = '512MB'`);
    await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '300s'`);
    return tx.$queryRawUnsafe<Array<{
      our_brand: string; ic_brand: string; row_count: bigint;
    }>>(
      `SELECT b.name AS our_brand,
              im.manufacturer AS ic_brand,
              COUNT(*)::bigint AS row_count
         FROM product_maps pm
         JOIN brands b ON b.id = pm.brand_id
         JOIN intercars_mappings im ON im.tow_kod = pm.ic_sku
        WHERE pm.ic_sku IS NOT NULL
          AND pm.status = 'active'
          AND UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g'))
                <> UPPER(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g'))
          AND UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g'))
                NOT LIKE UPPER(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g')) || '%'
          AND UPPER(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g'))
                NOT LIKE UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g')) || '%'
        GROUP BY b.name, im.manufacturer`
    );
  }, { maxWait: 10_000, timeout: 360_000 });

  const dirtyPairs: Array<{ ourBrand: string; icBrand: string; rowCount: number }> = [];
  let dirtyTotal = 0;
  let legitTotal = 0;
  let legitPairCount = 0;

  for (const p of pairs) {
    const key = `${normalizeBrand(p.our_brand)}|${normalizeBrand(p.ic_brand)}`;
    const count = Number(p.row_count);
    if (legitPairs.has(key)) {
      legitTotal += count;
      legitPairCount++;
    } else {
      dirtyPairs.push({ ourBrand: p.our_brand, icBrand: p.ic_brand, rowCount: count });
      dirtyTotal += count;
    }
  }

  logger.info(
    {
      dirtyRows: dirtyTotal,
      dirtyPairs: dirtyPairs.length,
      legitRows: legitTotal,
      legitPairs: legitPairCount,
      apply,
      durationMs: Date.now() - start,
    },
    "Contamination audit complete"
  );

  // Safety valve: refuse to apply if the spike looks abnormal.
  if (apply && dirtyTotal > maxAutoApply) {
    logger.warn(
      { dirtyRows: dirtyTotal, maxAutoApply },
      "Contamination audit: auto-apply refused — dirty-row count exceeds safety ceiling"
    );
    return {
      dirtyRowsFound: dirtyTotal,
      legitRowsKept: legitTotal,
      dirtyPairs: dirtyPairs.length,
      legitPairs: legitPairCount,
      applied: false,
      skippedReason: `dirtyTotal ${dirtyTotal} > maxAutoApply ${maxAutoApply}`,
    };
  }

  if (!apply) {
    return {
      dirtyRowsFound: dirtyTotal,
      legitRowsKept: legitTotal,
      dirtyPairs: dirtyPairs.length,
      legitPairs: legitPairCount,
      applied: false,
    };
  }

  // Apply the cleanup inside a fresh transaction.
  const affected = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL max_parallel_workers_per_gather = 0`);
    await tx.$executeRawUnsafe(`SET LOCAL work_mem = '512MB'`);
    await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '600s'`);
    let total = 0;
    for (const p of dirtyPairs) {
      const res = await tx.$executeRawUnsafe(
        `UPDATE product_maps pm
            SET ic_sku = NULL, price = NULL, ean = NULL, updated_at = NOW()
           FROM brands b, intercars_mappings im
          WHERE pm.brand_id = b.id
            AND im.tow_kod = pm.ic_sku
            AND pm.status = 'active'
            AND UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g'))
              = UPPER(regexp_replace($1, '[^a-zA-Z0-9]', '', 'g'))
            AND UPPER(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g'))
              = UPPER(regexp_replace($2, '[^a-zA-Z0-9]', '', 'g'))`,
        p.ourBrand,
        p.icBrand
      );
      total += Number(res);
    }
    return total;
  }, { maxWait: 10_000, timeout: 900_000 });

  logger.warn(
    { affected, durationMs: Date.now() - start, dirtyPairCount: dirtyPairs.length },
    "Contamination auto-cleanup applied"
  );

  return {
    dirtyRowsFound: dirtyTotal,
    legitRowsKept: legitTotal,
    dirtyPairs: dirtyPairs.length,
    legitPairs: legitPairCount,
    applied: true,
    affected,
  };
}
