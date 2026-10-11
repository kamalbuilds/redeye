// Every trade goes through guardedTrade: the cap, the slippage sanity
// check, the Ondo minimum and the REDEYE_LIVE switch are enforced here, in code, before execute is ever called.
import type { Decision, Fill, Rule, StockVersion } from "../types.ts";
import { execute, pickRoute } from "../exec/execute.ts";
import { createWeb3Client, credsFromEnv, simulateFailure } from "../exec/web3api.ts";
import type { QuoteRoute, SimulateResult, Web3Client } from "../exec/web3api.ts";
import type { Outcome, QuoteSummary } from "./store.ts";

export const DEFAULT_MAX_USD_PER_TRADE = 5;
// Live: Ondo RFQ answers 40375 at exactly $5 ("Minimum order amount is 5 USD."), so the floor is a cent above.
export const ONDO_MIN_USD = 5.01;

export interface TradeOpts { live: boolean; maxUsdPerTrade: number }
export type Env = Record<string, string | undefined>;
export interface TradeDeps {
  env?: Env;
  execute?: typeof execute;
  api?: Web3Client;
}

// Live needs BOTH the caller's flag and REDEYE_LIVE=yes in the environment.
export function isLive(opts: TradeOpts, env: Env = process.env): boolean {
  return opts.live === true && env.REDEYE_LIVE === "yes";
}

export function banner(opts: TradeOpts, env: Env = process.env): string {
  if (isLive(opts, env)) return `LIVE (cap $${opts.maxUsdPerTrade})`;
  return opts.live ? "DRY RUN (--live ignored: REDEYE_LIVE is not yes)" : "DRY RUN";
}

export const ondoTooSmall = (v: StockVersion, usd: number): boolean => v.issuer === "ondo" && usd < ONDO_MIN_USD;

// null = allowed. Written as negated comparisons so NaN or undefined fail closed.
export function refusal(rule: Rule, version: StockVersion, usd: number, opts: TradeOpts): string | null {
  if (!(usd > 0) || !Number.isFinite(usd)) return `Refused: the trade size ($${usd}) is not a positive dollar amount.`;
  if (!(usd <= opts.maxUsdPerTrade)) return `Refused: $${usd.toFixed(2)} is above the per-trade cap of $${opts.maxUsdPerTrade}.`;
  if (!(rule.maxSlippageBps > 0) || !Number.isFinite(rule.maxSlippageBps)) return `Refused: the rule has no valid max slippage (${rule.maxSlippageBps}).`;
  if (ondoTooSmall(version, usd)) return `Skipped the Ondo version: Ondo needs at least $${ONDO_MIN_USD} per order and this trade is $${usd.toFixed(2)}.`;
  return null;
}

export interface TradeResult {
  outcome: Outcome;
  reason: string;
  usd: number;
  live: boolean;
  fill: Fill | null;
  quote: QuoteSummary | null;
  simulate: string;
  execLog: string[];
}

interface Trace { quote: QuoteRoute[] | null; sims: SimulateResult[]; log: string[] }

// Records what execute asked the API, so the receipt carries the quote and the simulate result.
function traced(api: Web3Client, t: Trace): Web3Client {
  return {
    ...api,
    async quote(p) { const r = await api.quote(p); t.quote = r; return r; },
    async simulate(p) { const r = await api.simulate(p); t.sims.push(r); return r; },
  };
}

export async function guardedTrade(
  decision: Decision,
  rule: Rule,
  estimateUsd: number | null,
  opts: TradeOpts,
  deps: TradeDeps = {},
): Promise<TradeResult> {
  const env = deps.env ?? process.env;
  const live = isLive(opts, env);
  // A usd-sized rule spends exactly rule.action.usd; the caller's estimate only applies to fractionOfHolding sells.
  const usd = rule.action.usd ?? estimateUsd ?? NaN;
  const base = { usd, live, fill: null, quote: null, simulate: "not run", execLog: [] as string[] };
  const version = decision.version;
  if (!version) return { ...base, outcome: "skipped", reason: "No tradable version was selected." };
  const why = refusal(rule, version, usd, opts);
  if (why) return { ...base, outcome: "skipped", reason: why };

  const trace: Trace = { quote: null, sims: [], log: [] };
  let fill: Fill;
  try {
    const run = deps.execute ?? execute;
    const api = deps.api ?? (deps.execute ? undefined : createWeb3Client(credsFromEnv(env)));
    fill = await run(decision, rule, { live, log: (m) => trace.log.push(m), deps: api ? { api: traced(api, trace) } : undefined });
  } catch (e) {
    return { ...base, outcome: "failed", reason: `Could not trade: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`, execLog: trace.log };
  }

  let quote: QuoteSummary | null = null;
  if (trace.quote?.length) {
    const best = pickRoute(trace.quote, version.route === "RFQ" ? "RFQ" : "SWAP");
    quote = { vendor: best.vendorName, executionMode: best.executionMode, toTokenAmount: best.toTokenAmount, priceImpactPercent: best.priceImpactPercent ?? null, routes: trace.quote.length };
  }
  const failed = trace.sims.map((s) => simulateFailure(s)).find((r) => r !== null);
  const simulate = trace.sims.length === 0 ? "not run" : failed ?? "passed";
  const spent = `$${fill.usd.toFixed(2)} of ${version.symbol}`;
  const sideWord = fill.side === "buy" ? "bought" : "sold";
  let outcome: Outcome;
  let reason: string;
  if (fill.status === "filled") {
    outcome = "filled";
    reason = `Filled: ${sideWord} ${spent}${fill.txHash ? `, tx ${fill.txHash}` : ""}.`;
  } else if (!live && fill.status === "expired") {
    outcome = "dry_run";
    reason = `Dry run: would have ${fill.side === "buy" ? "bought" : "sold"} ${spent}; simulate ${simulate}; nothing was signed.`;
  } else {
    outcome = fill.status;
    reason = `Not filled (${fill.status}): ${trace.log[trace.log.length - 1] ?? "no detail from the executor"}`;
  }
  return { usd: fill.usd || usd, live, fill, outcome, reason, quote, simulate, execLog: trace.log };
}
