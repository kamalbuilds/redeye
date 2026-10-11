import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";

const RESEARCH = path.join(process.cwd(), "content", "proof");
export const PROOF_FILES = {
  tsv: "web/content/proof/tsla-earnings-2026-07-23.tsv",
  md: "web/content/proof/EARNINGS-SPIKE.md",
};

export interface Pt { t: number; v: number }
export interface Gap { t: number; ondo: number | null; bstocks: number | null; real: number }

export interface Proof {
  ondo: Pt[];
  bstocks: Pt[];
  real: { t: number; v: number; open: boolean }[];
  gaps: Gap[]; // hours where the real price is a same-hour reading (the open hour is excluded)
  maxGapPct: number;
  worst: { t: number; symbol: string; pct: number };
  first: { ondo: Pt; ondoAfter: Pt; bstocks: Pt; bstocksAfter: Pt };
}

function utc(date: string, hhmm: string): number {
  return Date.parse(`${date}T${hhmm}:00Z`);
}

function readTsv(): { ondo: Pt[]; bstocks: Pt[] } {
  const ondo: Pt[] = [];
  const bstocks: Pt[] = [];
  for (const line of readFileSync(path.join(RESEARCH, "tsla-earnings-2026-07-23.tsv"), "utf8").split("\n").filter(Boolean)) {
    const [sym, iso, price] = line.split("\t");
    const pt = { t: Date.parse(iso), v: Number(price) };
    if (!Number.isFinite(pt.t) || !Number.isFinite(pt.v)) throw new Error(`bad row in tsv: ${line}`);
    if (sym === "TSLAon") ondo.push(pt);
    else if (sym === "TSLAB") bstocks.push(pt);
    else throw new Error(`unknown symbol ${sym} in tsv`);
  }
  return { ondo, bstocks };
}

/** Table rows of EARNINGS-SPIKE.md: `| 2026-07-22 20:00 (after-hours) | 364.51 | 364.65 | 364.76 | -0.03% |`. */
function readReal(): Proof["real"] {
  const out: Proof["real"] = [];
  for (const line of readFileSync(path.join(RESEARCH, "EARNINGS-SPIKE.md"), "utf8").split("\n")) {
    const cells = line.split("|").map((c) => c.trim());
    const m = /^(\d{4}-\d{2}-\d{2}) (.+)$/.exec(cells[1] ?? "");
    if (!m || !cells[2]) continue;
    const times = m[2].match(/\d{2}:\d{2}/g) ?? [];
    const values = cells[2].split("/").map((s) => Number(s.trim()));
    if (times.length === 0 || values.length !== times.length || values.some((v) => !Number.isFinite(v))) continue;
    times.forEach((hhmm, i) => out.push({ t: utc(m[1], hhmm), v: values[i], open: times.length > 1 }));
  }
  return out;
}

export function loadProof(): Proof {
  const { ondo, bstocks } = readTsv();
  const real = readReal();
  if (ondo.length < 20 || bstocks.length < 18 || real.length < 6) {
    throw new Error(`proof inputs look truncated: ondo=${ondo.length} bstocks=${bstocks.length} real=${real.length}`);
  }
  const at = (rows: Pt[], t: number) => rows.find((r) => r.t === t)?.v ?? null;
  const gaps: Gap[] = real
    .filter((r) => !r.open && r.t % 3_600_000 === 0)
    .map((r) => ({ t: r.t, real: r.v, ondo: at(ondo, r.t), bstocks: at(bstocks, r.t) }));
  let worst = { t: 0, symbol: "", pct: 0 };
  for (const g of gaps) {
    for (const [symbol, v] of [["TSLAon", g.ondo], ["TSLAB", g.bstocks]] as const) {
      if (v === null) continue;
      const pct = ((v - g.real) / g.real) * 100;
      if (Math.abs(pct) > Math.abs(worst.pct)) worst = { t: g.t, symbol, pct };
    }
  }
  const pick = (rows: Pt[], t: number) => {
    const p = rows.find((r) => r.t === t);
    if (!p) throw new Error(`missing candle ${new Date(t).toISOString()}`);
    return p;
  };
  const t19 = utc("2026-07-22", "19:00");
  const t21 = utc("2026-07-22", "21:00");
  return {
    ondo, bstocks, real, gaps,
    maxGapPct: Math.abs(worst.pct),
    worst,
    first: { ondo: pick(ondo, t19), ondoAfter: pick(ondo, t21), bstocks: pick(bstocks, t19), bstocksAfter: pick(bstocks, t21) },
  };
}
