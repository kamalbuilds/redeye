import { test } from "node:test";
import assert from "node:assert/strict";
import type { Candle } from "../types.ts";
import { lastClose, lastRegularCloseMs } from "./lastclose.ts";
import { TSLAB, TSLAon, ver } from "./fixtures.ts";

const iso = (ms: number) => new Date(ms).toISOString();
const at = (s: string) => Date.parse(s);

test("last regular close: Friday 20:00Z (EDT) over the weekend, matching Yahoo regularMarketTime 1791576000", () => {
  assert.equal(lastRegularCloseMs(at("2026-10-11T12:00:00Z")), 1791576000 * 1000);
  assert.equal(lastRegularCloseMs(at("2026-10-12T13:00:00Z")), 1791576000 * 1000, "Monday premarket still sees Friday");
});

test("last regular close: same-day close once past 16:00 ET, previous day before it, 21:00Z in winter", () => {
  assert.equal(iso(lastRegularCloseMs(at("2026-10-09T20:00:00Z"))), "2026-10-09T20:00:00.000Z");
  assert.equal(iso(lastRegularCloseMs(at("2026-10-09T19:59:59Z"))), "2026-10-08T20:00:00.000Z");
  assert.equal(iso(lastRegularCloseMs(at("2026-12-09T20:30:00Z"))), "2026-12-08T21:00:00.000Z", "3:30pm EST is before the close");
  assert.equal(iso(lastRegularCloseMs(at("2026-12-09T21:30:00Z"))), "2026-12-09T21:00:00.000Z");
  assert.equal(iso(lastRegularCloseMs(at("2026-03-09T20:30:00Z"))), "2026-03-09T20:00:00.000Z", "day after the March DST change is EDT");
  assert.equal(iso(lastRegularCloseMs(at("2026-03-06T21:30:00Z"))), "2026-03-06T21:00:00.000Z", "day before is still EST");
});

const NOW = at("2026-10-11T12:00:00Z");
const OPEN = at("2026-10-09T19:00:00Z");
const candle = (t: number, c: number): Candle => ({ t, o: c, h: c, l: c, c, v: 0 });

test("lastClose reads the candle that opens an hour before the close, per share", async () => {
  const seen: unknown[] = [];
  const ondo2 = ver("ondo", "VZon", "VZ", 2);
  const r = await lastClose([ondo2, TSLAB], NOW, async (v, interval, o) => {
    seen.push([v.symbol, interval, o.startTime]);
    return [candle(OPEN - 3_600_000, 1), candle(OPEN, 200), candle(OPEN + 3_600_000, 3)];
  });
  assert.equal(r.close, 100, "Ondo token price 200 at multiplier 2 is 100 per share");
  assert.equal(r.closeAt, 1791576000000);
  assert.deepEqual(seen, [["VZon", "1h", OPEN]]);
});

test("lastClose falls back to bStocks when Ondo has no candle, and fails loudly when neither does", async () => {
  const r = await lastClose([TSLAon, TSLAB], NOW, async (v) => (v.issuer === "ondo" ? [] : [candle(OPEN, 380)]));
  assert.equal(r.close, 380);
  assert.match(r.source, /TSLAB/);
  await assert.rejects(() => lastClose([TSLAon, TSLAB], NOW, async () => [candle(OPEN + 1, 5)]), /no last-close price for TSLA/);
  await assert.rejects(() => lastClose([ver("xstocks", "TSLAx")], NOW, async () => [candle(OPEN, 5)]), /no Ondo or bStocks/);
});
