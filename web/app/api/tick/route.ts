import { timingSafeEqual } from "node:crypto";
import { REFERENCE_HOLDING_USD } from "@/lib/reference";
import { loadRepoEnv } from "@/lib/shared/server-env";
import { dryRunMod, tickMod } from "@/lib/shared/src";
import { allStores } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// The per-trade cap only shapes the dry run's refusals. The web never signs, so it is looser than the agent's own $5 default.
const DRY_CAP_USD = 100;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // no secret configured means nobody is let in
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return given.length === want.length && timingSafeEqual(given, want);
}

async function run(req: Request) {
  if (!authorized(req)) return Response.json({ error: "Unauthorized." }, { status: 401 });
  loadRepoEnv();
  const { tick } = await tickMod();
  const { dryTrade } = await dryRunMod();
  const now = Date.now();
  // ponytail: stores run one after another. Parallelise (with a cap on Binance calls) when visitors outgrow the function's time limit.
  const receipts = [];
  let stores = 0;
  for (const store of await allStores()) {
    stores++;
    receipts.push(...await tick(now, { live: false, maxUsdPerTrade: DRY_CAP_USD }, { store, trade: dryTrade, holdingUsd: async () => REFERENCE_HOLDING_USD }));
  }
  return Response.json(
    { ranAt: new Date(now).toISOString(), mode: "dry", stores, receipts: receipts.map((r) => ({ ruleId: r.ruleId, outcome: r.outcome, reason: r.reason })) },
    { headers: { "cache-control": "no-store" } },
  );
}

export const GET = run;
export const POST = run;
