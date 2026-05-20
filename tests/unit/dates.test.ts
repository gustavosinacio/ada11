import { describe, expect, it } from "vitest";

import { isoWeekStart, lastNIsoWeeks, weekKeyOf, parseISO } from "~/utils/dates";

describe("isoWeekStart", () => {
  it("returns Monday 00:00 for any day in the ISO week", () => {
    // 2026-05-13 is Wednesday; ISO Monday should be 2026-05-11.
    const wed = new Date(2026, 4, 13, 14, 30, 0); // local time
    const mon = isoWeekStart(wed);
    expect(mon.getDay()).toBe(1); // 1 = Monday
    expect(mon.getDate()).toBe(11);
    expect(mon.getMonth()).toBe(4);
    expect(mon.getFullYear()).toBe(2026);
    expect(mon.getHours()).toBe(0);
    expect(mon.getMinutes()).toBe(0);
  });

  it("treats a Monday as itself", () => {
    const mon = new Date(2026, 4, 11, 10, 0, 0);
    const start = isoWeekStart(mon);
    expect(start.getDate()).toBe(11);
    expect(start.getHours()).toBe(0);
  });

  it("rolls Sunday to the previous Monday (ISO-week semantics)", () => {
    // 2026-05-17 is Sunday; ISO Monday is 2026-05-11.
    const sun = new Date(2026, 4, 17, 23, 30, 0);
    const mon = isoWeekStart(sun);
    expect(mon.getDate()).toBe(11);
    expect(mon.getDay()).toBe(1);
  });
});

describe("weekKeyOf", () => {
  it("returns 'YYYY-Www' for any day in the same ISO week", () => {
    // Any day in 2026-W20 (May 11-17) should produce '2026-W20'.
    const days = [
      new Date(2026, 4, 11, 0, 0, 0),
      new Date(2026, 4, 13, 14, 0, 0),
      new Date(2026, 4, 17, 23, 59, 0),
    ];
    const keys = days.map(weekKeyOf);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toMatch(/^2026-W\d{2}$/);
  });

  it("changes key when crossing into the next Monday", () => {
    const sunNight = new Date(2026, 4, 17, 23, 30, 0); // Sunday of W20
    const monMorning = new Date(2026, 4, 18, 6, 0, 0); // Monday of W21
    expect(weekKeyOf(sunNight)).not.toBe(weekKeyOf(monMorning));
  });

  it("agrees with lastNIsoWeeks key generation", () => {
    // Pick any day; its weekKeyOf must equal the key of the bucket that
    // contains it in lastNIsoWeeks. This is the invariant that makes bucket
    // assignment correct.
    const now = new Date(2026, 4, 14, 12, 0, 0); // Thursday
    const weeks = lastNIsoWeeks(8, now);
    const currentKey = weeks[weeks.length - 1]!.key;
    expect(weekKeyOf(now)).toBe(currentKey);
  });
});

describe("lastNIsoWeeks", () => {
  it("returns exactly n entries", () => {
    expect(lastNIsoWeeks(8).length).toBe(8);
    expect(lastNIsoWeeks(1).length).toBe(1);
    expect(lastNIsoWeeks(12).length).toBe(12);
  });

  it("returns weeks oldest -> newest", () => {
    const weeks = lastNIsoWeeks(8);
    for (let i = 1; i < weeks.length; i++) {
      expect(weeks[i]!.start.getTime()).toBeGreaterThan(
        weeks[i - 1]!.start.getTime(),
      );
    }
  });

  it("the newest entry contains `now`", () => {
    const now = new Date(2026, 4, 14, 12, 0, 0);
    const weeks = lastNIsoWeeks(8, now);
    const last = weeks[weeks.length - 1]!;
    expect(now.getTime()).toBeGreaterThanOrEqual(last.start.getTime());
    expect(now.getTime()).toBeLessThanOrEqual(last.end.getTime());
  });

  it("each entry spans exactly one week (Monday->Sunday)", () => {
    const weeks = lastNIsoWeeks(8);
    for (const w of weeks) {
      expect(w.start.getDay()).toBe(1); // Mon
      expect(w.end.getDay()).toBe(0); // Sun
      // end is end-of-week (Sunday 23:59:59.999), start is Monday 00:00:00.000.
      // diff is just under 7 days.
      const diffDays = (w.end.getTime() - w.start.getTime()) / 86400000;
      expect(diffDays).toBeGreaterThan(6.9);
      expect(diffDays).toBeLessThan(7);
    }
  });

  it("labels are in 'M/d' format", () => {
    const weeks = lastNIsoWeeks(8);
    for (const w of weeks) {
      expect(w.label).toMatch(/^\d{1,2}\/\d{1,2}$/);
    }
  });

  it("keys are unique within the window", () => {
    const weeks = lastNIsoWeeks(8);
    const keys = weeks.map((w) => w.key);
    expect(new Set(keys).size).toBe(8);
  });
});

describe("parseISO re-export", () => {
  it("parses an ISO 8601 string into a Date", () => {
    const d = parseISO("2026-05-13T14:30:00Z");
    expect(d).toBeInstanceOf(Date);
    expect(d.getTime()).toBe(Date.UTC(2026, 4, 13, 14, 30, 0));
  });
});
