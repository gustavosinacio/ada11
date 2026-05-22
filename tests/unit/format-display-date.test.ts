import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  formatDisplayDate,
  formatShortDate,
} from "~/utils/format-display-date";

// Pin "now" so "current year" is deterministic across CI runs. Anchored at
// 2026-05-22 12:00 BRT (matches the design's choice + the project's BRT
// convention).
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-22T12:00:00-03:00"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("formatDisplayDate", () => {
  it("renders month + day with no year for current-year dates", () => {
    // 2026-05-24T12:00:00Z → in BRT that's still May 24, 2026.
    const out = formatDisplayDate("2026-05-24T12:00:00Z");
    // Locale-dependent — we only assert the YEAR is absent and the month/day
    // are present so the test passes on any en-* host locale.
    expect(out).not.toMatch(/2026/);
    expect(out).toMatch(/24/);
  });

  it("appends the year for prior-year dates", () => {
    const out = formatDisplayDate("2019-11-08T12:00:00Z");
    expect(out).toMatch(/2019/);
    expect(out).toMatch(/8/);
  });

  it("prepends the weekday when includeWeekday is true (current year)", () => {
    const out = formatDisplayDate("2026-05-23T12:00:00Z", {
      includeWeekday: true,
    });
    // Saturday — short weekday names start with "S" in every western locale,
    // but the safer assertion is "there's a comma" (weekday prefix shape).
    expect(out).toContain(",");
    expect(out).not.toMatch(/2026/);
  });

  it("includes weekday + year for prior-year dates", () => {
    const out = formatDisplayDate("2019-11-08T12:00:00Z", {
      includeWeekday: true,
    });
    expect(out).toMatch(/2019/);
    expect(out.split(",").length).toBeGreaterThanOrEqual(2); // weekday, ..., year
  });

  it("appends a locale-formatted time when includeTime is true", () => {
    const out = formatDisplayDate("2026-05-18T19:30:00Z", {
      includeWeekday: true,
      includeTime: true,
    });
    // BRT (UTC-3) of 19:30 UTC → 16:30 local. Match either 12h or 24h shape
    // so the test passes on en-US AND pt-BR / fr-FR hosts.
    expect(out).toMatch(/(4:30|16:30)/);
  });

  it("falls back to '—' for an Invalid Date instance", () => {
    expect(formatDisplayDate(new Date("not-a-date"))).toBe("—");
  });

  it("falls back to ISO slice for an invalid string input", () => {
    // 10-char slice of the original input. Matches the existing
    // `measurement-list-item.tsx` inline fallback.
    expect(formatDisplayDate("not-an-iso-date-string")).toBe("not-an-iso");
  });

  it("accepts a Date instance directly", () => {
    const d = new Date("2026-05-24T12:00:00Z");
    const out = formatDisplayDate(d);
    expect(out).toMatch(/24/);
    expect(out).not.toMatch(/2026/);
  });
});

describe("formatShortDate", () => {
  it("returns 'M/D' for current-year dates", () => {
    expect(formatShortDate("2026-05-24T12:00:00Z")).toBe("5/24");
  });

  it("returns 'M/D/YY' (2-digit year) by default for prior-year dates", () => {
    expect(formatShortDate("2025-11-08T12:00:00Z")).toBe("11/8/25");
  });

  it("returns 'M/D/YYYY' when yearFormat is 'numeric'", () => {
    expect(
      formatShortDate("2025-11-08T12:00:00Z", { yearFormat: "numeric" }),
    ).toBe("11/8/2025");
  });

  it("ignores yearFormat for current-year dates (still no year)", () => {
    expect(
      formatShortDate("2026-05-24T12:00:00Z", { yearFormat: "numeric" }),
    ).toBe("5/24");
  });

  it("falls back to '—' for an Invalid Date instance", () => {
    expect(formatShortDate(new Date("not-a-date"))).toBe("—");
  });

  it("falls back to ISO slice for an invalid string input", () => {
    expect(formatShortDate("not-an-iso-date-string")).toBe("not-an-iso");
  });

  it("accepts a Date instance directly", () => {
    const d = new Date("2026-05-24T12:00:00Z");
    expect(formatShortDate(d)).toBe("5/24");
  });
});
