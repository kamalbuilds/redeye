import { test } from "node:test";
import assert from "node:assert/strict";
import { formatQuoteTable, quoteTicker } from "./quote.ts";

// Live, read-only: public RWA endpoints plus the signed Trading API quote. No order, no signature, no wallet.
test("live: quote TSLA 5 returns at least one tradable version with a quote", async (t) => {
  if (!process.env.BINANCE_W3_API_KEY || !process.env.BINANCE_W3_API_SECRET) {
    t.skip("BINANCE_W3_API_KEY / BINANCE_W3_API_SECRET not set in .env, so the signed Trading API quote cannot run");
    return;
  }
  const rows = await quoteTicker("TSLA", 5);
  console.log(formatQuoteTable("TSLA", 5, rows));
  assert.ok(rows.length >= 3, `expected the 3 TSLA versions, got ${rows.length}`);
  const tradable = rows.filter((r) => r.tradable);
  assert.ok(tradable.length >= 1, "no version returned a quote");
  for (const r of tradable) {
    assert.ok(r.tokensOut !== null && r.tokensOut > 0);
    // $5 bought at the quote must land near the public per-share price (generous 5%: fee, spread, a stale pool)
    const ref = r.price.perShareUsd as number;
    assert.ok(Math.abs((r.impliedPerShareUsd as number) / ref - 1) < 0.05, `${r.price.version.symbol} implied ${r.impliedPerShareUsd} vs ${ref}`);
  }
  // negative case: Ondo is never quoted below its $5.01 minimum
  const ondo = rows.find((r) => r.price.version.issuer === "ondo");
  assert.equal(ondo?.tradable, false);
  assert.match(ondo?.note ?? "", /5\.01/);
});
