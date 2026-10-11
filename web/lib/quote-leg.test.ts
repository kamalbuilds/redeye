import { test } from "node:test";
import assert from "node:assert/strict";
import { BSC_USDT, quoteLeg } from "./quote-leg.ts";

const TOKEN = { address: "0x5b1910eaad6450e50f816082aa078c41f10c292f", decimals: 18 };

test("a buy runs USDT into the token for the dollars", () => {
  const leg = quoteLeg("buy", 6, TOKEN, 357.87);
  assert.deepEqual(leg, { fromToken: BSC_USDT, toToken: TOKEN.address, amount: "6000000000000000000" });
});

test("a sell runs the token into USDT, sized in tokens from the price", () => {
  const leg = quoteLeg("sell", 10, TOKEN, 200);
  assert.deepEqual(leg, { fromToken: TOKEN.address, toToken: BSC_USDT, amount: "50000000000000000" });
});

test("a sell never rounds up past the dollars", () => {
  const leg = quoteLeg("sell", 10, TOKEN, 357.87);
  assert.ok(leg);
  assert.ok(BigInt(leg.amount) * BigInt(35787) <= BigInt(10) * BigInt(10) ** BigInt(18) * BigInt(100));
});

test("a sell with no price cannot be sized", () => {
  assert.equal(quoteLeg("sell", 10, TOKEN, null), null);
  assert.equal(quoteLeg("sell", 10, TOKEN, 0), null);
});
