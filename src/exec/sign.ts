import { createHmac } from "node:crypto";

// Source: binance-web3-connector-js common/src/utils.ts, Web3RequestSigner.signWeb3 and sendRequest.
// preHash = timestamp + METHOD + requestPath + body, no separators.
// requestPath = base path segment ("/build") + endpoint + raw query, exactly as sent on the wire.
// X-OC-TIMESTAMP is new Date().toISOString() (ISO-8601 ms UTC), not epoch milliseconds.
export function prehash(timestamp: string, method: string, requestPath: string, body: string): string {
  return timestamp + method + requestPath + body;
}

export function sign(secret: string, timestamp: string, method: string, requestPath: string, body: string): string {
  return createHmac("sha256", secret).update(prehash(timestamp, method, requestPath, body), "utf8").digest("base64");
}

export function authHeaders(
  apiKey: string,
  secret: string,
  method: string,
  requestPath: string,
  body: string,
  now: Date = new Date(),
): Record<string, string> {
  const timestamp = now.toISOString();
  return {
    "X-OC-APIKEY": apiKey,
    "X-OC-TIMESTAMP": timestamp,
    "X-OC-SIGN": sign(secret, timestamp, method, requestPath, body),
  };
}
