// Read-only: every BSC version of a ticker with its price and, where it can trade, a Trading API quote for `usd` USDT.
import { listVersions as defaultList, priceVersions as defaultPrice, sessionStatus as defaultStatus } from "../data/rwa.ts";
import { pickRoute, toUnits, USDT } from "../exec/execute.ts";
import { createWeb3Client, credsFromEnv, Web3ApiError } from "../exec/web3api.ts";
import type { QuoteRoute, Web3Client } from "../exec/web3api.ts";
import type { SessionStatus, StockVersion, VersionPrice } from "../types.ts";
import { ondoTooSmall, ONDO_MIN_USD } from "./guards.ts";

// BSC-USD (USDT) on BSC has 18 decimals; execute.ts reads the same value with eth_call decimals().
const USDT_DECIMALS = 18;
const BLOCKED = new Set(["ASSET_LIMITED", "MARKET_PAUSED", "ASSET_PAUSED"]);

export interface QuoteRow {
  price: VersionPrice;
  status: SessionStatus | null;
  tradable: boolean;
  note: string;            // why a quote was not attempted, or the API error code and message
  route: QuoteRoute | null;
  tokensOut: number | null;
  impliedPerShareUsd: number | null;
}

export interface QuoteDeps {
  env?: Record<string, string | undefined>;
  api?: Web3Client;
  listVersions?: (ticker: string) => Promise<StockVersion[]>;
  priceVersions?: (v: StockVersion[]) => Promise<VersionPrice[]>;
  sessionStatus?: (v: StockVersion) => Promise<SessionStatus>;
  // xStocks quotes are RFQ-style and need a wallet address; without one that row reports the API's error.
  wallet?: string;
}

export async function quoteTicker(ticker: string, usd: number, deps: QuoteDeps = {}): Promise<QuoteRow[]> {
  const versions = await (deps.listVersions ?? defaultList)(ticker);
  if (versions.length === 0) throw new Error(`${ticker} has no tokenized version on BSC`);
  const prices = await (deps.priceVersions ?? defaultPrice)(versions);
  const statuses = await Promise.all(versions.map(async (v) => {
    try { return await (deps.sessionStatus ?? defaultStatus)(v); } catch { return null; }
  }));
  const api = deps.api ?? createWeb3Client(credsFromEnv(deps.env ?? process.env));
  return Promise.all(prices.map(async (price, i): Promise<QuoteRow> => {
    const status = statuses[i];
    const v = price.version;
    const row: QuoteRow = { price, status, tradable: false, note: "", route: null, tokensOut: null, impliedPerShareUsd: null };
    const code = status?.reasonCode;
    if (code && BLOCKED.has(code)) return { ...row, note: `${code}, not attempted` };
    if (ondoTooSmall(v, usd)) return { ...row, note: `Ondo minimum is $${ONDO_MIN_USD}, not attempted` };
    try {
      const routes = await api.quote({ amount: toUnits(String(usd), USDT_DECIMALS).toString(), fromToken: USDT, toToken: v.address, userWalletAddress: deps.wallet });
      const route = pickRoute(routes, v.route === "RFQ" ? "RFQ" : "SWAP");
      const tokensOut = Number(BigInt(route.toTokenAmount)) / 10 ** v.decimals;
      return { ...row, tradable: true, route, tokensOut, impliedPerShareUsd: usd / (tokensOut * v.multiplier), note: "" };
    } catch (e) {
      return { ...row, note: e instanceof Web3ApiError ? `${e.code} ${e.apiMsg}` : e instanceof Error ? e.message : String(e) };
    }
  }));
}

const num = (n: number | null, d = 4) => (n === null ? "-" : n.toFixed(d));

export function formatQuoteTable(ticker: string, usd: number, rows: QuoteRow[]): string {
  const head = ["version", "issuer", "route", "mult", "perShare $", "market", "quote for $" + usd];
  const body = rows.map((r) => [
    r.price.version.symbol,
    r.price.version.issuer,
    r.price.version.route,
    String(r.price.version.multiplier),
    num(r.price.perShareUsd, 3) + (r.price.derived ? " (derived)" : ""),
    r.status ? `${r.status.marketStatus ?? "-"}/${r.status.reasonCode ?? "-"}` : "unknown",
    r.tradable && r.route ? `${num(r.tokensOut, 6)} tok via ${r.route.vendorName} ${r.route.executionMode}, ~$${num(r.impliedPerShareUsd, 3)}/share` : `no quote: ${r.note}`,
  ]);
  const w = head.map((h, c) => Math.max(h.length, ...body.map((b) => b[c].length)));
  const line = (cells: string[]) => cells.map((x, c) => x.padEnd(w[c])).join("  ").trimEnd();
  return [`${ticker} on BSC (chainId 56), $${usd} USDT`, line(head), line(w.map((n) => "-".repeat(n))), ...body.map(line)].join("\n");
}
