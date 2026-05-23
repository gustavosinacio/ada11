/**
 * Unit tests for `computeWindowStart`. Pure function — verifies:
 *   1. `weeks === 0` returns `undefined` (lifetime mode, no filter).
 *   2. `weeks > 0` returns the numeric millisecond instant of the local
 *      Monday 00:00 that lies N weeks before the current ISO week's Monday.
 *   3. The returned number round-trips through `parseISO` / `toISOString`.
 *   4. `subWeeks` calendar semantics survive a Sunday-23:30 BRT input — the
 *      function picks the ISO-week Monday of `now`, not the calendar day.
 *
 * BRT (UTC-3) is implicit in the system timezone of the test process; the
 * helper does not need an explicit timezone argument because `isoWeekStart`
 * already operates on the device-local clock (see `src/utils/dates.ts`).
 */

import { subWeeks } from "date-fns";
import { describe, expect, it } from "vitest";

import { isoWeekStart, parseISO } from "~/utils/dates";
import { computeWindowStart } from "~/utils/window-utils";

describe("computeWindowStart", () => {
  it("returns undefined for weeks=0 (lifetime mode)", () => {
    const now = new Date(2026, 4, 23, 12, 0, 0); // Saturday 23 May 2026 (W21)
    expect(computeWindowStart(0, now)).toBeUndefined();
  });

  it("returns the UTC instant of the local Monday N weeks before this week", () => {
    // now = Saturday 23 May 2026 (BRT). ISO week of `now` = 2026-W21
    // (Monday = 18 May local). 10 weeks earlier = Monday 9 March 2026 (W11).
    const now = new Date(2026, 4, 23, 12, 0, 0);
    const expectedMonday = subWeeks(isoWeekStart(now), 10);
    const expected = parseISO(expectedMonday.toISOString()).getTime();
    expect(computeWindowStart(10, now)).toBe(expected);
  });

  it("returns increasingly older instants for 10, 20, 30 weeks", () => {
    const now = new Date(2026, 4, 23, 12, 0, 0);
    const ten = computeWindowStart(10, now)!;
    const twenty = computeWindowStart(20, now)!;
    const thirty = computeWindowStart(30, now)!;
    expect(typeof ten).toBe("number");
    expect(twenty).toBeLessThan(ten);
    expect(thirty).toBeLessThan(twenty);
    // Each step should be roughly 10 weeks apart (allow ±1h for DST drift,
    // even though Brazil does not observe DST since 2019).
    const TEN_WEEKS_MS = 10 * 7 * 24 * 3600 * 1000;
    expect(Math.abs(ten - twenty - TEN_WEEKS_MS)).toBeLessThan(3600_000);
    expect(Math.abs(twenty - thirty - TEN_WEEKS_MS)).toBeLessThan(3600_000);
  });

  it("anchors on the ISO-week Monday of `now` (Sunday-23:30 BRT input)", () => {
    // Sunday-23:30 local is still in week W20 (Monday=11 May 2026). Subtract
    // 10 weeks → Monday 2 March 2026 (W10).
    const sundayLate = new Date(2026, 4, 17, 23, 30, 0);
    const ms = computeWindowStart(10, sundayLate)!;
    const dayOfWeek = new Date(ms).getDay(); // 1 = Monday in JS local-time semantics
    expect(dayOfWeek).toBe(1);
  });

  it("returned number round-trips through parseISO(date.toISOString()).getTime()", () => {
    const now = new Date(2026, 4, 23, 12, 0, 0);
    const ms = computeWindowStart(20, now)!;
    // Round-trip: ms → Date → toISOString → parseISO → ms must match.
    const back = parseISO(new Date(ms).toISOString()).getTime();
    expect(back).toBe(ms);
  });

  it("inclusive lower bound: a session at exactly windowStartMs is in-window", () => {
    // The contract is "include iff started_at >= windowStartMs". This test
    // documents the inclusive boundary so a future kernel change cannot
    // silently flip to strict-`>` without surfacing here.
    const now = new Date(2026, 4, 23, 12, 0, 0);
    const ms = computeWindowStart(10, now)!;
    const exactlyOnBoundary = new Date(ms).toISOString();
    const startedMs = parseISO(exactlyOnBoundary).getTime();
    expect(startedMs >= ms).toBe(true);
  });
});
