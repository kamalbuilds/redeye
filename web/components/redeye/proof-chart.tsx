"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Proof } from "@/lib/redeye-proof";

const H = 3_600_000;
const IST = 5.5 * H;
const C = { ondo: "var(--series-ondo)", bstocks: "var(--series-bstocks)", real: "var(--series-real)" };

const istLabel = (t: number) =>
  new Date(t + IST).toLocaleTimeString("en-US", { timeZone: "UTC", hour: "numeric", minute: "2-digit", hour12: true }).replace(" ", "").toLowerCase();
const utcLabel = (t: number) => new Date(t).toISOString().slice(11, 16) + " UTC";
const price = (v: number) => v.toFixed(2);

export function ProofChart({ proof }: { proof: Proof }) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(960);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(320, Math.round(e.contentRect.width))));
    ro.observe(el);
    setW(Math.max(320, Math.round(el.getBoundingClientRect().width)));
    return () => ro.disconnect();
  }, []);

  const narrow = w < 560;
  const m = { l: narrow ? 40 : 52, r: narrow ? 12 : 20, t: 12 };
  const hA = narrow ? 260 : 320; // price panel
  const hGap = 130; // gap panel
  const gapBetween = 34;
  const axisH = 52;
  const totalH = m.t + hA + gapBetween + hGap + axisH;

  const hours = useMemo(() => [...new Set([...proof.ondo, ...proof.bstocks].map((p) => p.t))].sort((a, b) => a - b), [proof]);
  const t0 = hours[0] - H / 2;
  const t1 = hours[hours.length - 1] + H / 2;
  const x = (t: number) => m.l + ((t - t0) / (t1 - t0)) * (w - m.l - m.r);

  const prices = [...proof.ondo, ...proof.bstocks, ...proof.real].map((p) => p.v);
  const lo = Math.floor(Math.min(...prices) / 10) * 10 - 5;
  const hi = Math.ceil(Math.max(...prices) / 10) * 10 + 5;
  const yP = (v: number) => m.t + (1 - (v - lo) / (hi - lo)) * hA;
  const yTicks: number[] = [];
  for (let v = Math.ceil(lo / 20) * 20; v <= hi; v += 20) yTicks.push(v);

  const gapTop = m.t + hA + gapBetween;
  const gMax = 1; // percent
  const yG = (pct: number) => gapTop + (1 - (pct + gMax) / (2 * gMax)) * hGap;

  const tickEvery = narrow ? 6 : 3;
  const ticks = hours.filter((t) => (new Date(t).getUTCHours() % tickEvery === 0));

  const segments = (rows: { t: number; v: number }[]) => {
    const out: string[] = [];
    let cur = "";
    let prev: number | null = null;
    for (const p of rows) {
      if (prev !== null && p.t - prev > H) { out.push(cur); cur = ""; prev = null; }
      cur += `${cur ? "L" : "M"}${x(p.t).toFixed(1)},${yP(p.v).toFixed(1)}`;
      prev = p.t;
    }
    if (cur) out.push(cur);
    return out;
  };

  const at = (rows: { t: number; v: number }[], t: number) => rows.find((r) => r.t === t)?.v ?? null;
  const gapAt = (t: number) => proof.gaps.find((g) => g.t === t) ?? null;

  const idx = hover === null ? -1 : hours.indexOf(hover);
  const move = (clientX: number) => {
    const r = box.current!.getBoundingClientRect();
    const t = t0 + ((clientX - r.left - m.l) / (w - m.l - m.r)) * (t1 - t0);
    let best = hours[0];
    for (const h of hours) if (Math.abs(h - t) < Math.abs(best - t)) best = h;
    setHover(best);
  };

  const hv = hover;
  const tipLeft = hv === null ? 0 : Math.min(Math.max(x(hv) + 12, 4), w - 190);
  const gap = hv === null ? null : gapAt(hv);

  return (
    <div className="relative">
      <ul className="mb-3 flex flex-wrap gap-x-6 gap-y-1.5 text-[0.8125rem] text-bone-2" aria-label="Legend">
        <li className="flex items-center gap-2"><svg width="22" height="8" aria-hidden><line x1="0" y1="4" x2="22" y2="4" stroke={C.ondo} strokeWidth="2" strokeLinecap="round" /></svg>TSLAon (Ondo)</li>
        <li className="flex items-center gap-2"><svg width="22" height="8" aria-hidden><line x1="0" y1="4" x2="22" y2="4" stroke={C.bstocks} strokeWidth="2" strokeLinecap="round" /></svg>TSLAB (bStocks)</li>
        <li className="flex items-center gap-2"><svg width="12" height="12" aria-hidden><circle cx="6" cy="6" r="4.5" fill={C.real} stroke="var(--night-2)" strokeWidth="2" /></svg>TSLA after-hours price (Yahoo)</li>
      </ul>
      <div ref={box} className="w-full touch-pan-y select-none">
        <svg
          width={w}
          height={totalH}
          role="img"
          tabIndex={0}
          aria-label={`TSLA earnings night 22 to 23 July 2026. Ondo and bStocks tokens against the real after-hours price. Largest gap ${proof.maxGapPct.toFixed(2)} percent. Use the arrow keys to read each hour, or open the data table below.`}
          onPointerMove={(e) => move(e.clientX)}
          onPointerDown={(e) => move(e.clientX)}
          onPointerLeave={() => setHover(null)}
          onBlur={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            e.preventDefault();
            const i = idx < 0 ? 0 : idx + (e.key === "ArrowRight" ? 1 : -1);
            setHover(hours[Math.min(hours.length - 1, Math.max(0, i))]);
          }}
          className="block rounded-sm outline-offset-4"
        >
          <rect x={m.l} y={m.t} width={w - m.l - m.r} height={hA} fill="var(--night-2)" />
          <rect x={m.l} y={gapTop} width={w - m.l - m.r} height={hGap} fill="var(--night-2)" />

          {yTicks.map((v) => (
            <g key={v}>
              <line x1={m.l} x2={w - m.r} y1={yP(v)} y2={yP(v)} stroke="var(--night-rule)" strokeWidth="1" />
              <text x={m.l - 8} y={yP(v) + 4} textAnchor="end" className="fig" fontSize="11" fill="var(--bone-2)">{v}</text>
            </g>
          ))}

          {/* the move: 20:00 to 21:00 UTC = 1:30 to 2:30 am IST */}
          <rect x={x(Date.UTC(2026, 6, 22, 20))} width={x(Date.UTC(2026, 6, 22, 21)) - x(Date.UTC(2026, 6, 22, 20))} y={m.t} height={hA + gapBetween + hGap} fill="var(--series-real)" opacity="0.12" />
          <text x={x(Date.UTC(2026, 6, 22, 21)) + 6} y={m.t + 14} fontSize="11" fill="var(--bone)">{narrow ? "the move" : "1:30 to 2:30 am IST"}</text>

          {/* US open 13:30 UTC = 7:00 pm IST */}
          <line x1={x(Date.UTC(2026, 6, 23, 13, 30))} x2={x(Date.UTC(2026, 6, 23, 13, 30))} y1={m.t} y2={gapTop + hGap} stroke="var(--bone-2)" strokeWidth="1" strokeDasharray="2 4" />
          <text x={x(Date.UTC(2026, 6, 23, 13, 30)) - 6} y={m.t + 14} textAnchor="end" fontSize="11" fill="var(--bone-2)">{narrow ? "US open" : "US open, 7:00 pm IST"}</text>

          {segments(proof.bstocks).map((d, i) => <path key={`b${i}`} d={d} fill="none" stroke={C.bstocks} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />)}
          {segments(proof.ondo).map((d, i) => <path key={`o${i}`} d={d} fill="none" stroke={C.ondo} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />)}
          {proof.real.map((p) => (
            <circle key={p.t} cx={x(p.t)} cy={yP(p.v)} r="4.5" fill={C.real} stroke="var(--night-2)" strokeWidth="2" />
          ))}

          {/* gap panel */}
          <text x={m.l} y={gapTop - 12} fontSize="11" fill="var(--bone-2)">Token minus real price, percent</text>
          {[-1, -0.5, 0, 0.5, 1].map((p) => (
            <g key={p}>
              <line x1={m.l} x2={w - m.r} y1={yG(p)} y2={yG(p)} stroke={p === 0 ? "var(--bone-2)" : "var(--night-rule)"} strokeWidth="1" />
              <text x={m.l - 8} y={yG(p) + 4} textAnchor="end" className="fig" fontSize="11" fill="var(--bone-2)">{p > 0 ? "+" : ""}{p}</text>
            </g>
          ))}
          {proof.gaps.map((g) => (
            <g key={g.t}>
              {g.ondo !== null && <circle cx={x(g.t)} cy={yG(((g.ondo - g.real) / g.real) * 100)} r="4.5" fill={C.ondo} stroke="var(--night-2)" strokeWidth="2" />}
              {g.bstocks !== null && (
                <rect x={x(g.t) - 4.5} y={yG(((g.bstocks - g.real) / g.real) * 100) - 4.5} width="9" height="9" fill={C.bstocks} stroke="var(--night-2)" strokeWidth="2" />
              )}
            </g>
          ))}

          {/* time axis: IST first, UTC beneath */}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={gapTop + hGap} y2={gapTop + hGap + 5} stroke="var(--bone-2)" />
              <text x={x(t)} y={gapTop + hGap + 20} textAnchor="middle" fontSize="11" fill="var(--bone)" className="fig">{istLabel(t)}</text>
              <text x={x(t)} y={gapTop + hGap + 35} textAnchor="middle" fontSize="10" fill="var(--bone-2)" className="fig">{utcLabel(t).slice(0, 5)}</text>
            </g>
          ))}
          <text x={m.l - 8} y={gapTop + hGap + 20} textAnchor="end" fontSize="10" fill="var(--bone-2)">IST</text>
          <text x={m.l - 8} y={gapTop + hGap + 35} textAnchor="end" fontSize="10" fill="var(--bone-2)">UTC</text>

          {hv !== null && (
            <g pointerEvents="none">
              <line x1={x(hv)} x2={x(hv)} y1={m.t} y2={gapTop + hGap} stroke="var(--bone)" strokeWidth="1" />
              {at(proof.ondo, hv) !== null && <circle cx={x(hv)} cy={yP(at(proof.ondo, hv)!)} r="5" fill={C.ondo} stroke="var(--night-2)" strokeWidth="2" />}
              {at(proof.bstocks, hv) !== null && <circle cx={x(hv)} cy={yP(at(proof.bstocks, hv)!)} r="5" fill={C.bstocks} stroke="var(--night-2)" strokeWidth="2" />}
            </g>
          )}
        </svg>

        {hv !== null && (
          <div
            role="status"
            className="pointer-events-none absolute top-14 z-10 w-[180px] rounded-sm border border-night-rule bg-night px-3 py-2 text-[0.8125rem] text-bone"
            style={{ left: tipLeft }}
          >
            <p className="fig text-bone-2">{istLabel(hv)} IST · {utcLabel(hv)}</p>
            <dl className="fig mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
              <dt className="text-bone-2">TSLAon</dt><dd className="text-right">{at(proof.ondo, hv) !== null ? price(at(proof.ondo, hv)!) : "no candle"}</dd>
              <dt className="text-bone-2">TSLAB</dt><dd className="text-right">{at(proof.bstocks, hv) !== null ? price(at(proof.bstocks, hv)!) : "no candle"}</dd>
              {gap && (<><dt className="text-bone-2">Real</dt><dd className="text-right">{price(gap.real)}</dd></>)}
            </dl>
          </div>
        )}
      </div>
    </div>
  );
}
