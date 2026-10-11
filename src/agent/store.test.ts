import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "./store.ts";
import type { Receipt } from "./store.ts";
import { NOW, rule, tmpStore, ver } from "./fixtures.ts";

const receipt = (reason: string): Receipt => ({
  at: NOW, iso: new Date(NOW).toISOString(), kind: "rule", ruleId: "r", ticker: "TSLA", mode: "dry", outcome: "no_fire", reason,
  lastClose: 1, lastCloseSource: "x", observed: [], version: null, side: "buy", usd: null, quote: null, simulate: "not run", txHash: null, orderId: null, execLog: [],
});

test("rules persist, statuses change, duplicates are refused, and no tmp file is left behind", () => {
  const dir = mkdtempSync(join(tmpdir(), "redeye-"));
  const a = openStore(dir);
  a.addRule(rule({ id: "a" }), "first");
  a.addRule(rule({ id: "b" }), "second");
  assert.throws(() => a.addRule(rule({ id: "a" }), "dup"), /already exists/);
  a.setStatus("a", "filled", "done", 5);
  const b = openStore(dir); // a fresh handle reads from disk
  assert.deepEqual(b.rules().map((r) => [r.rule.id, r.status]), [["a", "filled"], ["b", "armed"]]);
  assert.equal(b.rules()[0].closedAt, 5);
  assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith(".tmp")), []);
  assert.throws(() => b.setStatus("zzz", "filled"), /no rule/);
});

test("receipts are append-only: earlier lines stay byte-identical", () => {
  const s = tmpStore();
  s.appendReceipt(receipt("one"));
  const first = readFileSync(join(s.dir, "receipts.jsonl"), "utf8");
  s.appendReceipt(receipt("two"));
  const all = readFileSync(join(s.dir, "receipts.jsonl"), "utf8");
  assert.ok(all.startsWith(first));
  assert.deepEqual(s.receipts().map((r) => r.reason), ["one", "two"]);
});

test("a corrupt receipts line is an error naming the line, not a silent skip", () => {
  const s = tmpStore();
  s.appendReceipt(receipt("ok"));
  const fs = readFileSync(join(s.dir, "receipts.jsonl"), "utf8");
  assert.ok(fs.length > 0);
  require_write(join(s.dir, "receipts.jsonl"), fs + "{not json\n");
  assert.throws(() => s.receipts(), /line 2/);
});

test("positions: per address, weighted baseline on a second buy, removal at zero tokens", () => {
  const s = tmpStore();
  const v = ver("ondo", "VZon", "VZ");
  const A = "0xAbCdEf0000000000000000000000000000000001";
  s.addPosition(A, { ticker: "VZ", symbol: "VZon", tokenAddress: v.address, tokens: 10, baselineMultiplier: 1, openedAt: 100 });
  const m = s.addPosition(A.toLowerCase(), { ticker: "VZ", symbol: "VZon", tokenAddress: v.address, tokens: 10, baselineMultiplier: 1.02, openedAt: 200 });
  assert.equal(m.tokens, 20);
  assert.ok(Math.abs(m.baselineMultiplier - 1.01) < 1e-12);
  assert.equal(m.openedAt, 100);
  // total accrued shares at multiplier 1.04 must equal the sum of the two lots
  assert.ok(Math.abs(20 * (1.04 - m.baselineMultiplier) - (10 * 0.04 + 10 * 0.02)) < 1e-12);
  assert.equal(s.positionsFor(A).length, 1);
  assert.deepEqual(s.positionsFor("0x0000000000000000000000000000000000000009"), []);
  s.setPosition(A, { ...m, tokens: 0 });
  assert.equal(s.positionsFor(A).length, 0);
});

import { writeFileSync } from "node:fs";
function require_write(p: string, c: string) { writeFileSync(p, c); }
