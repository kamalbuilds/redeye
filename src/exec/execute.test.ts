import { test } from "node:test";
import assert from "node:assert/strict";
import type { Decision, Rule, StockVersion } from "../types.ts";
import type { Baw } from "./baw.ts";
import { USDT, composeSignature, execute, floor8, pickRoute, pollToTerminal, toUnits, typedDataJson } from "./execute.ts";
import type { ExecDeps, PollOptions, Verdict } from "./execute.ts";
import { MissingKeyError, Web3ApiError } from "./web3api.ts";
import type { QuoteRoute, Web3Client } from "./web3api.ts";

// Virtual clock: sleeping advances time, so a 120s timeout runs instantly.
function clock(): PollOptions & { t: () => number } {
  let t = 0;
  return { now: () => t, sleep: async (ms) => { t += ms; }, t: () => t };
}

// ---------- poll loop ----------

test("poll: an order that stays pending ends failed at the 120s timeout, never filled", async () => {
  const c = clock();
  let calls = 0;
  const r = await pollToTerminal(async () => { calls++; return { status: "PENDING" }; }, (): Verdict => "pending", c);
  assert.equal(r.status, "failed");
  assert.equal(r.timedOut, true);
  assert.ok(calls > 10, `polled ${calls} times`);
  assert.ok(c.t() >= 120_000 && c.t() <= 122_000, `virtual elapsed ${c.t()}`);
});

test("poll: returns the first terminal verdict and keeps polling through transient errors", async () => {
  const c = clock();
  const seq: (string | Error)[] = ["PENDING", new Error("socket hang up"), "PENDING", "FILLED"];
  let i = 0;
  const r = await pollToTerminal(async () => { const v = seq[i++]; if (v instanceof Error) throw v; return v; }, (s) => (s === "FILLED" ? "filled" : "pending"), c);
  assert.equal(r.status, "filled");
  assert.equal(r.timedOut, false);
  assert.equal(i, 4);
});

test("poll: persistent fetch errors end failed at the deadline; credential errors rethrow at once", async () => {
  const c = clock();
  const r = await pollToTerminal(async () => { throw new Error("down"); }, (): Verdict => "filled", c);
  assert.equal(r.status, "failed");
  assert.match(String(r.lastError), /down/);
  await assert.rejects(() => pollToTerminal(async () => { throw new Web3ApiError(40102, "sig", 401, "x"); }, (): Verdict => "pending", clock()), /40102/);
});

// ---------- pure helpers ----------

test("units, quantity and signature helpers", () => {
  assert.equal(toUnits("5", 18), 5_000_000_000_000_000_000n);
  assert.equal(toUnits("0.000001", 6), 1n);
  assert.equal(toUnits("1.23456789", 4), 12345n);
  assert.equal(floor8(0.123456789), "0.12345678");
  assert.equal(floor8(2), "2");
  assert.throws(() => floor8(1e-12), /rounds to zero/);
  assert.equal(typedDataJson('{"a":1}'), '{"a":1}');
  assert.equal(typedDataJson("0x" + Buffer.from('{"a":1}').toString("hex")), '{"a":1}');
  assert.equal(composeSignature("ab".repeat(64), "01"), "0x" + "ab".repeat(64) + "01");
  assert.equal(composeSignature("0x" + "cd".repeat(65), null), "0x" + "cd".repeat(65));
  assert.throws(() => composeSignature("abcd", "01"), /unexpected signature length/);
  const routes = [
    { quoteId: "a", vendorName: "x", toTokenAmount: "5", executionMode: "SWAP" },
    { quoteId: "b", vendorName: "y", toTokenAmount: "9", executionMode: "RFQ" },
    { quoteId: "c", vendorName: "z", toTokenAmount: "7", executionMode: "SWAP" },
  ] as QuoteRoute[];
  assert.equal(pickRoute(routes, "SWAP").quoteId, "c");
  assert.equal(pickRoute(routes, "RFQ").quoteId, "b");
  assert.throws(() => pickRoute([routes[0]], "RFQ"), /no RFQ route/);
});

// ---------- execute ----------

const TSLAB: StockVersion = { ticker: "TSLA", issuer: "bstocks", symbol: "TSLAB", address: "0x5b1910eaad6450e50f816082aa078c41f10c292f", decimals: 18, multiplier: 1, route: "MIXED" };
const TSLAON: StockVersion = { ticker: "TSLA", issuer: "ondo", symbol: "TSLAon", address: "0x2494b603319d4d9f9715c9f4496d9e0364b59d93", decimals: 18, multiplier: 1, route: "RFQ" };
const rule: Rule = {
  id: "r1", ticker: "TSLA",
  trigger: { kind: "move_pct", direction: "down", pct: 5, from: "last_close" },
  action: { side: "buy", usd: 5 }, window: { startMs: 0, endMs: 1 }, maxSlippageBps: 100,
};
const decisionFor = (version: StockVersion): Decision => ({ ruleId: "r1", fire: true, version, reason: "test", observed: [] });
const WALLET = "0x1111111111111111111111111111111111111111";
const HASH = "0x" + "ab".repeat(32);
const word = (n: bigint) => "0x" + n.toString(16).padStart(64, "0");

interface World {
  deps: Partial<ExecDeps>;
  log: string[];
  api: string[];
  baw: string[];
  c: ReturnType<typeof clock>;
}
interface WorldOpts {
  allowance?: bigint;
  simulate?: { status: string; failReason?: string | null };
  quoteModes?: string[];
  swapTx?: { to: string; data: string } | null;
  quotaLeft?: number;
  devMode?: boolean;
  orderStatuses?: (string | { status: string; txHash?: string | null })[];
  swapFailures?: Web3ApiError[];
  marketOrders?: ({ status: string; txHash: string | null })[];
  signStatus?: string;
}
function world(o: WorldOpts = {}): World {
  const c = clock();
  const api: string[] = [];
  const bawCalls: string[] = [];
  const log: string[] = [];
  const orderSeq = [...(o.orderStatuses ?? ["FILLED"])];
  const marketSeq = [...(o.marketOrders ?? [{ status: "FINISHED", txHash: HASH }])];
  const swapFailures = [...(o.swapFailures ?? [])];
  const fakeApi = {
    async quote() {
      api.push("quote");
      return (o.quoteModes ?? ["SWAP"]).map((m, i) => ({ quoteId: `q${api.length}-${i}`, vendorName: m === "RFQ" ? "PcsXRfq" : "LiquidMesh", toTokenAmount: "100", priceImpactPercent: "0.1", executionMode: m }));
    },
    async approve(p: { vendor?: string }) { api.push(`approve:${p.vendor ?? ""}`); return [{ data: "0x095ea7b3", dexContractAddress: "0x2222222222222222222222222222222222222222" }]; },
    async swap() {
      api.push("swap");
      const f = swapFailures.shift();
      if (f) throw f;
      const tx = o.swapTx === null ? undefined : (o.swapTx ?? { to: "0x3333333333333333333333333333333333333333", data: "0xdeadbeef" });
      return { executionMode: "RFQ", tx, rfq: { vendor: "PcsXRfq", orderId: "rfq-quote-1", typedDataToSign: '{"types":{}}', signingScheme: "eip712" } };
    },
    async simulate(p: { to: string }) { api.push(`simulate:${p.to}`); return o.simulate ?? { status: "SUCCESS", failReason: null }; },
    async rfqSubmit(p: { userSignature: string; vendor: string; quoteId: string; requestId: string }) { api.push(`submit:${p.vendor}:${p.quoteId}:${p.userSignature.length}:${p.requestId}`); return { orderId: "ord-1" }; },
    async rfqOrder() { api.push("rfqOrder"); const s = orderSeq.length > 1 ? orderSeq.shift()! : orderSeq[0]; return typeof s === "string" ? { status: s } : s; },
    async txStatus() { api.push("txStatus"); return { status: "success" }; },
    async tokenBalance() { return null; },
  } as unknown as Web3Client;
  const baw: Baw = {
    async address() { return WALLET; },
    async settings() { return { dailyLimit: 100, quotaLeft: o.quotaLeft ?? 100, tradeAllTokens: true, devMode: { enabled: o.devMode ?? true, expiresAt: 1 } }; },
    async marketSwap() { bawCalls.push("marketSwap"); return { orderId: "m1" }; },
    async marketOrder() { bawCalls.push("marketOrder"); const s = marketSeq.length > 1 ? marketSeq.shift()! : marketSeq[0]; return { orderId: "m1", ...s }; },
    async signTypedData() { bawCalls.push("signTypedData"); return { requestId: "sr1", requireConfirmation: false }; },
    async signExecute() { bawCalls.push("signExecute"); return { orderId: "so1", status: o.signStatus ?? "COMPLETED", signature: "ab".repeat(64), signatureRecovery: "01" }; },
    async signResult() { return { orderId: "so1", status: "COMPLETED", signature: "ab".repeat(64), signatureRecovery: "01" }; },
    async contractPreview() { bawCalls.push("contractPreview"); return { requestId: "cp1", requireConfirmation: false }; },
    async contractExecute() { bawCalls.push("contractExecute"); return { orderId: "co1", status: "BROADCASTED", txHash: HASH }; },
  };
  const rpc = async (_to: string, data: string) => (data.startsWith("0x313ce567") ? word(18n) : word(o.allowance ?? 10n ** 30n));
  return { deps: { env: {}, api: fakeApi, baw, rpc, poll: c, requestId: () => "req-1" }, log, api, baw: bawCalls, c };
}
const opts = (w: World, live: boolean) => ({ live, log: (m: string) => w.log.push(m), deps: w.deps });

test("execute with live=false and no keys throws 'BINANCE_W3_API_KEY missing' before any network call", async () => {
  const realFetch = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = (async () => { fetched++; throw new Error("network must not be touched"); }) as typeof fetch;
  try {
    await assert.rejects(() => execute(decisionFor(TSLAB), rule, { live: false, deps: { env: {} } }), (e: unknown) => e instanceof MissingKeyError && /BINANCE_W3_API_KEY missing/.test(e.message));
    await assert.rejects(() => execute(decisionFor(TSLAB), rule, { live: false, deps: { env: { BINANCE_W3_API_KEY: "k" } } }), /BINANCE_W3_API_SECRET missing/);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(fetched, 0);
});

test("dry run, bStock buy: simulated, nothing signed, Fill is expired with no hash", async () => {
  const w = world();
  const f = await execute(decisionFor(TSLAB), rule, opts(w, false));
  assert.deepEqual({ status: f.status, txHash: f.txHash, orderId: f.orderId, simulated: f.simulated, usd: f.usd, side: f.side }, { status: "expired", txHash: null, orderId: null, simulated: true, usd: 5, side: "buy" });
  assert.deepEqual(w.api, ["quote", "approve:", "swap", "simulate:0x3333333333333333333333333333333333333333"]);
  assert.deepEqual(w.baw, []);
});

test("simulate failure: Fill failed, simulated false, reason logged, nothing submitted", async () => {
  const w = world({ simulate: { status: "FAILED", failReason: "execution reverted: STF" } });
  const f = await execute(decisionFor(TSLAB), rule, opts(w, true));
  assert.equal(f.status, "failed");
  assert.equal(f.simulated, false);
  assert.equal(f.txHash, null);
  assert.ok(w.log.some((l) => l.includes("execution reverted: STF")), w.log.join("|"));
  assert.deepEqual(w.baw, []);
});

test("short allowance on a bStock: the approve tx is the simulate target, dry run stops there", async () => {
  const w = world({ allowance: 0n });
  const f = await execute(decisionFor(TSLAB), rule, opts(w, false));
  assert.equal(f.status, "expired");
  assert.equal(f.simulated, true);
  assert.deepEqual(w.api, ["quote", "approve:", `simulate:${USDT}`]);
});

test("live bStock: filled only after baw reports FINISHED with a tx hash", async () => {
  const w = world({ marketOrders: [{ status: "PENDING", txHash: null }, { status: "PENDING", txHash: null }, { status: "FINISHED", txHash: HASH }] });
  const f = await execute(decisionFor(TSLAB), rule, opts(w, true));
  assert.equal(f.status, "filled");
  assert.equal(f.txHash, HASH);
  assert.equal(f.orderId, null);
  assert.equal(f.simulated, true);
  assert.equal(w.baw.filter((x) => x === "marketOrder").length, 3);
});

test("live bStock: pending forever is failed, FINISHED without a hash is not filled, FAILED is failed", async () => {
  for (const [orders, why] of [
    [[{ status: "PENDING", txHash: null }], "still pending at timeout"],
    [[{ status: "FINISHED", txHash: null }], "still pending at timeout"],
    [[{ status: "FAILED", txHash: null }], "FAILED"],
  ] as const) {
    const w = world({ marketOrders: [...orders] });
    const f = await execute(decisionFor(TSLAB), rule, opts(w, true));
    assert.equal(f.status, "failed", why);
    assert.equal(f.txHash, null);
    assert.ok(w.log.some((l) => l.includes(why)), w.log.join("|"));
  }
});

test("live Ondo RFQ: sign, submit with composed signature and rfq.orderId, poll to FILLED", async () => {
  const w = world({ quoteModes: ["SWAP", "RFQ"], orderStatuses: ["PENDING_VENDOR", "PENDING_ONCHAIN", { status: "FILLED", txHash: HASH }] });
  const f = await execute(decisionFor(TSLAON), rule, opts(w, true));
  assert.equal(f.status, "filled");
  assert.equal(f.orderId, "ord-1");
  assert.equal(f.txHash, HASH);
  assert.ok(w.api.includes("approve:PcsXRfq"), w.api.join(","));
  assert.ok(w.api.includes("submit:PcsXRfq:rfq-quote-1:132:req-1"), w.api.join(","));
  assert.deepEqual(w.baw, ["signTypedData", "signExecute"]);
});

test("live Ondo RFQ: EXPIRED maps to expired, FAILED to failed, stuck pending to failed", async () => {
  for (const [orders, want] of [[["EXPIRED"], "expired"], [["CANCELLED"], "expired"], [["FAILED"], "failed"], [["PENDING_VENDOR"], "failed"]] as const) {
    const w = world({ quoteModes: ["RFQ"], orderStatuses: [...orders] });
    const f = await execute(decisionFor(TSLAON), rule, opts(w, true));
    assert.equal(f.status, want, orders[0]);
    assert.equal(f.orderId, "ord-1", "the order id stays on the Fill for reconciliation");
    assert.equal(f.txHash, null);
  }
});

test("Ondo RFQ with Developer Mode off fails before anything is signed", async () => {
  const w = world({ quoteModes: ["RFQ"], devMode: false });
  const f = await execute(decisionFor(TSLAON), rule, opts(w, true));
  assert.equal(f.status, "failed");
  assert.deepEqual(w.baw, []);
  assert.ok(w.log.some((l) => l.includes("Developer Mode")));
});

test("Ondo RFQ with a short allowance approves through baw contract-call and waits for the tx", async () => {
  const w = world({ quoteModes: ["RFQ"], allowance: 0n });
  const f = await execute(decisionFor(TSLAON), rule, opts(w, true));
  assert.equal(f.status, "filled");
  assert.deepEqual(w.baw, ["contractPreview", "contractExecute", "signTypedData", "signExecute"]);
  assert.deepEqual(w.api.filter((x) => x === "quote").length, 2, "fresh quote after the approval");
});

test("QUOTE_EXPIRED on swap build retries once with a fresh quote; the daily limit stops a trade early", async () => {
  const w = world({ swapFailures: [new Web3ApiError(40401, "QUOTE_EXPIRED", 404, "swap")] });
  const f = await execute(decisionFor(TSLAB), rule, opts(w, false));
  assert.equal(f.simulated, true);
  assert.equal(w.api.filter((x) => x === "quote").length, 2);
  const w2 = world({ quotaLeft: 1 });
  const f2 = await execute(decisionFor(TSLAB), rule, opts(w2, true));
  assert.equal(f2.status, "failed");
  assert.deepEqual(w2.api, []);
  assert.ok(w2.log.some((l) => l.includes("daily limit")));
});

test("API errors (Ondo outside hours) become a failed Fill with the code in the log", async () => {
  const w = world();
  (w.deps.api as unknown as { quote: () => Promise<never> }).quote = async () => { throw new Web3ApiError(40367, "Ondo market closed", 400, "GET quote"); };
  const f = await execute(decisionFor(TSLAON), rule, opts(w, true));
  assert.equal(f.status, "failed");
  assert.ok(w.log.some((l) => l.includes("40367")));
});
