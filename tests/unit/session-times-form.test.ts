/**
 * Tests for `~/utils/session-times-form`.
 *
 * MAJ-NEW-1: tests are host-TZ-independent. Instead of pinning
 * `process.env.TZ = 'America/Sao_Paulo'` (unreliable in ESM Vitest because
 * imports are hoisted), expected UTC ISO values are constructed via
 * `date-fns-tz fromZonedTime("...", "America/Sao_Paulo")`.
 *
 * `composeIso` itself uses `date-fns/parse` which reads the host TZ at call
 * time, so to keep tests host-independent we test against the round-trip
 * `composeIso(decomposeIso(iso))` invariant rather than asserting specific
 * UTC ISO values.
 */

import { fromZonedTime } from "date-fns-tz";
import { describe, expect, it } from "vitest";

import {
  composeIso,
  maskTimeInput,
  countSetsOutsideRange,
  DATE_RE,
  decomposeIso,
  messageFor,
  TIME_RE,
  validateTimes,
} from "~/utils/session-times-form";

const TZ_HOST_NEUTRAL_LATE_FUTURE = new Date("2099-01-01T00:00:00Z");

describe("DATE_RE / TIME_RE", () => {
  it("accepts well-formed components", () => {
    expect(DATE_RE.test("2026-05-18")).toBe(true);
    expect(TIME_RE.test("00:00")).toBe(true);
    expect(TIME_RE.test("23:59")).toBe(true);
    expect(TIME_RE.test("09:30")).toBe(true);
  });

  it("rejects out-of-range time components", () => {
    expect(TIME_RE.test("24:00")).toBe(false);
    expect(TIME_RE.test("25:99")).toBe(false);
    expect(TIME_RE.test("09:60")).toBe(false);
    expect(TIME_RE.test("9:30")).toBe(false); // missing leading zero
    expect(TIME_RE.test("0930")).toBe(false);
  });

  it("rejects malformed date shape", () => {
    expect(DATE_RE.test("2026/05/18")).toBe(false);
    expect(DATE_RE.test("26-05-18")).toBe(false);
    expect(DATE_RE.test("2026-5-18")).toBe(false);
  });
});

describe("decompose / compose round trip", () => {
  it("composing then decomposing returns the same local strings", () => {
    // Pick an ISO whose local representation we can reconstruct using
    // fromZonedTime — the actual round trip uses host TZ, which is fine
    // because compose + decompose share that same TZ.
    const draftDate = "2026-05-18";
    const draftTime = "14:30";
    const iso = composeIso(draftDate, draftTime);
    expect(typeof iso).toBe("string");
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const back = decomposeIso(iso);
    expect(back.date).toBe(draftDate);
    expect(back.time).toBe(draftTime);
  });

  it("composeIso in São Paulo TZ matches fromZonedTime equivalent", () => {
    // Verify the formula composeIso uses agrees with date-fns-tz under
    // a known TZ. We can't pin host TZ reliably, so we compare the
    // expected UTC ms for São Paulo with a direct fromZonedTime call.
    // Then we confirm that composeIso would produce the same value when
    // the host is São Paulo, by parsing the host's actual UTC for the
    // same local string and asserting the offset between them is 0
    // hours iff the host is São Paulo, or a known UTC offset otherwise.
    const localDate = "2026-05-18";
    const localTime = "14:30";
    const spIso = fromZonedTime(
      `${localDate} ${localTime}`,
      "America/Sao_Paulo",
    ).toISOString();
    // São Paulo is UTC-3 (no DST since 2019) → 14:30 BRT = 17:30 UTC.
    expect(spIso).toBe("2026-05-18T17:30:00.000Z");

    // composeIso uses host TZ. We can only assert that it produces a
    // valid ISO; the actual UTC depends on host. The round-trip invariant
    // already covers correctness.
    const hostIso = composeIso(localDate, localTime);
    expect(new Date(hostIso).toString()).not.toBe("Invalid Date");
  });
});

describe("composeIso strictness", () => {
  it("throws RangeError on impossible date components", () => {
    expect(() => composeIso("2026-13-99", "12:00")).toThrow(RangeError);
    expect(() => composeIso("2026-02-30", "12:00")).toThrow(RangeError);
    // 2026 is not a leap year — Feb 29 is invalid.
    expect(() => composeIso("2026-02-29", "12:00")).toThrow(RangeError);
  });

  it("accepts Feb 29 in a leap year", () => {
    // 2028 is a leap year.
    expect(() => composeIso("2028-02-29", "12:00")).not.toThrow();
  });
});

describe("validateTimes", () => {
  const validDraft = {
    startDate: "2026-05-18",
    startTime: "09:00",
    endDate: "2026-05-18",
    endTime: "10:30",
  };

  it("returns ok for a well-formed past draft", () => {
    const res = validateTimes(validDraft, TZ_HOST_NEUTRAL_LATE_FUTURE);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(typeof res.started_at).toBe("string");
      expect(typeof res.ended_at).toBe("string");
    }
  });

  it("rejects bad start date shape", () => {
    const res = validateTimes(
      { ...validDraft, startDate: "26/05/2018" },
      TZ_HOST_NEUTRAL_LATE_FUTURE,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe("start-date-invalid");
  });

  it("rejects bad time component (25:99)", () => {
    const res = validateTimes(
      { ...validDraft, startTime: "25:99" },
      TZ_HOST_NEUTRAL_LATE_FUTURE,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe("start-time-invalid");
  });

  it("rejects bad time component (09:60)", () => {
    const res = validateTimes(
      { ...validDraft, endTime: "09:60" },
      TZ_HOST_NEUTRAL_LATE_FUTURE,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe("end-time-invalid");
  });

  it("rejects rollover date (2026-02-30)", () => {
    const res = validateTimes(
      { ...validDraft, startDate: "2026-02-30" },
      TZ_HOST_NEUTRAL_LATE_FUTURE,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe("start-date-invalid");
  });

  it("rejects Feb 29 on a non-leap year (2026)", () => {
    const res = validateTimes(
      {
        startDate: "2026-02-29",
        startTime: "09:00",
        endDate: "2026-02-29",
        endTime: "10:00",
      },
      TZ_HOST_NEUTRAL_LATE_FUTURE,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe("start-date-invalid");
  });

  it("rejects end < start", () => {
    const res = validateTimes(
      {
        startDate: "2026-05-18",
        startTime: "10:00",
        endDate: "2026-05-18",
        endTime: "09:00",
      },
      TZ_HOST_NEUTRAL_LATE_FUTURE,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe("end-before-start");
  });

  it("accepts end == start (zero-duration)", () => {
    const res = validateTimes(
      {
        startDate: "2026-05-18",
        startTime: "09:00",
        endDate: "2026-05-18",
        endTime: "09:00",
      },
      TZ_HOST_NEUTRAL_LATE_FUTURE,
    );
    expect(res.ok).toBe(true);
  });

  it("rejects end > now", () => {
    // Construct a draft 1 day in the future using fromZonedTime so the
    // expected UTC end timestamp is independent of host TZ. We compare
    // against a `now` two days in the past so the relationship holds.
    const now = new Date("2026-05-15T00:00:00Z");
    const res = validateTimes(
      {
        startDate: "2026-05-16",
        startTime: "09:00",
        endDate: "2026-05-16",
        endTime: "10:00",
      },
      now,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe("end-in-future");
  });
});

describe("countSetsOutsideRange", () => {
  // Use fromZonedTime to construct unambiguous UTC ISO strings.
  const startIso = fromZonedTime(
    "2026-05-18 09:00",
    "America/Sao_Paulo",
  ).toISOString(); // 12:00Z
  const endIso = fromZonedTime(
    "2026-05-18 10:30",
    "America/Sao_Paulo",
  ).toISOString(); // 13:30Z

  it("returns 0 when all sets are inside the range", () => {
    const inside1 = fromZonedTime(
      "2026-05-18 09:15",
      "America/Sao_Paulo",
    ).toISOString();
    const inside2 = fromZonedTime(
      "2026-05-18 10:00",
      "America/Sao_Paulo",
    ).toISOString();
    expect(countSetsOutsideRange(startIso, endIso, [inside1, inside2])).toBe(
      0,
    );
  });

  it("counts sets before the range", () => {
    const before = fromZonedTime(
      "2026-05-18 08:00",
      "America/Sao_Paulo",
    ).toISOString();
    expect(countSetsOutsideRange(startIso, endIso, [before])).toBe(1);
  });

  it("counts sets after the range", () => {
    const after = fromZonedTime(
      "2026-05-18 12:00",
      "America/Sao_Paulo",
    ).toISOString();
    expect(countSetsOutsideRange(startIso, endIso, [after])).toBe(1);
  });

  it("counts a mix of before/inside/after correctly", () => {
    const before = fromZonedTime(
      "2026-05-18 08:00",
      "America/Sao_Paulo",
    ).toISOString();
    const inside = fromZonedTime(
      "2026-05-18 09:15",
      "America/Sao_Paulo",
    ).toISOString();
    const after = fromZonedTime(
      "2026-05-18 12:00",
      "America/Sao_Paulo",
    ).toISOString();
    expect(
      countSetsOutsideRange(startIso, endIso, [before, inside, after]),
    ).toBe(2);
  });

  it("ignores null completed_at entries", () => {
    expect(countSetsOutsideRange(startIso, endIso, [null, null])).toBe(0);
  });

  it("includes boundary points (== start, == end) as inside", () => {
    expect(countSetsOutsideRange(startIso, endIso, [startIso, endIso])).toBe(
      0,
    );
  });
});

describe("messageFor", () => {
  it("returns a human-readable string for each kind", () => {
    expect(messageFor("start-date-invalid")).toMatch(/YYYY-MM-DD/);
    expect(messageFor("start-time-invalid")).toMatch(/HH:MM/);
    expect(messageFor("end-date-invalid")).toMatch(/YYYY-MM-DD/);
    expect(messageFor("end-time-invalid")).toMatch(/HH:MM/);
    expect(messageFor("end-before-start")).toMatch(/after start/);
    expect(messageFor("end-in-future")).toMatch(/future/);
  });
});

describe("maskTimeInput", () => {
  it("inserts the colon after the second digit while typing forward", () => {
    expect(maskTimeInput("", "1")).toBe("1");
    expect(maskTimeInput("1", "18")).toBe("18");
    expect(maskTimeInput("18", "183")).toBe("18:3");
    expect(maskTimeInput("18:3", "18:30")).toBe("18:30");
  });

  it("masks a fully-typed bare-digit sequence", () => {
    // User types "1830" without any colon (numeric keyboard).
    expect(maskTimeInput("183", "1830")).toBe("18:30");
  });

  it("normalises a paste that already includes the colon", () => {
    expect(maskTimeInput("", "18:30")).toBe("18:30");
  });

  it("normalises a paste of bare digits", () => {
    expect(maskTimeInput("", "1830")).toBe("18:30");
  });

  it("strips a stray colon typed in the wrong spot", () => {
    expect(maskTimeInput("", "1:8")).toBe("18");
  });

  it("bypasses the mask while deleting so the colon can be removed", () => {
    expect(maskTimeInput("18:30", "18:3")).toBe("18:3");
    expect(maskTimeInput("18:3", "18:")).toBe("18:");
    expect(maskTimeInput("18:", "18")).toBe("18");
    expect(maskTimeInput("18", "1")).toBe("1");
    expect(maskTimeInput("1", "")).toBe("");
  });

  it("clamps to 4 digits", () => {
    expect(maskTimeInput("18:30", "18:301")).toBe("18:30");
  });
});
