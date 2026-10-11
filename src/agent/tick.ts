// One pass of the overnight loop: for every armed rule, read the market, decide, trade (dry by default), write a receipt.
import { listVersions as defaultList, priceVersions as defaultPrice, sessionStatus as defaultStatus } from "../data/rwa.ts";
import { evaluate } from "../signals/evaluate.ts";
import { createBaw } from "../exec/baw.ts";
import { BSC, createWeb3Client, credsFromEnv } from "../exec/web3api.ts";
import type { Decision, SessionStatus, StockVersion, VersionPrice } from "../types.ts";
import { guardedTrade, isLive, ondoTooSmall } from "./guards.ts";
import type { TradeDeps, TradeOpts } from "./guards.ts";
import { lastClose as defaultLastClose } from "./lastclose.ts";
import type { LastClose } from "./lastclose.ts";
import { openStore } from "./store.ts";
import type { Receipt, RuleStatus, StoredRule } from "./store.ts";

export type TickOpts = TradeOpts;
type Maybe<T> = T | Promise<T>;
// What tick needs from a store. The file store answers synchronously, the blob store the web uses answers with promises.
export interface TickStore {
  rules(): Maybe<StoredRule[]>;
  receipts(): Maybe<Receipt[]>;
  appendReceipt(r: Receipt): Maybe<void>;
  setStatus(ruleId: string, status: RuleStatus, note?: string, now?: number): Maybe<void>;
}
export interface TickDeps extends TradeDeps {
  store?: TickStore;
  // Replaces guardedTrade. The web passes a trade that quotes and simulates without a wallet; the CLI keeps the default.
  trade?: typeof guardedTrade;
  listVersions?: (ticker: string) => Promise<StockVersion[]>;
  priceVersions?: (v: StockVersion[]) => Promise<VersionPrice[]>;
  sessionStatus?: (v: StockVersion) => Promise<SessionStatus>;
  lastClose?: (versions: StockVersion[], now: number) => Promise<LastClose>;
  // Dollar value of the whole holding of `version` in the signing wallet, for fractionOfHolding sells.
  holdingUsd?: (version: StockVersion, tokenUsd: number) => Promise<number>;
}

async function defaultHoldingUsd(version: StockVersion, tokenUsd: number, deps: TradeDeps): Promise<number> {
  const api = deps.api ?? createWeb3Client(credsFromEnv(deps.env ?? process.env));
  const wallet = await createBaw().address(BSC);
  const held = await api.tokenBalance({ address: wallet, token: version.address });
  return Number(held ?? 0) * tokenUsd;
}

export async function tick(now: number, opts: TickOpts, deps: TickDeps = {}): Promise<Receipt[]> {
  const store = deps.store ?? openStore();
  const env = deps.env ?? process.env;
  const mode = isLive(opts, env) ? "live" : "dry";
  const out: Receipt[] = [];

  for (const sr of (await store.rules()).filter((r) => r.status === "armed")) {
    const rule = sr.rule;
    const base: Receipt = {
      at: now, iso: new Date(now).toISOString(), kind: "rule", ruleId: rule.id, ticker: rule.ticker, mode,
      outcome: "no_fire", reason: "", lastClose: null, lastCloseSource: null, observed: [], version: null,
      side: rule.action.side, usd: null, quote: null, simulate: "not run", txHash: null, orderId: null, execLog: [],
    };
    const emit = async (r: Receipt): Promise<void> => {
      // Every decision gets a receipt, except that a rule still waiting for its window would repeat one sentence all day.
      if (now < rule.window.startMs && (await store.receipts()).filter((x) => x.ruleId === rule.id).at(-1)?.reason === r.reason) return;
      await store.appendReceipt(r);
      out.push(r);
    };
    try {
      await emit(await decideAndAct(sr, base, now, opts, deps, store));
    } catch (e) {
      await emit({ ...base, outcome: "failed", reason: `Could not check ${rule.ticker}: ${e instanceof Error ? e.message : String(e)}` });
    }
  }
  return out;
}

async function decideAndAct(sr: StoredRule, base: Receipt, now: number, opts: TickOpts, deps: TickDeps, store: TickStore): Promise<Receipt> {
  const rule = sr.rule;
  const listV = deps.listVersions ?? defaultList;
  const priceV = deps.priceVersions ?? defaultPrice;
  const statusOf = deps.sessionStatus ?? defaultStatus;
  const closeOf = deps.lastClose ?? defaultLastClose;

  // Outside the window evaluate() answers from the clock alone, so no network is touched.
  if (now < rule.window.startMs || now > rule.window.endMs) {
    const d = evaluate(rule, 1, [], new Map(), now);
    if (now > rule.window.endMs) await store.setStatus(rule.id, "expired", d.reason, now);
    return { ...base, reason: d.reason };
  }

  const versions = await listV(rule.ticker);
  if (versions.length === 0) return { ...base, outcome: "failed", reason: `${rule.ticker} has no tokenized version on BSC.` };
  const [observed, statuses, lc] = await Promise.all([
    priceV(versions),
    Promise.all(versions.map(async (v) => [v.symbol, await statusOf(v)] as const)),
    closeOf(versions, now),
  ]);
  const status = new Map(statuses);
  const seen = {
    lastClose: lc.close, lastCloseSource: lc.source,
    observed: observed.map((o) => ({ symbol: o.version.symbol, issuer: o.version.issuer, tokenUsd: o.tokenUsd, perShareUsd: o.perShareUsd })),
  };
  let decision = evaluate(rule, lc.close, observed, status, now);
  if (!decision.fire || !decision.version) return { ...base, ...seen, reason: decision.reason };

  // Dollar size of the trade on a given version (a fraction-of-holding sell depends on which token is held).
  const sizeOn = async (v: StockVersion): Promise<number | null> => {
    if (rule.action.usd !== undefined) return rule.action.usd;
    const tokenUsd = observed.find((o) => o.version.address === v.address)?.tokenUsd;
    if (!tokenUsd) return null;
    const whole = await (deps.holdingUsd ?? ((ver, p) => defaultHoldingUsd(ver, p, deps)))(v, tokenUsd);
    return whole * (rule.action.fractionOfHolding ?? 0);
  };

  let usd = await sizeOn(decision.version);
  // Ondo refuses small orders: drop it and let the next-best version take the trade.
  if (usd !== null && ondoTooSmall(decision.version, usd)) {
    const ondo = decision.version;
    const alt: Decision = evaluate(rule, lc.close, observed.filter((o) => o.version.issuer !== "ondo"), status, now);
    const note = `Skipped the Ondo version: Ondo needs at least $5.01 per order and this trade is $${usd.toFixed(2)}.`;
    if (!alt.fire || !alt.version) return { ...base, ...seen, outcome: "skipped", version: vref(ondo), usd, reason: `${decision.reason} ${note} No other version could take it.` };
    decision = { ...alt, reason: `${alt.reason} ${note}` };
    usd = await sizeOn(decision.version as StockVersion);
  }
  const version = decision.version as StockVersion;

  const t = await (deps.trade ?? guardedTrade)(decision, rule, usd, opts, deps);
  const r: Receipt = {
    ...base, ...seen, outcome: t.outcome, version: vref(version), usd: t.usd, quote: t.quote, simulate: t.simulate,
    txHash: t.fill?.txHash ?? null, orderId: t.fill?.orderId ?? null, execLog: t.execLog,
    reason: `${decision.reason} ${t.reason}`,
  };
  if (t.outcome === "filled") await store.setStatus(rule.id, "filled", r.reason, now);
  // A live order that was submitted but did not confirm may still fill later: never fire the rule again unattended.
  else if (t.live && t.outcome === "failed" && (r.orderId || r.txHash || t.execLog.some((l) => /submitted/.test(l)))) {
    await store.setStatus(rule.id, "review", "an order was submitted but did not confirm; check the wallet before re-arming", now);
  }
  return r;
}

const vref = (v: StockVersion) => ({ symbol: v.symbol, issuer: v.issuer, address: v.address });
