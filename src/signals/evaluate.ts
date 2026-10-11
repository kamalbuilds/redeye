import type { Decision, Rule, SessionStatus, VersionPrice } from "../types.ts";

const BLOCKED = new Set(["ASSET_LIMITED", "MARKET_PAUSED", "ASSET_PAUSED"]);
const STALE_GAP = 0.02;
const ISSUER_RANK: Record<string, number> = { bstocks: 0, xstocks: 1 };

const pct = (x: number) => (Math.abs(x) * 100).toFixed(1) + "%";
const usd = (x: number) => "$" + x.toFixed(2);
const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");
const hasPrice = (o: VersionPrice): o is VersionPrice & { perShareUsd: number } => o.perShareUsd !== null;

const issuerName = (i: string) => (i === "ondo" ? "Ondo" : i === "xstocks" ? "xStocks" : "bStocks");

// Price that measures the move: freshest real trade, bStocks before xStocks.
// Falls back to the independent stock price, then to a derived price as a last resort.
function moveBasis(observed: VersionPrice[]): number | null {
  const real = observed
    .filter((o) => hasPrice(o) && !o.derived && o.version.issuer !== "ondo")
    .sort((a, b) => ISSUER_RANK[a.version.issuer] - ISSUER_RANK[b.version.issuer] || b.at - a.at);
  if (real.length) return real[0].perShareUsd;
  const stock = observed.filter((o) => o.stockUsd !== null).sort((a, b) => b.at - a.at)[0];
  if (stock) return stock.stockUsd;
  return observed.find(hasPrice)?.perShareUsd ?? null;
}

export function evaluate(
  rule: Rule,
  lastClose: number,
  observed: VersionPrice[],
  status: Map<string, SessionStatus>,
  now: number,
): Decision {
  const no = (reason: string): Decision => ({ ruleId: rule.id, fire: false, version: null, reason, observed });
  const t = rule.ticker;
  if (now < rule.window.startMs) return no(`${t} rule is not armed yet; it arms at ${iso(rule.window.startMs)}.`);
  if (now > rule.window.endMs) return no(`${t} rule window ended at ${iso(rule.window.endMs)}; it will not act.`);

  const basis = moveBasis(observed);
  if (basis === null) return no(`No usable ${t} price yet, so nothing was done.`);
  const move = basis / lastClose - 1;
  const { direction, pct: need } = rule.trigger;
  const met = direction === "down" ? move <= -need / 100 : move >= need / 100;
  const word = move < 0 ? "down" : "up";
  const moveText = `${t} is ${word} ${pct(move)} from the last close`;
  if (!met) return no(`${moveText}, short of the ${need}% ${direction} trigger, so nothing was done.`);

  const usable = observed.filter(hasPrice).filter((o) => {
    const code = status.get(o.version.symbol)?.reasonCode;
    return !(code && BLOCKED.has(code));
  });
  // Derived prices are computed from the stale stock quote: drop them when a live price disagrees by >2%.
  const live = usable.filter((o) => !o.derived && o.version.issuer !== "ondo");
  const ref = live.length ? live.sort((a, b) => ISSUER_RANK[a.version.issuer] - ISSUER_RANK[b.version.issuer] || b.at - a.at)[0].perShareUsd : null;
  const staleSkipped: VersionPrice[] = [];
  const candidates = usable.filter((o) => {
    if (o.derived && ref !== null && Math.abs(o.perShareUsd / ref - 1) > STALE_GAP) {
      staleSkipped.push(o);
      return false;
    }
    return true;
  });
  if (!candidates.length) {
    return no(`${moveText}, but no version of ${t} can be traded right now (paused, limited or without a live price), so nothing was done.`);
  }
  const buy = rule.action.side === "buy";
  const best = candidates.reduce((a, b) => (buy ? b.perShareUsd < a.perShareUsd : b.perShareUsd > a.perShareUsd) ? b : a);
  let reason = `${moveText}; ${buy ? "bought" : "sold"} the ${issuerName(best.version.issuer)} version at ${usd(best.perShareUsd)}`;
  if (staleSkipped.length) {
    const s = staleSkipped[0];
    reason += `; skipped the ${issuerName(s.version.issuer)} version at ${usd(s.perShareUsd)} because it was more than 2% away from the live price`;
  }
  return { ruleId: rule.id, fire: true, version: best.version, reason: reason + ".", observed };
}
