import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  isoWeekContaining,
  isoWeekStart,
  isoWeeksBetween,
  lastNIsoWeeks,
  parseISO,
  weekKeyOf,
} from "~/utils/dates";

// Pin "now" so year-conditional label assertions stay stable across calendar
// years. `lastNIsoWeeks` and `isoWeekContaining` derive their `label` via
// `formatShortDate`, which appends a year suffix once the bucket's calendar
// year differs from the current local year. Without this, the
// `/^\d{1,2}\/\d{1,2}$/` regex assertions below start failing once we cross
// into 2027 because all the fixture weeks are anchored in 2026.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-22T12:00:00-03:00"));
});

afterEach(() => {
  vi.useRealTimers();
});

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

describe("isoWeekContaining", () => {
  it("returns the same Monday as isoWeekStart for the same input", () => {
    const wed = new Date(2026, 4, 13, 14, 30, 0);
    const wk = isoWeekContaining(wed);
    expect(wk.start.getTime()).toBe(isoWeekStart(wed).getTime());
  });

  it("agrees with weekKeyOf for any day in the same ISO week", () => {
    const days = [
      new Date(2026, 4, 11, 0, 0, 0),
      new Date(2026, 4, 13, 14, 0, 0),
      new Date(2026, 4, 17, 23, 59, 0),
    ];
    const keys = days.map((d) => isoWeekContaining(d).key);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe(weekKeyOf(days[0]!));
  });

  it("handles mid-week input and returns full IsoWeek shape", () => {
    const wed = new Date(2026, 4, 13, 14, 30, 0); // Wed of 2026-W20
    const wk = isoWeekContaining(wed);
    expect(wk.start.getDate()).toBe(11); // Mon 5/11
    expect(wk.end.getDay()).toBe(0); // Sunday
    expect(wk.label).toMatch(/^\d{1,2}\/\d{1,2}$/);
    expect(wk.key).toMatch(/^\d{4}-W\d{2}$/);
  });

  it("crosses an ISO-week-1-of-year boundary correctly (Jan 1 in W53/W1)", () => {
    // 2026-01-01 is a Thursday → ISO week 1 of 2026 (Mon Dec 29 2025).
    const jan1 = new Date(2026, 0, 1, 12, 0, 0);
    const wk = isoWeekContaining(jan1);
    expect(wk.start.getFullYear()).toBe(2025);
    expect(wk.start.getMonth()).toBe(11); // December
    expect(wk.start.getDate()).toBe(29);
  });
});

describe("isoWeeksBetween", () => {
  it("returns [] when end < start", () => {
    const a = new Date(2026, 4, 11);
    const b = new Date(2026, 4, 4);
    expect(isoWeeksBetween(a, b)).toEqual([]);
  });

  it("returns a single week when start === end", () => {
    const mon = new Date(2026, 4, 11); // Mon 5/11
    const weeks = isoWeeksBetween(mon, mon);
    expect(weeks.length).toBe(1);
    expect(weeks[0]!.start.getDate()).toBe(11);
  });

  it("returns 3 contiguous weeks for a 14-day span", () => {
    const start = new Date(2026, 4, 4); // Mon 5/4
    const end = new Date(2026, 4, 18); // Mon 5/18
    const weeks = isoWeeksBetween(start, end);
    expect(weeks.length).toBe(3);
    expect(weeks[0]!.start.getDate()).toBe(4);
    expect(weeks[1]!.start.getDate()).toBe(11);
    expect(weeks[2]!.start.getDate()).toBe(18);
  });

  it("returns 5 contiguous weeks for a 28-day span", () => {
    const start = new Date(2026, 3, 27); // Mon 4/27
    const end = new Date(2026, 4, 25); // Mon 5/25
    const weeks = isoWeeksBetween(start, end);
    expect(weeks.length).toBe(5);
    // Monotonically increasing.
    for (let i = 1; i < weeks.length; i++) {
      expect(weeks[i]!.start.getTime()).toBeGreaterThan(
        weeks[i - 1]!.start.getTime(),
      );
    }
    // Each entry is exactly 7 days after the previous Monday.
    for (let i = 1; i < weeks.length; i++) {
      const diff =
        weeks[i]!.start.getTime() - weeks[i - 1]!.start.getTime();
      // Account for DST jitter ±1h — accept any value within 6.9..7.1 days.
      const diffDays = diff / 86400000;
      expect(diffDays).toBeGreaterThan(6.9);
      expect(diffDays).toBeLessThan(7.1);
    }
  });

  it("handles year-boundary ranges (Dec → Jan)", () => {
    const start = new Date(2025, 11, 22); // Mon 2025-12-22
    const end = new Date(2026, 0, 12); // Mon 2026-01-12
    const weeks = isoWeeksBetween(start, end);
    expect(weeks.length).toBe(4);
    expect(weeks[0]!.start.getFullYear()).toBe(2025);
    expect(weeks[weeks.length - 1]!.start.getFullYear()).toBe(2026);
    // Keys are unique across the year boundary.
    const keys = weeks.map((w) => w.key);
    expect(new Set(keys).size).toBe(weeks.length);
  });

  it("normalises non-Monday inputs by snapping to that week's Monday", () => {
    // Wed of week A → Sun of week B should expand to [A, B-inclusive] weeks.
    const wedA = new Date(2026, 4, 13); // Wed of 2026-W20
    const sunB = new Date(2026, 4, 24); // Sun of 2026-W21
    const weeks = isoWeeksBetween(wedA, sunB);
    expect(weeks.length).toBe(2);
    expect(weeks[0]!.start.getDate()).toBe(11);
    expect(weeks[1]!.start.getDate()).toBe(18);
  });
});

describe("parseISO re-export", () => {
  it("parses an ISO 8601 string into a Date", () => {
    const d = parseISO("2026-05-13T14:30:00Z");
    expect(d).toBeInstanceOf(Date);
    expect(d.getTime()).toBe(Date.UTC(2026, 4, 13, 14, 30, 0));
  });
});
