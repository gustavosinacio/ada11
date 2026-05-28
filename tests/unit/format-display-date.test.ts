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
  it("renders dd/mm with no year for current-year dates", () => {
    // 2026-05-24T12:00:00Z → in BRT that's still May 24, 2026.
    expect(formatDisplayDate("2026-05-24T12:00:00Z")).toBe("24/05");
  });

  it("renders dd/mm/yy for prior-year dates", () => {
    expect(formatDisplayDate("2019-11-08T12:00:00Z")).toBe("08/11/19");
  });

  it("prepends the weekday when includeWeekday is true (current year)", () => {
    // 2026-05-23 is a Saturday — en-GB short weekday "Sat".
    expect(
      formatDisplayDate("2026-05-23T12:00:00Z", { includeWeekday: true }),
    ).toBe("Sat, 23/05");
  });

  it("includes weekday + 2-digit year for prior-year dates", () => {
    // 2019-11-08 is a Friday — en-GB "Fri".
    expect(
      formatDisplayDate("2019-11-08T12:00:00Z", { includeWeekday: true }),
    ).toBe("Fri, 08/11/19");
  });

  it("appends a 24h time when includeTime is true", () => {
    // BRT (UTC-3) of 19:30 UTC → 16:30 local. en-GB 24h time format.
    expect(
      formatDisplayDate("2026-05-18T19:30:00Z", {
        includeWeekday: true,
        includeTime: true,
      }),
    ).toBe("Mon, 18/05, 16:30");
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
    expect(formatDisplayDate(d)).toBe("24/05");
  });
});

describe("formatShortDate", () => {
  it("returns 'dd/mm' for current-year dates", () => {
    expect(formatShortDate("2026-05-24T12:00:00Z")).toBe("24/05");
  });

  it("returns 'dd/mm/yy' (2-digit year) by default for prior-year dates", () => {
    expect(formatShortDate("2025-11-08T12:00:00Z")).toBe("08/11/25");
  });

  it("returns 'dd/mm/yyyy' when yearFormat is 'numeric'", () => {
    expect(
      formatShortDate("2025-11-08T12:00:00Z", { yearFormat: "numeric" }),
    ).toBe("08/11/2025");
  });

  it("ignores yearFormat for current-year dates (still no year)", () => {
    expect(
      formatShortDate("2026-05-24T12:00:00Z", { yearFormat: "numeric" }),
    ).toBe("24/05");
  });

  it("falls back to '—' for an Invalid Date instance", () => {
    expect(formatShortDate(new Date("not-a-date"))).toBe("—");
  });

  it("falls back to ISO slice for an invalid string input", () => {
    expect(formatShortDate("not-an-iso-date-string")).toBe("not-an-iso");
  });

  it("accepts a Date instance directly", () => {
    const d = new Date("2026-05-24T12:00:00Z");
    expect(formatShortDate(d)).toBe("24/05");
  });
});
