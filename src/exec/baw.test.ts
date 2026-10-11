import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { BawError, createBaw, execBaw } from "./baw.ts";
import type { BawRunner } from "./baw.ts";

function runnerReturning(out: unknown) {
  const calls: string[][] = [];
  const run: BawRunner = async (args) => {
    calls.push(args);
    return { stdout: typeof out === "string" ? out : JSON.stringify(out), stderr: "" };
  };
  return { calls, run };
}

test("market-order swap uses the documented flags and appends --json", async () => {
  const { calls, run } = runnerReturning({ success: true, data: { orderId: "123" } });
  const r = await createBaw(run).marketSwap({ fromTokenQty: "5", fromToken: "0xf", toToken: "0xt", slippagePercent: "0.5" });
  assert.deepEqual(r, { orderId: "123" });
  assert.deepEqual(calls[0], ["market-order", "swap", "--fromTokenQty", "5", "--fromToken", "0xf", "--toToken", "0xt", "--binanceChainId", "56", "--slippage", "0.5", "--json"]);
});

test("wallet address picks the chain 56 entry; settings and market-order list parse", async () => {
  const addr = { success: true, data: { addresses: [{ binanceChainId: "1", address: "0xeth" }, { binanceChainId: "56", address: "0xbsc" }] } };
  assert.equal(await createBaw(runnerReturning(addr).run).address("56"), "0xbsc");
  await assert.rejects(() => createBaw(runnerReturning(addr).run).address("8453"), /no address for chain 8453/);
  const list = { success: true, data: { list: [{ orderId: "9", status: "FINISHED", txHash: "0xabc" }] } };
  const { calls, run } = runnerReturning(list);
  assert.deepEqual(await createBaw(run).marketOrder("9"), { orderId: "9", status: "FINISHED", txHash: "0xabc", fromTokenQty: undefined });
  assert.deepEqual(calls[0], ["market-order", "list", "--orderId", "9", "--json"]);
  assert.equal(await createBaw(runnerReturning({ success: true, data: { list: [] } }).run).marketOrder("9"), null);
});

test("sign-message preview sends the full eth_signTypedData_v4 request string", async () => {
  const { calls, run } = runnerReturning({ success: true, data: { requestId: "rq", requireConfirmation: false } });
  await createBaw(run).signTypedData({ signer: "0xme", typedDataJson: '{"a":1}' });
  const a = calls[0];
  assert.deepEqual(a.slice(0, 2), ["sign-message", "preview"]);
  assert.equal(a[a.indexOf("--signType") + 1], "EIP712");
  assert.deepEqual(JSON.parse(a[a.indexOf("--message") + 1]), { method: "eth_signTypedData_v4", params: ["0xme", '{"a":1}'] });
});

test("success:false and unparseable output throw BawError carrying the CLI error", async () => {
  const bad = { success: false, error: { code: 351803, name: "AGENT_DEV_MODE_RISK_BLOCKED", message: "High risk transaction" } };
  await assert.rejects(() => createBaw(runnerReturning(bad).run).settings(), (e: unknown) => e instanceof BawError && /AGENT_DEV_MODE_RISK_BLOCKED code=351803 High risk transaction/.test(e.message));
  await assert.rejects(() => createBaw(runnerReturning("not json").run).settings(), /unparseable output/);
});

test("execBaw maps a missing binary to a clear BawError (real child_process)", { skip: (() => { try { execFileSync("baw", ["--version"], { stdio: "ignore" }); return "baw is installed here"; } catch { return false; } })() }, async () => {
  await assert.rejects(() => execBaw(["wallet", "address", "--json"]), (e: unknown) => e instanceof BawError && /not on PATH/.test(e.message));
});
