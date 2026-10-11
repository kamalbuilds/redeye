import { test } from "node:test";
import assert from "node:assert/strict";
import type { StockVersion } from "../types.ts";
import { tick } from "./tick.ts";
import type { TickDeps } from "./tick.ts";
import { NOW, OPEN, priceOf, rule, spyExecute, tmpStore, TSLAB, TSLAon } from "./fixtures.ts";

const CLOSE = 100;
// bStocks trades at `bst`; optionally an Ondo version priced at `ondo` (derived from the stock price).
function market(bst: number, ondo?: number): Partial<TickDeps> {
  const versions: StockVersion[] = ondo === undefined ? [TSLAB] : [TSLAon, TSLAB];
  return {
    listVersions: async () => versions,
    priceVersions: async () => versions.map((v) => (v.issuer === "ondo" ? priceOf(v, ondo as number, true) : priceOf(v, bst))),
    sessionStatus: async () => OPEN,
    lastClose: async () => ({ close: CLOSE, closeAt: NOW - 7_200_000, source: "fixture" }),
  };
}
const dry = { live: false, maxUsdPerTrade: 5 };

test("a non-firing tick still writes a receipt with the plain-English reason", async () => {
  const store = tmpStore();
  store.addRule(rule(), "if TSLA drops more than 8% buy $5");
  const spy = spyExecute();
  const out = await tick(NOW, dry, { store, execute: spy, env: {}, ...market(97) });
  assert.equal(spy.calls.length, 0);
  assert.equal(out.length, 1);
  const logged = store.receipts();
  assert.equal(logged.length, 1, "receipts.jsonl must hold exactly one line");
  assert.equal(logged[0].outcome, "no_fire");
  assert.match(logged[0].reason, /down 3\.0% from the last close, short of the 8% down trigger/);
  assert.equal(logged[0].lastClose, CLOSE);
  assert.equal(logged[0].observed.length, 1);
  assert.equal(store.rules()[0].status, "armed");
  await tick(NOW + 300_000, dry, { store, execute: spy, env: {}, ...market(96) });
  assert.equal(store.receipts().length, 2, "receipts are appended, never rewritten");
  assert.equal(store.receipts()[0].reason, logged[0].reason);
  await tick(NOW + 600_000, dry, { store, execute: spy, env: {}, ...market(96) });
  assert.equal(store.receipts().length, 3, "an unchanged price still gets its own receipt");
  assert.equal(store.receipts()[2].reason, store.receipts()[1].reason);
});

test("a firing dry-run tick executes with live:false and records the decision", async () => {
  const store = tmpStore();
  store.addRule(rule(), "t");
  const spy = spyExecute();
  const [r] = await tick(NOW, { live: true, maxUsdPerTrade: 5 }, { store, execute: spy, env: {}, ...market(90) });
  assert.equal(spy.calls.length, 1);
  assert.equal(spy.calls[0].opts.live, false, "REDEYE_LIVE is unset so this must be a dry run");
  assert.equal(spy.calls[0].decision.version?.symbol, "TSLAB");
  assert.equal(r.outcome, "dry_run");
  assert.equal(r.mode, "dry");
  assert.match(r.reason, /down 10\.0% from the last close; bought the bStocks version at \$90\.00/);
  assert.equal(store.rules()[0].status, "armed", "a dry run must not disarm");
});

test("usd above the cap never reaches execute through tick, and the rule stays armed", async () => {
  const store = tmpStore();
  store.addRule(rule({ usd: 50 }), "t");
  const spy = spyExecute();
  const [r] = await tick(NOW, dry, { store, execute: spy, env: {}, ...market(90) });
  assert.equal(spy.calls.length, 0);
  assert.equal(r.outcome, "skipped");
  assert.match(r.reason, /per-trade cap of \$5/);
  assert.equal(store.rules()[0].status, "armed");
});

test("live without REDEYE_LIVE=yes stays dry through tick; with it, execute gets live:true", async () => {
  const spy = spyExecute();
  const a = tmpStore();
  a.addRule(rule(), "t");
  await tick(NOW, { live: true, maxUsdPerTrade: 5 }, { store: a, execute: spy, env: {}, ...market(90) });
  const b = tmpStore();
  b.addRule(rule(), "t");
  await tick(NOW, { live: true, maxUsdPerTrade: 5 }, { store: b, execute: spy, env: { REDEYE_LIVE: "yes" }, ...market(90) });
  assert.deepEqual(spy.calls.map((c) => c.opts.live), [false, true]);
});

test("a filled order disarms the rule; the next tick does nothing for it", async () => {
  const store = tmpStore();
  store.addRule(rule(), "t");
  const spy = spyExecute("filled", { txHash: `0x${"ab".repeat(32)}` });
  const live = { live: true, maxUsdPerTrade: 5 };
  const env = { REDEYE_LIVE: "yes" };
  const [r] = await tick(NOW, live, { store, execute: spy, env, ...market(90) });
  assert.equal(r.outcome, "filled");
  assert.equal(r.mode, "live");
  assert.equal(r.txHash, `0x${"ab".repeat(32)}`);
  assert.equal(store.rules()[0].status, "filled");
  const again = await tick(NOW + 300_000, live, { store, execute: spy, env, ...market(90) });
  assert.equal(again.length, 0);
  assert.equal(spy.calls.length, 1, "a filled rule must not trade twice");
});

test("a failed order leaves the rule armed; a submitted-but-unconfirmed live order parks it for review", async () => {
  const live = { live: true, maxUsdPerTrade: 5 };
  const env = { REDEYE_LIVE: "yes" };
  const failing = tmpStore();
  failing.addRule(rule(), "t");
  const [f] = await tick(NOW, live, { store: failing, execute: spyExecute("failed"), env, ...market(90) });
  assert.equal(f.outcome, "failed");
  assert.equal(failing.rules()[0].status, "armed");

  const stuck = tmpStore();
  stuck.addRule(rule(), "t");
  const exec = async (d: any, r: any, o: any) => {
    o.log("baw market order 42 submitted");
    o.log("failed r TSLAB: baw order 42 still pending at timeout");
    return { ruleId: r.id, version: d.version, side: "buy", usd: 5, txHash: null, orderId: null, status: "failed", simulated: true } as const;
  };
  const [s] = await tick(NOW, live, { store: stuck, execute: exec, env, ...market(90) });
  assert.equal(s.outcome, "failed");
  assert.match(s.reason, /still pending at timeout/);
  assert.equal(stuck.rules()[0].status, "review");
  assert.equal((await tick(NOW + 300_000, live, { store: stuck, execute: exec, env, ...market(90) })).length, 0);
});

test("Ondo at $5 is skipped with a reason and the trade falls to the next version", async () => {
  const store = tmpStore();
  store.addRule(rule({ usd: 5 }), "t");
  const spy = spyExecute();
  // Ondo prices lowest, so evaluate picks it; it must be dropped, bStocks used instead.
  const [r] = await tick(NOW, { live: false, maxUsdPerTrade: 6 }, { store, execute: spy, env: {}, ...market(90, 89.5) });
  assert.equal(spy.calls.length, 1);
  assert.equal(spy.calls[0].decision.version?.symbol, "TSLAB");
  assert.match(r.reason, /Skipped the Ondo version: Ondo needs at least \$5\.01/);
  assert.equal(r.version?.symbol, "TSLAB");
});

test("Ondo at $5 with no other version is skipped, not attempted", async () => {
  const store = tmpStore();
  store.addRule(rule({ usd: 5 }), "t");
  const spy = spyExecute();
  const deps = market(90, 89.5);
  const only = { ...deps, listVersions: async () => [TSLAon], priceVersions: async () => [priceOf(TSLAon, 89.5, true)] };
  const [r] = await tick(NOW, dry, { store, execute: spy, env: {}, ...only });
  assert.equal(spy.calls.length, 0);
  assert.equal(r.outcome, "skipped");
  assert.match(r.reason, /Ondo needs at least \$5\.01/);
});

test("fraction-of-holding sell: sized from the wallet holding, then held to the cap", async () => {
  const spy = spyExecute();
  const big = tmpStore();
  big.addRule(rule({ side: "sell", fraction: 0.5 }), "t");
  const [a] = await tick(NOW, dry, { store: big, execute: spy, env: {}, holdingUsd: async () => 100, ...market(90) });
  assert.equal(a.outcome, "skipped");
  assert.equal(a.usd, 50);
  assert.equal(spy.calls.length, 0);
  const small = tmpStore();
  small.addRule(rule({ side: "sell", fraction: 0.5 }), "t");
  const [b] = await tick(NOW, dry, { store: small, execute: spy, env: {}, holdingUsd: async () => 8, ...market(90) });
  assert.equal(b.outcome, "dry_run");
  assert.equal(spy.calls.length, 1);
});

test("outside the window no market data is read; the wait is logged once, an ended window expires the rule", async () => {
  const store = tmpStore();
  const boom = async () => { throw new Error("network must not be touched"); };
  const deps = { listVersions: boom, priceVersions: boom, sessionStatus: boom, lastClose: boom, store, execute: spyExecute(), env: {} };
  store.addRule(rule({ window: { startMs: NOW + 3_600_000, endMs: NOW + 7_200_000 } }), "t");
  const first = await tick(NOW, dry, deps);
  assert.match(first[0].reason, /not armed yet/);
  assert.equal((await tick(NOW + 300_000, dry, deps)).length, 0, "identical wait message is not repeated");
  const ended = await tick(NOW + 8_000_000, dry, deps);
  assert.match(ended[0].reason, /window ended/);
  assert.equal(store.rules()[0].status, "expired");
});

test("a data failure for one rule becomes a failed receipt and the other rules still run", async () => {
  const store = tmpStore();
  store.addRule(rule({ id: "A" }), "t");
  store.addRule({ ...rule({ id: "B" }), ticker: "NVDA" }, "t");
  const spy = spyExecute();
  const m = market(90);
  const out = await tick(NOW, dry, {
    store, execute: spy, env: {}, ...m,
    listVersions: async (t) => { if (t === "NVDA") throw new Error("HTTP 503"); return [TSLAB]; },
  });
  assert.equal(out.length, 2);
  assert.equal(out[0].outcome, "dry_run");
  assert.equal(out[1].outcome, "failed");
  assert.match(out[1].reason, /Could not check NVDA: HTTP 503/);
});
