// Which way a probe quote runs, and how much it moves. Pure, so lib/quote-leg.test.ts can pin the direction.
import { parseUnits } from "viem";

export const BSC_USDT = "0x55d398326f99059fF775485246999027B3197955";
const USDT_DECIMALS = 18; // BSC-USD

export interface Leg { fromToken: string; toToken: string; amount: string }

/** Same rounding as src/exec/execute.ts floor8: a computed sell quantity never exceeds what the dollars buy. */
const floor8 = (x: number): string => (Math.floor(x * 1e8) / 1e8).toFixed(8);

/** A buy spends `usd` of USDT for the token. A sell hands over `usd / tokenUsd` of the token for USDT. null when a sell cannot be sized. */
export function quoteLeg(side: "buy" | "sell", usd: number, token: { address: string; decimals: number }, tokenUsd: number | null): Leg | null {
  if (side === "buy") return { fromToken: BSC_USDT, toToken: token.address, amount: parseUnits(String(usd), USDT_DECIMALS).toString() };
  if (!tokenUsd || !(tokenUsd > 0)) return null;
  return { fromToken: token.address, toToken: BSC_USDT, amount: parseUnits(floor8(usd / tokenUsd), token.decimals).toString() };
}
