export interface FAOFertilizerPrice {
  name: string;
  code: string;
  price: number;
  unit: string;
  date: string;
  source: string;
  aliases: string[];
}

const FERTILIZERS: { name: string; code: string; aliases: string[] }[] = [
  {
    name: "Urea",
    code: "3102",
    aliases: ["urea", "nitrogeno", "nitrogenado", "nitrogen"],
  },
  {
    name: "DAP",
    code: "3105",
    aliases: ["dap", "diamonio", "diamonium", "fosfato diamonico", "fosfato diamónico", "18-46", "18 46"],
  },
  {
    name: "MAP",
    code: "3100",
    aliases: ["map", "monoamonio", "monoamonico", "monoamónico", "fosfato monoamonico", "fosfato monoamónico", "11-52", "11 52"],
  },
  {
    name: "KCl",
    code: "3104",
    aliases: ["kcl", "cloruro de potasio", "muriate", "muriato", "potash", "potasio cloruro"],
  },
];

// Embedded reference prices — Q1 2025, approximate FOB international market
// Sources: World Bank Pink Sheet Jan 2025 + FAO FAOSTAT PP dataset 2024
const EMBEDDED_PRICES: FAOFertilizerPrice[] = [
  {
    name: "Urea",
    code: "3102",
    price: 340,
    unit: "USD/ton",
    date: "2025-01",
    source: "embedded",
    aliases: FERTILIZERS[0].aliases,
  },
  {
    name: "DAP",
    code: "3105",
    price: 620,
    unit: "USD/ton",
    date: "2025-01",
    source: "embedded",
    aliases: FERTILIZERS[1].aliases,
  },
  {
    name: "MAP",
    code: "3100",
    price: 590,
    unit: "USD/ton",
    date: "2025-01",
    source: "embedded",
    aliases: FERTILIZERS[2].aliases,
  },
  {
    name: "KCl",
    code: "3104",
    price: 310,
    unit: "USD/ton",
    date: "2025-01",
    source: "embedded",
    aliases: FERTILIZERS[3].aliases,
  },
];

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
let cache: { prices: FAOFertilizerPrice[]; ts: number } | null = null;

export async function getFAOFertilizerPrices(): Promise<FAOFertilizerPrice[]> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) return cache.prices;

  try {
    const itemCodes = FERTILIZERS.map((f) => f.code).join(",");
    const year = new Date().getFullYear() - 1;
    const url = `https://fenixservices.fao.org/faostat/api/v1/en/data/PP?area=5000&element=5531&item=${itemCodes}&year=${year}&type=datasets`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const json = await res.json();
      const data: any[] = json?.data ?? [];
      if (data.length > 0) {
        const prices: FAOFertilizerPrice[] = data
          .map((row) => {
            const code = String(row["Item Code"] ?? row.ItemCode ?? "");
            const fert = FERTILIZERS.find((f) => f.code === code);
            if (!fert || !row.Value) return null;
            return {
              name: fert.name,
              code,
              price: Number(row.Value),
              unit: "USD/ton",
              date: `${row.Year}-12`,
              source: "FAOSTAT",
              aliases: fert.aliases,
            } as FAOFertilizerPrice;
          })
          .filter((p): p is FAOFertilizerPrice => p !== null && p.price > 0);
        if (prices.length >= 2) {
          cache = { prices, ts: Date.now() };
          return prices;
        }
      }
    }
  } catch (e) {
    console.warn(
      "[fao-fertilizer] FAOSTAT API unavailable, using embedded data:",
      e instanceof Error ? e.message : e,
    );
  }

  cache = { prices: EMBEDDED_PRICES, ts: Date.now() };
  return EMBEDDED_PRICES;
}

const ACCENT: Record<string, string> = { á: "a", é: "e", í: "i", ó: "o", ú: "u" };
function normText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[áéíóú]/g, (c) => ACCENT[c] ?? c);
}

export function matchFertilizerByName(concept: string, prices: FAOFertilizerPrice[]): FAOFertilizerPrice | null {
  const c = normText(concept);
  for (const price of prices) {
    if (price.aliases.some((alias) => c.includes(normText(alias)))) return price;
    if (c.includes(normText(price.name))) return price;
  }
  return null;
}
