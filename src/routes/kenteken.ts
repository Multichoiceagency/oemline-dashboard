import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";

const RDW_BASE = "https://opendata.rdw.nl/resource";
// m9d7-ebf2: Gekentekende_voertuigen — kerngegevens (merk, handelsbenaming, etc.)
// 8ys7-d773: Brandstof — fuel type, emission class, engine displacement
const DATASET_CORE = "m9d7-ebf2";
const DATASET_FUEL = "8ys7-d773";

function normalizePlate(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

interface RdwCore {
  kenteken: string;
  voertuigsoort: string;
  merk: string;
  handelsbenaming: string;
  inrichting?: string;
  aantal_zitplaatsen?: string;
  datum_eerste_toelating?: string;
  datum_tenaamstelling?: string;
  massa_ledig_voertuig?: string;
  massa_rijklaar?: string;
  toegestane_maximum_massa_voertuig?: string;
  aantal_cilinders?: string;
  cilinderinhoud?: string;
  zuinigheidsclassificatie?: string;
  wam_verzekerd?: string;
  uitvoering?: string;
  variant?: string;
  type?: string;
  typegoedkeuringsnummer?: string;
  europese_voertuigcategorie?: string;
  aantal_wielen?: string;
  wielbasis?: string;
  lengte?: string;
  breedte?: string;
  hoogte_voertuig?: string;
  catalogusprijs?: string;
  vermogen_massarijklaar?: string;
}

interface RdwFuel {
  kenteken: string;
  brandstof_omschrijving?: string;
  brandstofverbruik_gecombineerd?: string;
  co2_uitstoot_gecombineerd?: string;
  emissiecode_omschrijving?: string;
  milieuklasse_eg_goedkeuring_licht?: string;
  uitlaatemissieniveau?: string;
  nettomaximumvermogen?: string;
  toerental_geluidsniveau?: string;
}

async function fetchRdw<T>(dataset: string, plate: string): Promise<T[]> {
  const url = `${RDW_BASE}/${dataset}.json?kenteken=${encodeURIComponent(plate)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`RDW ${dataset} HTTP ${res.status}`);
    return (await res.json()) as T[];
  } finally {
    clearTimeout(timer);
  }
}

const lookupSchema = z.object({
  plate: z.string().min(4).max(10),
});

export async function kentekenRoutes(app: FastifyInstance) {
  /**
   * Lookup a Dutch license plate against RDW open data.
   * Returns vehicle info + (best-effort) matching TecDoc brand in our DB.
   *
   * No auth needed for RDW — these are public datasets.
   */
  app.get("/kenteken/:plate", async (request, reply) => {
    const { plate: rawPlate } = lookupSchema.parse(request.params);
    const plate = normalizePlate(rawPlate);
    if (plate.length < 4) return reply.code(400).send({ error: "Plate too short" });

    try {
      const [core, fuel] = await Promise.all([
        fetchRdw<RdwCore>(DATASET_CORE, plate),
        fetchRdw<RdwFuel>(DATASET_FUEL, plate),
      ]);

      if (core.length === 0) {
        return reply.code(404).send({ plate, error: "Kenteken niet gevonden in RDW" });
      }

      const c = core[0];
      const f = fuel[0];

      // Best-effort brand match: the RDW "merk" maps to our TecDoc brand table
      // for exact or prefix-normalized name. If no match, brand stays null —
      // storefront still gets general vehicle info to narrow the search.
      let brandMatch: { id: number; name: string; code: string; tecdocId: number | null } | null = null;
      if (c.merk) {
        const normMerk = c.merk.toUpperCase().replace(/[^A-Z0-9]/g, "");
        const brands = await prisma.$queryRawUnsafe<Array<{
          id: number; name: string; code: string; tecdoc_id: number | null;
        }>>(
          `SELECT id, name, code, tecdoc_id
             FROM brands
            WHERE normalized_name = $1
               OR normalized_name LIKE $1 || '%'
               OR $1 LIKE normalized_name || '%'
            ORDER BY LENGTH(normalized_name) ASC
            LIMIT 1`,
          normMerk
        );
        if (brands[0]) {
          brandMatch = {
            id: brands[0].id,
            name: brands[0].name,
            code: brands[0].code,
            tecdocId: brands[0].tecdoc_id,
          };
        }
      }

      // Year from datum_eerste_toelating (format: YYYYMMDD).
      let year: number | null = null;
      if (c.datum_eerste_toelating && c.datum_eerste_toelating.length >= 4) {
        const y = parseInt(c.datum_eerste_toelating.slice(0, 4), 10);
        if (Number.isFinite(y) && y > 1900 && y < 2100) year = y;
      }

      return {
        plate,
        vehicle: {
          merk: c.merk,
          handelsbenaming: c.handelsbenaming,
          voertuigsoort: c.voertuigsoort,
          inrichting: c.inrichting ?? null,
          variant: c.variant ?? null,
          uitvoering: c.uitvoering ?? null,
          year,
          dateFirstRegistration: c.datum_eerste_toelating ?? null,
          cilinderinhoud: c.cilinderinhoud ? Number(c.cilinderinhoud) : null,
          aantalCilinders: c.aantal_cilinders ? Number(c.aantal_cilinders) : null,
          massa: c.massa_ledig_voertuig ? Number(c.massa_ledig_voertuig) : null,
          europeseCategorie: c.europese_voertuigcategorie ?? null,
        },
        fuel: f
          ? {
              brandstof: f.brandstof_omschrijving ?? null,
              verbruik: f.brandstofverbruik_gecombineerd ? Number(f.brandstofverbruik_gecombineerd) : null,
              co2: f.co2_uitstoot_gecombineerd ? Number(f.co2_uitstoot_gecombineerd) : null,
              emissiecode: f.emissiecode_omschrijving ?? null,
              euroklasse: f.milieuklasse_eg_goedkeuring_licht ?? null,
              nettoVermogen: f.nettomaximumvermogen ? Number(f.nettomaximumvermogen) : null,
            }
          : null,
        brandMatch,
        searchHint: brandMatch
          ? { brand: brandMatch.code, year }
          : { brand: null, year },
      };
    } catch (err) {
      logger.warn({ err, plate }, "RDW kenteken lookup failed");
      return reply.code(502).send({ plate, error: "RDW lookup mislukt", detail: String(err) });
    }
  });
}
