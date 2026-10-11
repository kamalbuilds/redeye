// Shared types for src/data, src/exec and the product modules.

export type Issuer = "ondo" | "xstocks" | "bstocks";
export type Route = "RFQ" | "SWAP" | "MIXED";
export type Address = `0x${string}`;

export interface StockVersion {
  ticker: string;          // underlying, e.g. "TSLA"
  issuer: Issuer;
  symbol: string;          // "TSLAon" | "TSLAx" | "TSLAB"
  address: Address;        // BSC (chainId 56) only
  decimals: number;
  multiplier: number;      // shares represented by 1 token (dividends accrue here for Ondo)
  route: Route;            // ondo RFQ, xstocks SWAP, bstocks MIXED (Trading API docs)
}

export interface VersionPrice {
  version: StockVersion;
  tokenUsd: number | null;       // price of 1 token
  perShareUsd: number | null;    // tokenUsd normalised to 1 underlying share
  stockUsd: number | null;       // independent underlying price, null for bStocks
  derived: boolean;              // true when tokenUsd is computed from stockUsd (Ondo on dynamic)
  at: number;                    // ms
}

export interface Candle { t: number; o: number; h: number; l: number; c: number; v: number }

export interface SessionStatus {
  marketStatus: "premarket" | "regular" | "postmarket" | "overnight" | "offhours" | "closed" | "pause" | null;
  openState: boolean;
  reasonCode: string | null;     // TRADING, MARKET_CLOSED, ASSET_LIMITED, ...
  reasonMsg: string | null;      // "earnings", "cash_dividend", ...
  nextOpenTime: number | null;
  nextCloseTime: number | null;
}

// A rule the user writes before bed, parsed to this shape.
export interface Rule {
  id: string;
  ticker: string;
  trigger: { kind: "move_pct"; direction: "down" | "up"; pct: number; from: "last_close" };
  action: { side: "buy" | "sell"; usd?: number; fractionOfHolding?: number };
  window: { startMs: number; endMs: number };   // the earnings window it is armed for
  maxSlippageBps: number;
}

export interface Decision {
  ruleId: string;
  fire: boolean;
  version: StockVersion | null;  // which issuer version to act on
  reason: string;                // one sentence, shown in the receipt
  observed: VersionPrice[];
}

export interface Fill {
  ruleId: string;
  version: StockVersion;
  side: "buy" | "sell";
  usd: number;
  txHash: Address | null;        // SWAP route
  orderId: string | null;        // RFQ route, polled to a terminal state
  status: "filled" | "failed" | "expired";
  simulated: boolean;            // Transaction API simulate ran before signing
}
