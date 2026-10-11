import { test } from "node:test";
import assert from "node:assert/strict";
import type { Decision } from "../types.ts";
import type { QuoteRoute, Web3Client } from "../exec/web3api.ts";
import { USDT } from "../exec/execute.ts";
import { dryTrade, PROBE_WALLET } from "./dryrun.ts";
import { priceOf, rule, TSLAB, TSLAon } from "./fixtures.ts";

const decision = (v = TSLAB, tokenUsd = 100): Decision => ({
  ruleId: "TSLA-down-8-1", fire: true, version: v, reason: "r", observed: [{ ...priceOf(v, tokenUsd), tokenUsd }],
});
const route = (over: Partial<QuoteRoute> = {}): QuoteRoute => ({ quoteId: "q", vendorName: "PancakeSwap", executionMode: "SWAP", toTokenAmount: "50000000000000000", priceImpactPercent: "0.1", ...over });
const opts = { live: false, maxUsdPerTrade: 100 };

function fakeApi(over: { sim?: { status: string; failReason?: string }; routes?: QuoteRoute[] } = {}) {
  const calls: { quote: unknown[]; approve: unknown[]; simulate: unknown[] } = { quote: [], approve: [], simulate: [] };
  const api = {
    quote: async (p: unknown) => { calls.quote.push(p); return over.routes ?? [route()]; },
    approve: async (p: unknown) => { calls.approve.push(p); return [{ data: "0xabcdef", dexContractAddress: "0xdex" }]; },
    simulate: async (p: unknown) => { calls.simulate.push(p); return over.sim ?? { status: "SUCCESS" }; },
  } as unknown as Web3Client;
  return { api, calls };
}

test("a buy quotes USDT into the token for the rule's dollars, then simulates the approval", async () => {
  const { api, calls } = fakeApi();
  const r = await dryTrade(decision(), rule({ usd: 6 }), null, opts, { api });
  assert.equal(r.outcome, "dry_run");
  assert.equal(r.simulate, "passed");
  assert.equal(r.live, false);
  const q = calls.quote[0] as { amount: string; fromToken: string; toToken: string; userWalletAddress: string };
  assert.equal(q.fromToken, USDT);
  assert.equal(q.toToken, TSLAB.address);
  assert.equal(q.amount, "6000000000000000000");
  assert.equal(q.userWalletAddress, PROBE_WALLET);
  assert.equal((calls.simulate[0] as { from: string }).from, PROBE_WALLET);
  assert.match(r.reason, /would have bought \$6\.00 of TSLAB via PancakeSwap \(SWAP\), the quote returns 0\.05 TSLAB; approval simulate passed; nothing was signed/);
});

test("a sell quotes the token into USDT, sized in tokens from the observed price, never a dollar buy", async () => {
  const { api, calls } = fakeApi({ routes: [route({ toTokenAmount: "10000000000000000000" })] });
  const r = await dryTrade(decision(TSLAB, 200), rule({ side: "sell", usd: 10 }), null, opts, { api });
  assert.equal(r.outcome, "dry_run");
  const q = calls.quote[0] as { amount: string; fromToken: string; toToken: string };
  assert.equal(q.fromToken, TSLAB.address, "the token is what is sold");
  assert.equal(q.toToken, USDT);
  assert.equal(q.amount, "50000000000000000", "$10 at $200 per token is 0.05 token");
  assert.match(r.reason, /would have sold \$10\.00 of TSLAB.*returns 10 USDT/);
});

test("a fraction-of-holding sell is sized from the caller's dollar estimate", async () => {
  const { api, calls } = fakeApi();
  const r = await dryTrade(decision(TSLAB, 100), rule({ side: "sell", fraction: 0.5 }), 20, opts, { api });
  assert.equal(r.outcome, "dry_run");
  assert.equal((calls.quote[0] as { amount: string }).amount, "200000000000000000");
});

test("a failed approval simulate is a failed receipt with the reason, not a dry run", async () => {
  const { api } = fakeApi({ sim: { status: "FAILED", failReason: "execution reverted" } });
  const r = await dryTrade(decision(), rule({ usd: 6 }), null, opts, { api });
  assert.equal(r.outcome, "failed");
  assert.match(r.reason, /execution reverted/);
  assert.match(r.simulate, /execution reverted/);
});

test("the cap and the Ondo minimum refuse before any network call", async () => {
  const { api, calls } = fakeApi();
  const big = await dryTrade(decision(), rule({ usd: 500 }), null, opts, { api });
  assert.equal(big.outcome, "skipped");
  const small = await dryTrade(decision(TSLAon), rule({ usd: 5 }), null, opts, { api });
  assert.equal(small.outcome, "skipped");
  assert.match(small.reason, /Ondo needs at least/);
  assert.equal(calls.quote.length, 0, "no quote for a refused trade");
});

test("a price impact above the rule's slippage fails the dry run", async () => {
  const { api } = fakeApi({ routes: [route({ priceImpactPercent: "3.5" })] });
  const r = await dryTrade(decision(), rule({ usd: 6, maxSlippageBps: 100 }), null, opts, { api });
  assert.equal(r.outcome, "failed");
  assert.match(r.reason, /price impact 3\.5%/);
});
