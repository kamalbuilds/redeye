// The web's store: the same rules.json and receipts.jsonl as store.ts, kept as two objects per visitor in a key-value
// blob store (Vercel Blob) because a serverless function has no writable disk. The I/O is injected so the logic is
// testable and the package that talks to Blob stays in web/.
import type { Rule } from "../types.ts";
import type { Receipt, RuleStatus, StoredRule } from "./store.ts";

export interface BlobIO {
  read(path: string): Promise<string | null>;
  write(path: string, body: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

export const MAX_RECEIPTS = 200;
export const MAX_ARMED_PER_VISITOR = 5;
const VISITOR = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const isVisitorId = (v: string): boolean => VISITOR.test(v);
const rulesPath = (v: string) => `visitors/${v}/rules.json`;
const receiptsPath = (v: string) => `visitors/${v}/receipts.jsonl`;

// ponytail: read-modify-write with no lock, like store.ts. A tick that rewrites rules.json while the same visitor arms a
// rule can drop the new rule; the ETag precondition on put closes that if it ever shows up.
export function openBlobStore(io: BlobIO, visitor: string) {
  if (!isVisitorId(visitor)) throw new Error("visitor id must be a UUID");

  const store = {
    visitor,
    async rules(): Promise<StoredRule[]> {
      const raw = await io.read(rulesPath(visitor));
      return raw === null ? [] : (JSON.parse(raw) as StoredRule[]);
    },
    async addRule(rule: Rule, text: string, now = Date.now()): Promise<StoredRule> {
      const all = await store.rules();
      if (all.some((r) => r.rule.id === rule.id)) throw new Error(`rule ${rule.id} already exists`);
      if (all.filter((r) => r.status === "armed").length >= MAX_ARMED_PER_VISITOR) {
        throw new Error(`${MAX_ARMED_PER_VISITOR} rules are already armed. Wait for one to finish.`);
      }
      const sr: StoredRule = { rule, text, status: "armed", createdAt: now };
      await io.write(rulesPath(visitor), JSON.stringify([...all, sr], null, 2) + "\n");
      return sr;
    },
    async setStatus(ruleId: string, status: RuleStatus, note?: string, now = Date.now()): Promise<void> {
      const all = await store.rules();
      const sr = all.find((r) => r.rule.id === ruleId);
      if (!sr) throw new Error(`no rule ${ruleId}`);
      sr.status = status;
      if (status !== "armed") sr.closedAt = now;
      if (note !== undefined) sr.note = note;
      await io.write(rulesPath(visitor), JSON.stringify(all, null, 2) + "\n");
    },
    async appendReceipt(r: Receipt): Promise<void> {
      const lines = ((await io.read(receiptsPath(visitor))) ?? "").split("\n").filter(Boolean);
      lines.push(JSON.stringify(r));
      await io.write(receiptsPath(visitor), lines.slice(-MAX_RECEIPTS).join("\n") + "\n");
    },
    async receipts(): Promise<Receipt[]> {
      const raw = await io.read(receiptsPath(visitor));
      if (raw === null) return [];
      return raw.split("\n").filter(Boolean).map((l, i) => {
        try { return JSON.parse(l) as Receipt; } catch { throw new Error(`receipts line ${i + 1} is not JSON`); }
      });
    },
  };
  return store;
}
export type BlobStore = ReturnType<typeof openBlobStore>;

/** Every visitor that has a rules file: the tick walks these. */
export async function listVisitors(io: BlobIO): Promise<string[]> {
  const out: string[] = [];
  for (const p of await io.list("visitors/")) {
    const m = /^visitors\/([^/]+)\/rules\.json$/.exec(p);
    if (m && isVisitorId(m[1])) out.push(m[1]);
  }
  return out;
}
