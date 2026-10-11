import { authHeaders } from "./sign.ts";

// Paths, params and bodies are from binance-web3-connector-js clients/web3-wallet/src/rest-api/modules
// (trading-api.ts, transaction-api.ts, wallet-api.ts), not from the prose docs.
export const BASE_URL = "https://web3.binance.com";
export const BUILD_PREFIX = "/build"; // part of the signed requestPath; omitting it gives 40102
export const BSC = "56";

export const API_CODE = {
  UNAUTHORIZED: 40101,
  BAD_SIGNATURE: 40102,
  BAD_TIMESTAMP: 40103, // seen live: "Invalid timestamp format, expected ISO 8601"
  ONDO_CLOSED: 40367,
  BSTOCK_CLOSED: 40369,
  NO_LIQUIDITY: 40374, // seen live on Ondo TSLAon, market closed
  MIN_ORDER: 40375, // seen live: "Minimum order amount is 5 USD." for exactly $5 into Ondo
  QUOTE_EXPIRED: 40401,
} as const;

export type ApiErrorKind = "UNAUTHORIZED" | "BAD_SIGNATURE" | "BAD_TIMESTAMP" | "ONDO_CLOSED" | "BSTOCK_CLOSED" | "NO_LIQUIDITY" | "MIN_ORDER" | "QUOTE_EXPIRED" | "OTHER";

function kindOf(code: number | null): ApiErrorKind {
  if (code === API_CODE.UNAUTHORIZED) return "UNAUTHORIZED";
  if (code === API_CODE.BAD_SIGNATURE) return "BAD_SIGNATURE";
  if (code === API_CODE.BAD_TIMESTAMP) return "BAD_TIMESTAMP";
  if (code === API_CODE.ONDO_CLOSED) return "ONDO_CLOSED";
  if (code === API_CODE.BSTOCK_CLOSED) return "BSTOCK_CLOSED";
  if (code === API_CODE.NO_LIQUIDITY) return "NO_LIQUIDITY";
  if (code === API_CODE.MIN_ORDER) return "MIN_ORDER";
  if (code === API_CODE.QUOTE_EXPIRED) return "QUOTE_EXPIRED";
  return "OTHER";
}

export class Web3ApiError extends Error {
  readonly code: number | null;
  readonly kind: ApiErrorKind;
  readonly httpStatus: number;
  readonly apiMsg: string;
  constructor(code: number | null, apiMsg: string, httpStatus: number, where: string) {
    super(`Binance Web3 API ${where} failed: code=${code ?? "none"} http=${httpStatus} msg=${apiMsg}`);
    this.name = "Web3ApiError";
    this.code = code;
    this.kind = kindOf(code);
    this.httpStatus = httpStatus;
    this.apiMsg = apiMsg;
  }
}

export class MissingKeyError extends Error {
  constructor(varName: string) {
    super(`${varName} missing: set it in .env (never paste it into chat or code)`);
    this.name = "MissingKeyError";
  }
}

export interface Creds { apiKey: string; apiSecret: string }

export function credsFromEnv(env: Record<string, string | undefined> = process.env): Creds {
  const apiKey = env.BINANCE_W3_API_KEY;
  const apiSecret = env.BINANCE_W3_API_SECRET;
  if (!apiKey) throw new MissingKeyError("BINANCE_W3_API_KEY");
  if (!apiSecret) throw new MissingKeyError("BINANCE_W3_API_SECRET");
  return { apiKey, apiSecret };
}

// ---- response shapes (fields used here only; names from the SDK type files) ----

export interface QuoteRoute {
  quoteId: string;
  vendorName: string;
  fromTokenAmount?: string;
  toTokenAmount: string;
  priceImpactPercent?: string | null;
  executionMode: "SWAP" | "RFQ" | string;
  approveTarget?: string | null;
  isBest?: boolean;
}

export interface ApproveTx { data: string; dexContractAddress: string; gasLimit?: string; gasPrice?: string }

export interface SwapTx { from?: string; to?: string; data?: string; value?: string; gas?: string; gasPrice?: string; minReceiveAmount?: string }
export interface SwapRfq { vendor: string; orderId?: string; txType?: string; typedDataToSign: string; signingScheme?: string; signatureData?: string[] }
export interface SwapBuild { executionMode: "SWAP" | "RFQ" | string; tx?: SwapTx; rfq?: SwapRfq | null }

export interface RfqOrder {
  orderId?: string;
  status?: string;
  txHash?: string | null;
  fromAmount?: string | null;
  toAmount?: string | null;
  filledAt?: number | null;
  createdAt?: number;
}
export interface RfqSubmitted { orderId: string; status?: string; createdAt?: number }

export interface SimulateResult { status?: string; failReason?: string | null; balanceChanges?: unknown[]; allowanceChanges?: unknown[] }
export interface Broadcasted { orderId: string; txHash: string }
export interface TxStatus { txHash?: string; status?: string; errorMsg?: string | null }

export type RfqLifecycle = "pending" | "filled" | "failed" | "expired";

// trading-api.ts getRfqOrderStatus doc: terminal FILLED, FAILED, EXPIRED, CANCELLED; intermediate PENDING_VENDOR, PENDING_ONCHAIN.
// A non-fill terminal that moved no funds (EXPIRED, CANCELLED) maps to "expired". Unknown strings stay "pending" so a
// new intermediate state can never be reported as filled; the caller's timeout turns a stuck order into "failed".
export function rfqLifecycle(status: string | undefined | null): RfqLifecycle {
  switch ((status ?? "").toUpperCase()) {
    case "FILLED": return "filled";
    case "FAILED": return "failed";
    case "EXPIRED":
    case "CANCELLED": return "expired";
    default: return "pending";
  }
}

const SIM_OK = new Set(["SUCCESS", "SUCCEEDED", "SUCCESSFUL", "OK"]);

// Returns null when the simulation passed, otherwise the reason. Unknown statuses fail closed.
export function simulateFailure(r: SimulateResult | null | undefined): string | null {
  if (!r) return "simulate returned no data";
  const status = (r.status ?? "").toUpperCase();
  if (r.failReason) return `simulate failed: ${r.failReason}`;
  if (status === "FAILED") return "simulate failed: no failReason given";
  if (!SIM_OK.has(status)) return `simulate returned unrecognized status "${r.status ?? ""}"`;
  return null;
}

// ---- client ----

type Query = Record<string, string | undefined>;

export interface Web3Client {
  quote(p: { amount: string; fromToken: string; toToken: string; userWalletAddress?: string; chainId?: string }): Promise<QuoteRoute[]>;
  rfqQuote(p: { amount: string; fromToken: string; toToken: string; userWalletAddress: string; chainId?: string }): Promise<QuoteRoute[]>;
  approve(p: { token: string; amount: string; vendor?: string; chainId?: string }): Promise<ApproveTx[]>;
  swap(p: {
    amount: string; fromToken: string; toToken: string; userWalletAddress: string; quoteId: string;
    slippagePercent: string; chainId?: string;
  }): Promise<SwapBuild>;
  rfqSubmit(p: { requestId: string; userSignature: string; vendor: string; quoteId: string; signingScheme?: string }): Promise<RfqSubmitted>;
  rfqOrder(orderId: string): Promise<RfqOrder>;
  simulate(p: { from: string; to: string; data: string; value?: string; chainId?: string }): Promise<SimulateResult>;
  broadcast(p: { signedTransaction: string; address: string; enableMevProtection?: boolean; chainId?: string }): Promise<Broadcasted>;
  txStatus(txHash: string, chainId?: string): Promise<TxStatus | null>;
  tokenBalance(p: { address: string; token: string; chainId?: string }): Promise<string | null>;
}

const OK_CODES = new Set(["0", "200", "000000"]);

export function createWeb3Client(
  creds: Creds,
  fetcher: typeof fetch = fetch,
  clock: () => Date = () => new Date(),
): Web3Client {
  async function request<T>(method: "GET" | "POST", endpoint: string, query: Query, body?: unknown): Promise<T> {
    const qs = Object.entries(query)
      .filter((kv): kv is [string, string] => kv[1] !== undefined)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");
    const requestPath = BUILD_PREFIX + endpoint + (qs ? `?${qs}` : "");
    const bodyStr = body === undefined ? "" : JSON.stringify(body);
    const res = await fetcher(BASE_URL + requestPath, {
      method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...authHeaders(creds.apiKey, creds.apiSecret, method, requestPath, bodyStr, clock()),
      },
      body: bodyStr === "" ? undefined : bodyStr,
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let json: { code?: unknown; msg?: unknown; message?: unknown; success?: unknown; data?: unknown } | null = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    // Gateway blocks answer with an empty body and the code in a header, e.g. "AuthenticationFilter/40101".
    const blockedBy = res.headers.get("x-oc-blocked-by");
    const headerCode = blockedBy ? Number(blockedBy.split("/").pop()) : NaN;
    const code = typeof json?.code === "number" ? json.code : Number.isFinite(headerCode) ? headerCode : null;
    const msg = String(json?.msg ?? json?.message ?? blockedBy ?? (text.slice(0, 200) || `empty body, HTTP ${res.status}`));
    const where = `${method} ${endpoint}`;
    if (!res.ok) throw new Web3ApiError(code, msg, res.status, where);
    if (json === null) throw new Web3ApiError(code, msg, res.status, where);
    // Live: success is HTTP 200 + code 0 + msg "success"; errors such as 40374/40375 also arrive as HTTP 200, so the code decides.
    const codeOk = json.code === undefined || OK_CODES.has(String(json.code));
    if (json.success === false || !codeOk) throw new Web3ApiError(code, msg, res.status, where);
    return json.data as T;
  }

  const A = "/api/v1/dex/aggregator";
  const P = "/api/v1/dex/pre-transaction";

  const quote: Web3Client["quote"] = (p) =>
    request<QuoteRoute[]>("GET", `${A}/quote`, {
      binanceChainId: p.chainId ?? BSC,
      amount: p.amount,
      fromTokenAddress: p.fromToken,
      toTokenAddress: p.toToken,
      userWalletAddress: p.userWalletAddress,
    });

  return {
    quote,
    async rfqQuote(p) {
      const routes = await quote(p);
      const rfq = routes.filter((r) => r.executionMode === "RFQ");
      if (rfq.length === 0) throw new Error(`rfqQuote: no RFQ route returned (modes: ${routes.map((r) => r.executionMode).join(",") || "none"})`);
      return rfq;
    },
    approve: (p) =>
      request<ApproveTx[]>("GET", `${A}/approve-transaction`, {
        binanceChainId: p.chainId ?? BSC,
        tokenContractAddress: p.token,
        approveAmount: p.amount,
        vendor: p.vendor,
      }),
    swap: (p) =>
      request<SwapBuild>("GET", `${A}/swap`, {
        binanceChainId: p.chainId ?? BSC,
        amount: p.amount,
        fromTokenAddress: p.fromToken,
        toTokenAddress: p.toToken,
        slippagePercent: p.slippagePercent,
        userWalletAddress: p.userWalletAddress,
        quoteId: p.quoteId,
      }),
    rfqSubmit: (p) =>
      request<RfqSubmitted>("POST", `${A}/order/submit`, {}, {
        requestId: p.requestId,
        userSignature: p.userSignature,
        vendor: p.vendor,
        quoteId: p.quoteId,
        ...(p.signingScheme ? { signingScheme: p.signingScheme } : {}),
      }),
    // Source/doc disagreement: trading-api.ts:616 puts {orderId} into the GET body (signed and sent) although it is the
    // path parameter. The signature covers whatever body is sent, so this client sends no body on the GET.
    rfqOrder: (orderId) => request<RfqOrder>("GET", `${A}/order/${encodeURIComponent(orderId)}`, {}),
    // Source/doc disagreement: transaction-api.ts:411-415 asserts evmTx, solTx and tronTx all present, while the
    // parameter doc says exactly one; this client sends evmTx only, as the doc says.
    simulate: (p) =>
      request<SimulateResult>("POST", `${P}/simulate`, {}, {
        binanceChainId: p.chainId ?? BSC,
        evmTx: { from: p.from, to: p.to, value: p.value ?? "0", data: p.data },
      }),
    broadcast: (p) =>
      request<Broadcasted>("POST", `${P}/broadcast-transaction`, {}, {
        binanceChainId: p.chainId ?? BSC,
        signedTransaction: p.signedTransaction,
        address: p.address,
        ...(p.enableMevProtection === undefined ? {} : { enableMevProtection: p.enableMevProtection }),
      }),
    txStatus: (txHash, chainId = BSC) =>
      request<TxStatus | null>("GET", `${A}/history`, { binanceChainId: chainId, txHash }),
    async tokenBalance(p) {
      const data = await request<{ tokenAssets?: { tokenContractAddress?: string; balance?: string }[] }[]>(
        "POST", "/api/v1/dex/balance/token-balances-by-address", {},
        {
          address: p.address,
          tokenContractAddresses: [{ binanceChainId: p.chainId ?? BSC, tokenContractAddress: p.token }],
          excludeRiskToken: "1",
        },
      );
      const asset = (data ?? []).flatMap((d) => d.tokenAssets ?? []).find((a) => a.tokenContractAddress?.toLowerCase() === p.token.toLowerCase());
      return asset?.balance ?? null;
    },
  };
}
