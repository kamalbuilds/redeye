import "server-only";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseUnits } from "viem";
import type { Rule, SessionStatus, StockVersion, VersionPrice, Decision } from "../../src/types.ts";
import type { Receipt } from "../../src/agent/store.ts";
import { evaluateMod, parseMod, rwa, web3api } from "./shared/src";
import { loadRepoEnv, REPO_DATA_DIR } from "./shared/server-env";

export const REDEYE_NAME = "Redeye";
export const REDEYE_LINE = "Act while you sleep.";
export const EXAMPLE_RULE = "if TSLA drops 8% buy $6";

const USDT = "0x55d398326f99059fF775485246999027B3197955";
const BURN_PROBE = "0x000000000000000000000000000000000000dEaD";
const HOUR = 3_600_000;

export const ISSUER_LABEL: Record<string, string> = { ondo: "Ondo", xstocks: "xStocks", bstocks: "bStocks" };

export interface VersionRow {
  issuer: "ondo" | "xstocks" | "bstocks";
  issuerLabel: string;
  symbol: string;
  address: string;
  route: string;
  multiplier: number;
  tokenUsd: number | null;
  perShareUsd: number | null;
  stockUsd: number | null;
  derived: boolean;
  session: { state: string | null; open: boolean; reasonCode: string | null; reasonMsg: string | null; nextOpenTime: number | null };
  probe: { amountUsd: number; ok: boolean; vendor: string | null; mode: string | null; kind: string | null; message: string | null };
  tradable: boolean;
  because: string;
}

export interface RuleView {
  text: string;
  parsedBy: "pattern" | "claude";
  rule: Rule;
  sentence: string;
  windowNote: string;
  lastClose: { price: number; symbol: string; day: string } | null;
  trigger: { price: number | null };
  standing: string;
  versions: VersionRow[];
  at: number;
}

export class RuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuleError";
  }
}

function describeRule(r: Rule): string {
  const act = r.action.usd !== undefined
    ? `${r.action.side} $${r.action.usd}`
    : `${r.action.side} ${r.action.fractionOfHolding === 1 ? "all" : `${(r.action.fractionOfHolding ?? 0) * 100}%`} of your holding`;
  return `If ${r.ticker} moves ${r.trigger.direction} ${r.trigger.pct}% from the last close, ${act}.`;
}

async function windowFor(ticker: string, now: number): Promise<{ window: { startMs: number; endMs: number }; note: string }> {
  const { loadKnownEarnings } = await rwa();
  const hit = loadKnownEarnings(path.join(REPO_DATA_DIR, "earnings.json")).filter((e) => e.ticker.toUpperCase() === ticker && Date.parse(e.reportUtc) + 12 * HOUR > now)
    .sort((a, b) => Date.parse(a.reportUtc) - Date.parse(b.reportUtc))[0];
  if (hit) {
    const t = Date.parse(hit.reportUtc);
    return { window: { startMs: t - HOUR, endMs: t + 12 * HOUR }, note: `Armed around the ${ticker} report at ${hit.reportUtc} (${hit.source}).` };
  }
  return { window: { startMs: now - 60_000, endMs: now + 24 * HOUR }, note: `No report date for ${ticker} is on file, so this rule watches the next 24 hours.` };
}

async function parseText(text: string, ctx: { now: number; window: { startMs: number; endMs: number } }): Promise<{ rule: Rule; by: "pattern" | "claude" }> {
  const { parseRule, parseRuleStrict } = await parseMod();
  try {
    return { rule: parseRuleStrict(text, ctx), by: "pattern" };
  } catch (strictErr) {
    loadRepoEnv();
    if (!process.env.ANTHROPIC_API_KEY) throw new RuleError(strictErr instanceof Error ? strictErr.message : String(strictErr));
    try {
      return { rule: await parseRule(text, ctx), by: "claude" };
    } catch (e) {
      throw new RuleError(e instanceof Error ? e.message : String(e));
    }
  }
}

function lastDailyClose(rows: { t: number; c: number }[], now: number): { price: number; day: string } | null {
  const startOfToday = Math.floor(now / 86_400_000) * 86_400_000;
  const done = rows.filter((r) => r.t < startOfToday).sort((a, b) => b.t - a.t)[0];
  return done ? { price: done.c, day: new Date(done.t).toISOString().slice(0, 10) } : null;
}

export async function inspectRule(text: string, wallet?: string): Promise<RuleView> {
  const now = Date.now();
  const first = text.trim();
  if (!first) throw new RuleError("Write the rule first, for example: " + EXAMPLE_RULE);
  if (first.length > 300) throw new RuleError("Keep the rule under 300 characters.");

  const { rule, by } = await parseText(first, { now, window: { startMs: now - 60_000, endMs: now + 24 * HOUR } });
  const win = await windowFor(rule.ticker, now);
  rule.window = win.window;

  const { listVersions, priceVersions, sessionStatus, candles } = await rwa();
  const { evaluate } = await evaluateMod();
  const versions = await listVersions(rule.ticker);
  if (versions.length === 0) throw new RuleError(`${rule.ticker} has no tokenized version on BSC. Try TSLA, NVDA, AAPL or KO.`);

  const [prices, statuses] = await Promise.all([priceVersions(versions), Promise.all(versions.map((v) => sessionStatus(v)))]);
  const statusBySymbol = new Map<string, SessionStatus>(versions.map((v, i) => [v.symbol, statuses[i]]));

  // last close: latest finished UTC daily candle of the first version that has candles (bStocks, xStocks, Ondo)
  let lastClose: RuleView["lastClose"] = null;
  for (const v of [...versions].sort((a, b) => rank(a) - rank(b))) {
    try {
      const rows = await candles(v, "1d", { limit: 5 });
      const lc = lastDailyClose(rows, now);
      if (lc) { lastClose = { ...lc, symbol: v.symbol }; break; }
    } catch { /* try the next version; a missing daily candle is shown as unknown below */ }
  }

  const probes = await probeAll(versions, rule, wallet);
  const rows: VersionRow[] = versions.map((v, i) => rowFor(v, prices[i], statuses[i], probes[i], rule));

  let standing = "The last close is unavailable, so the current standing of the rule cannot be computed.";
  let triggerPrice: number | null = null;
  if (lastClose) {
    const d: Decision = evaluate(rule, lastClose.price, prices, statusBySymbol, now);
    standing = d.reason;
    triggerPrice = lastClose.price * (1 + (rule.trigger.direction === "down" ? -1 : 1) * rule.trigger.pct / 100);
  }

  return { text: first, parsedBy: by, rule, sentence: describeRule(rule), windowNote: win.note, lastClose, trigger: { price: triggerPrice }, standing, versions: rows, at: now };
}

const rank = (v: StockVersion) => (v.issuer === "bstocks" ? 0 : v.issuer === "xstocks" ? 1 : 2);

type Probe = VersionRow["probe"];

async function probeAll(versions: StockVersion[], rule: Rule, wallet?: string): Promise<Probe[]> {
  const amountUsd = rule.action.usd ?? 6;
  loadRepoEnv();
  const { createWeb3Client, credsFromEnv, MissingKeyError, Web3ApiError, BSC } = await web3api();
  let api;
  try {
    api = createWeb3Client(credsFromEnv());
  } catch (e) {
    const message = e instanceof MissingKeyError ? "Binance Web3 API key is not configured on the server" : String(e);
    return versions.map(() => ({ amountUsd, ok: false, vendor: null, mode: null, kind: "NO_KEY", message }));
  }
  const user = wallet && /^0x[0-9a-fA-F]{40}$/.test(wallet) ? wallet : BURN_PROBE;
  return Promise.all(versions.map(async (v): Promise<Probe> => {
    try {
      const amount = parseUnits(String(amountUsd), 18).toString(); // BSC USDT has 18 decimals
      const routes = await api.quote({ amount, fromToken: USDT, toToken: v.address, userWalletAddress: user, chainId: BSC });
      const best = routes[0];
      if (!best) return { amountUsd, ok: false, vendor: null, mode: null, kind: "NO_ROUTE", message: "No route returned" };
      return { amountUsd, ok: true, vendor: best.vendorName, mode: best.executionMode, kind: null, message: null };
    } catch (e) {
      if (e instanceof Web3ApiError) return { amountUsd, ok: false, vendor: null, mode: null, kind: e.kind, message: e.apiMsg };
      return { amountUsd, ok: false, vendor: null, mode: null, kind: "ERROR", message: e instanceof Error ? e.message : String(e) };
    }
  }));
}

const BLOCKED = new Set(["ASSET_LIMITED", "MARKET_PAUSED", "ASSET_PAUSED"]);

function rowFor(v: StockVersion, p: VersionPrice, s: SessionStatus, probe: Probe, rule: Rule): VersionRow {
  const issuerLabel = ISSUER_LABEL[v.issuer];
  let because: string;
  let tradable = probe.ok;
  if (s.reasonCode && BLOCKED.has(s.reasonCode)) {
    tradable = false;
    because = `Paused by Binance${s.reasonMsg ? ` (${s.reasonMsg})` : ""}.`;
  } else if (probe.ok) {
    because = `A $${probe.amountUsd} order quotes through ${probe.vendor ?? "a route"} (${probe.mode}).`;
  } else if (probe.kind === "MIN_ORDER") {
    because = `${issuerLabel} rejects an order this small: it needs more than $5. Your rule buys $${probe.amountUsd}.`;
  } else if (probe.kind === "ONDO_CLOSED" || probe.kind === "BSTOCK_CLOSED") {
    because = `${issuerLabel} is closed. ${probe.message ?? ""}`.trim();
  } else if (probe.kind === "NO_LIQUIDITY") {
    because = v.issuer === "ondo"
      ? `Ondo quotes nothing at $${probe.amountUsd} right now. On weekends and outside US hours its market makers do not answer.`
      : `No pool route has depth for $${probe.amountUsd} of ${v.symbol} right now.`;
  } else if (probe.kind === "NO_KEY") {
    because = "Cannot check: the Binance key is not set on this server.";
  } else {
    because = `No quote: ${probe.message ?? probe.kind ?? "unknown error"}.`;
  }
  if (v.issuer === "ondo" && rule.action.side === "buy" && (rule.action.usd ?? 6) <= 5 && !probe.ok && probe.kind !== "MIN_ORDER") {
    because += " Ondo also refuses orders of $5 or less.";
  }
  return {
    issuer: v.issuer, issuerLabel, symbol: v.symbol, address: v.address, route: v.route, multiplier: v.multiplier,
    tokenUsd: p.tokenUsd, perShareUsd: p.perShareUsd, stockUsd: p.stockUsd, derived: p.derived,
    session: { state: s.marketStatus, open: s.openState, reasonCode: s.reasonCode, reasonMsg: s.reasonMsg, nextOpenTime: s.nextOpenTime },
    probe, tradable, because,
  };
}

// ---------- receipts ----------

export interface ReceiptRow {
  at: number | null;
  ruleId: string | null;
  ticker: string | null;
  symbol: string | null;
  side: Receipt["side"];
  usd: number | null;
  mode: Receipt["mode"] | null;
  outcome: Receipt["outcome"] | null;
  reason: string | null;
  txHash: string | null;
  orderId: string | null;
}

export interface Receipts { rows: ReceiptRow[]; file: string; exists: boolean; bad: number }

const asNum = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
const asStr = (x: unknown): string | null => (typeof x === "string" && x ? x : null);

/** Reads receipts.jsonl as written by src/agent/store.ts, newest first. A line that is not a receipt object is counted, never dropped silently. */
export function readReceipts(limit = 20): Receipts {
  const file = path.join(REPO_DATA_DIR, "receipts.jsonl");
  const label = "receipts.jsonl";
  if (!existsSync(file)) return { rows: [], file: label, exists: false, bad: 0 };
  const rows: ReceiptRow[] = [];
  let bad = 0;
  for (const line of readFileSync(file, "utf8").split("\n").filter(Boolean)) {
    let j: Partial<Receipt>;
    try { j = JSON.parse(line); } catch { bad++; continue; }
    if (typeof j !== "object" || j === null || Array.isArray(j)) { bad++; continue; }
    const iso = typeof j.iso === "string" ? Date.parse(j.iso) : NaN;
    rows.push({
      at: asNum(j.at) ?? (Number.isFinite(iso) ? iso : null),
      ruleId: asStr(j.ruleId),
      ticker: asStr(j.ticker),
      symbol: asStr(j.version?.symbol),
      side: j.side === "buy" || j.side === "sell" ? j.side : null,
      usd: asNum(j.usd),
      mode: j.mode === "dry" || j.mode === "live" ? j.mode : null,
      outcome: asStr(j.outcome) as Receipt["outcome"] | null,
      reason: asStr(j.reason),
      txHash: asStr(j.txHash),
      orderId: asStr(j.orderId),
    });
  }
  rows.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  return { rows: rows.slice(0, limit), file: label, exists: true, bad };
}
