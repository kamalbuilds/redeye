import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  MissingKeyError, Web3ApiError, createWeb3Client, credsFromEnv, rfqLifecycle, simulateFailure,
} from "./web3api.ts";

const CREDS = { apiKey: "k-test", apiSecret: "s-test" };
const NOW = new Date("2026-10-11T12:00:00.123Z");

interface Seen { url: string; method: string; headers: Record<string, string>; body: string | undefined }
function fakeFetch(respond: () => { status?: number; body?: unknown; headers?: Record<string, string> }) {
  const seen: Seen[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    seen.push({ url, method: String(init.method), headers: init.headers as Record<string, string>, body: init.body as string | undefined });
    const r = respond();
    const text = r.body === undefined ? "" : JSON.stringify(r.body);
    return new Response(text, { status: r.status ?? 200, headers: r.headers });
  }) as unknown as typeof fetch;
  return { seen, fetcher };
}
const expectedSig = (h: Record<string, string>, method: string, path: string, body: string) =>
  createHmac("sha256", CREDS.apiSecret).update(h["X-OC-TIMESTAMP"] + method + path + body, "utf8").digest("base64");

test("GET quote: url, /build in the signed path, raw query, empty body", async () => {
  const { seen, fetcher } = fakeFetch(() => ({ body: { code: 0, msg: "success", success: true, data: [{ quoteId: "q1", vendorName: "LiquidMesh", toTokenAmount: "10", executionMode: "SWAP" }] } }));
  const api = createWeb3Client(CREDS, fetcher, () => NOW);
  const routes = await api.quote({ amount: "5000000000000000000", fromToken: "0xaaa", toToken: "0xbbb", userWalletAddress: "0xccc" });
  assert.equal(routes[0].quoteId, "q1");
  const path = "/build/api/v1/dex/aggregator/quote?binanceChainId=56&amount=5000000000000000000&fromTokenAddress=0xaaa&toTokenAddress=0xbbb&userWalletAddress=0xccc";
  assert.equal(seen[0].url, "https://web3.binance.com" + path);
  assert.equal(seen[0].method, "GET");
  assert.equal(seen[0].body, undefined);
  assert.equal(seen[0].headers["X-OC-APIKEY"], "k-test");
  assert.equal(seen[0].headers["X-OC-TIMESTAMP"], "2026-10-11T12:00:00.123Z");
  assert.equal(seen[0].headers["X-OC-SIGN"], expectedSig(seen[0].headers, "GET", path, ""));
});

test("POST order/submit: body is signed byte for byte and signingScheme is optional", async () => {
  const { seen, fetcher } = fakeFetch(() => ({ body: { code: 0, success: true, data: { orderId: "o1", status: "PENDING_VENDOR" } } }));
  const api = createWeb3Client(CREDS, fetcher, () => NOW);
  const r = await api.rfqSubmit({ requestId: "r-1", userSignature: "0x" + "ab".repeat(65), vendor: "PcsXRfq", quoteId: "q9" });
  assert.equal(r.orderId, "o1");
  const body = '{"requestId":"r-1","userSignature":"0x' + "ab".repeat(65) + '","vendor":"PcsXRfq","quoteId":"q9"}';
  assert.equal(seen[0].body, body);
  assert.equal(seen[0].url, "https://web3.binance.com/build/api/v1/dex/aggregator/order/submit");
  assert.equal(seen[0].headers["X-OC-SIGN"], expectedSig(seen[0].headers, "POST", "/build/api/v1/dex/aggregator/order/submit", body));
});

test("simulate sends evmTx only; broadcast and rfqOrder paths", async () => {
  const { seen, fetcher } = fakeFetch(() => ({ body: { code: 0, success: true, data: {} } }));
  const api = createWeb3Client(CREDS, fetcher, () => NOW);
  await api.simulate({ from: "0xf", to: "0xt", data: "0xd" });
  await api.broadcast({ signedTransaction: "0xf86c", address: "0xf", enableMevProtection: true });
  await api.rfqOrder("ord/1");
  assert.equal(seen[0].url, "https://web3.binance.com/build/api/v1/dex/pre-transaction/simulate");
  assert.equal(seen[0].body, '{"binanceChainId":"56","evmTx":{"from":"0xf","to":"0xt","value":"0","data":"0xd"}}');
  assert.equal(seen[1].url, "https://web3.binance.com/build/api/v1/dex/pre-transaction/broadcast-transaction");
  assert.equal(seen[1].body, '{"binanceChainId":"56","signedTransaction":"0xf86c","address":"0xf","enableMevProtection":true}');
  assert.equal(seen[2].url, "https://web3.binance.com/build/api/v1/dex/aggregator/order/ord%2F1");
  assert.equal(seen[2].method, "GET");
  assert.equal(seen[2].body, undefined);
});

test("rfqQuote keeps RFQ routes only and throws when there are none", async () => {
  let modes = ["SWAP", "RFQ"];
  const { fetcher } = fakeFetch(() => ({ body: { code: 0, success: true, data: modes.map((m, i) => ({ quoteId: `q${i}`, vendorName: "v", toTokenAmount: "1", executionMode: m })) } }));
  const api = createWeb3Client(CREDS, fetcher, () => NOW);
  const p = { amount: "1", fromToken: "0xa", toToken: "0xb", userWalletAddress: "0xc" };
  assert.deepEqual((await api.rfqQuote(p)).map((r) => r.quoteId), ["q1"]);
  modes = ["SWAP"];
  await assert.rejects(() => api.rfqQuote(p), /no RFQ route/);
});

test("typed API errors carry code, kind and message", async () => {
  const cases: [number, number, string][] = [
    [401, 40101, "UNAUTHORIZED"], [401, 40102, "BAD_SIGNATURE"], [401, 40103, "BAD_TIMESTAMP"], [400, 40367, "ONDO_CLOSED"],
    [400, 40369, "BSTOCK_CLOSED"], [200, 40374, "NO_LIQUIDITY"], [200, 40375, "MIN_ORDER"], [404, 40401, "QUOTE_EXPIRED"], [400, 40001, "OTHER"],
  ];
  for (const [status, code, kind] of cases) {
    const { fetcher } = fakeFetch(() => ({ status, body: { code, msg: `boom ${code}` } }));
    const api = createWeb3Client(CREDS, fetcher, () => NOW);
    await assert.rejects(() => api.quote({ amount: "1", fromToken: "0xa", toToken: "0xb" }), (e: unknown) => {
      assert.ok(e instanceof Web3ApiError);
      assert.equal(e.code, code);
      assert.equal(e.kind, kind);
      assert.equal(e.apiMsg, `boom ${code}`);
      assert.equal(e.httpStatus, status);
      return true;
    });
  }
});

test("an HTTP 200 envelope with an error code is still an error; empty 401 takes the code from x-oc-blocked-by", async () => {
  let r: { status?: number; body?: unknown; headers?: Record<string, string> } = { body: { code: 40401, msg: "QUOTE_EXPIRED", data: null } };
  const { fetcher } = fakeFetch(() => r);
  const api = createWeb3Client(CREDS, fetcher, () => NOW);
  await assert.rejects(() => api.swap({ amount: "1", fromToken: "0xa", toToken: "0xb", userWalletAddress: "0xc", quoteId: "q", slippagePercent: "1" }), (e: unknown) => e instanceof Web3ApiError && e.kind === "QUOTE_EXPIRED");
  r = { status: 401, headers: { "x-oc-blocked-by": "AuthenticationFilter/40101" } };
  await assert.rejects(() => api.quote({ amount: "1", fromToken: "0xa", toToken: "0xb" }), (e: unknown) => e instanceof Web3ApiError && e.kind === "UNAUTHORIZED" && e.code === 40101);
});

test("txStatus returns null for an unknown tx; tokenBalance reads the matching asset", async () => {
  let data: unknown = null;
  const { fetcher } = fakeFetch(() => ({ body: { code: 0, success: true, data } }));
  const api = createWeb3Client(CREDS, fetcher, () => NOW);
  assert.equal(await api.txStatus("0xabc"), null);
  data = [{ tokenAssets: [{ tokenContractAddress: "0xAAA", balance: "1.5" }] }];
  assert.equal(await api.tokenBalance({ address: "0xw", token: "0xaaa" }), "1.5");
  assert.equal(await api.tokenBalance({ address: "0xw", token: "0xzzz" }), null);
});

test("RFQ order status mapping", () => {
  const table: [string | undefined, string][] = [
    ["FILLED", "filled"], ["filled", "filled"], ["FAILED", "failed"], ["EXPIRED", "expired"], ["CANCELLED", "expired"],
    ["PENDING_VENDOR", "pending"], ["PENDING_ONCHAIN", "pending"], ["SOMETHING_NEW", "pending"], ["", "pending"], [undefined, "pending"],
  ];
  for (const [s, want] of table) assert.equal(rfqLifecycle(s), want, String(s));
});

test("simulate verdict fails closed on failure and on unknown status", () => {
  assert.equal(simulateFailure({ status: "SUCCESS", failReason: null }), null);
  assert.match(simulateFailure({ status: "FAILED", failReason: "execution reverted" }) ?? "", /execution reverted/);
  assert.match(simulateFailure({ status: "FAILED" }) ?? "", /no failReason/);
  assert.match(simulateFailure({ status: "WEIRD" }) ?? "", /unrecognized status "WEIRD"/);
  assert.match(simulateFailure({ status: "SUCCESS", failReason: "x" }) ?? "", /simulate failed: x/);
  assert.match(simulateFailure(null) ?? "", /no data/);
});

test("credsFromEnv names the missing variable and never echoes values", () => {
  assert.throws(() => credsFromEnv({}), (e: unknown) => e instanceof MissingKeyError && /BINANCE_W3_API_KEY missing/.test(e.message));
  assert.throws(() => credsFromEnv({ BINANCE_W3_API_KEY: "abc" }), (e: unknown) => e instanceof MissingKeyError && /BINANCE_W3_API_SECRET missing/.test(e.message) && !e.message.includes("abc"));
  assert.deepEqual(credsFromEnv({ BINANCE_W3_API_KEY: "a", BINANCE_W3_API_SECRET: "b" }), { apiKey: "a", apiSecret: "b" });
});

// Real signed read-only request, only when the keys are in process.env (node --env-file=.env --test src/exec/).
const haveKeys = Boolean(process.env.BINANCE_W3_API_KEY && process.env.BINANCE_W3_API_SECRET);
test("live read-only quote: $5 USDT -> TSLAB", { skip: haveKeys ? false : "BINANCE_W3_API_KEY/BINANCE_W3_API_SECRET not in process.env, no live call made" }, async (t) => {
  const USDT = "0x55d398326f99059fF775485246999027B3197955";
  const TSLAB = "0x5b1910eaad6450e50f816082aa078c41f10c292f";
  const wire: { http: number; code: unknown; msg: unknown }[] = [];
  const recording = (async (url: string, init: RequestInit) => {
    const res = await fetch(url, init);
    const text = await res.clone().text();
    let j: { code?: unknown; msg?: unknown } = {};
    try { j = JSON.parse(text); } catch { /* empty body */ }
    wire.push({ http: res.status, code: j.code ?? res.headers.get("x-oc-blocked-by"), msg: j.msg });
    return res;
  }) as unknown as typeof fetch;
  const api = createWeb3Client(credsFromEnv(), recording);
  let routes: unknown[] = [];
  try {
    routes = await api.quote({ amount: "5000000000000000000", fromToken: USDT, toToken: TSLAB, userWalletAddress: "0x000000000000000000000000000000000000dEaD" });
  } catch (e) {
    assert.ok(e instanceof Web3ApiError, String(e));
    assert.ok(e.kind !== "UNAUTHORIZED" && e.kind !== "BAD_SIGNATURE" && e.kind !== "BAD_TIMESTAMP", `auth/signing rejected: code ${e.code} ${e.apiMsg}`);
  }
  const line = `live quote http=${wire[0]?.http} code=${String(wire[0]?.code)} msg=${String(wire[0]?.msg)} routes=${routes.length}`;
  console.log(line);
  t.diagnostic(line);
});

test("live read-only RFQ quote: $5 USDT -> TSLAon (Ondo)", { skip: haveKeys ? false : "keys not in process.env, no live call made" }, async (t) => {
  const USDT = "0x55d398326f99059fF775485246999027B3197955";
  const TSLAON = "0x2494b603319d4d9f9715c9f4496d9e0364b59d93";
  const api = createWeb3Client(credsFromEnv());
  let line: string;
  try {
    const routes = await api.rfqQuote({ amount: "5000000000000000000", fromToken: USDT, toToken: TSLAON, userWalletAddress: "0x000000000000000000000000000000000000dEaD" });
    line = `live rfq quote ok routes=${routes.length} vendors=${routes.map((r) => r.vendorName).join(",")}`;
  } catch (e) {
    assert.ok(e instanceof Web3ApiError || /no RFQ route/.test(String(e)), String(e));
    if (e instanceof Web3ApiError) assert.ok(e.kind !== "UNAUTHORIZED" && e.kind !== "BAD_SIGNATURE" && e.kind !== "BAD_TIMESTAMP", `auth/signing rejected: code ${e.code}`);
    line = e instanceof Web3ApiError ? `live rfq quote code=${e.code} kind=${e.kind} http=${e.httpStatus} msg=${e.apiMsg}` : `live rfq quote: ${(e as Error).message}`;
  }
  console.log(line);
  t.diagnostic(line);
});

test("simulate verdict on payloads captured live (BSC, read-only)", () => {
  const passed = { status: "SUCCESS", failReason: "", balanceChanges: [], allowanceChanges: [{ spender: "0xb44446b0c8e56988c34f7ff73ae904982b5fdda5", preAmount: "0", postAmount: "1" }] };
  const reverted = { status: "FAILED", failReason: "execution reverted: BEP20: transfer amount exceeds balance", balanceChanges: [], allowanceChanges: [] };
  assert.equal(simulateFailure(passed), null);
  assert.equal(simulateFailure(reverted), "simulate failed: execution reverted: BEP20: transfer amount exceeds balance");
});
