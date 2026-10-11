// Test helpers only. No network, no keys.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Fill, Rule, SessionStatus, StockVersion, VersionPrice } from "../types.ts";
import type { ExecOpts } from "../exec/execute.ts";
import { openStore } from "./store.ts";

export const NOW = Date.parse("2026-10-09T22:00:00Z"); // Friday 6pm ET, after hours
export const tmpStore = () => openStore(mkdtempSync(join(tmpdir(), "redeye-")));

export const ver = (issuer: StockVersion["issuer"], symbol: string, ticker = "TSLA", multiplier = 1): StockVersion => ({
  ticker, issuer, symbol, address: `0x${Buffer.from(symbol).toString("hex").padEnd(40, "0")}` as `0x${string}`,
  decimals: 18, multiplier, route: issuer === "ondo" ? "RFQ" : issuer === "xstocks" ? "SWAP" : "MIXED",
});
export const TSLAB = ver("bstocks", "TSLAB");
export const TSLAon = ver("ondo", "TSLAon");

export const priceOf = (version: StockVersion, perShare: number, derived = false): VersionPrice => ({
  version, tokenUsd: perShare * version.multiplier, perShareUsd: perShare, stockUsd: derived ? perShare : null, derived, at: NOW,
});

export const rule = (over: Partial<Rule> & { usd?: number; side?: "buy" | "sell"; fraction?: number } = {}): Rule => ({
  id: over.id ?? "TSLA-down-8-1",
  ticker: "TSLA",
  trigger: { kind: "move_pct", direction: "down", pct: 8, from: "last_close" },
  action: over.fraction !== undefined ? { side: over.side ?? "sell", fractionOfHolding: over.fraction } : { side: over.side ?? "buy", usd: over.usd ?? 5 },
  window: over.window ?? { startMs: NOW - 3_600_000, endMs: NOW + 12 * 3_600_000 },
  maxSlippageBps: over.maxSlippageBps ?? 100,
});

export const OPEN: SessionStatus = { marketStatus: "postmarket", openState: true, reasonCode: "TRADING", reasonMsg: null, nextOpenTime: null, nextCloseTime: null };

export function spyExecute(status: Fill["status"] = "expired", extra: Partial<Fill> = {}) {
  const calls: { decision: Parameters<typeof import("../exec/execute.ts").execute>[0]; rule: Rule; opts: ExecOpts }[] = [];
  const fn = async (decision: any, r: Rule, opts: ExecOpts): Promise<Fill> => {
    calls.push({ decision, rule: r, opts });
    return { ruleId: r.id, version: decision.version, side: r.action.side, usd: r.action.usd ?? 0, txHash: null, orderId: null, status, simulated: true, ...extra };
  };
  return Object.assign(fn, { calls });
}
