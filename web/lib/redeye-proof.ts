import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Candle, Decision, SessionStatus, StockVersion, VersionPrice } from "../../src/types.ts";
import { evaluateMod, lastCloseMod, parseMod } from "./shared/src";

const RESEARCH = path.join(process.cwd(), "content", "proof");
export const PROOF_FILES = {
  tsv: "web/content/proof/tsla-earnings-2026-07-23.tsv",
  md: "web/content/proof/EARNINGS-SPIKE.md",
};

const HOUR = 3_600_000;

/** The rule the replay runs. 4% is the smallest round figure the after-hours move crossed: the first reading is down 2.5%, the next 4.3%. */
export const PROOF_RULE = "if TSLA drops 4% buy $6";

export interface Pt { t: number; v: number }
export interface Gap { t: number; ondo: number | null; bstocks: number | null; real: number }

export interface Proof {
  ondo: Pt[];
  bstocks: Pt[];
  real: { t: number; v: number; open: boolean }[];
  gaps: Gap[]; // readings where the real price is a same-hour reading (the open hour is excluded)
  maxGapPct: number;
  worst: { t: number; symbol: string; pct: number };
  /** The rule as parsed by the agent's own parser, the close it measures from and the line it triggers on. */
  rule: { text: string; pct: number; usd: number; lastClose: number; lastCloseAt: number; triggerPrice: number };
  /** The first reading evaluate() fires on: the receipt the replay prints. */
  fire: { t: number; symbol: string; issuer: string; price: number; usd: number; reason: string };
  /** The one move figure the page quotes: the last close to the price the rule measured at the firing reading. */
  move: { from: number; fromAt: number; to: number; toAt: number; pct: number };
  /** What evaluate() answered at each reading before it fired. */
  held: { t: number; reason: string }[];
}

/**
 * Every recorded value is the close of an hourly candle, so it is the price at the END of the hour its label names.
 * The loader places each reading at that close, so a label on the chart, in the table and in the receipt is a clock time at which the price was true.
 */
function readTsv(): { ondo: Pt[]; bstocks: Pt[] } {
  const ondo: Pt[] = [];
  const bstocks: Pt[] = [];
  for (const line of readFileSync(path.join(RESEARCH, "tsla-earnings-2026-07-23.tsv"), "utf8").split("\n").filter(Boolean)) {
    const [sym, iso, price] = line.split("\t");
    const pt = { t: Date.parse(iso) + HOUR, v: Number(price) };
    if (!Number.isFinite(pt.t) || !Number.isFinite(pt.v)) throw new Error(`bad row in tsv: ${line}`);
    if (sym === "TSLAon") ondo.push(pt);
    else if (sym === "TSLAB") bstocks.push(pt);
    else throw new Error(`unknown symbol ${sym} in tsv`);
  }
  return { ondo, bstocks };
}

function utc(date: string, hhmm: string): number {
  return Date.parse(`${date}T${hhmm}:00Z`);
}

/**
 * Table rows of EARNINGS-SPIKE.md: `| 2026-07-22 20:00 (after-hours) | 364.51 | 364.65 | 364.76 | -0.03% |`.
 * The label is the bar's open and the value its close. Where a row lists two bars (`13:00 / 13:30 open`) the first
 * bar closes when the second opens, which is also when the regular session starts.
 */
function readReal(): Proof["real"] {
  const out: Proof["real"] = [];
  for (const line of readFileSync(path.join(RESEARCH, "EARNINGS-SPIKE.md"), "utf8").split("\n")) {
    const cells = line.split("|").map((c) => c.trim());
    const m = /^(\d{4}-\d{2}-\d{2}) (.+)$/.exec(cells[1] ?? "");
    if (!m || !cells[2]) continue;
    const times = m[2].match(/\d{2}:\d{2}/g) ?? [];
    const values = cells[2].split("/").map((s) => Number(s.trim()));
    if (times.length === 0 || values.length !== times.length || values.some((v) => !Number.isFinite(v))) continue;
    times.forEach((hhmm, i) => out.push({ t: i + 1 < times.length ? utc(m[1], times[i + 1]) : utc(m[1], hhmm) + HOUR, v: values[i], open: times.length > 1 }));
  }
  return out;
}

const ONDO: StockVersion = { ticker: "TSLA", issuer: "ondo", symbol: "TSLAon", address: "0x2494b603319d4d9f9715c9f4496d9e0364b59d93", decimals: 18, multiplier: 1, route: "RFQ" };
const BSTOCK: StockVersion = { ticker: "TSLA", issuer: "bstocks", symbol: "TSLAB", address: "0x5b1910eaad6450e50f816082aa078c41f10c292f", decimals: 18, multiplier: 1, route: "MIXED" };
// The recorded data holds prices and no market status, so both tokens are read as trading.
const TRADING: SessionStatus = { marketStatus: "postmarket", openState: true, reasonCode: "TRADING", reasonMsg: null, nextOpenTime: null, nextCloseTime: null };

/** Runs the agent's own parser, last-close reader and evaluate() over the recorded readings, one reading at a time. */
export async function loadProof(): Promise<Proof> {
  const { ondo, bstocks } = readTsv();
  const real = readReal();
  if (ondo.length < 20 || bstocks.length < 18 || real.length < 6) {
    throw new Error(`proof inputs look truncated: ondo=${ondo.length} bstocks=${bstocks.length} real=${real.length}`);
  }
  const at = (rows: Pt[], t: number) => rows.find((r) => r.t === t)?.v ?? null;
  const gaps: Gap[] = real
    .filter((r) => !r.open && r.t % HOUR === 0)
    .map((r) => ({ t: r.t, real: r.v, ondo: at(ondo, r.t), bstocks: at(bstocks, r.t) }));
  let worst = { t: 0, symbol: "", pct: 0 };
  for (const g of gaps) {
    for (const [symbol, v] of [["TSLAon", g.ondo], ["TSLAB", g.bstocks]] as const) {
      if (v === null) continue;
      const pct = ((v - g.real) / g.real) * 100;
      if (Math.abs(pct) > Math.abs(worst.pct)) worst = { t: g.t, symbol, pct };
    }
  }

  const readings = [...new Set([...ondo, ...bstocks].map((p) => p.t))].sort((a, b) => a - b);
  const [first, last] = [readings[0], readings[readings.length - 1]];
  const { parseRuleStrict } = await parseMod();
  const { evaluate } = await evaluateMod();
  const { lastClose } = await lastCloseMod();
  const rule = parseRuleStrict(PROOF_RULE, { now: first, window: { startMs: first, endMs: last } });
  if (rule.action.usd === undefined) throw new Error("the proof rule must buy a dollar amount");

  // lastClose() reads the 1h candle that opens an hour before 16:00 New York, so it is handed the candles with their real open times.
  const candle = (rows: Pt[]) => (_v: StockVersion, _i: string, o: { startTime?: number }): Promise<Candle[]> =>
    Promise.resolve(rows.filter((r) => o.startTime === undefined || r.t - HOUR >= o.startTime).map((r) => ({ t: r.t - HOUR, o: r.v, h: r.v, l: r.v, c: r.v, v: 0 })));
  const lc = await lastClose([ONDO, BSTOCK], first, (v, i, o) => candle(v.issuer === "ondo" ? ondo : bstocks)(v, i, o));

  const status = new Map<string, SessionStatus>([[ONDO.symbol, TRADING], [BSTOCK.symbol, TRADING]]);
  const held: Proof["held"] = [];
  let decision: Decision | null = null;
  let firedAt = 0;
  for (const t of readings) {
    const observed: VersionPrice[] = [];
    for (const [v, rows] of [[ONDO, ondo], [BSTOCK, bstocks]] as const) {
      const price = at(rows, t);
      if (price !== null) observed.push({ version: v, tokenUsd: price, perShareUsd: price / v.multiplier, stockUsd: null, derived: false, at: t });
    }
    const d = evaluate(rule, lc.close, observed, status, t);
    if (d.fire) { decision = d; firedAt = t; break; }
    held.push({ t, reason: d.reason });
  }
  if (!decision?.version) throw new Error(`${PROOF_RULE} never fired on the recorded night: the replay would have nothing to show`);

  // The figure shown beside the receipt must be the one evaluate() acted on, so it is read back out of its own sentence.
  const price = at(decision.version.issuer === "ondo" ? ondo : bstocks, firedAt) as number;
  const measured = at(bstocks, firedAt) ?? price;
  const pct = ((lc.close - measured) / lc.close) * 100;
  if (!decision.reason.includes(`down ${pct.toFixed(1)}%`)) throw new Error(`move ${pct.toFixed(1)}% is not what evaluate() reported: ${decision.reason}`);

  return {
    ondo, bstocks, real, gaps,
    maxGapPct: Math.abs(worst.pct),
    worst,
    rule: { text: PROOF_RULE, pct: rule.trigger.pct, usd: rule.action.usd, lastClose: lc.close, lastCloseAt: lc.closeAt, triggerPrice: lc.close * (1 - rule.trigger.pct / 100) },
    fire: { t: firedAt, symbol: decision.version.symbol, issuer: decision.version.issuer, price, usd: rule.action.usd, reason: decision.reason },
    move: { from: lc.close, fromAt: lc.closeAt, to: measured, toAt: firedAt, pct },
    held,
  };
}
