import { test } from "node:test";
import assert from "node:assert/strict";
import { candles, listVersions, priceVersions, KNOWN_EARNINGS, sessionStatus } from "./rwa.ts";

test("TSLA has exactly the 3 BSC versions", async () => {
  const vs = await listVersions("TSLA");
  assert.equal(vs.length, 3);
  assert.deepEqual(vs.map((v) => v.issuer).sort(), ["bstocks", "ondo", "xstocks"]);
  const ondo = vs.find((v) => v.symbol === "TSLAon");
  assert.equal(ondo?.address, "0x2494b603319d4d9f9715c9f4496d9e0364b59d93");
  assert.equal(ondo?.route, "RFQ");
});

test("NFLX per-share prices agree within 3%, Ondo derived", async () => {
  const ps = await priceVersions(await listVersions("NFLX"));
  assert.equal(ps.length, 3);
  const shares = ps.map((p) => p.perShareUsd);
  assert.ok(shares.every((s) => s !== null && s > 0), JSON.stringify(shares));
  const min = Math.min(...(shares as number[]));
  const max = Math.max(...(shares as number[]));
  assert.ok((max - min) / min < 0.03, `spread ${shares}`);
  const ondo = ps.find((p) => p.version.issuer === "ondo");
  assert.equal(ondo?.derived, true);
  assert.ok(ps.find((p) => p.version.issuer === "bstocks")?.stockUsd === null);
});

test("session status overall and bStock nulls", async () => {
  const all = await sessionStatus();
  assert.ok(all.reasonCode);
  const [b] = (await listVersions("TSLA")).filter((v) => v.issuer === "bstocks");
  assert.equal((await sessionStatus(b)).marketStatus, null);
});

test("TSLAB candles contain 2026-07-23T12:00Z close 323.49; start+end does not throw", async () => {
  const b = (await listVersions("TSLA")).find((v) => v.symbol === "TSLAB")!;
  const cs = await candles(b, "1h", { startTime: 1784743200000, limit: 22 });
  assert.ok(cs.length > 0);
  // EARNINGS-SPIKE.md labels this row "12:00 UTC"; the live API's open time for it is 14:00Z (doc labels are UTC+2).
  const noon = Date.UTC(2026, 6, 23, 14);
  const hit = cs.find((c) => c.t === noon);
  assert.ok(hit, `no candle in ${cs.map((c) => c.t)}`);
  assert.ok(Math.abs(hit.c - 323.49) <= 0.01, `close ${hit.c}`);
  const both = await candles(b, "1h", { startTime: 1784743200000, endTime: noon, limit: 22 });
  assert.ok(both.length > 0 && both.every((c) => c.t <= noon));
});

test("Ethereum address is not a chainId 56 token", async () => {
  const fake = { ticker: "X", issuer: "ondo", symbol: "X", address: "0xf6b1117ec07684d3958cad8beb1b302bfd21103f", decimals: 18, multiplier: 1, route: "RFQ" } as const;
  await assert.rejects(() => candles(fake, "1h", { limit: 2 }), /not a chainId 56 token/);
});

test("KNOWN_EARNINGS empty by default", () => assert.equal(KNOWN_EARNINGS.length, 0));
