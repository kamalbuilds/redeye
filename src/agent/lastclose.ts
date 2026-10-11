// lastClose = the underlying's price at the last US regular-session close (16:00 America/New_York).
//
// Source: the 1h kline of the token itself (src/data candles), taking the candle that OPENS one hour before the close,
// whose close value is the price at 16:00 ET. The dynamic endpoint's stockInfo.price cannot serve: it is the live
// extended-hours price, so after the earnings print it already contains the move the rule measures, and it carries no
// previous-close field. Candle order of preference:
//   1. Ondo (...on): token price is stockUsd * multiplier, so its candle is the stock's own price. On a holiday it stays
//      flat at the last real close, which is exactly the value wanted.
//   2. bStocks (...B): real trades, multiplier 1, slightly noisier (pool fee) and trades on holidays.
// xStocks are skipped (near idle on BSC, last trade can be days old). Early-close days (13:00 ET) are not modelled: the
// candle read is then 3 hours of after-hours drift past the true close.
import { candles as defaultCandles } from "../data/rwa.ts";
import type { Candle, StockVersion } from "../types.ts";

const HOUR = 3_600_000;
const NY = "America/New_York";

function nyParts(ms: number) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: NY, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", hourCycle: "h23" });
  const o: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(ms))) if (p.type !== "literal") o[p.type] = Number(p.value);
  return { y: o.year, m: o.month, d: o.day, h: o.hour };
}

// 16:00 New York on the given calendar day, as epoch ms (20:00Z in EDT, 21:00Z in EST).
function closeOn(y: number, m: number, d: number): number {
  const edt = Date.UTC(y, m - 1, d, 20);
  return nyParts(edt).h === 16 ? edt : Date.UTC(y, m - 1, d, 21);
}

/** Latest weekday 16:00 ET at or before `now`. Holidays are not detected (see header). */
export function lastRegularCloseMs(now: number): number {
  let { y, m, d } = nyParts(now);
  for (let i = 0; i < 10; i++) {
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (dow !== 0 && dow !== 6) {
      const c = closeOn(y, m, d);
      if (c <= now) return c;
    }
    const prev = new Date(Date.UTC(y, m - 1, d - 1));
    y = prev.getUTCFullYear(); m = prev.getUTCMonth() + 1; d = prev.getUTCDate();
  }
  throw new Error(`no weekday close found before ${new Date(now).toISOString()}`);
}

export interface LastClose { close: number; closeAt: number; source: string }
export type CandleFn = (v: StockVersion, interval: string, o: { startTime?: number; limit?: number }) => Promise<Candle[]>;

export async function lastClose(versions: StockVersion[], now: number, candles: CandleFn = defaultCandles): Promise<LastClose> {
  const closeAt = lastRegularCloseMs(now);
  const open = closeAt - HOUR;
  const order = ["ondo", "bstocks"] as const;
  const errors: string[] = [];
  for (const issuer of order) {
    const v = versions.find((x) => x.issuer === issuer);
    if (!v) continue;
    try {
      const rows = await candles(v, "1h", { startTime: open, limit: 2 });
      const row = rows.find((c) => c.t === open);
      if (row && row.c > 0) return { close: row.c / v.multiplier, closeAt, source: `${v.symbol} 1h candle opening ${new Date(open).toISOString()}, close value` };
      errors.push(`${v.symbol}: no candle at ${new Date(open).toISOString()}`);
    } catch (e) {
      errors.push(`${v.symbol}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new Error(`no last-close price for ${versions[0]?.ticker ?? "?"} at ${new Date(closeAt).toISOString()} (${errors.join("; ") || "no Ondo or bStocks version on BSC"})`);
}
