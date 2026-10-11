import "server-only";
import path from "node:path";
import type { Rule, SessionStatus, StockVersion, VersionPrice, Decision } from "../../src/types.ts";
import type { Receipt, StoredRule } from "../../src/agent/store.ts";
import { evaluateMod, executeMod, lastCloseMod, parseMod, rwa, web3api, type WebStore } from "./shared/src";
import { REFERENCE_HOLDING_USD } from "./reference";
import { quoteLeg } from "./quote-leg";
import { pickVersion, type Pick } from "./pick";
import { loadRepoEnv, REPO_DATA_DIR } from "./shared/server-env";
import { DAY, usSegments } from "./night";

export const REDEYE_NAME = "Redeye";
export const REDEYE_LINE = "Act while you sleep.";
export const EXAMPLE_RULE = "if TSLA drops 8% buy $6";

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
  probe: { side: "buy" | "sell"; amountUsd: number; ok: boolean; vendor: string | null; mode: string | null; kind: string | null; message: string | null };
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
  sizing: Sizing;
  /** The version the agent would act on if the rule fired now, and why. null when nothing can trade. */
  pick: Pick | null;
  pickNote: string | null;
  standing: string;
  versions: VersionRow[];
  at: number;
}

/** How the quotes behind the ladder are sized: the direction and the dollars, in the rule's own terms. */
export interface Sizing {
  side: "buy" | "sell";
  usd: number;
  /** The rule sells a fraction of a holding the web cannot see, so the quotes use a reference sale. */
  reference: boolean;
  /** What the rule says it trades: "$6" or "50% of your holding". */
  rule: string;
  /** One sentence for the ladder: which way the quotes run and at what size. */
  text: string;
}

export interface MarketStatusView {
  state: SessionStatus["marketStatus"];
  open: boolean;
  reasonCode: string | null;
  reasonMsg: string | null;
  nextOpenTime: number | null;
  nextCloseTime: number | null;
  at: number;
}

/** Binance's market-status endpoint for US equities, read live. The night strip prints it next to the session clock. */
export async function readMarketStatus(): Promise<MarketStatusView> {
  const { sessionStatus } = await rwa();
  const s = await sessionStatus();
  return { state: s.marketStatus, open: s.openState, reasonCode: s.reasonCode, reasonMsg: s.reasonMsg, nextOpenTime: s.nextOpenTime, nextCloseTime: s.nextCloseTime, at: Date.now() };
}

export class RuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuleError";
  }
}

const holdingWords = (f: number | undefined) => (f === 1 ? "all of your holding" : `${Math.round((f ?? 0) * 100)}% of your holding`);

export function sizingFor(rule: Rule): Sizing {
  const a = rule.action;
  if (a.side === "buy") {
    if (a.usd === undefined) throw new RuleError("A buy needs a dollar amount, for example: buy $6.");
    return { side: "buy", usd: a.usd, reference: false, rule: `$${a.usd}`, text: `Buying: each quote runs USDT into the token for $${a.usd}, your rule's size.` };
  }
  if (a.usd !== undefined) {
    return { side: "sell", usd: a.usd, reference: false, rule: `$${a.usd} of the token`, text: `Selling: each quote runs the token into USDT for $${a.usd} worth of the token, your rule's size.` };
  }
  const usdRef = (a.fractionOfHolding ?? 0) * REFERENCE_HOLDING_USD;
  const w = holdingWords(a.fractionOfHolding);
  return {
    side: "sell", usd: usdRef, reference: true, rule: w,
    text: `Selling ${w}: each quote runs the token into USDT, sized as a $${usdRef} reference sale. The agent sizes the real sale from the wallet's balance.`,
  };
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
  // No report date on file: watch through the end of the next US after-hours session, the window the product is for.
  const after = usSegments(now, now + 7 * DAY).find((s) => s.kind === "after" && s.end > now);
  if (after) return { window: { startMs: now - 60_000, endMs: after.end }, note: `No report date for ${ticker} is on file, so this rule watches until US after-hours ends.` };
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

/** Parse the sentence and attach its window. Shared by reading a rule and arming it, so both see the same rule. */
async function prepareRule(text: string, now: number): Promise<{ first: string; rule: Rule; by: "pattern" | "claude"; win: { window: { startMs: number; endMs: number }; note: string } }> {
  const first = text.trim();
  if (!first) throw new RuleError("Write the rule first, for example: " + EXAMPLE_RULE);
  if (first.length > 300) throw new RuleError("Keep the rule under 300 characters.");
  const { rule, by } = await parseText(first, { now, window: { startMs: now - 60_000, endMs: now + 24 * HOUR } });
  const win = await windowFor(rule.ticker, now);
  rule.window = win.window;
  return { first, rule, by, win };
}

export interface ArmedView {
  ruleId: string;
  ticker: string;
  sentence: string;
  window: { startMs: number; endMs: number };
  note: string;
  alreadyArmed: boolean;
  at: number;
}

/** Persist the rule for the agent to watch. The text is parsed again here: the server never stores a rule the browser built. */
export async function armRule(text: string, store: WebStore): Promise<ArmedView> {
  const now = Date.now();
  const { first, rule, win } = await prepareRule(text, now);
  const { listVersions } = await rwa();
  if ((await listVersions(rule.ticker)).length === 0) throw new RuleError(`${rule.ticker} has no tokenized version on BSC. Try TSLA, NVDA, AAPL or KO.`);
  const norm = (t: string) => t.trim().replace(/\s+/g, " ").toLowerCase();
  const twin = (await store.rules()).find((r) => r.status === "armed" && norm(r.text) === norm(first));
  let sr: StoredRule;
  try {
    sr = twin ?? await store.addRule(rule, first, now);
  } catch (e) {
    throw new RuleError(e instanceof Error ? e.message : String(e));
  }
  return { ruleId: sr.rule.id, ticker: sr.rule.ticker, sentence: describeRule(sr.rule), window: sr.rule.window, note: win.note, alreadyArmed: twin !== undefined, at: now };
}

export async function inspectRule(text: string, wallet?: string): Promise<RuleView> {
  const now = Date.now();
  const { first, rule, by, win } = await prepareRule(text, now);

  const { listVersions, priceVersions, sessionStatus } = await rwa();
  const { evaluate } = await evaluateMod();
  const versions = await listVersions(rule.ticker);
  if (versions.length === 0) throw new RuleError(`${rule.ticker} has no tokenized version on BSC. Try TSLA, NVDA, AAPL or KO.`);

  const [prices, statuses] = await Promise.all([priceVersions(versions), Promise.all(versions.map((v) => sessionStatus(v)))]);
  const statusBySymbol = new Map<string, SessionStatus>(versions.map((v, i) => [v.symbol, statuses[i]]));

  // last close: the US regular-session close (16:00 New York), read from the Ondo or bStocks 1h candle that ends then.
  // A 24/7 pool's UTC daily candle would put Saturday's trading in the baseline.
  let lastClose: RuleView["lastClose"] = null;
  try {
    const lc = await (await lastCloseMod()).lastClose(versions, now);
    lastClose = { price: lc.close, day: new Date(lc.closeAt).toISOString().slice(0, 10), symbol: lc.source.split(" ")[0] };
  } catch { /* shown as unknown below */ }

  const sizing = sizingFor(rule);
  const probes = await probeAll(versions, prices, sizing, wallet);
  const rows: VersionRow[] = versions.map((v, i) => rowFor(v, prices[i], statuses[i], probes[i]));

  let standing = "The last close is unavailable, so the current standing of the rule cannot be computed.";
  let triggerPrice: number | null = null;
  if (lastClose) {
    const d: Decision = evaluate(rule, lastClose.price, prices, statusBySymbol, now);
    standing = d.reason;
    triggerPrice = lastClose.price * (1 + (rule.trigger.direction === "down" ? -1 : 1) * rule.trigger.pct / 100);
  }

  return { text: first, parsedBy: by, rule, sentence: describeRule(rule), windowNote: win.note, lastClose, trigger: { price: triggerPrice }, sizing, ...(lastClose ? pickVersion(rule, lastClose.price, prices, statusBySymbol, rows, sizing, evaluate, now) : { pick: null, pickNote: "The last close is unavailable, so the version the agent would pick cannot be computed." }), standing, versions: rows, at: now };
}

type Probe = VersionRow["probe"];


async function probeAll(versions: StockVersion[], prices: VersionPrice[], sizing: Sizing, wallet?: string): Promise<Probe[]> {
  const { side, usd: amountUsd } = sizing;
  loadRepoEnv();
  const { createWeb3Client, credsFromEnv, MissingKeyError, Web3ApiError, BSC } = await web3api();
  const { pickRoute } = await executeMod();
  let api;
  try {
    api = createWeb3Client(credsFromEnv());
  } catch (e) {
    const message = e instanceof MissingKeyError ? "Binance Web3 API key is not configured on the server" : String(e);
    return versions.map(() => ({ side, amountUsd, ok: false, vendor: null, mode: null, kind: "NO_KEY", message }));
  }
  const user = wallet && /^0x[0-9a-fA-F]{40}$/.test(wallet) ? wallet : BURN_PROBE;
  return Promise.all(versions.map(async (v, i): Promise<Probe> => {
    const miss = (kind: string, message: string): Probe => ({ side, amountUsd, ok: false, vendor: null, mode: null, kind, message });
    try {
      const leg = quoteLeg(side, amountUsd, v, prices[i]?.tokenUsd ?? null);
      if (!leg) return miss("NO_PRICE", "No token price to size the sale");
      const routes = await api.quote({ ...leg, userWalletAddress: user, chainId: BSC });
      if (routes.length === 0) return miss("NO_ROUTE", "No route returned");
      const best = pickRoute(routes, v.route === "RFQ" ? "RFQ" : "SWAP"); // the route the agent's own trade takes
      return { side, amountUsd, ok: true, vendor: best.vendorName, mode: best.executionMode, kind: null, message: null };
    } catch (e) {
      if (e instanceof Web3ApiError) return miss(e.kind, e.apiMsg);
      return miss("ERROR", e instanceof Error ? e.message : String(e));
    }
  }));
}

const BLOCKED = new Set(["ASSET_LIMITED", "MARKET_PAUSED", "ASSET_PAUSED"]);

function rowFor(v: StockVersion, p: VersionPrice, s: SessionStatus, probe: Probe): VersionRow {
  const issuerLabel = ISSUER_LABEL[v.issuer];
  let because: string;
  let tradable = probe.ok;
  const order = probe.side === "buy" ? "buy" : "sale";
  if (s.reasonCode && BLOCKED.has(s.reasonCode)) {
    tradable = false;
    because = `Paused by Binance${s.reasonMsg ? ` (${s.reasonMsg})` : ""}.`;
  } else if (probe.ok) {
    because = `A $${probe.amountUsd} ${order} quotes through ${probe.vendor ?? "a route"} (${probe.mode}).`;
  } else if (probe.kind === "MIN_ORDER") {
    because = `${issuerLabel} rejects an order this small: it needs more than $5. This ${order} is $${probe.amountUsd}.`;
  } else if (probe.kind === "ONDO_CLOSED" || probe.kind === "BSTOCK_CLOSED") {
    because = `${issuerLabel} is closed. ${probe.message ?? ""}`.trim();
  } else if (probe.kind === "NO_LIQUIDITY") {
    because = v.issuer === "ondo"
      ? `Ondo quotes nothing at $${probe.amountUsd} right now. On weekends and outside US hours its market makers do not answer.`
      : `No pool route has depth for a $${probe.amountUsd} ${order} of ${v.symbol} right now.`;
  } else if (probe.kind === "NO_KEY") {
    because = "Cannot check: the Binance key is not set on this server.";
  } else {
    because = `No quote: ${probe.message ?? probe.kind ?? "unknown error"}.`;
  }
  if (v.issuer === "ondo" && probe.amountUsd <= 5 && !probe.ok && probe.kind !== "MIN_ORDER") {
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

export interface WatchRow { ruleId: string; text: string; sentence: string; startMs: number; endMs: number; since: number }

export interface Desk { rows: ReceiptRow[]; total: number; watching: WatchRow[]; error: string | null }

const asNum = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
const asStr = (x: unknown): string | null => (typeof x === "string" && x ? x : null);

function rowOf(j: Partial<Receipt>): ReceiptRow {
  const iso = typeof j.iso === "string" ? Date.parse(j.iso) : NaN;
  return {
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
  };
}

/** Receipts newest first, plus the rules still armed, from whichever store this deployment uses. A store that cannot be read is reported, never shown as empty. */
export async function readDesk(store: WebStore | null, limit = 20): Promise<Desk> {
  if (!store) return { rows: [], total: 0, watching: [], error: null };
  try {
    const [receipts, rules] = await Promise.all([store.receipts(), store.rules()]);
    const rows = receipts.filter((j) => typeof j === "object" && j !== null).map(rowOf).sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
    const watching = rules.filter((r) => r.status === "armed").map((r): WatchRow => ({
      ruleId: r.rule.id, text: r.text, sentence: describeRule(r.rule), startMs: r.rule.window.startMs, endMs: r.rule.window.endMs, since: r.createdAt,
    })).sort((a, b) => b.since - a.since);
    return { rows: rows.slice(0, limit), total: rows.length, watching, error: null };
  } catch (e) {
    return { rows: [], total: 0, watching: [], error: e instanceof Error ? e.message : String(e) };
  }
}
