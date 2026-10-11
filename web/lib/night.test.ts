import { test } from "node:test";
import assert from "node:assert/strict";
import { ZONES, clock, duration, etOffsetMin, nightWindow, phaseAt, span, usSegments, HOUR, DAY } from "./night.ts";

const IST = ZONES.IST;
const SGT = ZONES.SGT;
const utc = (iso: string) => Date.parse(iso);

test("New York offset flips at both DST switches", () => {
  assert.equal(etOffsetMin(utc("2026-03-08T06:00:00Z")), -300); // before 2 am EST
  assert.equal(etOffsetMin(utc("2026-03-08T08:00:00Z")), -240); // after: EDT
  assert.equal(etOffsetMin(utc("2026-11-01T05:00:00Z")), -240);
  assert.equal(etOffsetMin(utc("2026-11-01T07:00:00Z")), -300);
});

test("after-hours lands 1:30 to 5:30 am IST in summer, 2:30 to 6:30 am in winter", () => {
  const summer = usSegments(utc("2026-10-12T00:00:00Z"), utc("2026-10-13T00:00:00Z")).find((s) => s.kind === "after")!;
  assert.equal(span(summer.start, summer.end, IST), "1:30 to 5:30 am");
  assert.equal(span(summer.start, summer.end, SGT), "4 to 8 am");
  const winter = usSegments(utc("2026-12-14T00:00:00Z"), utc("2026-12-15T00:00:00Z")).find((s) => s.kind === "after")!;
  assert.equal(span(winter.start, winter.end, IST), "2:30 to 6:30 am");
});

test("regular session is 9:30 to 16:00 New York on both sides of the March switch", () => {
  const fri = usSegments(utc("2026-03-06T12:00:00Z"), utc("2026-03-06T23:00:00Z")).find((s) => s.kind === "regular")!;
  const mon = usSegments(utc("2026-03-09T12:00:00Z"), utc("2026-03-09T23:00:00Z")).find((s) => s.kind === "regular")!;
  assert.equal(new Date(fri.start).toISOString(), "2026-03-06T14:30:00.000Z"); // EST
  assert.equal(new Date(mon.start).toISOString(), "2026-03-09T13:30:00.000Z"); // EDT
});

test("weekends and a listed holiday have no session", () => {
  assert.equal(usSegments(utc("2026-10-10T04:00:00Z"), utc("2026-10-11T23:00:00Z")).filter((s) => s.start >= utc("2026-10-10T04:00:00Z") && s.end <= utc("2026-10-11T23:00:00Z")).length, 0);
  assert.equal(phaseAt(utc("2026-07-03T15:00:00Z")), null); // Independence Day observed
  assert.equal(phaseAt(utc("2026-07-22T21:00:00Z")), "after"); // 5 pm EDT
  assert.equal(phaseAt(utc("2026-07-22T15:00:00Z")), "regular");
});

test("the night window keeps now inside on a weeknight and shifts forward on a Sunday", () => {
  const tue = nightWindow(utc("2026-10-13T14:30:00Z"), IST); // Tuesday 8 pm IST
  assert.equal(tue.nowInside, true);
  assert.equal(tue.weekendShift, false);
  assert.deepEqual(tue.segs.map((s) => s.kind), ["pre", "regular", "after"]);
  assert.ok(Math.abs(tue.nowP - (8 / 24)) < 1e-9, String(tue.nowP));

  const sun = nightWindow(utc("2026-10-11T13:31:00Z"), IST); // Sunday 7:01 pm IST
  assert.equal(sun.nowInside, false);
  assert.equal(sun.weekendShift, true);
  assert.equal(clock(sun.start, IST), "12 pm");
  assert.equal(new Date(sun.start).toISOString(), "2026-10-12T06:30:00.000Z"); // Monday noon IST
  assert.equal(sun.nowP, 0);
});

test("US trading inside the sleep hours: 6 h 30 m from Mumbai, 8 h from Singapore", () => {
  const now = utc("2026-10-13T14:30:00Z");
  assert.equal(duration(nightWindow(now, IST).sleepOverlapMs), "6 h 30 m");
  assert.equal(duration(nightWindow(now, SGT).sleepOverlapMs), "8 h");
  assert.equal(nightWindow(now, IST).end - nightWindow(now, IST).start, DAY);
  assert.equal(HOUR * 24, DAY);
});
