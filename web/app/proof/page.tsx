import type { Metadata } from "next";
import { Page } from "@/components/shared/page";
import { Colophon } from "@/components/shared/colophon";
import { Replay } from "@/components/night/replay";
import { HOUR, ZONES, clock } from "@/lib/night";
import { loadProof, PROOF_FILES } from "@/lib/redeye-proof";

export const metadata: Metadata = { title: "Replay: the TSLA earnings night, tokens against the real price" };

const IST = ZONES.IST;
const SGT = ZONES.SGT;
const ist = (t: number) =>
  new Date(t + 5.5 * 3_600_000).toLocaleString("en-US", { timeZone: "UTC", weekday: "short", hour: "numeric", minute: "2-digit", hour12: true });
const sgt = (t: number) =>
  new Date(t + 8 * 3_600_000).toLocaleString("en-US", { timeZone: "UTC", weekday: "short", hour: "numeric", minute: "2-digit", hour12: true });
const both = (t: number) => `${clock(t, IST, { minutes: true })} IST (${clock(t, SGT, { minutes: true })} SGT)`;
const pct = (a: number, b: number) => (((a - b) / b) * 100).toFixed(2);

export default async function Proof() {
  const p = await loadProof();
  const rows = [...new Set([...p.ondo, ...p.bstocks].map((x) => x.t))].sort((a, b) => a - b);
  const bsT = new Set(p.bstocks.map((x) => x.t));
  const missing: number[] = [];
  for (let t = p.bstocks[0].t; t < p.bstocks[p.bstocks.length - 1].t; t += HOUR) if (!bsT.has(t)) missing.push(t);
  const afterOpen = Date.UTC(2026, 6, 22, 20);
  const preOpen = Date.UTC(2026, 6, 23, 8);
  const open = Date.UTC(2026, 6, 23, 13, 30);
  const [beforeOpen, firstHour] = p.real.filter((r) => r.open);

  return (
    <>
      <Page className="pt-12">
        <p className="label">Tesla reported on 22 July 2026 after the US close</p>
        <h1 className="mt-3 max-w-[20ch] text-[2.5rem] leading-[1.05] tracking-[-0.015em] md:max-w-[24ch] md:text-[3.75rem]">
          The night Tesla moved, replayed on a Mumbai clock.
        </h1>
        <p className="mt-5 max-w-[62ch] text-[1rem] leading-relaxed text-fg-2">
          The US session closed at {both(p.move.fromAt)} with TSLA at {p.move.from.toFixed(2)}. By {both(p.move.toAt)} TSLAB read {p.move.to.toFixed(2)}, down {p.move.pct.toFixed(1)}%, and the rule <span className="fig text-fg">{p.rule.text}</span> fired on {p.fire.symbol}. The agent&apos;s own evaluate() ran on the recorded readings and printed the receipt on the chart. You were asleep.
        </p>
        <p className="mt-3 max-w-[62ch] text-[1rem] leading-relaxed text-fg-2">
          At every reading with a real after-hours price, TSLAon and TSLAB stayed within {p.maxGapPct.toFixed(2)}% of it.
        </p>
      </Page>

      <section aria-labelledby="replay-h" className="mt-12 border-y border-line bg-night-2/40 py-10">
        <Page>
          <h2 id="replay-h" className="sr-only">Replay: tokens against the real after-hours price</h2>
          <Replay proof={p} />
          <p className="mt-6 max-w-[70ch] text-[0.8125rem] leading-snug text-fg-3">
            Rings are the real TSLA price at the readings recorded. Every reading is the price at the end of its hour. It read {beforeOpen?.v.toFixed(2)} at {clock(beforeOpen.t, IST, { minutes: true })} IST just before the open and {firstHour?.v.toFixed(2)} at {clock(firstHour.t, IST, { minutes: true })} IST, so the reading that straddles the {clock(open, IST, { minutes: true })} IST open is plotted and not compared. The readout holds each reading until the next one.
          </p>
        </Page>
      </section>

      <Page className="pt-12">
        <div className="grid gap-x-16 gap-y-12 md:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
          <section aria-labelledby="steps">
            <h2 id="steps" className="label">The reaction reached the tokens in three steps</h2>
            <ol className="mt-4 divide-y divide-line border-y border-line">
              <li className="py-4"><p className="font-serif text-[1.5rem]">After-hours</p><p className="fig text-[0.8125rem] text-fg-2">from {both(afterOpen)}</p></li>
              <li className="py-4"><p className="font-serif text-[1.5rem]">Premarket</p><p className="fig text-[0.8125rem] text-fg-2">from {both(preOpen)}</p></li>
              <li className="py-4"><p className="font-serif text-[1.5rem]">The open</p><p className="fig text-[0.8125rem] text-fg-2">{both(open)}</p></li>
            </ol>
          </section>
          <section aria-labelledby="meaning">
            <h2 id="meaning" className="label">What it means for a sleeper</h2>
            <p className="mt-4 text-fg-2">
              There is no limit or conditional order for tokenized stocks on BNB Chain. The fall that fired the rule landed between {clock(p.move.fromAt, IST, { minutes: true })} and {clock(p.move.toAt, IST, { minutes: true })} in Mumbai, so the only way to act on it was to be awake. A rule held by an agent acts in that window.
            </p>
            <p className="mt-3 text-fg-2">
              The largest gap, {p.worst.pct.toFixed(2)}%, was {p.worst.symbol} at {clock(p.worst.t, IST, { minutes: true })} IST. TSLAB has no reading at {missing.map((t) => `${clock(t, IST, { minutes: true })} IST`).join(" and ")}, so its line breaks there.
            </p>
          </section>
        </div>

        <details className="mt-14 border-t border-line-2 pt-4">
          <summary className="label min-h-11 cursor-pointer py-2.5 hover:text-fg">Data table, every reading</summary>
          <div className="mt-4 overflow-x-auto">
            <table className="fig w-full min-w-[34rem] text-left text-[0.8125rem]">
              <caption className="sr-only">Hourly TSLAon and TSLAB prices against the real after-hours price</caption>
              <thead>
                <tr className="label border-b border-line-2">
                  <th scope="col" className="py-2 pr-4 font-normal">Reading (IST)</th>
                  <th scope="col" className="py-2 pr-4 font-normal">SGT</th>
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
                      <td className="py-2 pr-4 text-fg-3">{sgt(t)}</td>
                      <td className="py-2 pr-4 text-right">{on?.toFixed(2) ?? "no reading"}</td>
                      <td className="py-2 pr-4 text-right">{b?.toFixed(2) ?? "no reading"}</td>
                      <td className="py-2 pr-4 text-right">{real ? real.v.toFixed(2) : ""}</td>
                      <td className="py-2 text-right text-fg-2">
                        {same && on !== undefined && b !== undefined ? `${pct(on, same.real)}% / ${pct(b, same.real)}%` : t > open && t <= open + HOUR ? "straddles the open, not compared" : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-4 max-w-[62ch] text-[0.8125rem] text-fg-3">
            Rows are in {PROOF_FILES.tsv} and {PROOF_FILES.md}. The replay runs with both tokens open to trade, so the rule&apos;s choice rests on price alone.
          </p>
        </details>
      </Page>
      <Colophon
        statement="The rule that fires here is the one the agent runs."
        lines={[
          { term: "Tokens", text: "TSLAon and TSLAB hourly candles from the Binance public kline endpoint, chain 56. Each reading is a candle's close, placed at the end of its hour." },
          { term: "Real price", text: "Yahoo Finance extended-hours hourly bars for TSLA, recorded beside the candles. Rings on the chart are these closes." },
          { term: "The rule", text: "The agent's parser reads the sentence, its last-close reader takes the 4 pm New York close, and evaluate() answers at every reading in order. The first answer that fires prints the receipt." },
        ]}
      />
    </>
  );
}
