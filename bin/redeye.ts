#!/usr/bin/env -S node --env-file-if-exists=.env
// Redeye CLI. Dry run everywhere unless --live is passed AND REDEYE_LIVE=yes is set.
import { numberFlag, parseArgs } from "../src/agent/args.ts";
import { banner, DEFAULT_MAX_USD_PER_TRADE } from "../src/agent/guards.ts";
import type { Receipt } from "../src/agent/store.ts";

const USAGE = `usage:
  redeye rule add "<text>" --window <iso-start> <iso-end>
  redeye rule list
  redeye tick [--live] [--max-usd N]
  redeye watch [--every 300] [--live] [--max-usd N]
  redeye quote <TICKER> <usd> [--wallet <0xaddress>]
  redeye receipts [--last N]`;

const line = (r: Receipt) => `${r.iso} ${r.mode.padEnd(4)} ${r.outcome.padEnd(8)} ${r.ticker.padEnd(6)} ${r.reason}`;

async function main(argv: string[]): Promise<void> {
  const [cmd, ...rest] = argv;

  if (cmd === "rule") {
    const { openStore } = await import("../src/agent/store.ts");
    const store = openStore();
    const [sub, ...r] = rest;
    if (sub === "list") {
      const all = store.rules();
      if (all.length === 0) console.log("no rules yet. Add one: rule add \"if TSLA drops more than 8% buy $5\" --window <iso-start> <iso-end>");
      for (const s of all) console.log(`${s.status.padEnd(8)} ${s.rule.id}  "${s.text}"  ${new Date(s.rule.window.startMs).toISOString()} .. ${new Date(s.rule.window.endMs).toISOString()}${s.note ? `  (${s.note})` : ""}`);
      return;
    }
    if (sub === "add") {
      const a = parseArgs(r, { "--window": 2 });
      const text = a.pos[0];
      const w = a.flags.get("--window");
      if (!text || !w) throw new Error(USAGE);
      const [startMs, endMs] = w.map((s) => Date.parse(s));
      if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) throw new Error(`--window needs two ISO times with end after start, got "${w.join('" "')}"`);
      const { parseRule, parseRuleStrict } = await import("../src/signals/parse.ts");
      const ctx = { now: Date.now(), window: { startMs, endMs } };
      const rule = process.env.ANTHROPIC_API_KEY ? await parseRule(text, ctx) : parseRuleStrict(text, ctx);
      store.addRule(rule, text, ctx.now);
      console.log(`armed ${rule.id}: ${rule.action.side} ${rule.action.usd !== undefined ? "$" + rule.action.usd : (rule.action.fractionOfHolding ?? 0) * 100 + "% of holding"} of ${rule.ticker} if it moves ${rule.trigger.direction} ${rule.trigger.pct}% from the last close, ${w[0]} .. ${w[1]}`);
      return;
    }
    throw new Error(USAGE);
  }

  if (cmd === "tick" || cmd === "watch") {
    const a = parseArgs(rest, { "--live": 0, "--max-usd": 1, "--every": 1 });
    const opts = { live: a.flags.has("--live"), maxUsdPerTrade: numberFlag(a, "--max-usd", DEFAULT_MAX_USD_PER_TRADE) };
    console.log(banner(opts));
    const { tick } = await import("../src/agent/tick.ts");
    const once = async () => {
      const rs = await tick(Date.now(), opts);
      if (rs.length === 0) console.log(`${new Date().toISOString()} no receipts: no armed rules, or every armed rule is still waiting for its window`);
      for (const r of rs) console.log(line(r));
    };
    if (cmd === "tick") return once();
    const every = numberFlag(a, "--every", 300) * 1000;
    let wake: (() => void) | null = null;
    let stop = false;
    process.on("SIGINT", () => { stop = true; wake?.(); });
    while (!stop) {
      try { await once(); } catch (e) { console.error(`tick failed: ${e instanceof Error ? e.message : String(e)}`); }
      if (!stop) await new Promise<void>((res) => { const t = setTimeout(res, every); wake = () => { clearTimeout(t); res(); }; });
    }
    console.log("watch stopped");
    return;
  }

  if (cmd === "quote") {
    const qa = parseArgs(rest, { "--wallet": 1 });
    const [ticker, usdRaw] = qa.pos;
    const usd = Number(usdRaw);
    if (!ticker || !(usd > 0)) throw new Error(USAGE);
    const { quoteTicker, formatQuoteTable } = await import("../src/agent/quote.ts");
    let wallet: string | undefined = qa.flags.get("--wallet")?.[0];
    if (!wallet) try {
      const { createBaw } = await import("../src/exec/baw.ts");
      wallet = await createBaw().address("56");
    } catch (e) {
      console.log(`note: no signed-in baw wallet (${e instanceof Error ? e.message.slice(0, 80) : "unknown"}); xStocks quotes need one`);
    }
    console.log(formatQuoteTable(ticker.toUpperCase(), usd, await quoteTicker(ticker.toUpperCase(), usd, { wallet })));
    return;
  }

  if (cmd === "receipts") {
    const a = parseArgs(rest, { "--last": 1 });
    const { openStore } = await import("../src/agent/store.ts");
    const all = openStore().receipts();
    if (all.length === 0) console.log("no receipts yet. They are written by tick and watch.");
    for (const r of all.slice(-numberFlag(a, "--last", 20))) console.log(line(r));
    return;
  }

  console.log(USAGE);
  if (cmd !== undefined && cmd !== "help") process.exitCode = 2;
}

main(process.argv.slice(2)).catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
