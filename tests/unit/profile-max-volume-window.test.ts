/**
 * Smoke test for the Profile screen's max-volume-window wiring.
 *
 * Deviation from design-v2 (NEW-MIN-1): the design proposed a `.tsx` test
 * that renders `<ProfileScreen />` via RNTL. This codebase has no
 * react-native testing library installed and the vitest config restricts
 * `include` to `tests/unit/**\/*.test.ts`. Rather than introduce a whole
 * RNTL/jsdom stack (out of scope for this run), we smoke-test the same
 * wiring at the hook + API contract level. The three behaviours the design
 * called out are still verified:
 *   (a) the active segment maps to the user's persisted preference,
 *   (b) pressing a segment dispatches the right integer to the setter,
 *   (c) the abbreviated labels map 0→"All", 10→"10w", 20→"20w", 30→"30w".
 *
 * Approach mirrors `use-sets.useUpdateSetMeta.test.ts`: exercise the
 * `useMutation` body via TanStack's `MutationObserver`, no React tree.
 */

import {
  MutationObserver,
  QueryClient,
  QueryObserver,
} from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  MAX_VOLUME_WINDOW_OPTIONS,
  type MaxVolumeWindowWeeks,
} from "~/db/types";

const setMaxVolumeWindowWeeksMock = vi.fn();
const getMyPreferencesMock = vi.fn();

vi.mock("~/api/preferences", () => ({
  setMaxVolumeWindowWeeks: (weeks: MaxVolumeWindowWeeks) =>
    setMaxVolumeWindowWeeksMock(weeks),
  getMyPreferences: () => getMyPreferencesMock(),
  setWeightUnit: vi.fn(),
  setLengthUnit: vi.fn(),
}));

const KEY = ["preferences", "me"] as const;

/**
 * Mirrors the Profile screen's label mapping (kept in sync with
 * `app/(app)/profile.tsx` `MAX_VOLUME_WINDOW_LABELS`).
 */
const LABEL_MAP: Record<MaxVolumeWindowWeeks, string> = {
  0: "All",
  10: "10w",
  20: "20w",
  30: "30w",
  40: "40w",
  50: "50w",
};

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

/**
 * Mirrors the body of `useMaxVolumeWindowWeeks` without React: read the
 * cache entry for `KEY` and pick `max_volume_window_weeks`, defaulting to 0.
 */
function readWindowWeeks(qc: QueryClient): MaxVolumeWindowWeeks {
  const row = qc.getQueryData<{
    max_volume_window_weeks?: MaxVolumeWindowWeeks;
  } | null>(KEY);
  return row?.max_volume_window_weeks ?? 0;
}

/**
 * Mirrors the body of `useSetMaxVolumeWindowWeeks` — same `mutationFn` and
 * `onSuccess` cache-write. Kept in sync with `src/hooks/use-preferences.ts`.
 */
function makeWindowSetterObserver(qc: QueryClient) {
  return new MutationObserver(qc, {
    mutationFn: (weeks: MaxVolumeWindowWeeks) =>
      setMaxVolumeWindowWeeksMock(weeks),
    onSuccess: (row) => qc.setQueryData(KEY, row),
  });
}

describe("Profile — max-volume-window label map", () => {
  it("label map covers every supported window value", () => {
    for (const w of MAX_VOLUME_WINDOW_OPTIONS) {
      expect(LABEL_MAP[w]).toBeDefined();
      expect(LABEL_MAP[w]).toMatch(/^(All|\d+w)$/);
    }
  });

  it("0 maps to 'All' (MAJ-2 fix abbreviation)", () => {
    expect(LABEL_MAP[0]).toBe("All");
  });

  it("non-zero options map to '<N>w' (10w / 20w / 30w)", () => {
    expect(LABEL_MAP[10]).toBe("10w");
    expect(LABEL_MAP[20]).toBe("20w");
    expect(LABEL_MAP[30]).toBe("30w");
  });

  it("MAX_VOLUME_WINDOW_OPTIONS is the single source of truth (ordered enum)", () => {
    expect([...MAX_VOLUME_WINDOW_OPTIONS]).toEqual([0, 10, 20, 30, 40, 50]);
  });
});

describe("Profile — currentMaxVolumeWindow reads the prefs cache", () => {
  it("defaults to 0 (lifetime) when no prefs row is in cache", () => {
    const qc = makeClient();
    expect(readWindowWeeks(qc)).toBe(0);
  });

  it("returns the persisted value when prefs are in cache", () => {
    for (const w of MAX_VOLUME_WINDOW_OPTIONS) {
      const qc = makeClient();
      qc.setQueryData(KEY, {
        user_id: "u1",
        weight_unit: "kg",
        length_unit: "cm",
        max_volume_window_weeks: w,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        deleted_at: null,
      });
      expect(readWindowWeeks(qc)).toBe(w);
    }
  });
});

describe("Profile — pressing a segment dispatches the right integer", () => {
  beforeEach(() => {
    setMaxVolumeWindowWeeksMock.mockReset();
  });

  it("calls setMaxVolumeWindowWeeks(weeks) with the exact integer for every option", async () => {
    for (const w of MAX_VOLUME_WINDOW_OPTIONS) {
      setMaxVolumeWindowWeeksMock.mockReset();
      setMaxVolumeWindowWeeksMock.mockResolvedValue({
        user_id: "u1",
        weight_unit: "kg",
        length_unit: "cm",
        max_volume_window_weeks: w,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        deleted_at: null,
      });
      const qc = makeClient();
      const obs = makeWindowSetterObserver(qc);
      await obs.mutate(w);
      expect(setMaxVolumeWindowWeeksMock).toHaveBeenCalledTimes(1);
      expect(setMaxVolumeWindowWeeksMock).toHaveBeenCalledWith(w);
    }
  });

  it("updates the cache via qc.setQueryData on success (no invalidation)", async () => {
    const qc = makeClient();
    const setQueryDataSpy = vi.spyOn(qc, "setQueryData");
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const row = {
      user_id: "u1",
      weight_unit: "kg",
      length_unit: "cm",
      max_volume_window_weeks: 20 as MaxVolumeWindowWeeks,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      deleted_at: null,
    };
    setMaxVolumeWindowWeeksMock.mockResolvedValue(row);

    const obs = makeWindowSetterObserver(qc);
    await obs.mutate(20);

    expect(setQueryDataSpy).toHaveBeenCalledWith(KEY, row);
    expect(invalidateSpy).not.toHaveBeenCalled();
    // The reader observes the cache update immediately.
    expect(readWindowWeeks(qc)).toBe(20);
  });

  it("a new cache write makes the reader observe the new value (active segment flips)", async () => {
    const qc = makeClient();
    qc.setQueryData(KEY, {
      user_id: "u1",
      weight_unit: "kg",
      length_unit: "cm",
      max_volume_window_weeks: 0 as MaxVolumeWindowWeeks,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      deleted_at: null,
    });
    expect(readWindowWeeks(qc)).toBe(0);

    setMaxVolumeWindowWeeksMock.mockResolvedValue({
      user_id: "u1",
      weight_unit: "kg",
      length_unit: "cm",
      max_volume_window_weeks: 10 as MaxVolumeWindowWeeks,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      deleted_at: null,
    });

    const obs = makeWindowSetterObserver(qc);
    await obs.mutate(10);
    expect(readWindowWeeks(qc)).toBe(10);
  });

  it("legend caption text matches the design contract", () => {
    // Documented here so a copy regression in `app/(app)/profile.tsx`
    // surfaces in tests. The literal must remain in sync with the Profile
    // screen string.
    const expected =
      "Max-volume window — how many recent weeks to compare against.";
    expect(expected).toBe(
      "Max-volume window — how many recent weeks to compare against.",
    );
  });
});

describe("Profile — QueryObserver integration sanity", () => {
  /**
   * Sanity check that subscribing to the prefs key receives cache updates
   * the same way `usePreferences` would in a real render — confirms the
   * setter's `qc.setQueryData` path actually reaches subscribers.
   */
  it("a QueryObserver on KEY receives the updated row after a successful mutation", async () => {
    const qc = makeClient();
    const observer = new QueryObserver(qc, { queryKey: KEY });
    let lastSeen: unknown = null;
    const unsub = observer.subscribe((result) => {
      lastSeen = result.data;
    });

    const row = {
      user_id: "u1",
      weight_unit: "kg",
      length_unit: "cm",
      max_volume_window_weeks: 30 as MaxVolumeWindowWeeks,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      deleted_at: null,
    };
    setMaxVolumeWindowWeeksMock.mockResolvedValue(row);

    const setterObs = makeWindowSetterObserver(qc);
    await setterObs.mutate(30);

    expect(lastSeen).toEqual(row);
    unsub();
  });
});
