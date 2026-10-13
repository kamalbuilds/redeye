"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { HOUR, KIND_LABEL, ZONES, clock, phaseAt, usSegments, weekdayDate, type SessionKind } from "@/lib/night";
import type { Proof, Pt } from "@/lib/redeye-proof";

const IST = ZONES.IST;
const SGT = ZONES.SGT;
const STEP = 15 * 60_000;
const SEG_FILL: Record<SessionKind, string> = { pre: "var(--sodium-dim)", regular: "var(--sodium-soft)", after: "var(--sodium)" };

const asOf = (rows: Pt[], t: number): Pt | null => {
  let hit: Pt | null = null;
  for (const r of rows) if (r.t <= t) hit = r; else break;
  return hit;
};

function niceTicks(min: number, max: number): number[] {
  const raw = (max - min) / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(v);
  return out;
}

/** Hours in IST sleep (23:00 to 07:00) that touch [t0, t1]. */
function sleepSpans(t0: number, t1: number): [number, number][] {
  const out: [number, number][] = [];
  const dayMs = 24 * HOUR;
  const off = IST.offsetMin * 60_000;
  for (let mid = Math.floor((t0 + off) / dayMs) * dayMs - off - dayMs; mid < t1 + dayMs; mid += dayMs) {
    const a = mid - HOUR;
    const b = mid + 7 * HOUR;
    if (b > t0 && a < t1) out.push([Math.max(a, t0), Math.min(b, t1)]);
  }
  return out;
}

export function Replay({ proof }: { proof: Proof }) {
  const hours = useMemo(() => [...new Set([...proof.ondo, ...proof.bstocks].map((p) => p.t))].sort((a, b) => a - b), [proof]);
  const t0 = hours[0];
  const t1 = hours[hours.length - 1];
  const moveA = proof.move.fromAt;
  const moveB = proof.move.toAt;
  const [t, setT] = useState(proof.fire.t);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const id = setInterval(() => {
      setT((cur) => {
        const next = cur + (reduce ? HOUR : STEP);
        if (next >= t1) { setPlaying(false); return t1; }
        return next;
      });
    }, reduce ? 900 : 110);
    return () => clearInterval(id);
  }, [playing, t1]);

  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(900);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(300, Math.round(e.contentRect.width))));
    ro.observe(el);
    setW(Math.max(300, Math.round(el.getBoundingClientRect().width)));
    return () => ro.disconnect();
  }, []);

  const narrow = w < 560;
  const m = { l: narrow ? 44 : 56, r: narrow ? 58 : 84, t: 30 };
  const hPlot = narrow ? 280 : 420;
  const axisH = 40;
  const totalH = m.t + hPlot + axisH;
  const x = (ms: number) => m.l + ((ms - t0) / (t1 - t0)) * (w - m.l - m.r);

  const prices = [...proof.ondo, ...proof.bstocks, ...proof.real].map((p) => p.v);
  const lo = Math.floor(Math.min(...prices) / 10) * 10 - 4;
  const hi = Math.ceil(Math.max(...prices) / 10) * 10 + 4;
  const y = (v: number) => m.t + (1 - (v - lo) / (hi - lo)) * hPlot;
  const yTicks = niceTicks(lo, hi);

  const sessions = useMemo(() => usSegments(t0, t1).map((s) => ({ ...s, start: Math.max(s.start, t0), end: Math.min(s.end, t1) })).filter((s) => s.end > s.start), [t0, t1]);
  const sleeps = useMemo(() => sleepSpans(t0, t1), [t0, t1]);

  const xTicks: number[] = [];
  for (let k = Math.ceil((t0 + IST.offsetMin * 60_000) / (3 * HOUR)); ; k++) {
    const tick = k * 3 * HOUR - IST.offsetMin * 60_000;
    if (tick > t1) break;
    xTicks.push(tick);
  }

  const segments = (rows: Pt[]) => {
    const out: string[] = [];
    let cur = "";
    let prev: number | null = null;
    for (const p of rows) {
      if (prev !== null && p.t - prev > HOUR) { out.push(cur); cur = ""; }
      cur += `${cur ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`;
      prev = p.t;
    }
    if (cur) out.push(cur);
    return out;
  };
  const realLinks = proof.real.slice(1).map((p, i) => ({ a: proof.real[i], b: p })).filter(({ a, b }) => b.t - a.t <= HOUR);

  const on = asOf(proof.ondo, t);
  const bs = asOf(proof.bstocks, t);
  const real = asOf(proof.real, t);
  const realFresh = real && t - real.t < HOUR ? real : null;
  const phase = phaseAt(t);
  const inSleep = sleeps.some(([a, b]) => t >= a && t <= b);
  const trig = proof.rule.triggerPrice;
  const fireX = x(proof.fire.t);

  const setFromPointer = (clientX: number) => {
    const r = box.current!.getBoundingClientRect();
    const ms = t0 + ((clientX - r.left - m.l) / (w - m.l - m.r)) * (t1 - t0);
    setT(Math.min(t1, Math.max(t0, Math.round(ms / STEP) * STEP)));
  };

  const [hh, ap] = clock(t, IST, { minutes: true }).split(" ");
  const gapOn = realFresh && on ? ((on.v - realFresh.v) / realFresh.v) * 100 : null;
  const gapBs = realFresh && bs ? ((bs.v - realFresh.v) / realFresh.v) * 100 : null;

  return (
    <div className="grid gap-x-12 gap-y-8 md:grid-cols-[17rem_minmax(0,1fr)]">
      <div className="min-w-0">
        <p className="label">Mumbai clock</p>
        <p className="num mt-1 flex items-baseline gap-2 leading-none text-fg" aria-live="off">
          <span className="text-[5.5rem] md:text-[6.5rem]">{hh}</span>
          <span className="text-[1.75rem] text-sodium">{ap}</span>
        </p>
        <p className="fig mt-2 text-[0.8125rem] text-fg-2">IST, {weekdayDate(t, IST)}</p>
        <p className="fig text-[0.75rem] text-fg-3">{clock(t, SGT, { minutes: true })} SGT</p>
        <p className="mt-4 max-w-[26ch] text-[0.9375rem] leading-snug text-fg-2">
          {phase ? `US ${KIND_LABEL[phase].toLowerCase()}.` : "The US market is closed."} {inSleep ? "You are asleep." : "You are awake."}
        </p>

        <dl className="fig mt-6 space-y-2.5 border-t border-line pt-4 text-[0.8125rem]">
          <Reading name="TSLAon" color="var(--series-ondo)" value={on?.v} at={on?.t} />
          <Reading name="TSLAB" color="var(--series-bstocks)" value={bs?.v} at={bs?.t} />
          <Reading name="TSLA real" color="var(--series-real)" value={realFresh?.v} at={realFresh?.t} ring none="no reading this hour" />
        </dl>
        {(gapOn !== null || gapBs !== null) && (
          <p className="fig mt-3 text-[0.75rem] text-fg-3">
            Against the real price: {gapOn !== null && `TSLAon ${gapOn >= 0 ? "+" : ""}${gapOn.toFixed(2)}%`}{gapOn !== null && gapBs !== null && ", "}{gapBs !== null && `TSLAB ${gapBs >= 0 ? "+" : ""}${gapBs.toFixed(2)}%`}
          </p>
        )}
      </div>

      <div className="min-w-0">
        <div ref={box} className="relative w-full select-none">
          <svg
            width={w}
            height={totalH}
            role="img"
            aria-label={`TSLA on 22 to 23 July 2026 in Mumbai time. TSLAon and TSLAB against the real after-hours price. Use the slider below to move through the night.`}
            className="block touch-pan-y"
            onPointerDown={(e) => { try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic pointer: no capture */ } setPlaying(false); setFromPointer(e.clientX); }}
            onPointerMove={(e) => { if (e.buttons) setFromPointer(e.clientX); }}
          >
            <rect x={m.l} y={m.t} width={w - m.l - m.r} height={hPlot} fill="var(--night-2)" />
            {sessions.map((s) => (
              <rect key={`${s.kind}${s.start}`} x={x(s.start)} width={x(s.end) - x(s.start)} y={m.t - 12} height="6" fill={SEG_FILL[s.kind]} />
            ))}
            <text x={m.l} y={m.t - 18} fontSize="10" fill="var(--fg-3)" className="fig">US SESSIONS</text>
            {sleeps.map(([a, b]) => (
              <g key={a}>
                <rect x={x(a)} y={m.t} width={x(b) - x(a)} height={hPlot} fill="oklch(14% 0.03 262 / 0.5)" />
                <rect x={x(a)} y={m.t} width={x(b) - x(a)} height={hPlot} fill="url(#hatch)" />
                {x(b) - x(a) > 90 && <text x={x(a) + 6} y={m.t + hPlot - 8} fontSize="10" fill="var(--fg-3)" className="fig">ASLEEP</text>}
              </g>
            ))}
            <defs>
              <pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="8" stroke="var(--line-2)" strokeWidth="1" />
              </pattern>
            </defs>

            {yTicks.map((v) => (
              <g key={v}>
                <line x1={m.l} x2={w - m.r} y1={y(v)} y2={y(v)} stroke="var(--line)" />
                <text x={m.l - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--fg-3)" className="fig">{v}</text>
              </g>
            ))}

            <rect x={x(moveA)} y={m.t} width={x(moveB) - x(moveA)} height={hPlot} fill="var(--sodium)" opacity="0.14" />
            <line x1={x(moveA)} x2={x(moveA)} y1={m.t} y2={m.t + hPlot} stroke="var(--sodium)" strokeWidth="1" />
            <line x1={x(moveB)} x2={x(moveB)} y1={m.t} y2={m.t + hPlot} stroke="var(--sodium)" strokeWidth="1" />

            {/* the rule: the close it measures from and the line it triggers on */}
            <line x1={m.l} x2={w - m.r} y1={y(proof.rule.lastClose)} y2={y(proof.rule.lastClose)} stroke="var(--fg-2)" strokeWidth="1" />
            <line x1={m.l} x2={w - m.r} y1={y(trig)} y2={y(trig)} stroke="var(--sodium)" strokeWidth="1.5" strokeDasharray="7 5" />

            {segments(proof.bstocks).map((d, i) => <path key={`b${i}`} d={d} fill="none" stroke="var(--series-bstocks)" strokeWidth="2" strokeLinejoin="round" />)}
            {segments(proof.ondo).map((d, i) => <path key={`o${i}`} d={d} fill="none" stroke="var(--series-ondo)" strokeWidth="2" strokeLinejoin="round" />)}
            {realLinks.map(({ a, b }) => <line key={a.t} x1={x(a.t)} y1={y(a.v)} x2={x(b.t)} y2={y(b.v)} stroke="var(--series-real)" strokeWidth="1.5" strokeDasharray="2 3" />)}
            {proof.real.map((p) => <circle key={p.t} cx={x(p.t)} cy={y(p.v)} r="4.5" fill="var(--night-2)" stroke="var(--series-real)" strokeWidth="2" />)}

            {/* direct labels at the line ends */}
            {(() => {
              const lastO = proof.ondo[proof.ondo.length - 1];
              const lastB = proof.bstocks[proof.bstocks.length - 1];
              const near = Math.abs(y(lastO.v) - y(lastB.v)) < 14;
              return (
                <>
                  <text x={x(lastO.t) + 8} y={y(lastO.v) + (near ? 12 : 4)} fontSize="11" fill="var(--series-ondo)" className="fig">TSLAon</text>
                  <text x={x(lastB.t) + 8} y={y(lastB.v) - (near ? 2 : -4)} fontSize="11" fill="var(--series-bstocks)" className="fig">TSLAB</text>
                </>
              );
            })()}

            {/* the move: annotation sits on the chart, the same figure the headline and the receipt quote */}
            <g>
              <text x={x(moveB) + 8} y={m.t + 18} fontSize="11" fill="var(--sodium)" className="fig">
                {clock(moveA, IST, { minutes: true })} to {clock(moveB, IST, { minutes: true })} IST
              </text>
              <text x={x(moveB) + 8} y={m.t + 33} fontSize="11" fill="var(--fg-2)" className="fig">
                {narrow ? `-${proof.move.pct.toFixed(1)}%` : `${proof.move.from.toFixed(2)} to ${proof.move.to.toFixed(2)}, -${proof.move.pct.toFixed(1)}%`}
              </text>
            </g>
            <text x={w - m.r - 6} y={y(proof.rule.lastClose) - 6} textAnchor="end" fontSize="11" fill="var(--fg-2)" className="fig">
              {narrow ? `close ${proof.rule.lastClose.toFixed(2)}` : `4 pm New York close ${proof.rule.lastClose.toFixed(2)}`}
            </text>
            <text x={w - m.r - 6} y={y(trig) - 7} textAnchor="end" fontSize="12" fill="var(--sodium)" stroke="var(--night-2)" strokeWidth="4" paintOrder="stroke" className="fig">
              {narrow ? `trigger ${trig.toFixed(2)}` : `trigger ${trig.toFixed(2)}, ${proof.rule.pct}% under the close`}
            </text>

            {/* the reading the rule fired on */}
            <line x1={fireX} x2={fireX} y1={m.t - 12} y2={m.t + hPlot} stroke="var(--sodium)" strokeWidth="2" />
            <circle cx={fireX} cy={y(proof.fire.price)} r="6.5" fill="var(--sodium)" stroke="var(--night)" strokeWidth="2" />

            {xTicks.map((tk) => {
              const h = new Date(tk + IST.offsetMin * 60_000).getUTCHours();
              if (narrow && h % 6 !== 0) return null;
              return (
                <g key={tk}>
                  <line x1={x(tk)} x2={x(tk)} y1={m.t + hPlot} y2={m.t + hPlot + 5} stroke="var(--fg-3)" />
                  <text x={x(tk)} y={m.t + hPlot + 20} textAnchor="middle" fontSize="11" fill="var(--fg-2)" className="fig">{clock(tk, IST)}</text>
                  {h === 0 && <text x={x(tk)} y={m.t + hPlot + 34} textAnchor="middle" fontSize="10" fill="var(--fg-3)" className="fig">{weekdayDate(tk, IST)}</text>}
                </g>
              );
            })}
            <text x={m.l - 8} y={m.t + hPlot + 20} textAnchor="end" fontSize="10" fill="var(--fg-3)">IST</text>

            {/* the scrubber's cursor */}
            <g pointerEvents="none">
              <line x1={x(t)} x2={x(t)} y1={m.t - 12} y2={m.t + hPlot} stroke="var(--fg)" strokeWidth="1.5" />
              {on && <circle cx={x(on.t)} cy={y(on.v)} r="5" fill="var(--series-ondo)" stroke="var(--night)" strokeWidth="2" />}
              {bs && <circle cx={x(bs.t)} cy={y(bs.v)} r="5" fill="var(--series-bstocks)" stroke="var(--night)" strokeWidth="2" />}
            </g>
          </svg>
          {!narrow && (
            <div className="pointer-events-none absolute w-[17rem] shadow-[0_18px_40px_-12px_var(--night)]" style={{ left: Math.min(fireX + 16, w - m.r - 280), bottom: axisH + 10 }}>
              <FireSlip proof={proof} />
            </div>
          )}
        </div>
        {narrow && (
          <div className="mt-4 w-full max-w-[20rem]">
            <FireSlip proof={proof} />
          </div>
        )}

        <div className="mt-5 flex items-center gap-4">
          <button
            type="button"
            onClick={() => { if (t >= t1) setT(t0); setPlaying((p) => !p); }}
            aria-label={playing ? "Pause the replay" : "Play the replay"}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-sm border border-line-2 text-fg transition-colors duration-150 hover:border-sodium hover:text-sodium active:scale-[0.97]"
          >
            {playing ? <Pause aria-hidden className="size-4" /> : <Play aria-hidden className="size-4" />}
          </button>
          <Slider
            value={[t]}
            min={t0}
            max={t1}
            step={STEP}
            largeStep={HOUR}
            onValueChange={(v) => { setPlaying(false); setT(Array.isArray(v) ? v[0] : v); }}
            getAriaLabel={() => "Time of night, Mumbai"}
            getAriaValueText={(_f, value) => `${clock(value, IST, { minutes: true })} IST, ${weekdayDate(value, IST)}`}
            className={cn("min-h-11 flex-1")}
          />
        </div>
        <p className="fig mt-2 text-[0.75rem] text-fg-3">Drag the chart or use the slider. Arrow keys move 15 minutes, Page Up and Page Down move an hour.</p>
      </div>
    </div>
  );
}

function Reading({ name, color, value, at, ring, none = "no candle yet" }: { name: string; color: string; value?: number; at?: number; ring?: boolean; none?: string }) {
  return (
    <div className="grid grid-cols-[auto_1fr] items-baseline gap-x-3">
      <dt className="flex items-center gap-2 text-fg-2">
        <span aria-hidden className="size-2.5 rounded-full" style={ring ? { border: `2px solid ${color}` } : { background: color }} />
        {name}
      </dt>
      <dd className="text-right">
        {value === undefined ? <span className="text-fg-3">{none}</span> : (
          <>
            <span className="num text-[1.5rem] text-fg">{value.toFixed(2)}</span>
            {at !== undefined && <span className="ml-2 text-[0.6875rem] text-fg-3">{clock(at, IST, { minutes: true })}</span>}
          </>
        )}
      </dd>
    </div>
  );
}

function FireSlip({ proof }: { proof: Proof }) {
  const f = proof.fire;
  return (
    <article className="border border-sodium/70 border-l-4 border-l-sodium bg-night px-4 pb-4 pt-3.5">
      <p className="label text-sodium">Rule fired</p>
      <p className="mt-1.5 flex items-baseline gap-2">
        <span className="num text-[1.5rem] leading-none text-fg">{clock(f.t, IST, { minutes: true })} IST</span>
        <span className="fig text-[0.6875rem] text-fg-3">{clock(f.t, SGT, { minutes: true })} SGT</span>
      </p>
      <p className="mt-2 text-[0.875rem] font-medium leading-snug text-fg">Bought {f.symbol} at ${f.price.toFixed(2)}. You were asleep.</p>
      <dl className="mt-2.5 space-y-1 border-t border-line-2 pt-2.5 text-[0.75rem] leading-snug text-fg-2">
        <div className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-2"><dt className="label">Rule</dt><dd className="fig">{proof.rule.text}</dd></div>
        <div className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-2"><dt className="label">Why</dt><dd>{f.reason}</dd></div>
      </dl>
    </article>
  );
}
