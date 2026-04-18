/**
 * Shared IC → TecDoc brand alias map.
 *
 * Only entries where the IC CSV name is genuinely different from the TecDoc
 * brand name. Imported by ic-enrich (seeds supplier_brand_rules) and the IC
 * pricing importer (resolves IC brand → TecDoc brand without loose prefix
 * matching, which previously caused wrong prices to be assigned).
 */

export const MANUAL_ALIASES_FULL: Record<string, string> = {
  // Verified different names (IC name → TecDoc name)
  "KAYABA": "KYB",                     // KYB was formerly Kayaba (company renamed)
  "HANS PRIES": "HP",                  // Hans Pries is the full name, HP is the TecDoc brand
  "LEMFOERDER": "LEMFÖRDER",           // Umlaut difference (oe vs ö)
  "REINZ": "VICTOR REINZ",             // Short vs full name (same company)
  "MEAT&DORIA": "MEAT & DORIA",        // Punctuation difference
  "GOETZE": "GOETZE ENGINE",           // Short vs full name
  "LUK1": "LuK",                       // Typo in IC system (LUK1 vs LuK)
  "ATE1": "ATE",                       // Typo in IC system
  "DAYCO1": "DAYCO",                   // Typo in IC system
  "INA1": "INA",                       // Typo in IC system
  "SACHS1": "SACHS",                   // Typo in IC system
  "PIERBURG1": "PIERBURG",             // Typo in IC system
  "SNR": "NTN-SNR",                    // SNR merged with NTN
  "BEHR": "MAHLE",                     // BEHR was acquired by MAHLE
  "BEHR HELLA": "HELLA",               // BEHR HELLA SERVICE → HELLA
  "MAHLE ORIGINAL": "MAHLE",           // Extended name vs short
  "KNECHT": "MAHLE",                   // KNECHT is a MAHLE brand
  "TRW AUTOMOTIVE": "TRW",             // Extended name vs short
  "SAINT-GOBAIN SEKURIT": "SAINT-GOBAIN", // Extended name
  "SAINT GOBAIN": "SAINT-GOBAIN",      // Punctuation difference
  "AUTOFREN SEINSA": "SEINSA",         // Extended name
  "JAPAN PARTS": "JAPANPARTS",         // Space difference
  "LESJOFORS": "LESJÖFORS",            // Umlaut difference (o vs ö)
  "HENGST": "HENGST FILTER",           // Short vs full name
  "MANN": "MANN-FILTER",               // Short vs full name
  "MANN FILTER": "MANN-FILTER",         // Punctuation difference
  "HERTH+BUSS": "HERTH+BUSS ELPARTS",  // Short vs full name
  "HERTH BUSS": "HERTH+BUSS ELPARTS",  // Punctuation difference
  "DT SPARE PARTS": "DT",              // Extended name vs short
  "DIESEL TECHNIC": "DT",              // Different brand name, same company
  "PE AUTOMOTIVE": "PE Automotive",     // Case difference
  "ICER": "ICER BRAKES",               // Short vs full name
  "FTE": "FTE AUTOMOTIVE",             // Short vs full name
  "ZF PARTS": "ZF",                    // Extended name
  "ALL BALLS": "ALL BALLS RACING",     // Short vs full name
  "DELPHI TECHNOLOGIES": "DELPHI",     // Extended name
  "NGK SPARK PLUG": "NGK",             // Extended name
  "VDO": "CONTINENTAL",                // VDO is a Continental brand (verified acquisition)
  "CONTI": "CONTINENTAL",              // Short name for Continental
  "NTK": "NGK",                        // NTK is NGK's sensor brand (verified)
  "GKN": "SPIDAN",                     // GKN driveline → SPIDAN (verified same company)
  "SWF": "SWF VALEO",                  // SWF is part of Valeo group
  "KS": "KOLBENSCHMIDT",               // KS = Kolbenschmidt (verified abbreviation in IC)
  "C.E.I": "CEI",                      // Punctuation difference
  "HC-CARGO": "CARGO",                 // Prefix difference (HC = house code)
  "CORTECO": "CORTECO",                // Direct match
  "LAUBER": "LAUBER",                  // Direct match
  "STEINHOF": "STEINHOF",              // Direct match
  "ORIS": "ORIS",                      // Direct match (towbar manufacturer)
  "AUTLOG": "AUTLOG",                  // Direct match
  "ROMIX": "ROMIX",                    // Direct match
  "OPTIMAL": "OPTIMAL",                // Direct match
  "PRASCO": "PRASCO",                  // Direct match
  "STARK": "STARK",                    // Direct match
  "RIDEX": "RIDEX",                    // Direct match
  "ACKOJA": "ACKOJA",                  // Direct match
  "AUTOMEGA": "AUTOMEGA",              // Direct match
  "TOPRAN": "TOPRAN",                  // Direct match
  "ABAKUS": "ABAKUS",                  // Direct match
  "A.B.S.": "A.B.S.",                  // Direct match (punctuation)
  "EPS": "EPS",                        // Direct match
  "FAST": "FAST",                      // Direct match
  "SWA": "SWag",                       // SWA might be SWAG abbreviation
  "S-TR": "S-TR",                      // Direct match
  "MAXGEAR": "MAXGEAR",                // Direct match
  "KONI": "KONI",                      // Direct match
  "PROCODIS FRANCE": "PROCODIS",       // Extended name
  "LUCAS ELECTRICAL": "LUCAS",         // Extended name
  "QUINTON HAZELL": "QUINTON HAZELL",  // Direct match
  "SRL": "S.R.L.",                     // Punctuation difference
  "WILMINK": "WILMINK GROUP",          // Short vs full
  "BORG AUTOMOTIVE": "BORG",           // Extended name
  "VIGNAL": "VIGNAL",                  // Direct match
  "DT": "DT Spare Parts",              // DT → DT Spare Parts (verified TecDoc name)
  // BOSCH sub-brands in InterCars
  "BOSCH Brakes": "BOSCH",
  "BOSCH Filers": "BOSCH",
  "BOSCH DIESEL": "BOSCH",
  "BOSCH Belts": "BOSCH",
  "BOSCH Wipers": "BOSCH",
  "BOSCH Injection": "BOSCH",
  "BOSCH Electrics": "BOSCH",
  "BOSCH Bateries": "BOSCH",
  "BOSCH-ELEKTRONARZĘDZ": "BOSCH",
  "KIOSK SBC": "BOSCH",
  // VALEO sub-brands
  "VALEO1": "VALEO",
  "VALEO WYCIERACZKI": "VALEO",
  // DELPHI sub-brands
  "DELPHI DIESEL": "DELPHI",
  "DELPHI WTRYSK": "DELPHI",
  // DENSO sub-brands
  "DENSO WTRYSK": "DENSO",
  "DENSO DIESEL": "DENSO",
  // GATES sub-brand
  "GATES OFF HIGHWAY": "GATES",
  // DONALDSON sub-brand
  "DONALDSON OFF": "DONALDSON",
  // TRW sub-brand
  "TRW ENGINE COMPONENT": "TRW",
  // ABE sub-brand
  "ABE PERFORMANCE": "ABE",
  // Continental sub-brand
  "CONTI Industry": "CONTINENTAL CTAM",
  // Numbered IC variants
  "MAGNUM TECHNOLOGY1": "Magnum Technology",
  "TYC1": "TYC",
  "BILSTEIN1": "BILSTEIN",
  "BREMBO-TU": "BREMBO",
  // XXL pack variants
  "CASTROL XXL": "CASTROL",
  "CASTROL MOTO": "CASTROL",
  "CASTROL MOTO XXL": "CASTROL",
  "SHELL XXL": "SHELL",
  "MOBIL XXL": "MOBIL",
  "LIQUI MOLY XXL": "LIQUI MOLY",
  "LIQUI MOLY MOTO": "LIQUI MOLY",
  "FEBI BILSTEIN XXL": "FEBI BILSTEIN",
  // Other
  "HANKOOK AKUMULATORY": "Hankook",
  "BMTS": "MAHLE",
  "FAG Industry": "Schaeffler FAG",
  "TARNÓW": "ZF",
  "4MAX BLACHY": "BLIC",
};

/** Normalize a brand name: uppercase, strip all non-alphanumeric. Matches the DB `normalized_name` column. */
export function normalizeBrand(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Normalize an article number the same way as the DB `normalized_article_no` column. */
export function normalizeArticle(article: string): string {
  return article.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Precomputed normalized alias map: normalized IC brand → normalized TecDoc brand.
 * Use this for O(1) lookup during bulk matching.
 */
export const NORMALIZED_ALIASES: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const [icName, tdName] of Object.entries(MANUAL_ALIASES_FULL)) {
    out[normalizeBrand(icName)] = normalizeBrand(tdName);
  }
  return out;
})();
