import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

const STORAGE_KEY = "ada11.rest-timer";

type Persisted = {
  endsAt: number; // epoch ms
  totalSeconds: number;
};

type RestTimerValue = {
  running: boolean;
  remainingSeconds: number;
  totalSeconds: number | null;
  start: (seconds: number) => void;
  stop: () => void;
};

const RestTimerContext = createContext<RestTimerValue | undefined>(undefined);

/**
 * Client-side rest timer.
 *
 * Lifted to a React Context so the workout screen (where `start(rest)` is
 * called from set-check handlers) and the bottom overlay (where the running
 * state is rendered) share the same `useState` instance — calling
 * `useRestTimer()` as a plain hook in two components would otherwise yield
 * two independent state trees and the overlay would never observe a `start()`
 * fired from the screen.
 *
 * Persists end-time + duration to AsyncStorage so that:
 *  - on web: closing the tab and reopening within the rest window keeps the
 *    countdown ticking (state is recovered from storage on Provider mount)
 *  - on native: the timer survives app backgrounding the same way
 *
 * The actual remaining time is always recomputed from `endsAt - Date.now()`,
 * not from a counter, so backgrounding/sleeping doesn't drift the value.
 */
export function RestTimerProvider({ children }: { children: ReactNode }) {
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

  // No `useCallback`/`useMemo` here — the React Compiler (enabled in
  // `app.json`) handles memoization automatically. Manual memoization can
  // interact with the compiler in surprising ways, and we explicitly want a
  // fresh `value` reference whenever `endsAt`/`now`/`totalSeconds` change so
  // consumers re-render.
  const start = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    const ends = Date.now() + seconds * 1000;
    setEndsAt(ends);
    setTotalSeconds(seconds);
    AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ endsAt: ends, totalSeconds: seconds } satisfies Persisted),
    ).catch(() => {});
  };

  const stop = () => {
    setEndsAt(null);
    setTotalSeconds(null);
    AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
  };

  const remainingMs = endsAt == null ? 0 : Math.max(0, endsAt - now);
  const running = endsAt != null && remainingMs > 0;

  const value: RestTimerValue = {
    running,
    remainingSeconds: Math.ceil(remainingMs / 1000),
    totalSeconds,
    start,
    stop,
  };

  // `createElement` instead of JSX so this file stays `.ts` and doesn't need
  // to be renamed to `.tsx` (keeps the import path stable and avoids touching
  // any other call-site).
  return createElement(RestTimerContext.Provider, { value }, children);
}

export function useRestTimer(): RestTimerValue {
  const ctx = useContext(RestTimerContext);
  if (!ctx) {
    throw new Error(
      "useRestTimer must be used inside <RestTimerProvider>. Wrap the screen that needs the rest timer (and its overlay) with <RestTimerProvider>.",
    );
  }
  return ctx;
}
