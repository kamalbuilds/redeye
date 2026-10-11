import { execFile } from "node:child_process";

// Thin wrapper over the Binance Agentic Wallet CLI. Every command, flag and --json shape below is from
// binance-skills-hub skills/binance-web3/binance-agentic-wallet (SKILL.md v1.12.0, requiredCliVersion 1.10.0):
//   wallet address          references/wallet-view.md   "baw wallet address --json"
//   wallet settings         references/wallet-setting.md "baw wallet settings --json"
//   market-order swap/list  references/market-order.md  L20 (swap) and L116 (list)
//   sign-message *          references/external-sign.md L242 (preview), L297 (execute), L353 (result)
//   contract-call *         references/external-sign.md L31 (preview), L183 (execute)
export const BAW_TIMEOUT_MS = 60_000;

export class BawError extends Error {
  readonly detail: string;
  constructor(command: string, detail: string) {
    super(`baw ${command} failed: ${detail}`);
    this.name = "BawError";
    this.detail = detail;
  }
}

export type BawRunner = (args: string[]) => Promise<{ stdout: string; stderr: string }>;

export const execBaw: BawRunner = (args) =>
  new Promise((resolve, reject) => {
    execFile("baw", args, { timeout: BAW_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, encoding: "utf8" }, (err, stdout, stderr) => {
      if (err) {
        const e = err as NodeJS.ErrnoException & { killed?: boolean; code?: string | number };
        const cmd = args.slice(0, 2).join(" ");
        if (e.code === "ENOENT") return reject(new BawError(cmd, "baw is not on PATH (install: npm install -g @binance/agentic-wallet@1.10.0)"));
        if (e.killed) return reject(new BawError(cmd, `timed out after ${BAW_TIMEOUT_MS / 1000}s`));
        return reject(new BawError(cmd, `exit ${e.code}: ${(stderr || stdout || e.message).trim().slice(0, 500)}`));
      }
      resolve({ stdout, stderr });
    });
  });

function parseJson(stdout: string): any {
  const s = stdout.trim();
  try { return JSON.parse(s); } catch { /* fall through to brace extraction */ }
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a >= 0 && b > a) return JSON.parse(s.slice(a, b + 1));
  throw new Error("no JSON object in output");
}

export interface BawSettings {
  dailyLimit: number;
  quotaLeft: number;
  tradeAllTokens: boolean;
  devMode: { enabled: boolean; expiresAt: number | null; dailyLimit?: number; balanceExceeded?: boolean };
  [k: string]: unknown;
}
export type BawOrderStatus = "PENDING" | "FINISHED" | "FAILED" | string;
export interface BawMarketOrder { orderId: string; status: BawOrderStatus; txHash: string | null; fromTokenQty?: string }
export interface BawPreview { requestId: string; requireConfirmation: boolean; expiresAt?: number }
export interface BawSigned { orderId: string; status: string; signature: string | null; signatureRecovery: string | null; message?: string | null }
export interface BawBroadcast { orderId: string; status: string; txHash: string | null; message?: string | null }

export interface Baw {
  address(chainId?: string): Promise<string>;
  settings(): Promise<BawSettings>;
  marketSwap(p: { fromTokenQty: string; fromToken: string; toToken: string; slippagePercent: string; chainId?: string }): Promise<{ orderId: string }>;
  marketOrder(orderId: string): Promise<BawMarketOrder | null>;
  signTypedData(p: { signer: string; typedDataJson: string; chainId?: string }): Promise<BawPreview>;
  signExecute(requestId: string): Promise<BawSigned>;
  signResult(orderId: string): Promise<BawSigned>;
  contractPreview(p: { from: string; to: string; data: string; value?: string; chainId?: string }): Promise<BawPreview>;
  contractExecute(requestId: string): Promise<BawBroadcast>;
}

export function createBaw(run: BawRunner = execBaw): Baw {
  async function call(args: string[]): Promise<any> {
    const cmd = args.slice(0, 2).join(" ");
    const { stdout } = await run([...args, "--json"]);
    let json: any;
    try { json = parseJson(stdout); } catch (e) { throw new BawError(cmd, `unparseable output: ${(e as Error).message}`); }
    if (json?.success !== true) {
      const err = json?.error ?? {};
      throw new BawError(cmd, `${err.name ?? "error"} code=${err.code ?? "?"} ${err.message ?? JSON.stringify(json).slice(0, 300)}`);
    }
    return json.data;
  }

  return {
    async address(chainId = "56") {
      const d = await call(["wallet", "address"]);
      const hit = (d?.addresses ?? []).find((a: any) => String(a.binanceChainId) === chainId);
      if (!hit?.address) throw new BawError("wallet address", `no address for chain ${chainId}`);
      return hit.address;
    },
    settings: () => call(["wallet", "settings"]),
    async marketSwap(p) {
      const d = await call([
        "market-order", "swap",
        "--fromTokenQty", p.fromTokenQty, "--fromToken", p.fromToken, "--toToken", p.toToken,
        "--binanceChainId", p.chainId ?? "56", "--slippage", p.slippagePercent,
      ]);
      if (!d?.orderId) throw new BawError("market-order swap", "success without orderId");
      return { orderId: String(d.orderId) };
    },
    async marketOrder(orderId) {
      const d = await call(["market-order", "list", "--orderId", orderId]);
      const row = (d?.list ?? []).find((o: any) => String(o.orderId) === orderId);
      return row ? { orderId, status: String(row.status), txHash: row.txHash ?? null, fromTokenQty: row.fromTokenQty } : null;
    },
    signTypedData(p) {
      const message = JSON.stringify({ method: "eth_signTypedData_v4", params: [p.signer, p.typedDataJson] });
      return call(["sign-message", "preview", "--binanceChainId", p.chainId ?? "56", "--message", message, "--signType", "EIP712"]);
    },
    signExecute: (requestId) => call(["sign-message", "execute", "--requestId", requestId]),
    signResult: (orderId) => call(["sign-message", "result", "--order-id", orderId]),
    contractPreview(p) {
      return call([
        "contract-call", "preview", "--binanceChainId", p.chainId ?? "56",
        "--from", p.from, "--to", p.to, "--value", p.value ?? "0", "--inputData", p.data,
      ]);
    },
    contractExecute: (requestId) => call(["contract-call", "execute", "--requestId", requestId]),
  };
}
