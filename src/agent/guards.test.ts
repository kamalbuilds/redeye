import { test } from "node:test";
import assert from "node:assert/strict";
import type { Decision } from "../types.ts";
import type { Web3Client } from "../exec/web3api.ts";
import { banner, guardedTrade, isLive, ONDO_MIN_USD, refusal } from "./guards.ts";
import { rule, spyExecute, TSLAB, TSLAon } from "./fixtures.ts";

const decision = (v = TSLAB): Decision => ({ ruleId: "TSLA-down-8-1", fire: true, version: v, reason: "r", observed: [] });
const LIVE = { REDEYE_LIVE: "yes" };

test("cap: usd above maxUsdPerTrade never reaches execute; at the cap it does", async () => {
  const spy = spyExecute();
  const over = await guardedTrade(decision(), rule({ usd: 50 }), null, { live: false, maxUsdPerTrade: 5 }, { execute: spy, env: {} });
  assert.equal(spy.calls.length, 0, "execute was called for a $50 trade under a $5 cap");
  assert.equal(over.outcome, "skipped");
  assert.match(over.reason, /per-trade cap of \$5/);
  const exact = await guardedTrade(decision(), rule({ usd: 5 }), null, { live: false, maxUsdPerTrade: 5 }, { execute: spy, env: {} });
  assert.equal(spy.calls.length, 1, "a $5 trade at a $5 cap must pass (positive control)");
  assert.equal(exact.outcome, "dry_run");
});

test("cap: a broken cap (NaN, 0, negative) fails closed", async () => {
  const spy = spyExecute();
  for (const cap of [NaN, 0, -1]) {
    const r = await guardedTrade(decision(), rule({ usd: 5 }), null, { live: false, maxUsdPerTrade: cap }, { execute: spy, env: {} });
    assert.equal(r.outcome, "skipped", `cap ${cap}`);
  }
  assert.equal(spy.calls.length, 0);
});

test("cap: a fraction-of-holding sell is held to the cap by its dollar estimate", async () => {
  const spy = spyExecute();
  const r = rule({ side: "sell", fraction: 0.5 });
  assert.equal((await guardedTrade(decision(), r, 40, { live: false, maxUsdPerTrade: 5 }, { execute: spy, env: {} })).outcome, "skipped");
  assert.equal((await guardedTrade(decision(), r, null, { live: false, maxUsdPerTrade: 5 }, { execute: spy, env: {} })).outcome, "skipped", "no estimate must not slip through");
  assert.equal(spy.calls.length, 0);
  assert.equal((await guardedTrade(decision(), r, 4, { live: false, maxUsdPerTrade: 5 }, { execute: spy, env: {} })).outcome, "dry_run");
  assert.equal(spy.calls.length, 1);
});

test("live: --live without REDEYE_LIVE=yes stays dry; with it, live", async () => {
  const spy = spyExecute();
  const opts = { live: true, maxUsdPerTrade: 5 };
  for (const env of [{}, { REDEYE_LIVE: "true" }, { REDEYE_LIVE: "YES" }, { REDEYE_LIVE: "" }]) {
    await guardedTrade(decision(), rule(), null, opts, { execute: spy, env });
  }
  assert.equal(spy.calls.length, 4);
  assert.deepEqual(spy.calls.map((c) => c.opts.live), [false, false, false, false]);
  await guardedTrade(decision(), rule(), null, opts, { execute: spy, env: LIVE });
  assert.equal(spy.calls[4].opts.live, true, "REDEYE_LIVE=yes plus live:true must be live (positive control)");
  await guardedTrade(decision(), rule(), null, { live: false, maxUsdPerTrade: 5 }, { execute: spy, env: LIVE });
  assert.equal(spy.calls[5].opts.live, false, "REDEYE_LIVE=yes alone must not go live");
});

test("isLive and banner", () => {
  assert.equal(isLive({ live: true, maxUsdPerTrade: 5 }, LIVE), true);
  assert.equal(isLive({ live: true, maxUsdPerTrade: 5 }, {}), false);
  assert.equal(banner({ live: false, maxUsdPerTrade: 5 }, {}), "DRY RUN");
  assert.equal(banner({ live: true, maxUsdPerTrade: 5 }, LIVE), "LIVE (cap $5)");
  assert.match(banner({ live: true, maxUsdPerTrade: 5 }, {}), /^DRY RUN \(--live ignored/);
});

test("ondo: below $5.01 is skipped, bStocks at the same size is not", () => {
  const o = { live: false, maxUsdPerTrade: 50 };
  assert.match(refusal(rule({ usd: 5 }), TSLAon, 5, o) ?? "", /at least \$5\.01/);
  assert.equal(refusal(rule({ usd: ONDO_MIN_USD }), TSLAon, ONDO_MIN_USD, o), null);
  assert.equal(refusal(rule({ usd: 5 }), TSLAB, 5, o), null);
});

test("slippage: a rule without a valid maxSlippageBps is refused", () => {
  const o = { live: false, maxUsdPerTrade: 5 };
  assert.match(refusal(rule({ maxSlippageBps: 0 }), TSLAB, 5, o) ?? "", /slippage/);
  assert.match(refusal(rule({ maxSlippageBps: NaN }), TSLAB, 5, o) ?? "", /slippage/);
  assert.equal(refusal(rule({ maxSlippageBps: 100 }), TSLAB, 5, o), null);
});

test("receipt data: the quote and simulate result seen by execute are captured", async () => {
  const api = {
    quote: async () => [{ quoteId: "q1", vendorName: "LiquidMesh", toTokenAmount: "13000000000000000", executionMode: "SWAP", priceImpactPercent: "0.1" }],
    simulate: async () => ({ status: "SUCCESS" }),
  } as unknown as Web3Client;
  const exec = async (d: any, r: any, o: any) => {
    await o.deps.api.quote({ amount: "5", fromToken: "a", toToken: "b" });
    await o.deps.api.simulate({ from: "a", to: "b", data: "0x" });
    o.log("dry run: ok");
    return { ruleId: r.id, version: d.version, side: "buy", usd: 5, txHash: null, orderId: null, status: "expired", simulated: true } as const;
  };
  const r = await guardedTrade(decision(), rule(), null, { live: false, maxUsdPerTrade: 5 }, { execute: exec, api, env: {} });
  assert.equal(r.outcome, "dry_run");
  assert.equal(r.simulate, "passed");
  assert.equal(r.quote?.vendor, "LiquidMesh");
  assert.equal(r.quote?.toTokenAmount, "13000000000000000");
  assert.deepEqual(r.execLog, ["dry run: ok"]);
  const bad = { ...api, simulate: async () => ({ status: "FAILED", failReason: "reverted" }) } as unknown as Web3Client;
  assert.match((await guardedTrade(decision(), rule(), null, { live: false, maxUsdPerTrade: 5 }, { execute: exec, api: bad, env: {} })).simulate, /reverted/);
});

test("an execute that throws becomes a failed result, not a crash", async () => {
  const r = await guardedTrade(decision(), rule(), null, { live: false, maxUsdPerTrade: 5 }, { execute: async () => { throw new Error("boom"); }, env: {} });
  assert.equal(r.outcome, "failed");
  assert.match(r.reason, /boom/);
});
