import { readFileSync } from "node:fs";
import type { Address, Candle, Issuer, Route, SessionStatus, StockVersion, VersionPrice } from "../types.ts";

const V1 = "https://www.binance.com/bapi/defi/v1/public/wallet-direct/buw/wallet";
const RWA = `${V1}/market/token/rwa`;
const DYNAMIC = "https://www.binance.com/bapi/defi/v2/public/wallet-direct/buw/wallet/market/token/rwa/dynamic/ai";
const KLINE = `${V1}/dex/market/token/kline/ai`;
const HEADERS = { "Accept-Encoding": "identity", "User-Agent": "binance-web3/1.1 (Skill)" };
const CACHE_MS = 10 * 60 * 1000;
const TYPES: { type: 1 | 2 | 3; issuer: Issuer; route: Route }[] = [
  { type: 1, issuer: "ondo", route: "RFQ" },
  { type: 2, issuer: "xstocks", route: "SWAP" },
  { type: 3, issuer: "bstocks", route: "MIXED" },
];

async function once(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(8000) });
  const body = await res.text();
  if (res.status !== 200) throw new Error(`HTTP ${res.status} ${url}: ${body.slice(0, 200)}`);
  return JSON.parse(body);
}

// Binance envelope: {code, message, data, success}. Throws on success:false.
async function api(url: string): Promise<any> {
  let json: any;
  try {
    json = await once(url);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("HTTP ")) throw e;
    json = await once(url); // retry once on network error / timeout
  }
  if (json?.success === false) throw new Error(`Binance API error code=${json.code} message=${json.message} url=${url}`);
  return json.data;
}

function num(x: unknown): number | null {
  if (x === null || x === undefined || x === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

let cache: { at: number; versions: StockVersion[] } | null = null;

async function loadAll(): Promise<StockVersion[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.versions;
  const lists = await Promise.all(TYPES.map((t) => api(`${RWA}/stock/detail/list/ai?type=${t.type}`)));
  const versions: StockVersion[] = [];
  TYPES.forEach((t, i) => {
    for (const r of lists[i] as any[]) {
      if (r.chainId !== "56") continue;
      versions.push({
        ticker: r.ticker,
        issuer: t.issuer,
        symbol: r.symbol,
        address: String(r.contractAddress).toLowerCase() as Address,
        decimals: Number(r.d),
        multiplier: num(r.multiplier) ?? 1,
        route: t.route,
      });
    }
  });
  cache = { at: Date.now(), versions };
  return versions;
}

export async function listVersions(ticker?: string): Promise<StockVersion[]> {
  const all = await loadAll();
  if (!ticker) return all;
  const t = ticker.toUpperCase();
  return all.filter((v) => v.ticker.toUpperCase() === t);
}

export async function priceVersions(versions: StockVersion[]): Promise<VersionPrice[]> {
  return Promise.all(
    versions.map(async (version): Promise<VersionPrice> => {
      const d = await api(`${DYNAMIC}?chainId=56&contractAddress=${version.address}`);
      const tokenUsd = num(d?.tokenInfo?.price);
      const stockUsd = num(d?.stockInfo?.price);
      const mult = num(d?.tokenInfo?.sharesMultiplier) ?? version.multiplier;
      let perShareUsd: number | null = null;
      let derived = false;
      if (tokenUsd !== null) {
        perShareUsd = tokenUsd / mult;
        if (stockUsd !== null && stockUsd > 0 && mult !== 1) {
          // NFLXx trap: price already per share while multiplier says 10.
          const ratio = tokenUsd / (stockUsd * mult);
          if (Math.abs(ratio - 1 / mult) / (1 / mult) < 0.02) perShareUsd = tokenUsd;
        }
        if (stockUsd !== null && tokenUsd !== 0) derived = Math.abs(tokenUsd - stockUsd * mult) / tokenUsd < 1e-4;
      }
      return { version, tokenUsd, perShareUsd, stockUsd, derived, at: Date.now() };
    }),
  );
}

const STATES = ["premarket", "regular", "postmarket", "overnight", "offhours", "closed", "pause"] as const;

export async function sessionStatus(version?: StockVersion): Promise<SessionStatus> {
  const d = await api(
    version
      ? `${RWA}/asset/market/status/ai?chainId=56&contractAddress=${version.address}`
      : `${RWA}/market/status/ai`,
  );
  const ms = STATES.find((s) => s === d?.marketStatus) ?? null;
  return {
    marketStatus: ms,
    openState: Boolean(d?.openState),
    reasonCode: d?.reasonCode ?? null,
    reasonMsg: d?.reasonMsg ?? null,
    nextOpenTime: num(d?.nextOpenTime),
    nextCloseTime: num(d?.nextCloseTime),
  };
}

export async function candles(
  version: StockVersion,
  interval: string,
  opts: { startTime?: number; endTime?: number; limit?: number } = {},
): Promise<Candle[]> {
  const { startTime, endTime, limit } = opts;
  const q = new URLSearchParams({ chainId: "56", contractAddress: version.address, interval });
  if (limit !== undefined) q.set("limit", String(limit));
  // Live API rejects startTime+endTime together (000002): send startTime, filter endTime client side.
  if (startTime !== undefined) q.set("startTime", String(startTime));
  else if (endTime !== undefined) q.set("endTime", String(endTime));
  const d = await api(`${KLINE}?${q}`);
  const rows: any[] = d?.klineInfos ?? [];
  if (rows.length === 0 && !(await loadAll()).some((v) => v.address === version.address.toLowerCase())) {
    throw new Error(`${version.address} is not a chainId 56 token`);
  }
  let out = rows.map((r) => ({ t: Number(r[0]), o: Number(r[1]), h: Number(r[2]), l: Number(r[3]), c: Number(r[4]), v: Number(r[5]) }));
  if (startTime !== undefined && endTime !== undefined) out = out.filter((c) => c.t <= endTime);
  return out;
}

// Tickers whose per-asset status reasonMsg is "earnings" (one BSC version per ticker is polled).
export async function earningsTickers(): Promise<string[]> {
  const first = new Map<string, StockVersion>();
  for (const v of await loadAll()) if (v.issuer !== "bstocks" && !first.has(v.ticker)) first.set(v.ticker, v);
  const vs = [...first.values()];
  const hits: string[] = [];
  for (let i = 0; i < vs.length; i += 20) {
    const batch = vs.slice(i, i + 20);
    const st = await Promise.all(batch.map((v) => sessionStatus(v)));
    st.forEach((s, j) => s.reasonMsg === "earnings" && hits.push(batch[j].ticker));
  }
  return hits;
}

export interface KnownEarnings { ticker: string; reportUtc: string; source: string }
export const KNOWN_EARNINGS: KnownEarnings[] = [];

// Fills KNOWN_EARNINGS from data/earnings.json (project root). Missing file leaves it empty.
export function loadKnownEarnings(path: URL | string = new URL("../../data/earnings.json", import.meta.url)): KnownEarnings[] {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return KNOWN_EARNINGS;
    throw e;
  }
  const rows = JSON.parse(raw) as KnownEarnings[];
  for (const r of rows) {
    if (typeof r.ticker !== "string" || typeof r.reportUtc !== "string" || Number.isNaN(Date.parse(r.reportUtc)) || typeof r.source !== "string")
      throw new Error(`bad earnings row: ${JSON.stringify(r)}`);
  }
  KNOWN_EARNINGS.splice(0, KNOWN_EARNINGS.length, ...rows);
  return KNOWN_EARNINGS;
}
