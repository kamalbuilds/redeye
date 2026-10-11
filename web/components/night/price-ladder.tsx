"use client";

import { useSyncExternalStore } from "react";
import { Note } from "@/components/shared/page";
import { istAndSgt, usd } from "@/lib/shared/format";
import { cn } from "@/lib/utils";
import type { RuleView, VersionRow } from "@/lib/redeye";
import type { SlipState } from "./order-slip";

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

/** Push labels apart so none overlap, keeping each as close to its marker as the gap allows. */
function spread(ys: number[], gap: number, lo: number, hi: number): number[] {
  const order = ys.map((y, i) => i).sort((a, b) => ys[a] - ys[b]);
  const out = [...ys];
  let prev = lo - gap;
  for (const i of order) { out[i] = Math.max(ys[i], prev + gap); prev = out[i]; }
  let next = hi + gap;
  for (const i of [...order].reverse()) { out[i] = Math.min(out[i], next - gap); next = out[i]; }
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
    case "NO_ROUTE": return "Not tradable: no route";
    default: return "Not tradable: no quote";
  }
};

const closeDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });

export function PriceLadder({ state }: { state: SlipState }) {
  if (state.kind === "loading") return <Frame><Ghost label="Pricing every tokenized version against the last close" pulse /></Frame>;
  if (state.kind === "error") return <Frame><Ghost label="No rule on the ladder." /></Frame>;
  if (state.kind === "idle") {
    return (
      <Frame>
        <Ghost label="Read a rule and every tokenized version of the stock stands here at its live price, against the last close and your trigger." />
      </Frame>
    );
  }
  return <Frame sub={`Quotes requested ${istAndSgt(state.view.at)}, sized at ${usd(state.view.versions[0]?.probe.amountUsd ?? 0, 0)}, your rule's size.`}><Ladder view={state.view} /></Frame>;
}

function Frame({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <section aria-labelledby="ladder-h" className="min-w-0">
      <h2 id="ladder-h" className="label">Price ladder, per share</h2>
      {sub && <p className="fig mt-1 text-[0.75rem] text-fg-3">{sub}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Ghost({ label, pulse }: { label: string; pulse?: boolean }) {
  const wide = useWide();
  const gut = wide ? 112 : 84;
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
  const gut = wide ? 112 : 84;
  const railX = gut + 14;
  const labelX = gut + (wide ? 70 : 42);
  const gap = wide ? 132 : 92;

  const { rule } = view;
  const priced = view.versions.filter((v) => v.perShareUsd !== null);
  const unpriced = view.versions.filter((v) => v.perShareUsd === null);
  const close = view.lastClose?.price ?? null;
  const trig = view.trigger.price;
  const basis = basisPrice(view.versions);

  const values = [...priced.map((v) => v.perShareUsd as number), ...(close !== null ? [close] : []), ...(trig !== null ? [trig] : [])];
  if (values.length === 0) return <Note tone="warn">No version of {rule.ticker} has a price right now, so there is nothing to stand on the ladder.</Note>;
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
  const labelY = spread(dotY, gap, TOP + 6, H - BOTTOM - 40);
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
      <div className="relative" style={{ height: H }} role="group" aria-label={`Price ladder for ${rule.ticker}`}>
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
              <p className="fig text-[0.8125rem] text-fg">{usd(close)}</p>
            </div>
          </>
        )}

        {yTrig !== null && trig !== null && (
          <>
            {near && <span aria-hidden className="lamp absolute h-2 rounded-full bg-sodium blur-[7px]" style={{ left: gut, right: 0, top: yTrig - 4 }} />}
            <span className="absolute border-t-2 border-dashed border-sodium" style={{ left: gut - 8, right: 0, top: yTrig - 1 }} />
            <div className="absolute left-0 -translate-y-1/2 text-right" style={{ top: yTrig, width: gut - 14 }}>
              <p className="label text-sodium">Trigger</p>
              <p className="fig text-[0.8125rem] text-sodium">{usd(trig)}</p>
              {awayPct !== null && (
                <p className="fig text-[0.6875rem] text-sodium">
                  {awayPct >= 0 ? `${awayPct.toFixed(1)}% away` : `${Math.abs(awayPct).toFixed(1)}% past`}
                </p>
              )}
            </div>
          </>
        )}

        {yBasis !== null && yTrig !== null && (
          <span aria-hidden className="absolute w-2 border-y border-l border-sodium/70" style={{ left: gut + 2, top: Math.min(yBasis, yTrig), height: Math.abs(yTrig - yBasis) }} />
        )}

        <svg aria-hidden width={labelX} height={H} className="pointer-events-none absolute left-0 top-0 overflow-visible">
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
              v.tradable ? "bg-sodium shadow-[0_0_10px_1px_var(--sodium-soft)]" : "border-2 border-fg-3 bg-night",
            )}
            style={{ left: railX + dotDx[i], top: dotY[i] }}
          />
        ))}

        {sorted.map((v, i) => (
          <div key={v.address} className="absolute bg-night pr-1" style={{ left: labelX, right: 0, top: labelY[i] - 12 }}>
            <p className="fig text-[0.75rem] leading-tight">
              <span className="font-bold text-fg">{v.symbol}</span> <span className="text-fg-3">{v.issuerLabel}</span>
            </p>
            <p className="num mt-0.5 text-[1.75rem] leading-none text-fg md:text-[2rem]">
              {usd(v.perShareUsd as number)}
              {close !== null && <span className="fig ml-2 text-[0.6875rem] text-fg-3">{(((v.perShareUsd as number) / close - 1) * 100).toFixed(2)}% vs close</span>}
            </p>
            <p className={cn("mt-1.5 flex gap-1.5 text-[0.8125rem] leading-snug", v.tradable ? "text-sodium" : "text-fg-2")}>
              <span aria-hidden className="fig shrink-0">{v.tradable ? "+" : "x"}</span>
              <span>{shortReason(v)}</span>
            </p>
            {wide && <p className="mt-1 max-w-[46ch] text-[0.75rem] leading-snug text-fg-3">{v.because}{v.derived ? " Price computed from the stock quote." : ""}</p>}
          </div>
        ))}
      </div>

      {!wide && (
        <ol className="mt-6 space-y-3 border-t border-line pt-4 text-[0.8125rem] leading-snug text-fg-2">
          {view.versions.map((v) => (
            <li key={v.address}><span className="fig font-bold text-fg">{v.symbol}</span> {v.because}{v.derived ? " Price computed from the stock quote." : ""}</li>
          ))}
        </ol>
      )}
      {unpriced.length > 0 && (
        <p className="mt-4 text-[0.8125rem] text-fg-2">
          {unpriced.map((v) => v.symbol).join(", ")} {unpriced.length > 1 ? "have no price right now, so they are not" : "has no price right now, so it is not"} on the ladder.
        </p>
      )}
      {close === null && <div className="mt-4"><Note tone="warn">The last close is unavailable, so the close and trigger lines cannot be drawn.</Note></div>}
    </div>
  );
}
