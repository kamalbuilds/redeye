import { test } from "node:test";
import assert from "node:assert/strict";
import type { BlobIO } from "./blobstore.ts";
import { listVisitors, MAX_ARMED_PER_VISITOR, MAX_RECEIPTS, openBlobStore } from "./blobstore.ts";
import { tick } from "./tick.ts";
import { NOW, OPEN, priceOf, rule, TSLAB, tmpStore } from "./fixtures.ts";
import type { Receipt } from "./store.ts";

const memory = (): BlobIO & { files: Map<string, string> } => {
  const files = new Map<string, string>();
  return {
    files,
    read: async (p) => files.get(p) ?? null,
    write: async (p, b) => void files.set(p, b),
    list: async (prefix) => [...files.keys()].filter((k) => k.startsWith(prefix)),
  };
};
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const receipt = (n: number): Receipt => ({
  at: n, iso: new Date(n).toISOString(), kind: "rule", ruleId: "r", ticker: "TSLA", mode: "dry", outcome: "no_fire", reason: `n${n}`,
  lastClose: null, lastCloseSource: null, observed: [], version: null, side: "buy", usd: null, quote: null, simulate: "not run", txHash: null, orderId: null, execLog: [],
});

test("visitors never see each other's rules or receipts", async () => {
  const io = memory();
  const a = openBlobStore(io, A);
  const b = openBlobStore(io, B);
  await a.addRule(rule({ id: "A-1" }), "if TSLA drops 8% buy $5", NOW);
  await a.appendReceipt(receipt(1));
  assert.equal((await a.rules()).length, 1, "positive control: A sees its own rule");
  assert.equal((await b.rules()).length, 0);
  assert.equal((await b.receipts()).length, 0);
  assert.deepEqual(await listVisitors(io), [A]);
});

test("a visitor id that is not a UUID cannot reach a path", () => {
  assert.throws(() => openBlobStore(memory(), "../victim"), /UUID/);
  assert.throws(() => openBlobStore(memory(), ""), /UUID/);
});

test("rules persist as armed, setStatus closes them, duplicates and the armed cap are refused", async () => {
  const s = openBlobStore(memory(), A);
  const sr = await s.addRule(rule({ id: "x" }), "t", NOW);
  assert.equal(sr.status, "armed");
  await assert.rejects(() => s.addRule(rule({ id: "x" }), "t", NOW), /already exists/);
  await s.setStatus("x", "expired", "window over", NOW + 1);
  const [after] = await s.rules();
  assert.equal(after.status, "expired");
  assert.equal(after.closedAt, NOW + 1);
  for (let i = 0; i < MAX_ARMED_PER_VISITOR; i++) await s.addRule(rule({ id: `r${i}` }), "t", NOW);
  await assert.rejects(() => s.addRule(rule({ id: "over" }), "t", NOW), /already armed/);
});

test("receipts keep only the newest MAX_RECEIPTS, in order", async () => {
  const s = openBlobStore(memory(), A);
  for (let i = 0; i < MAX_RECEIPTS + 5; i++) await s.appendReceipt(receipt(i));
  const all = await s.receipts();
  assert.equal(all.length, MAX_RECEIPTS);
  assert.equal(all[0].at, 5);
  assert.equal(all.at(-1)?.at, MAX_RECEIPTS + 4);
});

test("tick runs against an async store and a custom trade, and the receipt lands in the blob", async () => {
  const s = openBlobStore(memory(), A);
  await s.addRule(rule({ usd: 5 }), "if TSLA drops 8% buy $5", NOW);
  const calls: string[] = [];
  const out = await tick(NOW, { live: false, maxUsdPerTrade: 5 }, {
    store: s,
    listVersions: async () => [TSLAB],
    priceVersions: async () => [priceOf(TSLAB, 90)],
    sessionStatus: async () => OPEN,
    lastClose: async () => ({ close: 100, closeAt: NOW - 7_200_000, source: "fixture" }),
    trade: async (d) => { calls.push(d.version?.symbol ?? "none"); return { outcome: "dry_run", reason: "custom trade ran.", usd: 5, live: false, fill: null, quote: null, simulate: "passed", execLog: [] }; },
    env: {},
  });
  assert.deepEqual(calls, ["TSLAB"], "deps.trade replaced guardedTrade");
  assert.equal(out[0].outcome, "dry_run");
  const stored = await s.receipts();
  assert.equal(stored.length, 1);
  assert.match(stored[0].reason, /bought the bStocks version at \$90\.00\. custom trade ran\./);
  assert.equal((await s.rules())[0].status, "armed");
});

test("tick on the file store still works after the async change (positive control for the sync path)", async () => {
  const store = tmpStore();
  store.addRule(rule(), "t");
  const out = await tick(NOW, { live: false, maxUsdPerTrade: 5 }, {
    store, listVersions: async () => [TSLAB], priceVersions: async () => [priceOf(TSLAB, 99)], sessionStatus: async () => OPEN,
    lastClose: async () => ({ close: 100, closeAt: NOW - 7_200_000, source: "fixture" }), env: {},
  });
  assert.equal(out[0].outcome, "no_fire");
  assert.equal(store.receipts().length, 1);
});
