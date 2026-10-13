"use client";

import { useSyncExternalStore } from "react";
import { Note } from "@/components/shared/page";
import { istAndSgt, usd } from "@/lib/shared/format";
import { cn } from "@/lib/utils";
import type { RuleView, VersionRow } from "@/lib/redeye";
import type { SlipState } from "./rule-console";

const H = 540;
const TOP = 28;
const BOTTOM = 28;

const subscribe = (cb: () => void) => {
  const mq = window.matchMedia("(min-width: 768px)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
const useWide = () => useSyncExternalStore(subscribe, () => window.matchMedia("(min-width: 768px)").matches, () => false);

/** The price that measures the move, the same choice src/signals/evaluate.ts makes: a real bStocks or xStocks trade first, then the stock quote. */
function basisPrice(rows: VersionRow[]): number | null {
  const rank = (r: VersionRow) => (r.issuer === "bstocks" ? 0 : 1);
  const real = rows.filter((r) => r.perShareUsd !== null && !r.derived && r.issuer !== "ondo").sort((a, b) => rank(a) - rank(b));
  if (real.length) return real[0].perShareUsd;
  const stock = rows.find((r) => r.stockUsd !== null);
  if (stock) return stock.stockUsd;
  return rows.find((r) => r.perShareUsd !== null)?.perShareUsd ?? null;
}

function niceTicks(min: number, max: number): number[] {
  const raw = (max - min) / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

/** Push labels apart so none overlap, each label hs[i] tall, keeping each as close to its marker as the heights allow. */
function spread(ys: number[], hs: number[], lo: number): number[] {
  const order = ys.map((y, i) => i).sort((a, b) => ys[a] - ys[b]);
  const out = [...ys];
  let floor = lo;
  for (const i of order) { out[i] = Math.max(ys[i], floor); floor = out[i] + hs[i]; }
  return out;
}

const shortReason = (v: VersionRow): string => {
  if (v.tradable) return "Tradable now";
  const s = v.session;
  if (s.reasonCode && ["ASSET_LIMITED", "MARKET_PAUSED", "ASSET_PAUSED"].includes(s.reasonCode)) return "Not tradable: paused by Binance";
  switch (v.probe.kind) {
    case "MIN_ORDER": return "Not tradable: under the $5 minimum";
    case "ONDO_CLOSED": case "BSTOCK_CLOSED": return `Not tradable: ${v.issuerLabel} is closed`;
    case "NO_LIQUIDITY": return "Not tradable: no quote at this size";
    case "NO_KEY": return "Not checked: no Binance key on the server";
    case "NO_PRICE": return "Not tradable: no price to size the sale";
    case "NO_ROUTE": return "Not tradable: no route";
    default: return "Not tradable: no quote";
  }
};

const closeDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });

export function PriceLadder({ state }: { state: SlipState }) {
  if (state.kind === "loading" || state.kind === "idle") return <Frame><Ghost label="Pricing every tokenized version against the last close" pulse /></Frame>;
  if (state.kind === "error") return <Frame><Ghost label="Fix the rule on the left and the ladder redraws at live prices." /></Frame>;
  return <Frame sub={`Quotes requested ${istAndSgt(state.view.at)}. ${state.view.sizing.text}`}><Ladder view={state.view} /></Frame>;
}

function Frame({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <section aria-labelledby="ladder-h" className="min-w-0 rounded-lg border border-line-2 bg-night-2">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-2.5">
        <h2 id="ladder-h" className="label whitespace-nowrap text-fg-2">Price ladder<span className="max-md:hidden">, per share</span></h2>
        <p className="label flex items-center gap-2 whitespace-nowrap"><span aria-hidden className="live-dot size-1.5 rounded-full bg-sodium" />BNB Chain, live</p>
      </div>
      <div className="px-5 pb-6 pt-4">
        {sub && <p className="fig text-[0.75rem] leading-snug text-fg-3">{sub}</p>}
        <div className="mt-5">{children}</div>
      </div>
    </section>
  );
}

function Ghost({ label, pulse }: { label: string; pulse?: boolean }) {
  const wide = useWide();
  const gut = wide ? 112 : 92;
  return (
    <div role={pulse ? "status" : undefined} aria-busy={pulse || undefined} className="relative" style={{ height: 380 }}>
      <div className={cn("absolute inset-x-0 border-t border-fg-2/60", pulse && "animate-pulse motion-reduce:animate-none")} style={{ left: gut, top: 120 }} />
      <p className="label absolute left-0 w-[calc(var(--gut)-12px)] text-right" style={{ ["--gut" as string]: `${gut}px`, top: 108 }}>Last close</p>
      <div className={cn("absolute inset-x-0 border-t-2 border-dashed border-sodium/50", pulse && "animate-pulse motion-reduce:animate-none")} style={{ left: gut, top: 300 }} />
      <p className="label absolute left-0 w-[calc(var(--gut)-12px)] text-right text-sodium/80" style={{ ["--gut" as string]: `${gut}px`, top: 288 }}>Your trigger</p>
      <p className="absolute max-w-[34ch] font-serif text-[1.5rem] leading-snug text-fg-2" style={{ left: gut + 24, top: 148 }}>{label}</p>
    </div>
  );
}

function Ladder({ view }: { view: RuleView }) {
  const wide = useWide();
  const gut = wide ? 112 : 92;
  const railX = gut + 14;
  const labelX = gut + (wide ? 70 : 42);
  const base = wide ? 132 : 112;

  const { rule } = view;
  const priced = view.versions.filter((v) => v.perShareUsd !== null);
  const unpriced = view.versions.filter((v) => v.perShareUsd === null);
  const close = view.lastClose?.price ?? null;
  const trig = view.trigger.price;
  const basis = basisPrice(view.versions);

  const values = [...priced.map((v) => v.perShareUsd as number), ...(close !== null ? [close] : []), ...(trig !== null ? [trig] : [])];
  if (values.length === 0) return <Note tone="warn">No version of {rule.ticker} has a price right now, so there is nothing to stand on the ladder.</Note>;
  if (!wide) return <Rows view={view} basis={basis} />;
  const lo0 = Math.min(...values);
  const hi0 = Math.max(...values);
  const pad = Math.max((hi0 - lo0) * 0.06, hi0 * 0.004);
  const min = lo0 - pad;
  const max = hi0 + pad;
  const plotH = H - TOP - BOTTOM;
  const y = (v: number) => TOP + ((max - v) / (max - min)) * plotH;

  const ticks = niceTicks(min, max);
  const yClose = close !== null ? y(close) : null;
  const yTrig = trig !== null ? y(trig) : null;
  const yBasis = basis !== null ? y(basis) : null;
  const awayPct = basis !== null && trig !== null ? (rule.trigger.direction === "down" ? ((basis - trig) / basis) * 100 : ((trig - basis) / basis) * 100) : null;
  const near = awayPct !== null && Math.abs(awayPct) <= 2;

  const sorted = [...priced].sort((a, b) => (b.perShareUsd as number) - (a.perShareUsd as number));
  const dotY = sorted.map((v) => y(v.perShareUsd as number));
  // the version the agent would act on carries a second block (the line, and on a wide screen the reason), so its label is taller
  const winner = view.pick?.symbol ?? null;
  const heights = sorted.map((v) => base + (v.symbol === winner ? (wide ? 100 : 30) : 0));
  const labelY = spread(dotY, heights, TOP + 6);
  const boxH = Math.max(H, ...labelY.map((ly, i) => ly + heights[i] - 12));
  const dotDx: number[] = [];
  dotY.forEach((yy, i) => {
    let dx = 0;
    for (let j = 0; j < i; j++) if (Math.abs(yy - dotY[j]) < 12) dx = Math.max(dx, dotDx[j] + 14);
    dotDx.push(dx);
  });

  const gutterTicks = ticks.filter((t) => [yClose, yTrig].every((l) => l === null || Math.abs(y(t) - l) > 34));
  const stepDigits = ticks.length > 1 && ticks[1] - ticks[0] < 1 ? 2 : 0;

  return (
    <div>
      <div className="relative" style={{ height: boxH }} role="group" aria-label={`Price ladder for ${rule.ticker}`}>
        {gutterTicks.map((t) => (
          <div key={t}>
            <span className="fig absolute left-0 -translate-y-1/2 text-right text-[0.6875rem] text-fg-3" style={{ top: y(t), width: gut - 14 }}>{usd(t, stepDigits)}</span>
            <span className="absolute border-t border-line" style={{ left: gut - 8, right: 0, top: y(t) }} />
          </div>
        ))}

        {yClose !== null && close !== null && view.lastClose && (
          <>
            <span className="absolute border-t border-fg-2" style={{ left: gut - 8, right: 0, top: yClose }} />
            <div className="absolute left-0 -translate-y-1/2 text-right" style={{ top: yClose, width: gut - 14 }}>
              <p className="label text-fg-2">{closeDay(view.lastClose.day)} close</p>
              <p className="num text-[1.125rem] leading-tight text-fg md:text-[1.5rem]">{usd(close)}</p>
            </div>
          </>
        )}

        {yTrig !== null && trig !== null && (
          <>
            {near && <span aria-hidden className="lamp absolute h-2 rounded-full bg-sodium blur-[7px]" style={{ left: gut, right: 0, top: yTrig - 4 }} />}
            <span className="absolute border-t-2 border-dashed border-sodium" style={{ left: gut - 8, right: 0, top: yTrig - 1 }} />
            <div className="absolute left-0 -translate-y-1/2 text-right" style={{ top: yTrig, width: gut - 14 }}>
              <p className="label text-sodium">Trigger</p>
              <p className="num text-[1.125rem] leading-tight text-sodium md:text-[1.5rem]">{usd(trig)}</p>
              {awayPct !== null && (
                <p className="num text-[0.9375rem] leading-tight text-sodium md:text-[1.125rem]">
                  {awayPct >= 0 ? `${awayPct.toFixed(1)}% away` : `${Math.abs(awayPct).toFixed(1)}% past`}
                </p>
              )}
            </div>
          </>
        )}

        {yBasis !== null && yTrig !== null && (
          <span aria-hidden className="absolute w-2 border-y border-l border-sodium/70" style={{ left: gut + 2, top: Math.min(yBasis, yTrig), height: Math.abs(yTrig - yBasis) }} />
        )}

        <svg aria-hidden width={labelX} height={boxH} className="pointer-events-none absolute left-0 top-0 overflow-visible">
          {sorted.map((v, i) => (
            <path
              key={v.address}
              d={`M${railX + dotDx[i] + 6},${dotY[i]} H${railX + 20 + dotDx[i]} L${labelX - 18},${labelY[i]} H${labelX - 6}`}
              fill="none"
              stroke={v.tradable ? "var(--sodium)" : "var(--fg-3)"}
              strokeWidth="1"
              strokeDasharray={v.tradable ? undefined : "3 3"}
            />
          ))}
        </svg>

        {sorted.map((v, i) => (
          <span
            key={v.address}
            aria-hidden
            className={cn(
              "absolute size-3 -translate-y-1/2 rounded-full",
              v.tradable ? "bg-sodium shadow-[0_0_10px_1px_var(--sodium-soft)]" : "border-2 border-fg-3 bg-night-2",
              view.pick?.symbol === v.symbol && "outline outline-2 outline-offset-2 outline-sodium",
            )}
            style={{ left: railX + dotDx[i], top: dotY[i] }}
          />
        ))}

        {sorted.map((v, i) => (
          <div key={v.address} className="absolute bg-night-2 pr-2" style={{ left: labelX, maxWidth: `calc(100% - ${labelX}px)`, top: labelY[i] - 12 }}>
            <p className="fig text-[0.75rem] leading-tight">
              <span className="font-bold text-fg">{v.symbol}</span> <span className="text-fg-3">{v.issuerLabel}</span>{" "}
              <a href={`https://bscscan.com/token/${v.address}`} target="_blank" rel="noreferrer" className="text-fg-3 underline decoration-line-2 underline-offset-2 transition-colors duration-150 hover:text-sodium hover:decoration-sodium">
                {v.address.slice(0, 6)}…{v.address.slice(-4)}
              </a>
            </p>
            <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
              <span className="num text-[1.75rem] leading-none text-fg md:text-[2rem]">{usd(v.perShareUsd as number)}</span>
              {close !== null && <span className="num text-[0.9375rem] leading-none text-fg-3 md:text-[1.125rem]">{(((v.perShareUsd as number) / close - 1) * 100).toFixed(2)}% vs close</span>}
            </p>
            <p className={cn("mt-1.5 flex gap-1.5 text-[0.8125rem] leading-snug", v.tradable ? "text-sodium" : "text-fg-2")}>
              <span aria-hidden className="fig shrink-0">{v.tradable ? "+" : "x"}</span>
              <span>{shortReason(v)}</span>
            </p>
            {view.pick?.symbol === v.symbol && (
              <div className="mt-2 border-l-2 border-sodium pl-2.5">
                <p className="fig text-[0.8125rem] font-bold text-sodium">{view.pick.line}</p>
                {wide && <p className="mt-0.5 max-w-[46ch] text-[0.8125rem] leading-snug text-fg">{view.pick.reason}</p>}
              </div>
            )}
            {wide && <p className="mt-1 max-w-[46ch] text-[0.75rem] leading-snug text-fg-3">{v.because}{v.derived ? " Price computed from the stock quote." : ""}</p>}
          </div>
        ))}
      </div>

      {!view.pick && view.pickNote && <p className="mt-4 text-[0.8125rem] text-fg-2">{view.pickNote}</p>}
      {unpriced.length > 0 && (
        <p className="mt-4 text-[0.8125rem] text-fg-2">
          {unpriced.map((v) => v.symbol).join(", ")} {unpriced.length > 1 ? "have no price right now, so they are not" : "has no price right now, so it is not"} on the ladder.
        </p>
      )}
      {close === null && <div className="mt-4"><Note tone="warn">The last close is unavailable, so the close and trigger lines cannot be drawn.</Note></div>}
    </div>
  );
}

/** A phone has no room for a scaled ladder: the close and the trigger, then each version as a row, dearest first. */
function Rows({ view, basis }: { view: RuleView; basis: number | null }) {
  const close = view.lastClose?.price ?? null;
  const trig = view.trigger.price;
  const down = view.rule.trigger.direction === "down";
  const away = basis !== null && trig !== null ? (down ? (basis - trig) / basis : (trig - basis) / basis) * 100 : null;
  const sorted = view.versions.filter((v) => v.perShareUsd !== null).sort((a, b) => (b.perShareUsd as number) - (a.perShareUsd as number));
  return (
    <div>
      <dl className="grid grid-cols-2 gap-3">
        <div className="border-l-2 border-fg-2 pl-3">
          <dt className="label">{view.lastClose ? `${closeDay(view.lastClose.day)} close` : "Last close"}</dt>
          <dd className="num text-[1.5rem] leading-tight text-fg">{close !== null ? usd(close) : "unavailable"}</dd>
        </div>
        <div className="border-l-2 border-dashed border-sodium pl-3">
          <dt className="label text-sodium">Trigger</dt>
          <dd className="num text-[1.5rem] leading-tight text-sodium">{trig !== null ? usd(trig) : "unavailable"}</dd>
          {away !== null && <dd className="fig text-[0.75rem] text-sodium">{away >= 0 ? `${away.toFixed(1)}% away` : `${Math.abs(away).toFixed(1)}% past`}</dd>}
        </div>
      </dl>
      <ol className="mt-5 divide-y divide-line border-y border-line">
        {sorted.map((v) => {
          const pick = view.pick?.symbol === v.symbol;
          return (
            <li key={v.address} className={cn("py-3.5", pick && "-mx-5 border-l-2 border-sodium bg-night-3/50 px-5")}>
              <div className="flex items-baseline justify-between gap-3">
                <p className="fig min-w-0 text-[0.75rem]">
                  <span className="font-bold text-fg">{v.symbol}</span> <span className="text-fg-3">{v.issuerLabel}</span>
                </p>
                <p className="num text-[1.5rem] leading-none text-fg">{usd(v.perShareUsd as number)}</p>
              </div>
              <div className="mt-1 flex items-baseline justify-between gap-3 text-[0.8125rem]">
                <p className={cn("flex gap-1.5", v.tradable ? "text-sodium" : "text-fg-2")}>
                  <span aria-hidden className="fig">{v.tradable ? "+" : "x"}</span>{shortReason(v)}
                </p>
                {close !== null && <p className="fig shrink-0 text-[0.75rem] text-fg-3">{(((v.perShareUsd as number) / close - 1) * 100).toFixed(2)}%</p>}
              </div>
              {pick && view.pick && <p className="mt-2 text-[0.8125rem] leading-snug text-fg"><span className="font-bold text-sodium">{view.pick.line}.</span> {view.pick.reason}</p>}
              <a href={`https://bscscan.com/token/${v.address}`} target="_blank" rel="noreferrer" className="fig mt-1.5 inline-flex min-h-8 items-center text-[0.6875rem] text-fg-3 underline decoration-line-2 underline-offset-2 hover:text-sodium">
                {v.address.slice(0, 6)}…{v.address.slice(-4)} on BscScan
              </a>
            </li>
          );
        })}
      </ol>
      {!view.pick && view.pickNote && <p className="mt-4 text-[0.8125rem] text-fg-2">{view.pickNote}</p>}
    </div>
  );
}
