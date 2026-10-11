import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRule, parseRuleStrict } from "./parse.ts";

const ctx = { now: 1, window: { startMs: 10, endMs: 20 } };

test("strict parses 4 phrasings", () => {
  const a = parseRuleStrict("if TSLA drops more than 8% buy $50", ctx);
  assert.deepEqual([a.ticker, a.trigger.direction, a.trigger.pct, a.action], ["TSLA", "down", 8, { side: "buy", usd: 50 }]);
  const b = parseRuleStrict("if NFLX jumps 10% sell half", ctx);
  assert.deepEqual([b.ticker, b.trigger.direction, b.trigger.pct, b.action], ["NFLX", "up", 10, { side: "sell", fractionOfHolding: 0.5 }]);
  assert.equal(parseRuleStrict("If nvda falls 2.5%, buy $100.", ctx).trigger.pct, 2.5);
  assert.equal(parseRuleStrict("if AAPL rises over 5% sell all", ctx).action.fractionOfHolding, 1);
  assert.deepEqual(a.window, ctx.window);
});

test("strict rejects rather than guesses", () => {
  assert.throws(() => parseRuleStrict("buy Tesla if it tanks after earnings", ctx), /Cannot parse/);
  assert.throws(() => parseRuleStrict("if TSLA drops more than 8% buy a bunch", ctx), /Cannot parse/);
  assert.throws(() => parseRuleStrict("if TSLA drops 80% buy $50", ctx), /pct/);
  assert.throws(() => parseRuleStrict("if TSLA drops 8% buy $5000", ctx), /usd/);
  assert.throws(() => parseRuleStrict("if TSLA drops 8% buy half", ctx), /buy needs a dollar/);
});

test("parseRule throws without key", async (t) => {
  if (process.env.ANTHROPIC_API_KEY) return t.skip("key is set");
  await assert.rejects(parseRule("x", ctx), /ANTHROPIC_API_KEY is not set/);
});

test("parseRule live", async (t) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("SKIPPED parseRule live test: ANTHROPIC_API_KEY not set");
    return t.skip("ANTHROPIC_API_KEY not set");
  }
  const r = await parseRule("If TSLA drops more than 8% overnight, buy $20 of it", ctx);
  assert.equal(r.ticker, "TSLA");
  assert.equal(r.trigger.direction, "down");
  assert.equal(r.trigger.pct, 8);
  assert.equal(r.action.usd, 20);
});
