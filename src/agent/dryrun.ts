// A dry-run trade with no wallet and no signer, for the web. It runs the read-only half of execute(): quote, approve-
// transaction, Transaction API simulate. Same signature as guardedTrade, so tick takes it as `deps.trade`.
// The quote and the simulate come from PROBE_WALLET (a burn address that holds nothing): the approval simulate passes
// without funds, the swap itself cannot be simulated without a balance, and the receipt says which one ran.
import type { Decision, Rule } from "../types.ts";
import { floor8, pickRoute, toUnits, USDT } from "../exec/execute.ts";
import { createWeb3Client, credsFromEnv, simulateFailure, Web3ApiError } from "../exec/web3api.ts";
import { refusal } from "./guards.ts";
import type { TradeDeps, TradeOpts, TradeResult } from "./guards.ts";
import type { QuoteSummary } from "./store.ts";

export const PROBE_WALLET = "0x000000000000000000000000000000000000dEaD";
const USDT_DECIMALS = 18; // BSC-USD, the same value execute.ts reads with decimals()

export async function dryTrade(
  decision: Decision,
  rule: Rule,
  estimateUsd: number | null,
  opts: TradeOpts,
  deps: TradeDeps = {},
): Promise<TradeResult> {
  const usd = rule.action.usd ?? estimateUsd ?? NaN;
  const log: string[] = [];
  const base = { usd, live: false, fill: null, quote: null, simulate: "not run", execLog: log };
  const version = decision.version;
  if (!version) return { ...base, outcome: "skipped", reason: "No tradable version was selected." };
  const why = refusal(rule, version, usd, opts);
  if (why) return { ...base, outcome: "skipped", reason: why };

  const buy = rule.action.side === "buy";
  const verb = buy ? "bought" : "sold";
  const fail = (reason: string, extra: Partial<TradeResult> = {}): TradeResult =>
    ({ ...base, outcome: "failed", reason: `Dry run: could not ${buy ? "buy" : "sell"} ${version.symbol}: ${reason}`, ...extra });

  try {
    const api = deps.api ?? createWeb3Client(credsFromEnv(deps.env ?? process.env));
    let fromToken: string = USDT;
    let toToken: string = version.address;
    let amount = toUnits(String(usd), USDT_DECIMALS).toString();
    let outDecimals = version.decimals;
    let outLabel = version.symbol;
    if (!buy) {
      const tokenUsd = decision.observed.find((o) => o.version.address.toLowerCase() === version.address.toLowerCase())?.tokenUsd;
      if (!tokenUsd || !(tokenUsd > 0)) return fail("no token price was observed for this version, so the quantity to sell is unknown.");
      fromToken = version.address;
      toToken = USDT;
      amount = toUnits(floor8(usd / tokenUsd), version.decimals).toString();
      outDecimals = USDT_DECIMALS;
      outLabel = "USDT";
    }

    const routes = await api.quote({ amount, fromToken, toToken, userWalletAddress: PROBE_WALLET });
    const route = pickRoute(routes, version.route === "RFQ" ? "RFQ" : "SWAP");
    const quote: QuoteSummary = {
      vendor: route.vendorName, executionMode: route.executionMode, toTokenAmount: route.toTokenAmount,
      priceImpactPercent: route.priceImpactPercent ?? null, routes: routes.length,
    };
    log.push(`quote: ${amount} of ${fromToken} -> ${toToken} via ${route.vendorName} ${route.executionMode}`);
    const impact = route.priceImpactPercent == null ? null : Number(route.priceImpactPercent);
    if (impact !== null && Number.isFinite(impact) && impact > rule.maxSlippageBps / 100) {
      return fail(`price impact ${impact}% exceeds the rule's ${rule.maxSlippageBps / 100}% slippage cap.`, { quote });
    }

    const [approveTx] = await api.approve({ token: fromToken, amount, vendor: version.route === "RFQ" ? route.vendorName : undefined });
    if (!approveTx?.data) return fail("the approve-transaction call returned no calldata.", { quote });
    const failed = simulateFailure(await api.simulate({ from: PROBE_WALLET, to: fromToken, data: approveTx.data }));
    const simulate = failed ?? "passed";
    log.push(`approval simulate: ${simulate}`);
    if (failed) return fail(`the approval ${failed}.`, { quote, simulate });

    const out = Number(BigInt(route.toTokenAmount)) / 10 ** outDecimals;
    return {
      ...base, outcome: "dry_run", quote, simulate,
      reason: `Dry run: would have ${verb} $${usd.toFixed(2)} of ${version.symbol} via ${route.vendorName} (${route.executionMode}), the quote returns ${out.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${outLabel}; approval simulate passed; nothing was signed.`,
    };
  } catch (e) {
    if (e instanceof Web3ApiError) return fail(`${e.kind} ${e.apiMsg.replace(/\.+$/, "")}.`);
    return fail(e instanceof Error ? e.message : String(e));
  }
}
