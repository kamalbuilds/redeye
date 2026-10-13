import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { readDesk, type ReceiptRow, type WatchRow } from "@/lib/redeye";
import { loadProof } from "@/lib/redeye-proof";
import { storeFor, visitorFromCookie } from "@/lib/store";
import { istAndSgt, usd, watchWindow } from "@/lib/shared/format";
import { cn } from "@/lib/utils";

type Tone = "act" | "dry" | "hold" | "fail" | "watch";
const OUTCOME: Record<string, { text: string; tone: Tone }> = {
  no_fire: { text: "Held", tone: "hold" },
  skipped: { text: "Skipped", tone: "hold" },
  dry_run: { text: "Dry run", tone: "dry" },
  filled: { text: "Filled", tone: "act" },
  failed: { text: "Failed", tone: "fail" },
  expired: { text: "Expired", tone: "hold" },
};
const GLYPH: Record<Tone, string> = { act: "+", dry: "~", hold: "-", fail: "x", watch: "" };
const SHOWN = 8;

function Badge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "fig inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-sm border px-2 text-[0.6875rem] font-bold uppercase tracking-[0.1em]",
        tone === "act" && "border-sodium bg-sodium text-sodium-ink",
        tone === "watch" && "border-sodium/60 text-sodium",
        tone === "dry" && "border-fg-3 text-fg",
        tone === "hold" && "border-line-2 text-fg-3",
        tone === "fail" && "border-fail/70 text-fail",
      )}
    >
      {tone === "watch" ? <span aria-hidden className="live-dot size-1.5 rounded-full bg-sodium" /> : <span aria-hidden>{GLYPH[tone]}</span>}
      {children}
    </span>
  );
}

const ROW = "grid gap-x-6 gap-y-1.5 border-b border-line px-5 py-4 transition-colors duration-150 last:border-b-0 hover:bg-night-3 md:grid-cols-[7.5rem_9rem_minmax(0,1fr)_6rem] md:items-baseline";

function Watching({ w, now }: { w: WatchRow; now: number }) {
  return (
    <li className={ROW}>
      <div><Badge tone="watch">On watch</Badge></div>
      <p className="fig text-[0.8125rem] text-fg">{w.text.replace(/^if /, "")}</p>
      <div className="min-w-0">
        <p className="text-[0.9375rem] leading-snug text-fg">{w.sentence}</p>
        <p className="mt-0.5 text-[0.8125rem] leading-snug text-fg-3">Watching {watchWindow(w.startMs, w.endMs, now)}. Left {istAndSgt(w.since)}.</p>
      </div>
      <p className="fig text-[0.6875rem] text-fg-3 md:text-right">signs when it fires</p>
    </li>
  );
}

function Receipt({ x }: { x: ReceiptRow }) {
  const o = x.outcome ? OUTCOME[x.outcome] ?? { text: x.outcome, tone: "hold" as Tone } : { text: "Unrecorded", tone: "hold" as Tone };
  const acted = x.outcome !== "no_fire" && x.outcome !== null;
  return (
    <li className={ROW}>
      <div className="flex items-center gap-2 md:block">
        <Badge tone={o.tone}>{o.text}</Badge>
        {x.mode && <span className="fig text-[0.6875rem] uppercase tracking-[0.1em] text-fg-3 md:mt-1.5 md:block">{x.mode === "live" ? "live" : "no signing"}</span>}
      </div>
      <p className="fig text-[0.8125rem] text-fg">
        {x.symbol ?? x.ticker ?? "unknown"}
        {acted && x.side ? ` ${x.side}` : ""}
        {acted && x.usd !== null ? ` ${usd(x.usd)}` : ""}
      </p>
      <div className="min-w-0">
        <p className="text-[0.9375rem] leading-snug text-fg">{x.reason ?? "No reason recorded."}</p>
        <p className="mt-0.5 text-[0.8125rem] text-fg-3">{x.at ? istAndSgt(x.at) : "time not recorded"}</p>
      </div>
      <div className="md:text-right">
        {x.txHash ? (
          <a href={`https://bscscan.com/tx/${x.txHash}`} target="_blank" rel="noreferrer" className="fig inline-flex min-h-11 items-center gap-1 text-[0.75rem] text-sodium underline-offset-4 hover:underline md:min-h-0">
            {x.txHash.slice(0, 6)}…{x.txHash.slice(-4)} <ArrowUpRight aria-hidden className="size-3.5" />
          </a>
        ) : (
          <span className="fig text-[0.6875rem] text-fg-3">no tx</span>
        )}
      </div>
    </li>
  );
}

/** With nothing run yet, the ledger opens on the one night that has been run: the recorded TSLA earnings, through the agent's own evaluate(). */
async function Replayed() {
  const p = await loadProof();
  const f = p.fire;
  return (
    <li className={ROW}>
      <div><Badge tone="act">Fired</Badge></div>
      <p className="fig text-[0.8125rem] text-fg">{f.symbol} buy {usd(f.usd, 0)}</p>
      <div className="min-w-0">
        <p className="text-[0.9375rem] leading-snug text-fg">{f.reason}</p>
        <p className="mt-0.5 text-[0.8125rem] text-fg-3">{istAndSgt(f.t)}, rule &ldquo;{p.rule.text}&rdquo; on the TSLA earnings night</p>
      </div>
      <div className="md:text-right">
        <Link href="/proof" className="fig inline-flex min-h-11 items-center gap-1 text-[0.75rem] text-sodium underline-offset-4 hover:underline md:min-h-0">
          Replay <ArrowUpRight aria-hidden className="size-3.5" />
        </Link>
      </div>
    </li>
  );
}

export async function ReceiptStack({ now }: { now: number }) {
  const desk = await readDesk(await storeFor(await visitorFromCookie()), 20);
  const shown = desk.rows.slice(0, SHOWN);
  return (
    <section aria-labelledby="receipts">
      <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-3">
        <div>
          <h2 id="receipts" className="font-serif text-[2rem] leading-[1.08] md:text-[2.5rem]">Morning receipts</h2>
          <p className="mt-3 max-w-[56ch] text-[0.9375rem] leading-snug text-fg-2">
            {shown.length === 0
              ? "Your rules land here, newest first. Until one runs, the ledger carries the receipt the agent printed on the TSLA earnings night."
              : "What Redeye did while you slept, newest first. Each line names the version it chose and why, in one sentence."}
          </p>
        </div>
        {desk.total > SHOWN && <p className="fig text-[0.75rem] text-fg-3">{desk.total - SHOWN} older receipts kept</p>}
      </div>
      {desk.error && <p role="alert" className="fig mt-4 text-[0.75rem] text-fail">Receipts could not be read: {desk.error}</p>}

      <div className="mt-8 overflow-hidden rounded-lg border border-line-2 bg-night-2">
        <div aria-hidden className="label hidden grid-cols-[7.5rem_9rem_minmax(0,1fr)_6rem] gap-x-6 border-b border-line px-5 py-2.5 md:grid">
          <span>Outcome</span><span>Version</span><span>Why</span><span className="text-right">Tx</span>
        </div>
        <ol aria-label="Receipts, newest first">
          {desk.watching.map((w) => <Watching key={w.ruleId} w={w} now={now} />)}
          {shown.map((x, i) => <Receipt key={`${x.ruleId}-${x.at}-${i}`} x={x} />)}
          {shown.length === 0 && <Replayed />}
        </ol>
      </div>
    </section>
  );
}
