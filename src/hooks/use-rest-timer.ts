import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "ada11.rest-timer";

type Persisted = {
  endsAt: number; // epoch ms
  totalSeconds: number;
};

/**
 * Client-side rest timer.
 *
 * Persists end-time + duration to AsyncStorage so that:
 *  - on web: closing the tab and reopening within the rest window keeps the
 *    countdown ticking (state is recovered from storage)
 *  - on native: the timer survives app backgrounding the same way
 *
 * The actual remaining time is always recomputed from `endsAt - Date.now()`,
 * not from a counter, so backgrounding/sleeping doesn't drift the value.
 */
export function useRestTimer() {
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [totalSeconds, setTotalSeconds] = useState<number | null>(null);
  const [now, setNow] = useState<number>(Date.now());
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Hydrate from storage on mount.
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (cancelled || !raw) return;
        try {
          const parsed = JSON.parse(raw) as Persisted;
          if (parsed.endsAt > Date.now()) {
            setEndsAt(parsed.endsAt);
            setTotalSeconds(parsed.totalSeconds);
          } else {
            // Expired — clear it.
            AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
          }
        } catch {
          AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Tick while running.
  useEffect(() => {
    if (endsAt == null) {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
      return;
    }
    setNow(Date.now());
    tickRef.current = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= endsAt) {
        if (tickRef.current) clearInterval(tickRef.current);
        tickRef.current = null;
      }
    }, 250);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
    };
  }, [endsAt]);

  const start = useCallback((seconds: number) => {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    const ends = Date.now() + seconds * 1000;
    setEndsAt(ends);
    setTotalSeconds(seconds);
    AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ endsAt: ends, totalSeconds: seconds } satisfies Persisted),
    ).catch(() => {});
  }, []);

  const stop = useCallback(() => {
    setEndsAt(null);
    setTotalSeconds(null);
    AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
  }, []);

  const remainingMs = endsAt == null ? 0 : Math.max(0, endsAt - now);
  const running = endsAt != null && remainingMs > 0;

  return {
    running,
    remainingSeconds: Math.ceil(remainingMs / 1000),
    totalSeconds,
    start,
    stop,
  };
}
