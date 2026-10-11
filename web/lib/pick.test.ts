import { test } from "node:test";
import assert from "node:assert/strict";
import type { Rule, SessionStatus, StockVersion, VersionPrice } from "../../src/types.ts";
import { pickVersion } from "./pick.ts";
import type { VersionRow } from "./redeye";

// src/signals does not pass strict tsc (see lib/shared/src.ts), so the real evaluate() is loaded by a computed path.
const evalPath = "../../src/signals/evaluate.ts";
const { evaluate } = (await import(evalPath)) as { evaluate: Parameters<typeof pickVersion>[6] };

const NOW = Date.parse("2026-10-09T22:00:00Z");
const ver = (issuer: StockVersion["issuer"], symbol: string): StockVersion => ({
  ticker: "TSLA", issuer, symbol, address: `0x${Buffer.from(symbol).toString("hex").padEnd(40, "0")}` as `0x${string}`,
  decimals: 18, multiplier: 1, route: issuer === "ondo" ? "RFQ" : issuer === "xstocks" ? "SWAP" : "MIXED",
});
const B = ver("bstocks", "TSLAB");
const X = ver("xstocks", "TSLAx");
const O = ver("ondo", "TSLAon");
const price = (v: StockVersion, p: number): VersionPrice => ({ version: v, tokenUsd: p, perShareUsd: p, stockUsd: v.issuer === "bstocks" ? null : 100, derived: false, at: NOW });
const rule = (side: "buy" | "sell"): Rule => ({
  id: "r", ticker: "TSLA", trigger: { kind: "move_pct", direction: "down", pct: 8, from: "last_close" },
  action: side === "buy" ? { side, usd: 6 } : { side, fractionOfHolding: 0.5 }, window: { startMs: NOW + 9e9, endMs: NOW + 9e10 }, maxSlippageBps: 100,
});
const open: SessionStatus = { marketStatus: "postmarket", openState: true, reasonCode: "TRADING", reasonMsg: null, nextOpenTime: null, nextCloseTime: null };
const status = new Map([[B.symbol, open], [X.symbol, open], [O.symbol, open]]);
const row = (v: StockVersion, p: number, tradable: boolean): VersionRow => ({
  issuer: v.issuer, issuerLabel: v.issuer, symbol: v.symbol, address: v.address, route: v.route, multiplier: 1, tokenUsd: p, perShareUsd: p,
  stockUsd: v.issuer === "bstocks" ? null : 100, derived: false, session: { state: null, open: true, reasonCode: null, reasonMsg: null, nextOpenTime: null },
  probe: { side: "buy" as const, amountUsd: 6, ok: tradable, vendor: tradable ? "LiquidMesh" : null, mode: tradable ? "SWAP" : null, kind: null, message: null }, tradable, because: "",
});
const buySize = { side: "buy", usd: 6, reference: false, rule: "$6", text: "" } as const;
const sellSize = { side: "sell", usd: 10, reference: true, rule: "50% of your holding", text: "" } as const;

// bStocks 99.5, xStocks 100.2, Ondo 99.0 (cheapest, but cannot trade)
const prices = [price(B, 99.5), price(X, 100.2), price(O, 99)];
const rows = [row(B, 99.5, true), row(X, 100.2, true), row(O, 99, false)];

test("a buy picks the cheapest version that can trade, and skips a cheaper one that cannot", () => {
  const { pick } = pickVersion(rule("buy"), 100, prices, status, rows, buySize, evaluate, NOW);
  assert.equal(pick?.symbol, "TSLAB", "Ondo at 99.00 is cheaper but cannot trade");
  assert.equal(pick?.line, "Redeye would buy this one");
  assert.match(pick?.reason ?? "", /^Cheapest of the 2 versions that can trade: a \$6 buy fills via LiquidMesh \(SWAP\) at \$99\.50 per share, 0\.50% under the real TSLA price of \$100\.00\.$/);
});

test("a sell picks the dearest version that can trade and names the holding fraction", () => {
  const { pick } = pickVersion(rule("sell"), 100, prices, status, rows, sellSize, evaluate, NOW);
  assert.equal(pick?.symbol, "TSLAx");
  assert.equal(pick?.line, "Redeye would sell this one");
  assert.match(pick?.reason ?? "", /^Dearest of the 2 versions that can trade: a sale of 50% of your holding fills .* at \$100\.20 per share, 0\.20% over the real/);
});

test("with nothing tradable there is no pick, only a note", () => {
  const none = rows.map((r) => ({ ...r, tradable: false }));
  const out = pickVersion(rule("buy"), 100, prices, status, none, buySize, evaluate, NOW);
  assert.equal(out.pick, null);
  assert.match(out.pickNote ?? "", /No version can trade right now/);
});

test("a single tradable version is called the only one", () => {
  const out = pickVersion(rule("buy"), 100, prices, status, [rows[0], { ...rows[1], tradable: false }, rows[2]], buySize, evaluate, NOW);
  assert.match(out.pick?.reason ?? "", /^The only version that can trade:/);
});
