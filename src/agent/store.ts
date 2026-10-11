import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Address, Rule } from "../types.ts";

// REDEYE_DATA_DIR redirects all state (used to run the CLI against a scratch directory).
export const DEFAULT_DIR = process.env.REDEYE_DATA_DIR ?? resolve(import.meta.dirname, "../../data");

export type RuleStatus = "armed" | "filled" | "expired" | "review" | "disarmed";
export interface StoredRule {
  rule: Rule;
  text: string;
  status: RuleStatus;
  createdAt: number;
  closedAt?: number;
  note?: string;
}

export interface Position {
  ticker: string;
  symbol: string;
  tokenAddress: Address;
  tokens: number;
  baselineMultiplier: number;
  openedAt: number;
}
export type Positions = Record<string, Position[]>; // key: lowercased wallet address

export type Outcome = "no_fire" | "skipped" | "dry_run" | "filled" | "failed" | "expired";
export interface QuoteSummary {
  vendor: string;
  executionMode: string;
  toTokenAmount: string;
  priceImpactPercent: string | null;
  routes: number;
}
export interface Receipt {
  at: number;
  iso: string;
  kind: "rule";
  ruleId: string;
  ticker: string;
  mode: "dry" | "live";
  outcome: Outcome;
  reason: string;
  lastClose: number | null;
  lastCloseSource: string | null;
  observed: { symbol: string; issuer: string; tokenUsd: number | null; perShareUsd: number | null }[];
  version: { symbol: string; issuer: string; address: string } | null;
  side: "buy" | "sell" | null;
  usd: number | null;
  quote: QuoteSummary | null;
  simulate: string;
  txHash: string | null;
  orderId: string | null;
  execLog: string[];
}

// ponytail: read-modify-write without a lock; one writer at a time (the watch loop or one CLI call). Add a lockfile if two writers must overlap.
export function openStore(dir: string = DEFAULT_DIR) {
  const path = (f: string) => join(dir, f);

  function readJson<T>(file: string, empty: T): T {
    if (!existsSync(path(file))) return empty;
    return JSON.parse(readFileSync(path(file), "utf8")) as T;
  }
  // tmp + rename: a crash mid-write leaves the old file intact, never a half-written one.
  function writeJson(file: string, value: unknown): void {
    mkdirSync(dir, { recursive: true });
    const tmp = `${path(file)}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
    renameSync(tmp, path(file));
  }

  const store = {
    dir,
    rules: (): StoredRule[] => readJson<StoredRule[]>("rules.json", []),
    addRule(rule: Rule, text: string, now = Date.now()): StoredRule {
      const all = store.rules();
      if (all.some((r) => r.rule.id === rule.id)) throw new Error(`rule ${rule.id} already exists`);
      const sr: StoredRule = { rule, text, status: "armed", createdAt: now };
      writeJson("rules.json", [...all, sr]);
      return sr;
    },
    setStatus(ruleId: string, status: RuleStatus, note?: string, now = Date.now()): void {
      const all = store.rules();
      const sr = all.find((r) => r.rule.id === ruleId);
      if (!sr) throw new Error(`no rule ${ruleId}`);
      sr.status = status;
      if (status !== "armed") sr.closedAt = now;
      if (note !== undefined) sr.note = note;
      writeJson("rules.json", all);
    },
    appendReceipt(r: Receipt): void {
      mkdirSync(dir, { recursive: true });
      appendFileSync(path("receipts.jsonl"), JSON.stringify(r) + "\n");
    },
    receipts(): Receipt[] {
      if (!existsSync(path("receipts.jsonl"))) return [];
      return readFileSync(path("receipts.jsonl"), "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l, i) => {
          try { return JSON.parse(l) as Receipt; } catch { throw new Error(`receipts.jsonl line ${i + 1} is not JSON`); }
        });
    },
    positions: (): Positions => readJson<Positions>("positions.json", {}),
    positionsFor: (address: string): Position[] => store.positions()[address.toLowerCase()] ?? [],
    // Buying more of a held token keeps total accrual: the new baseline is the token-weighted mean of the two.
    addPosition(address: string, p: Position): Position {
      const all = store.positions();
      const key = address.toLowerCase();
      const list = all[key] ?? [];
      const i = list.findIndex((x) => x.tokenAddress.toLowerCase() === p.tokenAddress.toLowerCase());
      let merged = p;
      if (i >= 0) {
        const o = list[i];
        const tokens = o.tokens + p.tokens;
        merged = { ...o, tokens, baselineMultiplier: (o.tokens * o.baselineMultiplier + p.tokens * p.baselineMultiplier) / tokens, openedAt: Math.min(o.openedAt, p.openedAt) };
        list[i] = merged;
      } else list.push(p);
      all[key] = list;
      writeJson("positions.json", all);
      return merged;
    },
    // Replaces one position wholesale (used after a payout re-baselines it); tokens <= 0 removes it.
    setPosition(address: string, p: Position): void {
      const all = store.positions();
      const key = address.toLowerCase();
      const rest = (all[key] ?? []).filter((x) => x.tokenAddress.toLowerCase() !== p.tokenAddress.toLowerCase());
      all[key] = p.tokens > 0 ? [...rest, p] : rest;
      writeJson("positions.json", all);
    },
  };
  return store;
}
export type Store = ReturnType<typeof openStore>;
