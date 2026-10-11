import type { Metadata } from "next";
import { Page } from "@/components/shared/page";
import { ProofChart } from "@/components/redeye/proof-chart";
import { loadProof, PROOF_FILES } from "@/lib/redeye-proof";

export const metadata: Metadata = { title: "Proof: the TSLA earnings night, tokens against the real price" };

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
      <Page>
        <p className="label">Tesla reported on 22 July 2026 after the US close</p>
        <h1 className="mt-3 max-w-[22ch] text-[2.25rem] font-light leading-[1.08] tracking-[-0.015em] md:text-[3.25rem]">
          The tokens moved with the real price, while Mumbai slept.
        </h1>
        <p className="mt-5 max-w-[60ch] text-[1.0625rem] text-ink-2">
          At the hours where a real after-hours price exists, TSLAon and TSLAB were never more than {p.maxGapPct.toFixed(2)}% from it. TSLAon went from {p.first.ondo.v.toFixed(2)} to {p.first.ondoAfter.v.toFixed(2)} ({drop.toFixed(1)}%) between the 19:00 and 21:00 UTC candles, and the step happened at 20:00 to 21:00 UTC, which is 1:30 to 2:30 am in Mumbai.
        </p>
      </Page>

      <section aria-labelledby="chart" className="mt-12 bg-night py-10 text-bone">
        <div className="mx-auto max-w-[1180px] px-5 md:px-8">
          <h2 id="chart" className="sr-only">Chart: tokens against the real after-hours price</h2>
          <ProofChart proof={p} />
          <p className="mt-4 max-w-[70ch] text-[0.8125rem] text-bone-2">
            Green markers are the real TSLA price at the hours recorded. At 13:00 UTC it read {p.real.find((r) => r.open)?.v.toFixed(2)} before the open and {p.real.filter((r) => r.open)[1]?.v.toFixed(2)} at the 13:30 open, so that hour is plotted and not compared.
          </p>
        </div>
      </section>

      <Page className="pt-12">
        <div className="grid gap-x-16 gap-y-12 md:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
          <section aria-labelledby="steps">
            <h2 id="steps" className="label">The reaction reached the tokens in three steps</h2>
            <ol className="mt-4 divide-y divide-rule border-y border-rule">
              <li className="py-4"><p className="font-serif text-[1.25rem]">After-hours</p><p className="fig text-[0.875rem] text-ink-2">20:00 to 21:00 UTC · 1:30 to 2:30 am IST</p></li>
              <li className="py-4"><p className="font-serif text-[1.25rem]">Premarket</p><p className="fig text-[0.875rem] text-ink-2">from 08:00 UTC · 1:30 pm IST</p></li>
              <li className="py-4"><p className="font-serif text-[1.25rem]">The open</p><p className="fig text-[0.875rem] text-ink-2">13:30 UTC · 7:00 pm IST</p></li>
            </ol>
          </section>
          <section aria-labelledby="meaning">
            <h2 id="meaning" className="label">What it means for a sleeper</h2>
            <p className="mt-4 text-ink-2">
              There is no limit or conditional order for tokenized stocks on BNB Chain. The first step landed at 1:30 am in Mumbai, so the only way to act on it was to be awake. A rule held by an agent acts in that window.
            </p>
            <p className="mt-3 text-ink-2">
              The largest gap, {p.worst.pct.toFixed(2)}%, was {p.worst.symbol} at {utc(p.worst.t)} UTC. TSLAB has no candle at 22:00 and 23:00 UTC, so its line breaks there.
            </p>
          </section>
        </div>

        <details className="mt-14 border-t border-ink pt-4">
          <summary className="label min-h-11 cursor-pointer py-2.5 hover:text-ink">Data table, every hour</summary>
          <div className="mt-4 overflow-x-auto">
            <table className="fig w-full min-w-[34rem] text-left text-[0.875rem]">
              <caption className="sr-only">Hourly TSLAon and TSLAB prices against the real after-hours price</caption>
              <thead>
                <tr className="label border-b border-rule">
                  <th scope="col" className="py-2 pr-4 font-normal">Candle open (IST)</th>
                  <th scope="col" className="py-2 pr-4 font-normal">UTC</th>
                  <th scope="col" className="py-2 pr-4 text-right font-normal">TSLAon</th>
                  <th scope="col" className="py-2 pr-4 text-right font-normal">TSLAB</th>
                  <th scope="col" className="py-2 pr-4 text-right font-normal">Real</th>
                  <th scope="col" className="py-2 text-right font-normal">On / B vs real</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {rows.map((t) => {
                  const on = p.ondo.find((x) => x.t === t)?.v;
                  const b = p.bstocks.find((x) => x.t === t)?.v;
                  const real = p.real.find((x) => x.t === t);
                  const same = p.gaps.find((g) => g.t === t);
                  return (
                    <tr key={t}>
                      <th scope="row" className="py-2 pr-4 font-normal">{ist(t)}</th>
                      <td className="py-2 pr-4 text-ink-3">{utc(t)}</td>
                      <td className="py-2 pr-4 text-right">{on?.toFixed(2) ?? "no candle"}</td>
                      <td className="py-2 pr-4 text-right">{b?.toFixed(2) ?? "no candle"}</td>
                      <td className="py-2 pr-4 text-right">{real ? real.v.toFixed(2) : ""}</td>
                      <td className="py-2 text-right text-ink-2">
                        {same && on !== undefined && b !== undefined ? `${pct(on, same.real)}% / ${pct(b, same.real)}%` : real?.open ? "open hour, not compared" : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-4 max-w-[62ch] text-[0.8125rem] text-ink-3">
            Tokens: Binance public kline endpoint, chain 56, 1h candles from 2026-07-22T18:00Z, rows in {PROOF_FILES.tsv}. Real price: Yahoo Finance extended-hours hourly bars as recorded in {PROOF_FILES.md}. The 13:00 UTC hour straddles the 13:30 US open, so it is plotted and not compared.
          </p>
        </details>
      </Page>
    </>
  );
}
