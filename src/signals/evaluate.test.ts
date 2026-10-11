import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluate } from "./evaluate.ts";
import type { Rule, SessionStatus, StockVersion, VersionPrice } from "../types.ts";

const rows = new Map<string, number>();
for (const line of readFileSync(new URL("./fixtures/tsla-earnings-2026-07-23.tsv", import.meta.url), "utf8").trim().split("\n")) {
  const [sym, ts, close] = line.split("\t");
  rows.set(`${sym}@${ts}`, Number(close));
}
const close = (sym: string, ts: string) => {
  const v = rows.get(`${sym}@${ts}`);
  assert.ok(v !== undefined, `missing row ${sym}@${ts}`);
  return v;
};

const ondo: StockVersion = { ticker: "TSLA", issuer: "ondo", symbol: "TSLAon", address: "0x2494b603319d4d9f9715c9f4496d9e0364b59d93", decimals: 18, multiplier: 1, route: "RFQ" };
const bs: StockVersion = { ticker: "TSLA", issuer: "bstocks", symbol: "TSLAB", address: "0x5b1910eaad6450e50f816082aa078c41f10c292f", decimals: 18, multiplier: 1, route: "MIXED" };
const price = (version: StockVersion, p: number, at: number, derived: boolean): VersionPrice => ({ version, tokenUsd: p, perShareUsd: p, stockUsd: null, derived, at });
const obs = (onoTs: string, bTs: string, at: number) => [price(ondo, close("TSLAon", onoTs), at, true), price(bs, close("TSLAB", bTs), at, false)];

// 2026-07-22T19:00Z TSLAon close, a proxy for the official close.
const LAST_CLOSE = close("TSLAon", "2026-07-22T19:00:00Z");
const rule: Rule = {
  id: "r1", ticker: "TSLA",
  trigger: { kind: "move_pct", direction: "down", pct: 8, from: "last_close" },
  action: { side: "buy", usd: 20 },
  window: { startMs: Date.parse("2026-07-22T20:00:00Z"), endMs: Date.parse("2026-07-23T20:00:00Z") },
  maxSlippageBps: 100,
};
const ms = (ts: string) => Date.parse(ts);
const none = new Map<string, SessionStatus>();
const limited = (sym: string) => new Map<string, SessionStatus>([[sym, { marketStatus: "pause", openState: false, reasonCode: "ASSET_LIMITED", reasonMsg: "earnings", nextOpenTime: null, nextCloseTime: null }]]);

test("02:00Z overnight: gap is ~4%, no fire", () => {
  const t = "2026-07-23T02:00:00Z";
  const d = evaluate(rule, LAST_CLOSE, obs(t, t, ms(t)), none, ms(t));
  assert.equal(d.fire, false);
  assert.equal(d.version, null);
});

test("12:00Z: real rows are only -7.6% to -7.7%, short of 8%, no fire", () => {
  const t = "2026-07-23T12:00:00Z";
  const d = evaluate(rule, LAST_CLOSE, obs(t, t, ms(t)), none, ms(t));
  assert.equal(d.fire, false);
});

test("14:00Z candle: fires at -13.5%, both ~323.5, picks the lower of the two",  () => {
  const t = "2026-07-23T14:00:00Z";
  const d = evaluate(rule, LAST_CLOSE, obs(t, t, ms(t)), none, ms(t));
  assert.equal(d.fire, true);
  assert.equal(close("TSLAon", t) < close("TSLAB", t), true);
  assert.equal(d.version?.symbol, "TSLAon");
  assert.match(d.reason, /down 13\.5% from the last close/);
  assert.doesNotMatch(d.reason, /stale|old price/);
});

test("derived price >2% from a live one is skipped (constructed pair)", () => {
  // Constructed, not observed: real numbers TSLAon 345.53 (12:00Z row) and TSLAB 323.49 (14:00Z row),
  // paired as if a derived Ondo quote lagged a live bStocks trade. The TSV itself never shows this gap.
  const at = ms("2026-07-23T14:00:00Z");
  const d = evaluate(rule, LAST_CLOSE, [price(ondo, close("TSLAon", "2026-07-23T12:00:00Z"), at, true), price(bs, close("TSLAB", "2026-07-23T14:00:00Z"), at, false)], none, at);
  assert.equal(d.fire, true);
  assert.equal(d.version?.symbol, "TSLAB");
  assert.match(d.reason, /skipped the Ondo version at \$345\.53/);
});

test("sell picks the highest tradable price, derived 345.53 skipped when live is 2%+ away", () => {
  const at = ms("2026-07-23T14:00:00Z");
  const up: Rule = { ...rule, trigger: { ...rule.trigger, direction: "down" }, action: { side: "sell", fractionOfHolding: 0.5 } };
  const d = evaluate(up, LAST_CLOSE, [price(ondo, close("TSLAon", "2026-07-23T12:00:00Z"), at, true), price(bs, close("TSLAB", "2026-07-23T14:00:00Z"), at, false)], none, at);
  assert.equal(d.version?.symbol, "TSLAB");
});

test("TSLAB ASSET_LIMITED is never chosen, Ondo wins when it is the only tradable one", () => {
  const t = "2026-07-23T15:00:00Z"; // TSLAB 323.82 is cheaper than TSLAon 324.66, so only the filter keeps it out
  const d = evaluate(rule, LAST_CLOSE, obs(t, t, ms(t)), limited("TSLAB"), ms(t));
  assert.equal(evaluate(rule, LAST_CLOSE, obs(t, t, ms(t)), none, ms(t)).version?.symbol, "TSLAB");
  assert.equal(d.fire, true);
  assert.equal(d.version?.symbol, "TSLAon");
});

test("everything limited: no fire", () => {
  const t = "2026-07-23T14:00:00Z";
  const st = new Map([...limited("TSLAB"), ...limited("TSLAon")]);
  const d = evaluate(rule, LAST_CLOSE, obs(t, t, ms(t)), st, ms(t));
  assert.equal(d.fire, false);
});

test("outside window says when it arms", () => {
  const d = evaluate(rule, LAST_CLOSE, obs("2026-07-23T14:00:00Z", "2026-07-23T14:00:00Z", 0), none, ms("2026-07-22T10:00:00Z"));
  assert.equal(d.fire, false);
  assert.match(d.reason, /arms at 2026-07-22T20:00:00Z/);
});
