import "server-only";
import { createPublicClient, erc20Abi, fallback, http, isAddress, type Address } from "viem";
import { bsc } from "viem/chains";

export const bscClient = createPublicClient({
  chain: bsc,
  transport: fallback(
    [http("https://bsc-dataseed.bnbchain.org"), http("https://bsc-rpc.publicnode.com"), http("https://bsc-dataseed1.defibit.io")],
    { retryCount: 1 },
  ),
  batch: { multicall: { batchSize: 8_192, wait: 8 } },
});

export function parseAddress(raw: string): Address | null {
  const s = raw.trim();
  return isAddress(s, { strict: false }) ? (s.toLowerCase() as Address) : null;
}

export interface Balance { token: Address; raw: bigint }

/** balanceOf for many tokens in Multicall3 batches. A failed call surfaces as an error, never as zero. */
export async function balancesOf(holder: Address, tokens: Address[]): Promise<{ balances: Balance[]; block: bigint }> {
  const block = await bscClient.getBlockNumber();
  const res = await bscClient.multicall({
    allowFailure: true,
    blockNumber: block,
    contracts: tokens.map((token) => ({ address: token, abi: erc20Abi, functionName: "balanceOf" as const, args: [holder] as const })),
  });
  const failed = res.filter((r) => r.status === "failure").length;
  if (failed > 0) throw new Error(`balanceOf failed for ${failed} of ${tokens.length} tokens at block ${block}`);
  return { block, balances: res.map((r, i) => ({ token: tokens[i], raw: r.result as bigint })) };
}

export async function allowanceOf(token: Address, owner: Address, spender: Address): Promise<bigint> {
  return bscClient.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [owner, spender] });
}
