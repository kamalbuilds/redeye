import { randomUUID } from "node:crypto";
import type { Address, Decision, Fill, Rule, StockVersion } from "../types.ts";
import { createBaw } from "./baw.ts";
import type { Baw } from "./baw.ts";
import { BSC, Web3ApiError, createWeb3Client, credsFromEnv, rfqLifecycle, simulateFailure } from "./web3api.ts";
import type { QuoteRoute, SwapBuild, Web3Client } from "./web3api.ts";

// binance-agentic-wallet SKILL.md "Common Token Addresses", BSC table.
export const USDT: Address = "0x55d398326f99059fF775485246999027B3197955";
export const POLL_TIMEOUT_MS = 120_000;
export const POLL_INTERVAL_MS = 2_000;
const DEFAULT_RPC = "https://bsc-dataseed.bnbchain.org";

// ---------- poll to a terminal state ----------

export type Verdict = "pending" | "filled" | "failed" | "expired";
export interface PollOptions { timeoutMs?: number; intervalMs?: number; now?: () => number; sleep?: (ms: number) => Promise<void> }
export interface PollResult<T> { status: Exclude<Verdict, "pending">; last: T | null; timedOut: boolean; lastError: unknown }

// Polls fetchOnce until classify returns a terminal verdict. Stuck "pending" at the deadline is "failed", never "filled".
// Fetch errors are treated as transient (the deadline still ends the loop) except credential errors, which rethrow.
export async function pollToTerminal<T>(
  fetchOnce: () => Promise<T>,
  classify: (t: T) => Verdict,
  o: PollOptions = {},
): Promise<PollResult<T>> {
  const timeoutMs = o.timeoutMs ?? POLL_TIMEOUT_MS;
  const intervalMs = o.intervalMs ?? POLL_INTERVAL_MS;
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = now() + timeoutMs;
  let last: T | null = null;
  let lastError: unknown = null;
  for (;;) {
    try {
      last = await fetchOnce();
      lastError = null;
      const v = classify(last);
      if (v !== "pending") return { status: v, last, timedOut: false, lastError };
    } catch (e) {
      if (e instanceof Web3ApiError && (e.kind === "UNAUTHORIZED" || e.kind === "BAD_SIGNATURE" || e.kind === "BAD_TIMESTAMP")) throw e;
      lastError = e;
    }
    if (now() >= deadline) return { status: "failed", last, timedOut: true, lastError };
    await sleep(intervalMs);
  }
}

// ---------- pure helpers ----------

const HASH = /^0x[0-9a-fA-F]{64}$/;

// Decimal string to smallest units without floating point.
export function toUnits(human: string, decimals: number): bigint {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(human);
  if (!m) throw new Error(`bad decimal amount "${human}"`);
  const frac = (m[2] ?? "").padEnd(decimals, "0").slice(0, decimals);
  return BigInt(m[1] + frac);
}

// Floor to 8 decimals so a computed sell quantity can never exceed what is held.
export function floor8(x: number): string {
  if (!Number.isFinite(x) || x <= 0) throw new Error(`bad quantity ${x}`);
  const s = (Math.floor(x * 1e8) / 1e8).toFixed(8).replace(/\.?0+$/, "");
  if (s === "" || s === "0") throw new Error(`quantity ${x} rounds to zero`);
  return s;
}

// typedDataToSign is "a hex string (or JSON-encoded string)" (build-swap-transaction-response-data-rfq.ts).
export function typedDataJson(raw: string): string {
  const s = raw.trim();
  const json = /^0x(?:[0-9a-fA-F]{2})+$/.test(s) ? Buffer.from(s.slice(2), "hex").toString("utf8") : s;
  JSON.parse(json);
  return json;
}

// order/submit wants 0x + 65 bytes. external-sign.md L322-323 shows signature and signatureRecovery as separate fields.
export function composeSignature(signature: string, recovery: string | null): `0x${string}` {
  let s = signature.replace(/^0x/, "");
  if (s.length === 128 && recovery) s += recovery.replace(/^0x/, "");
  if (!/^[0-9a-fA-F]{130}$/.test(s)) throw new Error(`unexpected signature length ${s.length} (want 130 hex chars)`);
  return `0x${s}`;
}

export function pickRoute(routes: QuoteRoute[], want: "RFQ" | "SWAP"): QuoteRoute {
  const rfq = routes.filter((r) => r.executionMode === "RFQ");
  const swap = routes.filter((r) => r.executionMode === "SWAP");
  const pool = want === "RFQ" ? rfq : swap.length > 0 ? swap : routes;
  if (pool.length === 0) throw new Error(`quote has no ${want} route (modes: ${routes.map((r) => r.executionMode).join(",") || "none"})`);
  return [...pool].sort((a, b) => (BigInt(b.toTokenAmount) > BigInt(a.toTokenAmount) ? 1 : BigInt(b.toTokenAmount) < BigInt(a.toTokenAmount) ? -1 : 0))[0];
}

// ---------- execute ----------

export interface ExecDeps {
  env: Record<string, string | undefined>;
  api: Web3Client;
  baw: Baw;
  rpc: (to: string, data: string) => Promise<string>;
  poll: PollOptions;
  requestId: () => string;
}
export interface ExecOpts { live: boolean; log?: (msg: string) => void; deps?: Partial<ExecDeps> }

function pad32(addr: string): string {
  return addr.replace(/^0x/, "").toLowerCase().padStart(64, "0");
}

function bscRpc(url: string) {
  return async (to: string, data: string): Promise<string> => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
      signal: AbortSignal.timeout(10_000),
    });
    const j = (await res.json()) as { result?: string; error?: { message?: string } };
    if (typeof j.result !== "string") throw new Error(`eth_call failed: ${j.error?.message ?? res.status}`);
    return j.result;
  };
}

/**
 * Executes one fired decision on BSC mainnet.
 *
 * Path: quote -> approval check -> swap build -> Transaction API simulate (must pass) -> sign -> submit -> poll.
 * SWAP and MIXED versions (xStocks, bStocks) go live through the one-shot `baw market-order swap`. RFQ versions (Ondo)
 * go live by signing the typedDataToSign with `baw sign-message`, POST /order/submit, then polling /order/{id}.
 *
 * live=false is a dry run: everything up to and including simulate runs, nothing is signed or submitted, and the Fill is
 * status "expired" with txHash null and orderId null. simulated=true means the Transaction API simulate passed.
 * live=true returns "filled" only for a FINISHED baw order that carries a tx hash, or a FILLED RFQ order; a pending
 * order at the 120s deadline is "failed". A "failed" or "expired" Fill never hides a reason: it goes to opts.log.
 *
 * Simulate target: the first user-originated transaction. When the allowance is short that is the approve tx, since
 * the swap tx would revert before approval; otherwise the built swap tx. An RFQ order with sufficient allowance has no
 * user transaction (the user only signs typed data), so simulated stays false there.
 *
 * Needs BINANCE_W3_API_KEY and BINANCE_W3_API_SECRET in the environment even for a dry run, and a signed-in `baw`.
 */
export async function execute(decision: Decision, rule: Rule, opts: ExecOpts): Promise<Fill> {
  const env = opts.deps?.env ?? process.env;
  const api = opts.deps?.api ?? createWeb3Client(credsFromEnv(env)); // throws MissingKeyError before any network call
  const log = opts.log ?? ((m: string) => console.error(`[exec] ${m}`));
  const baw = opts.deps?.baw ?? createBaw();
  const rpc = opts.deps?.rpc ?? bscRpc(env.BSC_RPC_URL ?? DEFAULT_RPC);
  const poll = opts.deps?.poll ?? {};
  const newRequestId = opts.deps?.requestId ?? randomUUID;

  if (!decision.fire || !decision.version) throw new Error("execute called with a decision that did not fire");
  if (decision.ruleId !== rule.id) throw new Error(`decision.ruleId ${decision.ruleId} does not match rule.id ${rule.id}`);
  const version: StockVersion = decision.version;
  const side = rule.action.side;

  const state = { usd: rule.action.usd ?? 0, txHash: null as Address | null, orderId: null as string | null, simulated: false };
  const fill = (status: Fill["status"]): Fill => ({
    ruleId: rule.id, version, side, usd: state.usd, txHash: state.txHash, orderId: state.orderId, status, simulated: state.simulated,
  });
  const fail = (reason: string, status: Fill["status"] = "failed"): Fill => {
    log(`${status} ${rule.id} ${version.symbol}: ${reason}`);
    return fill(status);
  };

  try {
    const wallet = await baw.address(BSC);
    const settings = await baw.settings();

    // ---- size the trade ----
    let fromToken: string;
    let toToken: string;
    let fromDecimals: number;
    let qty: string; // human units of fromToken
    if (side === "buy") {
      const usd = rule.action.usd;
      if (!usd || usd <= 0) throw new Error("buy rule needs action.usd > 0");
      fromToken = USDT;
      toToken = version.address;
      fromDecimals = Number(BigInt(await rpc(USDT, "0x313ce567")));
      qty = String(usd);
    } else {
      fromToken = version.address;
      toToken = USDT;
      fromDecimals = version.decimals;
      const tokenUsd = decision.observed.find((o) => o.version.address.toLowerCase() === version.address.toLowerCase())?.tokenUsd ?? null;
      if (!tokenUsd || tokenUsd <= 0) return fail("sell needs an observed tokenUsd for this version");
      if (rule.action.usd) {
        qty = floor8(rule.action.usd / tokenUsd);
      } else if (rule.action.fractionOfHolding) {
        const held = await api.tokenBalance({ address: wallet, token: version.address });
        if (!held || !(Number(held) > 0)) return fail("no holding to sell");
        qty = rule.action.fractionOfHolding >= 1 ? held : floor8(Number(held) * rule.action.fractionOfHolding);
        state.usd = Number(qty) * tokenUsd;
      } else {
        throw new Error("sell rule needs action.usd or action.fractionOfHolding");
      }
    }
    const amount = toUnits(qty, fromDecimals).toString();
    const slippagePercent = String(rule.maxSlippageBps / 100);

    // ---- spending limit (read from baw, set only in the Binance App) ----
    if (typeof settings.quotaLeft !== "number") return fail("baw wallet settings returned no numeric quotaLeft");
    if (settings.quotaLeft < state.usd) return fail(`daily limit: quotaLeft ${settings.quotaLeft} < trade ${state.usd} USD`);
    const rfqRoute = version.route === "RFQ";
    if (opts.live && rfqRoute && !settings.devMode?.enabled) {
      return fail("Developer Mode is off in the Binance App; RFQ (Ondo) orders need sign-message");
    }

    // ---- quote and approval ----
    const quoteRoute = async (): Promise<QuoteRoute> => {
      const route = pickRoute(await api.quote({ amount, fromToken, toToken, userWalletAddress: wallet }), rfqRoute ? "RFQ" : "SWAP");
      const impact = route.priceImpactPercent == null ? null : Number(route.priceImpactPercent);
      if (impact !== null && Number.isFinite(impact) && impact > rule.maxSlippageBps / 100) {
        throw new Error(`price impact ${impact}% exceeds rule slippage ${rule.maxSlippageBps / 100}%`);
      }
      return route;
    };
    let route = await quoteRoute();
    const [approveTx] = await api.approve({ token: fromToken, amount, vendor: rfqRoute ? route.vendorName : undefined });
    if (!approveTx?.data || !approveTx.dexContractAddress) return fail("approve-transaction returned no calldata");
    const allowance = BigInt(await rpc(fromToken, "0xdd62ed3e" + pad32(wallet) + pad32(approveTx.dexContractAddress)));
    const needsApprove = allowance < BigInt(amount);

    const simulate = async (tx: { from: string; to: string; data: string; value?: string }): Promise<string | null> => {
      const reason = simulateFailure(await api.simulate(tx));
      if (reason === null) state.simulated = true;
      return reason;
    };

    if (needsApprove) {
      const reason = await simulate({ from: wallet, to: fromToken, data: approveTx.data });
      if (reason) return fail(`approve ${reason}`);
      if (!opts.live) {
        log(`dry run: allowance short, approve simulated OK; swap simulate runs once the approval exists`);
        return fill("expired");
      }
      if (rfqRoute) {
        const prev = await baw.contractPreview({ from: wallet, to: fromToken, data: approveTx.data });
        if (prev.requireConfirmation) return fail("approve needs confirmation in the Binance App");
        const sent = await baw.contractExecute(prev.requestId);
        if (sent.status !== "BROADCASTED" || !sent.txHash) return fail(`approve not broadcast: ${sent.status} ${sent.message ?? ""}`);
        const mined = await pollToTerminal(
          () => api.txStatus(sent.txHash as string),
          (t) => {
            const s = (t?.status ?? "").toLowerCase();
            return s === "success" ? "filled" : s === "failed" || s === "fail" ? "failed" : "pending";
          },
          poll,
        );
        if (mined.status !== "filled") return fail(`approve tx ${sent.txHash} ${mined.timedOut ? "not confirmed before timeout" : "failed"}`);
        route = await quoteRoute(); // the pre-approval quote is older than its ~30s TTL
      }
      // SWAP/MIXED: the one-shot baw swap performs its own approval.
    }

    // ---- build ----
    let build: SwapBuild | null = null;
    if (rfqRoute || !needsApprove) {
      const buildOnce = (r: QuoteRoute) =>
        api.swap({ amount, fromToken, toToken, userWalletAddress: wallet, quoteId: r.quoteId, slippagePercent });
      try {
        build = await buildOnce(route);
      } catch (e) {
        if (!(e instanceof Web3ApiError && e.kind === "QUOTE_EXPIRED")) throw e;
        route = await quoteRoute();
        build = await buildOnce(route);
      }
      if (build.tx?.to && build.tx.data) {
        const reason = await simulate({ from: build.tx.from ?? wallet, to: build.tx.to, data: build.tx.data, value: build.tx.value });
        if (reason) return fail(`swap ${reason}`);
      } else if (!rfqRoute) {
        return fail("swap build returned no transaction to simulate");
      }
    }

    if (!opts.live) {
      log(`dry run: ${side} ${qty} ${version.symbol} via ${rfqRoute ? "RFQ " + route.vendorName : "baw market-order swap"} simulated=${state.simulated}`);
      return fill("expired");
    }

    // ---- live: SWAP / MIXED through the one-shot baw swap ----
    if (!rfqRoute) {
      const { orderId } = await baw.marketSwap({ fromTokenQty: qty, fromToken, toToken, slippagePercent });
      log(`baw market order ${orderId} submitted`);
      const done = await pollToTerminal(
        () => baw.marketOrder(orderId),
        (o) => (o?.status === "FAILED" ? "failed" : o?.status === "FINISHED" && o.txHash && HASH.test(o.txHash) ? "filled" : "pending"),
        poll,
      );
      if (done.status === "filled" && done.last?.txHash) {
        state.txHash = done.last.txHash as Address;
        return fill("filled");
      }
      return fail(done.timedOut ? `baw order ${orderId} still pending at timeout` : `baw order ${orderId} FAILED`);
    }

    // ---- live: RFQ (Ondo) ----
    const rfq = build?.rfq;
    if (!rfq?.typedDataToSign) return fail("swap build returned no rfq.typedDataToSign");
    const preview = await baw.signTypedData({ signer: wallet, typedDataJson: typedDataJson(rfq.typedDataToSign) });
    let signed = await baw.signExecute(preview.requestId);
    if (signed.status === "PENDING_CONFIRMATION") {
      const waited = await pollToTerminal(
        () => baw.signResult(signed.orderId),
        (s) => (s.status === "COMPLETED" ? "filled" : s.status === "REJECTED" || s.status === "EXPIRED" ? "failed" : "pending"),
        poll,
      );
      if (waited.status !== "filled" || !waited.last) return fail("typed-data signature was not confirmed in the Binance App");
      signed = waited.last;
    }
    if (signed.status !== "COMPLETED" || !signed.signature) return fail(`typed-data signing ended ${signed.status}`);
    const userSignature = composeSignature(signed.signature, signed.signatureRecovery);

    // Source/doc disagreement: submitRfqOrder documents quoteId as rfq.orderId, but the SDK type for rfq has no orderId.
    const quoteId = rfq.orderId ?? route.quoteId;
    const submitted = await api.rfqSubmit({
      requestId: newRequestId(), userSignature, vendor: rfq.vendor, quoteId, signingScheme: rfq.signingScheme,
    });
    if (!submitted.orderId) return fail("order/submit returned no orderId");
    state.orderId = submitted.orderId;
    log(`rfq order ${submitted.orderId} submitted via ${rfq.vendor}`);

    const done = await pollToTerminal(() => api.rfqOrder(submitted.orderId), (o) => rfqLifecycle(o.status), poll);
    if (done.status === "filled") {
      const h = done.last?.txHash;
      state.txHash = h && HASH.test(h) ? (h as Address) : null;
      return fill("filled");
    }
    if (done.status === "expired") return fail(`rfq order ${submitted.orderId} ${done.last?.status}`, "expired");
    return fail(done.timedOut ? `rfq order ${submitted.orderId} still pending at timeout` : `rfq order ${submitted.orderId} ${done.last?.status}`);
  } catch (e) {
    return fail(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
  }
}
