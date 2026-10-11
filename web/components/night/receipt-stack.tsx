import { readDesk, type ReceiptRow, type WatchRow } from "@/lib/redeye";
import { storeFor, visitorFromCookie } from "@/lib/store";
import { istAndSgt, usd, watchWindow } from "@/lib/shared/format";

const OUTCOME: Record<string, string> = {
  no_fire: "Held. Trigger not met",
  skipped: "Skipped",
  dry_run: "Dry run. Nothing sent",
  filled: "Filled",
  failed: "Failed",
  expired: "Expired",
};
const TILT = [-0.7, 0.5, -0.3, 0.8, -0.5, 0.35];
const SHOWN = 6;

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[4.25rem_minmax(0,1fr)] gap-x-2">
      <dt className="text-[0.6875rem] uppercase tracking-[0.14em] text-ink-2">{k}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

function Watching({ w, now, i, total }: { w: WatchRow; now: number; i: number; total: number }) {
  return (
    <li
      className="slip-wrap relative -mt-3 first:mt-0"
      style={{ zIndex: total - i, transform: `rotate(${TILT[i % TILT.length]}deg) translateX(${(i % 2 ? 1 : -1) * 3}px)` }}
    >
      <article className="slip slip-top slip-bottom px-5 pb-7 pt-7">
        <p className="text-[0.75rem] font-bold uppercase tracking-[0.12em]">On watch</p>
        <dl className="mt-2.5 space-y-1.5 border-t border-dashed border-ink/50 pt-2.5 text-[0.8125rem] leading-snug">
          <Row k="Rule">{w.sentence}</Row>
          <Row k="Watching">{watchWindow(w.startMs, w.endMs, now)}</Row>
          <Row k="Left">{istAndSgt(w.since)}</Row>
          <Row k="Id">{w.ruleId}</Row>
        </dl>
      </article>
    </li>
  );
}

function Slip({ x, i, total }: { x: ReceiptRow; i: number; total: number }) {
  const acted = x.outcome !== "no_fire" && x.outcome !== null;
  return (
    <li
      className="slip-wrap relative -mt-3 first:mt-0"
      style={{ zIndex: total - i, transform: `rotate(${TILT[i % TILT.length]}deg) translateX(${(i % 2 ? 1 : -1) * 3}px)` }}
    >
      <article className="slip slip-top slip-bottom px-5 pb-7 pt-7">
        <p className="text-[0.75rem] font-bold uppercase tracking-[0.12em]">{x.outcome ? OUTCOME[x.outcome] ?? x.outcome : "Outcome not recorded"}</p>
        <dl className="mt-2.5 space-y-1.5 border-t border-dashed border-ink/50 pt-2.5 text-[0.8125rem] leading-snug">
          <Row k="Time">{x.at ? istAndSgt(x.at) : "not recorded"}</Row>
          <Row k="Rule">{x.ruleId ?? "not recorded"}</Row>
          <Row k="Stock">
            {x.symbol ?? x.ticker ?? "unknown"}
            {acted && x.side ? `, ${x.side}` : ""}
            {acted && x.usd !== null ? ` ${usd(x.usd)}` : ""}
            {x.mode ? `, ${x.mode === "live" ? "live" : "dry"}` : ""}
          </Row>
          <Row k="Why">{x.reason ?? "No reason recorded."}</Row>
        </dl>
        {x.txHash && (
          <a href={`https://bscscan.com/tx/${x.txHash}`} target="_blank" rel="noreferrer" className="mt-2 inline-flex min-h-11 items-center text-[0.8125rem] font-bold uppercase tracking-[0.12em] underline underline-offset-4">
            BscScan
          </a>
        )}
      </article>
    </li>
  );
}

export async function ReceiptStack() {
  const desk = await readDesk(await storeFor(await visitorFromCookie()), 20);
  const shown = desk.rows.slice(0, SHOWN);
  const now = Date.now();
  const stack = desk.watching.length + shown.length;
  return (
    <section aria-labelledby="receipts" className="grid gap-x-16 gap-y-10 md:grid-cols-[22.5rem_minmax(0,1fr)]">
      <div>
        <h2 id="receipts" className="font-serif text-[2rem] leading-[1.08] md:text-[2.5rem]">Morning receipts</h2>
        <p className="mt-3 max-w-[34ch] text-[0.9375rem] leading-snug text-fg-2">
          What Redeye did while you slept, newest on top. Every receipt carries the rule id, the version it chose and one sentence on why.
        </p>
        {desk.error && <p role="alert" className="fig mt-4 text-[0.75rem] text-fail">Receipts could not be read: {desk.error}</p>}
      </div>

      <div className="w-full max-w-[22.5rem] py-2">
        {stack === 0 ? (
          <div className="slip-wrap">
            <article className="slip slip-top slip-bottom px-5 pb-7 pt-7">
              <p className="text-[0.75rem] font-bold uppercase tracking-[0.12em]">No receipt yet</p>
              <p className="mt-3 text-[0.9375rem] font-bold leading-snug">Nothing has run yet. Leave a rule tonight.</p>
              <dl aria-hidden className="mt-4 space-y-2.5 border-t border-dashed border-ink/50 pt-3">
                {["Time", "Rule", "Stock", "Why"].map((k) => (
                  <div key={k} className="grid grid-cols-[4.25rem_minmax(0,1fr)] gap-x-2">
                    <dt className="text-[0.6875rem] uppercase tracking-[0.14em] text-ink-2">{k}</dt>
                    <dd className="mt-2 border-b border-dotted border-ink/40" />
                  </div>
                ))}
              </dl>
            </article>
          </div>
        ) : (
          <ol aria-label="Receipts, newest first">
            {desk.watching.map((w, i) => <Watching key={w.ruleId} w={w} now={now} i={i} total={stack} />)}
            {shown.map((x, i) => <Slip key={`${x.ruleId}-${x.at}-${i}`} x={x} i={i + desk.watching.length} total={stack} />)}
          </ol>
        )}
        {desk.total > SHOWN && <p className="fig mt-4 text-[0.75rem] text-fg-3">{desk.total - SHOWN} older receipts are kept.</p>}
      </div>
    </section>
  );
}
