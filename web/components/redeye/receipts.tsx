import { readReceipts } from "@/lib/redeye";
import { istTime, usd } from "@/lib/shared/format";

const OUTCOME: Record<string, string> = {
  no_fire: "held, trigger not met",
  skipped: "skipped",
  dry_run: "dry run, nothing sent",
  filled: "filled",
  failed: "failed",
  expired: "expired",
};

export function Receipts() {
  const r = readReceipts(20);
  return (
    <section aria-labelledby="receipts" className="mt-24 border-t border-ink pt-6">
      <h2 id="receipts" className="text-[1.75rem] font-light leading-tight">Morning receipts</h2>
      {r.rows.length === 0 ? (
        <p className="mt-3 max-w-[62ch] text-ink-2">
          {r.exists
            ? `${r.file} has no readable receipts yet.`
            : "Nothing has run yet."}{" "}
          When the agent acts on a rule overnight, or decides to hold, its receipt lands here with the fill, the BscScan link and one sentence on why.
        </p>
      ) : (
        <ol className="mt-6 divide-y divide-rule border-y border-rule">
          {r.rows.map((x, i) => (
            <li key={`${x.ruleId}-${x.at}-${i}`} className="grid gap-x-8 gap-y-1.5 py-5 md:grid-cols-[12rem_minmax(0,1fr)_auto]">
              <p className="fig text-[0.875rem] text-ink-2">{x.at ? `${istTime(x.at)} IST` : "time not recorded"}</p>
              <div>
                <p className="font-serif text-[1.125rem] leading-snug">{x.reason ?? "No reason recorded."}</p>
                <p className="fig mt-1 text-[0.8125rem] text-ink-3">
                  {x.symbol ?? x.ticker ?? "unknown stock"}{x.outcome !== "no_fire" && x.side ? ` · ${x.side}` : ""}{x.outcome !== "no_fire" && x.usd !== null ? ` · ${usd(x.usd)}` : ""} · {x.outcome ? OUTCOME[x.outcome] ?? x.outcome : "outcome not recorded"}{x.mode ? ` · ${x.mode === "live" ? "live" : "dry"}` : ""}
                </p>
              </div>
              {x.txHash && (
                <a href={`https://bscscan.com/tx/${x.txHash}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center border-b border-signal text-[0.875rem] font-medium text-signal md:self-start">
                  BscScan
                </a>
              )}
            </li>
          ))}
        </ol>
      )}
      {r.bad > 0 && <p className="mt-3 text-[0.8125rem] text-warn">{r.bad} line(s) in {r.file} were not receipts and are not shown.</p>}
    </section>
  );
}
