"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ChevronLeft } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Note } from "@/components/shared/page";
import { Desk } from "./desk";
import { cn } from "@/lib/utils";
import {
  DAY, HOUR, KIND_LABEL, ZONES, clock, duration, nightWindow, span, weekday, weekdayDate,
  type SessionKind, type Zone, type ZoneId,
} from "@/lib/night";
import type { MarketStatusView } from "@/lib/redeye";

const SEG_FILL: Record<SessionKind, string> = {
  pre: "bg-sodium-dim border-t-2 border-sodium/60",
  regular: "bg-sodium-soft border-t-2 border-sodium",
  after: "bg-sodium border-t-2 border-sodium",
};
const STATE_LABEL: Record<string, string> = {
  premarket: "premarket", regular: "regular session", postmarket: "after-hours", overnight: "overnight",
  offhours: "off-hours", closed: "closed", pause: "paused",
};

type Status = { kind: "loading" } | { kind: "error" } | { kind: "ok"; s: MarketStatusView };

function useStatus(): Status {
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  useEffect(() => {
    let alive = true;
    const read = async () => {
      try {
        const res = await fetch("/api/status", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const s = (await res.json()) as MarketStatusView;
        if (alive) setStatus({ kind: "ok", s });
      } catch {
        if (alive) setStatus({ kind: "error" });
      }
    };
    void read();
    const id = setInterval(read, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  return status;
}

/** One sentence, one next-open time: Binance's own, named as the overnight venue's, because that is when the tokens trade next. */
function statusText(s: MarketStatusView, z: Zone): string {
  const label = s.state ? STATE_LABEL[s.state] ?? s.state : "state unknown";
  const parts = [`Binance reads the US market as ${label}${s.open ? ", open" : ""}.`];
  if (s.reasonMsg && !s.open) parts.push(`${s.reasonMsg}.`);
  if (s.open && s.nextCloseTime) parts.push(`This session ends ${clock(s.nextCloseTime, z)} ${z.id}.`);
  else if (s.nextOpenTime) parts.push(`Next open on Binance's overnight venue: ${weekdayDate(s.nextOpenTime, z)}, ${clock(s.nextOpenTime, z, { minutes: true })} ${z.id}.`);
  return parts.join(" ");
}

// the chosen zone lives in localStorage; the strip re-reads it through a tiny store so the server render stays on IST
const zoneListeners = new Set<() => void>();
const readZone = (): ZoneId => {
  const saved = localStorage.getItem("redeye.zone");
  if (saved === "IST" || saved === "SGT") return saved;
  return Intl.DateTimeFormat().resolvedOptions().timeZone === "Asia/Singapore" ? "SGT" : "IST";
};
const subscribeZone = (cb: () => void) => { zoneListeners.add(cb); return () => { zoneListeners.delete(cb); }; };
const storeZone = (id: ZoneId) => { localStorage.setItem("redeye.zone", id); zoneListeners.forEach((l) => l()); };

/** The top of the page: the headline and the order desk side by side, then the 24 hour instrument they both read from. */
export function Tonight({ initialNow }: { initialNow: number }) {
  const zoneId = useSyncExternalStore(subscribeZone, readZone, () => "IST" as ZoneId);
  const [now, setNow] = useState(initialNow);
  const status = useStatus();
  const z = ZONES[zoneId];

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 30_000);
    return () => { clearTimeout(first); clearInterval(id); };
  }, []);

  const w = useMemo(() => nightWindow(now, z), [now, z]);
  const pct = (ms: number) => ((ms - w.start) / DAY) * 100;
  const seg = (k: SessionKind) => w.segs.find((s) => s.kind === k);
  const after = seg("after");
  const regular = seg("regular");
  const pre = seg("pre");

  // Redeye is on watch where US trading and your sleep overlap
  const watchStart = Math.max(w.sleepStart, regular?.start ?? w.sleepStart);
  const watchEnd = Math.min(w.sleepEnd, after?.end ?? w.sleepEnd);
  const watching = watchEnd > watchStart;

  const ticks = Array.from({ length: 25 }, (_, i) => w.start + i * HOUR);
  const tickLabel = (ms: number) => clock(ms, z);
  const markerAlign = !w.nowInside || w.nowP < 0.1 ? "left" : w.nowP > 0.9 ? "right" : "center";
  const nextPre = pre ?? w.segs[0];

  const headline = (
    <div>
      <h1 id="night-h" className="max-w-[22ch] font-serif text-[2.25rem] leading-[1.05] tracking-[-0.015em] md:max-w-[26ch] md:text-[3.25rem]">
        {watching
          ? <><span className="text-sodium">{duration(watchEnd - watchStart)}</span> of the US session lands while you sleep.</>
          : "The US session does not overlap your sleep tonight."}
      </h1>
      <p className="mt-3 max-w-[64ch] text-[1.0625rem] leading-snug text-fg-2">
        Leave Redeye one rule before bed. It watches every tokenized version of the stock on BNB Chain, Ondo, xStocks and bStocks, and acts on the one that can trade at the best price.
      </p>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-x-8 gap-y-3 border-y border-line py-3">
        <div className="min-w-0 max-w-[70ch] flex-1 space-y-2" aria-live="polite">
          {status.kind === "loading" && <p className="fig text-[0.8125rem] text-fg-3">Reading the Binance market status.</p>}
          {status.kind === "error" && (
            <>
              <Note tone="warn">The Binance market status did not answer. The bands below come from the session clock alone.</Note>
              {w.weekendShift && nextPre && (
                <p className="text-[0.9375rem] text-fg-2">
                  The US market is shut. The next night opens {weekdayDate(nextPre.start, z)} at {clock(nextPre.start, z)} {z.id}.
                </p>
              )}
            </>
          )}
          {status.kind === "ok" && (
            <p className="fig flex gap-2.5 text-[0.8125rem] leading-snug text-fg-2">
              <span aria-hidden className={cn("mt-[0.3rem] size-2 shrink-0 rounded-full", status.s.open ? "live-dot bg-sodium" : "bg-fg-3")} />
              <span>{statusText(status.s, z)}</span>
            </p>
          )}
        </div>
        <ToggleGroup
          aria-label="Time zone"
          value={[zoneId]}
          onValueChange={(v) => {
            const next = v[0] as ZoneId | undefined;
            if (!next) return;
            storeZone(next);
          }}
          spacing={0}
          className="rounded-sm border border-line-2"
        >
          {(["IST", "SGT"] as const).map((id) => (
            <ToggleGroupItem
              key={id}
              value={id}
              aria-label={`${id}, ${ZONES[id].city}`}
              className="min-h-11 min-w-14 rounded-none px-3 font-mono text-[0.75rem] tracking-[0.12em] text-fg-3 hover:bg-night-3 hover:text-fg aria-pressed:bg-sodium aria-pressed:text-sodium-ink md:min-h-9"
            >
              {id}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
    </div>
  );

  return (
    <>
      <section aria-label="Tonight's desk" className="border-b border-line">
        <div className="mx-auto max-w-[1180px] px-5 pb-14 pt-6 md:px-8 md:pt-9">
          <Desk headline={headline} />
        </div>
      </section>

      <section aria-label="The night, hour by hour" className="relative border-b border-line">
        <div className="mx-auto max-w-[1180px] px-5 pb-12 pt-8 md:px-8">
          <h2 className="label mb-5">Night of {weekdayDate(w.start, z)}, {z.city} time</h2>
          <p className="sr-only">
            US premarket {pre ? span(pre.start, pre.end, z) : "is closed"}, regular session {regular ? span(regular.start, regular.end, z) : "is closed"},
            after-hours {after ? span(after.start, after.end, z) : "is closed"}, all {z.id}. Sleep is {span(w.sleepStart, w.sleepEnd, z)}.
          </p>

          <div aria-hidden className="[container-type:inline-size]">
            {/* hour labels: every 6 h on a phone, every 3 h from tablet up */}
            <div className="relative h-6">
              {ticks.map((t, i) => {
                if (i % 3 !== 0) return null;
                const six = i % 6 === 0;
                return (
                  <span
                    key={t}
                    className={cn(
                      "fig absolute top-0 whitespace-nowrap text-[0.6875rem] text-fg-3",
                      i === 0 ? "" : i === 24 ? "-translate-x-full" : "-translate-x-1/2",
                      !six && "max-md:hidden",
                    )}
                    style={{ left: `${(i / 24) * 100}%` }}
                  >
                    {tickLabel(t)}
                  </span>
                );
              })}
            </div>

            <div className="relative h-[120px] overflow-hidden rounded-lg border border-line-2 bg-night-2 md:h-[150px]">
              <div className="grid-plate absolute inset-0 opacity-60" />
              {ticks.map((t, i) => i > 0 && i < 24 && (
                <span key={t} className={cn("absolute inset-y-0 w-px", i % 3 === 0 ? "bg-line-2" : "bg-line")} style={{ left: `${(i / 24) * 100}%` }} />
              ))}

              {w.segs.map((s) => (
                <div
                  key={s.kind}
                  className={cn("absolute bottom-0 top-10 md:top-12", SEG_FILL[s.kind])}
                  style={{ left: `${pct(s.start)}%`, width: `${pct(s.end) - pct(s.start)}%` }}
                />
              ))}

              {/* sleep: the dark hatch lies over the sessions so you can see exactly what you miss */}
              <div
                className="absolute inset-y-0 z-10"
                style={{
                  left: `${pct(w.sleepStart)}%`,
                  width: `${pct(w.sleepEnd) - pct(w.sleepStart)}%`,
                  backgroundImage:
                    "repeating-linear-gradient(135deg, oklch(14% 0.03 262 / 0.72) 0 2px, transparent 2px 8px), linear-gradient(oklch(14% 0.03 262 / 0.4), oklch(14% 0.03 262 / 0.4))",
                }}
              >
                <span className="label absolute left-2 top-2 text-fg-2">Asleep {span(w.sleepStart, w.sleepEnd, z)}</span>
              </div>

              {/* now: drifts along the night, one transform per half minute */}
              <div
                className="absolute inset-y-0 left-0 z-20 w-0 transition-transform duration-[30000ms] ease-linear motion-reduce:transition-none"
                style={{ transform: `translateX(calc(${w.nowP} * 100cqw))` }}
              >
                <span className={cn("absolute inset-y-0 w-0.5 bg-fg shadow-[0_0_14px_2px_var(--sodium-soft)]", markerAlign === "right" ? "-translate-x-full" : "")} />
                <span
                  className={cn(
                    "fig absolute -top-px whitespace-nowrap bg-fg px-1.5 py-0.5 text-[0.6875rem] font-bold uppercase tracking-[0.1em] text-night",
                    markerAlign === "left" ? "left-0" : markerAlign === "right" ? "right-0" : "-translate-x-1/2",
                  )}
                >
                  {!w.nowInside && <ChevronLeft aria-hidden className="mr-0.5 inline size-3 -translate-y-px" />}
                  Now {w.nowInside ? "" : `${weekday(now, z)} `}{clock(now, z, { minutes: true })}
                </span>
              </div>
            </div>

            {/* where Redeye is on watch: US trading that falls inside your sleep */}
            <div className="relative mt-2 h-9">
              {watching && (
                <>
                  <span className="absolute top-0 h-2 border-x border-b border-sodium" style={{ left: `${pct(watchStart)}%`, width: `${pct(watchEnd) - pct(watchStart)}%` }} />
                  <span
                    className="label absolute top-3 whitespace-nowrap text-sodium"
                    style={{ left: `${(pct(watchStart) + pct(watchEnd)) / 2}%`, transform: "translateX(-50%)" }}
                  >
                    Redeye on watch
                  </span>
                </>
              )}
            </div>

            {/* direct labels under each session, from tablet up */}
            <div className="relative hidden h-[4.25rem] md:block">
              {w.segs.map((s) => {
                const left = pct(s.start);
                return (
                  <div key={s.kind} className="absolute top-0 max-w-[22rem] border-l border-line-2 pl-2.5" style={{ left: `${left}%` }}>
                    <p className="label">{KIND_LABEL[s.kind]}</p>
                    <p className={cn("num whitespace-nowrap text-[1.375rem] leading-tight", s.kind === "after" ? "text-sodium" : "text-fg")}>
                      {span(s.start, s.end, z)} <span className="fig text-[0.75rem] text-fg-3">{z.id}</span>
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          <ul className="mt-5 space-y-3 md:hidden" aria-label="US session hours in your time">
            {w.segs.map((s) => (
              <li key={s.kind} className="flex items-baseline gap-3">
                <span aria-hidden className={cn("size-3 shrink-0 translate-y-0.5", SEG_FILL[s.kind])} />
                <span className="label w-[7.5rem] shrink-0">{KIND_LABEL[s.kind]}</span>
                <span className={cn("num text-[1.25rem] leading-tight", s.kind === "after" ? "text-sodium" : "text-fg")}>
                  {span(s.start, s.end, z)} <span className="fig text-[0.75rem] text-fg-3">{z.id}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}
