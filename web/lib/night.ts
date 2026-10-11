// Session math for the night strip and the replay. Pure functions, no imports, so the same file runs in the
// browser, in the server render and under `node --test lib/night.test.ts`.
//
// US equity hours are fixed in New York wall time (premarket 04:00 to 09:30, regular 09:30 to 16:00,
// after-hours 16:00 to 20:00). Everything is converted through the America/New_York rules in Intl, so the
// two DST switches move the UTC instants and the strip together. IST and SGT have no DST, so a fixed
// offset is exact for them.

const MIN = 60_000;
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

export type ZoneId = "IST" | "SGT";
export interface Zone { id: ZoneId; tz: string; offsetMin: number; city: string }
export const ZONES: Record<ZoneId, Zone> = {
  IST: { id: "IST", tz: "Asia/Kolkata", offsetMin: 330, city: "Mumbai" },
  SGT: { id: "SGT", tz: "Asia/Singapore", offsetMin: 480, city: "Singapore" },
};

export type SessionKind = "pre" | "regular" | "after";
export interface Seg { kind: SessionKind; start: number; end: number }

export const KIND_LABEL: Record<SessionKind, string> = { pre: "Premarket", regular: "Regular session", after: "After-hours" };
const WINDOWS: { kind: SessionKind; from: [number, number]; to: [number, number] }[] = [
  { kind: "pre", from: [4, 0], to: [9, 30] },
  { kind: "regular", from: [9, 30], to: [16, 0] },
  { kind: "after", from: [16, 0], to: [20, 0] },
];

// NYSE full-day closures for 2026 (New York calendar dates). Weekends are handled by the weekday test.
// The live Binance status line stays the authority on whether a token can trade right now.
const NYSE_CLOSED_2026 = new Set([
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
  "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
]);

const etFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric",
});

function etParts(ms: number) {
  const o: Record<string, number> = {};
  for (const p of etFmt.formatToParts(new Date(ms))) if (p.type !== "literal") o[p.type] = Number(p.value);
  return o as { year: number; month: number; day: number; hour: number; minute: number };
}

/** New York's offset from UTC in minutes at an instant: -240 in EDT, -300 in EST. */
export function etOffsetMin(ms: number): number {
  const p = etParts(ms);
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(ms / MIN) * MIN) / MIN);
}

/** The UTC instant of a New York wall-clock time. */
export function etWallToUtc(year: number, month: number, day: number, hour: number, minute: number): number {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  for (const off of [-240, -300]) {
    const t = wall - off * MIN;
    if (etOffsetMin(t) === off) return t;
  }
  throw new Error(`no New York instant for ${year}-${month}-${day} ${hour}:${minute}`);
}

/** US session segments that overlap [from, to), in UTC milliseconds, unclipped. */
export function usSegments(from: number, to: number): Seg[] {
  const out: Seg[] = [];
  const first = etParts(from - DAY);
  const last = etParts(to + DAY);
  const end = Date.UTC(last.year, last.month - 1, last.day);
  for (let d = Date.UTC(first.year, first.month - 1, first.day); d <= end; d += DAY) {
    const day = new Date(d);
    const dow = day.getUTCDay();
    const key = day.toISOString().slice(0, 10);
    if (dow === 0 || dow === 6 || NYSE_CLOSED_2026.has(key)) continue;
    const [y, m, dd] = [day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate()];
    for (const w of WINDOWS) {
      const seg = { kind: w.kind, start: etWallToUtc(y, m, dd, ...w.from), end: etWallToUtc(y, m, dd, ...w.to) };
      if (seg.end > from && seg.start < to) out.push(seg);
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

export function phaseAt(ms: number): SessionKind | null {
  return usSegments(ms, ms + 1).find((s) => s.start <= ms && ms < s.end)?.kind ?? null;
}

// ---------- local clock ----------

const local = (ms: number, z: Zone) => new Date(ms + z.offsetMin * MIN);

export function localHour(ms: number, z: Zone): number {
  const d = local(ms, z);
  return d.getUTCHours() + d.getUTCMinutes() / 60;
}

/** "7 pm", "1:30 am". Minutes only when they are not zero. */
export function clock(ms: number, z: Zone, opts: { minutes?: boolean } = {}): string {
  const d = local(ms, z);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}${m || opts.minutes ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`;
}

/** "1:30 to 5:30 am" when both ends share am or pm, "7 pm to 1:30 am" when they do not. */
export function span(start: number, end: number, z: Zone): string {
  const a = clock(start, z);
  const b = clock(end, z);
  const [aTime, aAp] = a.split(" ");
  const [, bAp] = b.split(" ");
  return aAp === bAp ? `${aTime} to ${b}` : `${a} to ${b}`;
}

export function weekdayDate(ms: number, z: Zone): string {
  return local(ms, z).toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
}

export function weekday(ms: number, z: Zone): string {
  return local(ms, z).toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "short" });
}

export function duration(ms: number): string {
  const total = Math.round(ms / MIN);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h && m ? `${h} h ${m} m` : h ? `${h} h` : `${m} m`;
}

/** The latest local noon at or before ms. A night runs noon to noon so it never splits at midnight. */
export function localNoonAtOrBefore(ms: number, z: Zone): number {
  const shifted = ms + z.offsetMin * MIN;
  let noon = Math.floor(shifted / DAY) * DAY + 12 * HOUR;
  if (noon > shifted) noon -= DAY;
  return noon - z.offsetMin * MIN;
}

// ---------- the night window ----------

export interface NightWindow {
  start: number;
  end: number;
  segs: Seg[];            // clipped to the window
  sleepStart: number;     // 23:00 local
  sleepEnd: number;       // 07:00 local
  sleepOverlapMs: number; // US trading time inside the sleep hours
  nowInside: boolean;     // false when now is before the window opens (weekend, holiday)
  nowP: number;           // 0..1 along the window, clamped
  weekendShift: boolean;  // the window was moved forward to find a trading night
}

export function nightWindow(now: number, z: Zone): NightWindow {
  const base = localNoonAtOrBefore(now, z);
  let start = base;
  let segs: Seg[] = [];
  for (let i = 0; i < 6; i++) {
    segs = clipSegs(usSegments(start, start + DAY), start, start + DAY);
    if (segs.length) break;
    start += DAY;
  }
  const end = start + DAY;
  const sleepStart = start + 11 * HOUR;
  const sleepEnd = start + 19 * HOUR;
  const sleepOverlapMs = segs.reduce((n, s) => n + Math.max(0, Math.min(s.end, sleepEnd) - Math.max(s.start, sleepStart)), 0);
  return {
    start, end, segs, sleepStart, sleepEnd, sleepOverlapMs,
    nowInside: now >= start && now < end,
    nowP: Math.min(1, Math.max(0, (now - start) / DAY)),
    weekendShift: start !== base,
  };
}

function clipSegs(segs: Seg[], from: number, to: number): Seg[] {
  return segs.map((s) => ({ ...s, start: Math.max(s.start, from), end: Math.min(s.end, to) })).filter((s) => s.end > s.start);
}
