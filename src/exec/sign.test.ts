import { test } from "node:test";
import assert from "node:assert/strict";
import { authHeaders, prehash, sign } from "./sign.ts";

// Inputs are the reference values in binance-web3-connector-js common/tests/UtilsTest.test.ts (getWeb3Signature block).
// That file recomputes the expected value with node:crypto and holds no literal digest, so the digests below were
// computed independently with `openssl dgst -sha256 -hmac test-secret -binary | base64` on the same prehash strings.
const TS = "2026-05-11T10:08:57.715Z";
const SECRET = "test-secret";
const GET_PATH = "/api/v1/dex/market/price?chainId=1&symbol=ETH%20USDT";
const POST_PATH = "/api/v1/dex/swap";
const POST_BODY = '{"chainId":1,"fromToken":"0xEEEE"}';

test("prehash is timestamp + METHOD + requestPath + body with no separators", () => {
  assert.equal(prehash(TS, "GET", GET_PATH, ""), "2026-05-11T10:08:57.715ZGET/api/v1/dex/market/price?chainId=1&symbol=ETH%20USDT");
  assert.equal(prehash(TS, "POST", POST_PATH, POST_BODY), '2026-05-11T10:08:57.715ZPOST/api/v1/dex/swap{"chainId":1,"fromToken":"0xEEEE"}');
});

test("GET with raw query matches the openssl digest", () => {
  assert.equal(sign(SECRET, TS, "GET", GET_PATH, ""), "qyu/Z2JA5KwufIqPsVDqUTCZuq20N2I53liFGffdZYA=");
});

test("POST with body matches the openssl digest", () => {
  assert.equal(sign(SECRET, TS, "POST", POST_PATH, POST_BODY), "ZuzE9Tes209fDOw/wb2CnF7VyYI39q040khQJgCHep8=");
});

test("the /build prefix changes the digest (omitting it is the documented 40102 cause)", () => {
  const withPrefix = sign(SECRET, TS, "POST", "/build/api/v1/dex/swap", '{"chainId":1}');
  assert.equal(withPrefix, "ZzCUlGck7ZY0C8AhNVzzQGrPYYm9rPMlCv4/75SEdjg=");
  assert.notEqual(withPrefix, sign(SECRET, TS, "POST", "/api/v1/dex/swap", '{"chainId":1}'));
});

test("authHeaders carries key, ISO-8601 ms timestamp and the same signature", () => {
  const h = authHeaders("key-1", SECRET, "GET", GET_PATH, "", new Date(TS));
  assert.deepEqual(h, {
    "X-OC-APIKEY": "key-1",
    "X-OC-TIMESTAMP": TS,
    "X-OC-SIGN": "qyu/Z2JA5KwufIqPsVDqUTCZuq20N2I53liFGffdZYA=",
  });
});

test("X-OC-TIMESTAMP is ISO-8601 with milliseconds, never epoch ms (live gateway answers 40103 to epoch ms)", () => {
  const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  const h = authHeaders("k", SECRET, "GET", GET_PATH, ""); // default clock
  assert.match(h["X-OC-TIMESTAMP"], ISO);
  assert.doesNotMatch(h["X-OC-TIMESTAMP"], /^\d+$/);
  assert.match(authHeaders("k", SECRET, "GET", GET_PATH, "", new Date(0))["X-OC-TIMESTAMP"], ISO);
  // the signed prefix is the same string as the header
  const hh = authHeaders("k", SECRET, "GET", GET_PATH, "", new Date(1_700_000_000_123));
  assert.equal(hh["X-OC-SIGN"], sign(SECRET, hh["X-OC-TIMESTAMP"], "GET", GET_PATH, ""));
});
