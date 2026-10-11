// Which version the agent would act on, in one sentence a reader can check. Pure: evaluate() is passed in.
import type { Decision, Rule, SessionStatus, VersionPrice } from "../../src/types.ts";
import type { Sizing, VersionRow } from "./redeye";

export interface Pick { symbol: string; line: string; reason: string }

/**
 * The version evaluate() would hand to the agent. evaluate() only names a version once the trigger is met, so it is asked with the
 * trigger removed (a threshold no move can miss): its own rule then chooses among the versions that can trade right now
 * (cheapest per share to buy, dearest to sell, a stale derived price skipped), the same choice tick makes when the rule fires.
 */
export function pickVersion(
  rule: Rule, lastClose: number, prices: VersionPrice[], status: Map<string, SessionStatus>, rows: VersionRow[], sizing: Sizing,
  evaluate: (rule: Rule, lastClose: number, observed: VersionPrice[], status: Map<string, SessionStatus>, now: number) => Decision, now: number,
): { pick: Pick | null; pickNote: string | null } {
  const canTrade = new Set(rows.filter((r) => r.tradable).map((r) => r.symbol));
  const candidates = prices.filter((p) => canTrade.has(p.version.symbol));
  if (candidates.length === 0) return { pick: null, pickNote: "No version can trade right now, so the agent would wait and check again at the next tick." };
  const open: Rule = { ...rule, trigger: { ...rule.trigger, pct: -1e6 }, window: { startMs: now - 1, endMs: now + 1 } };
  const d = evaluate(open, lastClose, candidates, status, now);
  const row = d.fire && d.version ? rows.find((r) => r.symbol === d.version?.symbol) : undefined;
  if (!row || row.perShareUsd === null) return { pick: null, pickNote: d.reason };
  const buy = rule.action.side === "buy";
  const stock = rows.find((r) => r.stockUsd !== null)?.stockUsd ?? null;
  const gap = stock ? (row.perShareUsd / stock - 1) * 100 : null;
  const rank = candidates.length === 1 ? "The only version that can trade" : `${buy ? "Cheapest" : "Dearest"} of the ${candidates.length} versions that can trade`;
  const size = buy ? `a ${sizing.rule} buy` : `a sale of ${sizing.rule}`;
  const route = row.probe.vendor ? ` via ${row.probe.vendor} (${row.probe.mode})` : "";
  const real = gap !== null && stock !== null ? `, ${Math.abs(gap).toFixed(2)}% ${gap < 0 ? "under" : "over"} the real ${rule.ticker} price of $${stock.toFixed(2)}` : "";
  return {
    pick: { symbol: row.symbol, line: `Redeye would ${buy ? "buy" : "sell"} this one`, reason: `${rank}: ${size} fills${route} at $${row.perShareUsd.toFixed(2)} per share${real}.` },
    pickNote: null,
  };
}
