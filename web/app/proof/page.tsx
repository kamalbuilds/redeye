import type { Metadata } from "next";
import { Page } from "@/components/shared/page";
import { Replay } from "@/components/night/replay";
import { loadProof, PROOF_FILES } from "@/lib/redeye-proof";

export const metadata: Metadata = { title: "Replay: the TSLA earnings night, tokens against the real price" };

const ist = (t: number) =>
  new Date(t + 5.5 * 3_600_000).toLocaleString("en-US", { timeZone: "UTC", weekday: "short", hour: "numeric", minute: "2-digit", hour12: true });
const utc = (t: number) => new Date(t).toLocaleString("en-GB", { timeZone: "UTC", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).replace(",", "");
const pct = (a: number, b: number) => (((a - b) / b) * 100).toFixed(2);

export default function Proof() {
  const p = loadProof();
  const drop = ((p.first.ondoAfter.v - p.first.ondo.v) / p.first.ondo.v) * 100;
  const rows = [...new Set([...p.ondo, ...p.bstocks].map((x) => x.t))].sort((a, b) => a - b);

  return (
    <>
      <Page className="pt-12">
        <p className="label">Tesla reported on 22 July 2026 after the US close</p>
        <h1 className="mt-3 max-w-[20ch] text-[2.5rem] leading-[1.05] tracking-[-0.015em] md:max-w-[24ch] md:text-[3.75rem]">
          The night Tesla moved, replayed on a Mumbai clock.
        </h1>
        <p className="mt-5 max-w-[62ch] text-[1rem] leading-relaxed text-fg-2">
          At the hours where a real after-hours price exists, TSLAon and TSLAB were never more than {p.maxGapPct.toFixed(2)}% from it. TSLAon went from {p.first.ondo.v.toFixed(2)} to {p.first.ondoAfter.v.toFixed(2)} ({drop.toFixed(1)}%) between the 19:00 and 21:00 UTC candles, and the step happened at 20:00 to 21:00 UTC, which is 1:30 to 2:30 am in Mumbai.
        </p>
      </Page>

      <section aria-labelledby="replay-h" className="mt-12 border-y border-line bg-night-2/40 py-10">
        <Page>
          <h2 id="replay-h" className="sr-only">Replay: tokens against the real after-hours price</h2>
          <Replay proof={p} />
          <p className="mt-6 max-w-[70ch] text-[0.8125rem] leading-snug text-fg-3">
            Rings are the real TSLA price at the hours recorded. At 13:00 UTC it read {p.real.find((r) => r.open)?.v.toFixed(2)} before the open and {p.real.filter((r) => r.open)[1]?.v.toFixed(2)} at the 13:30 open, so that hour is plotted and not compared. The readout holds each candle until the next one opens.
          </p>
        </Page>
      </section>

      <Page className="pt-12">
        <div className="grid gap-x-16 gap-y-12 md:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
          <section aria-labelledby="steps">
            <h2 id="steps" className="label">The reaction reached the tokens in three steps</h2>
            <ol className="mt-4 divide-y divide-line border-y border-line">
              <li className="py-4"><p className="font-serif text-[1.5rem]">After-hours</p><p className="fig text-[0.8125rem] text-fg-2">20:00 to 21:00 UTC · 1:30 to 2:30 am IST</p></li>
              <li className="py-4"><p className="font-serif text-[1.5rem]">Premarket</p><p className="fig text-[0.8125rem] text-fg-2">from 08:00 UTC · 1:30 pm IST</p></li>
              <li className="py-4"><p className="font-serif text-[1.5rem]">The open</p><p className="fig text-[0.8125rem] text-fg-2">13:30 UTC · 7:00 pm IST</p></li>
            </ol>
          </section>
          <section aria-labelledby="meaning">
            <h2 id="meaning" className="label">What it means for a sleeper</h2>
            <p className="mt-4 text-fg-2">
              There is no limit or conditional order for tokenized stocks on BNB Chain. The first step landed at 1:30 am in Mumbai, so the only way to act on it was to be awake. A rule held by an agent acts in that window.
            </p>
            <p className="mt-3 text-fg-2">
              The largest gap, {p.worst.pct.toFixed(2)}%, was {p.worst.symbol} at {utc(p.worst.t)} UTC. TSLAB has no candle at 22:00 and 23:00 UTC, so its line breaks there.
            </p>
          </section>
        </div>

        <details className="mt-14 border-t border-line-2 pt-4">
          <summary className="label min-h-11 cursor-pointer py-2.5 hover:text-fg">Data table, every hour</summary>
          <div className="mt-4 overflow-x-auto">
            <table className="fig w-full min-w-[34rem] text-left text-[0.8125rem]">
              <caption className="sr-only">Hourly TSLAon and TSLAB prices against the real after-hours price</caption>
              <thead>
                <tr className="label border-b border-line-2">
                  <th scope="col" className="py-2 pr-4 font-normal">Candle open (IST)</th>
                  <th scope="col" className="py-2 pr-4 font-normal">UTC</th>
                  <th scope="col" className="py-2 pr-4 text-right font-normal">TSLAon</th>
                  <th scope="col" className="py-2 pr-4 text-right font-normal">TSLAB</th>
                  <th scope="col" className="py-2 pr-4 text-right font-normal">Real</th>
                  <th scope="col" className="py-2 text-right font-normal">On / B vs real</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((t) => {
                  const on = p.ondo.find((x) => x.t === t)?.v;
                  const b = p.bstocks.find((x) => x.t === t)?.v;
                  const real = p.real.find((x) => x.t === t);
                  const same = p.gaps.find((g) => g.t === t);
                  return (
                    <tr key={t}>
                      <th scope="row" className="py-2 pr-4 font-normal">{ist(t)}</th>
                      <td className="py-2 pr-4 text-fg-3">{utc(t)}</td>
                      <td className="py-2 pr-4 text-right">{on?.toFixed(2) ?? "no candle"}</td>
                      <td className="py-2 pr-4 text-right">{b?.toFixed(2) ?? "no candle"}</td>
                      <td className="py-2 pr-4 text-right">{real ? real.v.toFixed(2) : ""}</td>
                      <td className="py-2 text-right text-fg-2">
                        {same && on !== undefined && b !== undefined ? `${pct(on, same.real)}% / ${pct(b, same.real)}%` : real?.open ? "open hour, not compared" : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-4 max-w-[62ch] text-[0.8125rem] text-fg-3">
            Tokens: Binance public kline endpoint, chain 56, 1h candles from 2026-07-22T18:00Z, rows in {PROOF_FILES.tsv}. Real price: Yahoo Finance extended-hours hourly bars as recorded in {PROOF_FILES.md}. The 13:00 UTC hour straddles the 13:30 US open, so it is plotted and not compared.
          </p>
        </details>
      </Page>
    </>
  );
}
