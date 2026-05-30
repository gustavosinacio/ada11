import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Calculator, Plus } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";

import { ChooseActionModal } from "~/components/choose-action-modal";
import { ExerciseBlock } from "~/components/exercise-block";
import { ExercisePicker } from "~/components/exercise-picker";
import { PlateCalculator } from "~/components/plate-calculator";
import { RestTimerOverlay } from "~/components/rest-timer-overlay";
import { SessionHeader } from "~/components/session-header";
import { confirmDelete } from "~/components/confirm-delete";
import type { ExerciseRow, SetRow } from "~/db/types";
import { useAllExercises } from "~/hooks/use-exercises";
import { useWeightUnit } from "~/hooks/use-preferences";
import { RestTimerProvider, useRestTimer } from "~/hooks/use-rest-timer";
import { useRoutineExercises } from "~/hooks/use-routine-exercises";
import {
  useFinishSession,
  useSession,
  useSoftDeleteSession,
} from "~/hooks/use-sessions";
import {
  useBulkCheckAllInSession,
  useBulkSoftDeleteUncheckedInSession,
  useCheckSet,
  useDeleteSet,
  useLogSet,
  useRemoveExerciseFromSession,
  useSetsForSession,
  useUncheckSet,
  useUpdateSet,
  useUpdateSetMeta,
} from "~/hooks/use-sets";
import { useMeasurements } from "~/hooks/use-measurements";
import { bodyweightKgAsOf } from "~/utils/bodyweight";
import { parseISO } from "~/utils/dates";
import { computeAutoFillPayload } from "~/utils/auto-fill-set";
import { sumLiveVolume } from "~/utils/volume-target";

export default function LiveWorkoutScreen() {
  // Provider wraps the screen body so `useRestTimer()` in both
  // `LiveWorkoutScreenInner` (set-check handlers, add-set handler) and the
  // `<RestTimerOverlay>` rendered inside read from the same state instance.
  // Without this, each `useRestTimer()` call would create its own `useState`
  // tree and `restTimer.start(rest)` would never propagate to the overlay.
  return (
    <RestTimerProvider>
      <LiveWorkoutScreenInner />
    </RestTimerProvider>
  );
}

function LiveWorkoutScreenInner() {
  const router = useRouter();
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();

  const session = useSession(sessionId);
  const finish = useFinishSession();
  const cancelSession = useSoftDeleteSession();

  // Include soft-deleted exercises so blocks don't disappear mid-session if a
  // user soft-deletes from /exercises/[id] while a session is open, and so the
  // routine-exercises embedded join (which doesn't filter deleted_at) still
  // resolves to a row in exMap. Picker (ExercisePicker below) keeps the
  // filtered `useExercises()` so the deleted row can't be re-added.
  const exercisesQ = useAllExercises();
  const measurementsQ = useMeasurements();
  const setsQ = useSetsForSession(sessionId);
  const logSet = useLogSet(sessionId ?? "");
  const updateSet = useUpdateSet(sessionId ?? "");
  const updateSetMeta = useUpdateSetMeta(sessionId ?? "");
  const deleteSet = useDeleteSet(sessionId ?? "");
  const removeExerciseFromSession = useRemoveExerciseFromSession(sessionId ?? "");
  const checkSetM = useCheckSet(sessionId ?? "");
  const uncheckSetM = useUncheckSet(sessionId ?? "");
  const bulkCheckAll = useBulkCheckAllInSession(sessionId ?? "");
  const bulkDiscardUnchecked = useBulkSoftDeleteUncheckedInSession(sessionId ?? "");
  const unit = useWeightUnit();

  // Live session-wide total volume (kg). Re-computed only when the sets
  // cache flips — the 1-second elapsed-clock rerender inside
  // `<SessionHeader>` does NOT trigger this reduce. Mirrors the verdict
  // screen's gold-standard precedent at `verdict/[sessionId].tsx:53-56`.
  // `sumLiveVolume` enforces F10 "checked = committed": warmups out,
  // dropsets in, unchecked drafts out — so the live header total agrees
  // with the post-Finish verdict by construction.
  // exercise_id → equipment, for the bodyweight-aware live-volume kernel.
  const equipmentByExerciseId = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of exercisesQ.data ?? []) {
      if (e.equipment != null) map.set(e.id, e.equipment);
    }
    return map;
  }, [exercisesQ.data]);

  const totalVolumeKg = useMemo(() => {
    const startedAt = session.data?.started_at;
    if (!startedAt) return sumLiveVolume(setsQ.data ?? []);
    const bodyweightKg = bodyweightKgAsOf(
      measurementsQ.data,
      parseISO(startedAt).getTime(),
    );
    return sumLiveVolume(setsQ.data ?? [], {
      equipmentByExerciseId,
      bodyweightKg,
    });
  }, [setsQ.data, session.data?.started_at, measurementsQ.data, equipmentByExerciseId]);

  const routineExercisesQ = useRoutineExercises(session.data?.routine_id ?? undefined);
  const restTimer = useRestTimer();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [plateCalcOpen, setPlateCalcOpen] = useState(false);
  const [finishModalOpen, setFinishModalOpen] = useState(false);
  const [adHocExerciseIds, setAdHocExerciseIds] = useState<string[]>([]);
  // User-controlled exercise ordering for this session. Null = use derived
  // default (routine order → first-logged order → ad-hoc order). Non-null
  // means the user explicitly reordered; we honor that, with any new
  // exercises (added via picker or first-logged) appended to the end.
  // Not persisted across reloads — same scope as adHocExerciseIds.
  const [exerciseOrderOverride, setExerciseOrderOverride] = useState<
    string[] | null
  >(null);
  // Client-only suppression of exercises the user removed mid-session.
  // Not persisted: a reload re-exposes routine-sourced exercises with no sets.
  // Same lifecycle as adHocExerciseIds / exerciseOrderOverride.
  const [removedExerciseIds, setRemovedExerciseIds] = useState<Set<string>>(
    () => new Set(),
  );
  // Set IDs whose check/uncheck mutation is in flight. Drives the per-set
  // spinner + disabled press in <SetInput> so the user can't re-toggle a set
  // until its background save settles (the optimistic green flip is still
  // instant — this is a "saving" affordance on top of it).
  const [pendingCheckIds, setPendingCheckIds] = useState<Set<string>>(
    () => new Set(),
  );

  // Map exercise_id -> target_rest_seconds (from the routine, if any).
  const restByExercise = useMemo(() => {
    const map = new Map<string, number>();
    for (const re of routineExercisesQ.data ?? []) {
      if (re.target_rest_seconds && re.target_rest_seconds > 0) {
        map.set(re.exercise_id, re.target_rest_seconds);
      }
    }
    return map;
  }, [routineExercisesQ.data]);

  // Observer-based rest-timer auto-start. We can't safely rely on the
  // optimistic click-time path alone: react-native-web's `Pressable` wires
  // its `onPress` through a `useRef`/`useEffect` cycle (see
  // `react-native-web/dist/cjs/modules/usePressEvents/index.js`), which on
  // very fast successive clicks (e.g. Playwright firing
  // check→uncheck→re-check inside ~500ms) can dispatch a STALE `onPress`
  // closure. That closure carries stale React state, so a re-check can
  // land on the previous render's view of the cache and silently no-op.
  //
  // To make the start side-effect robust against that race AND against
  // the pre-existing add-set path (`useLogSet` had no e2e coverage), we
  // watch `setsQ.data` and start the timer when EXACTLY ONE working set
  // transitions from `completed_at == null` → `completed_at != null`
  // between renders. The "exactly one" gate matters because the bulk
  // "Check all and finish" path flips many sets simultaneously, and the
  // design (and the e2e spec at `bulk Check all and finish does NOT fire
  // the timer`) explicitly forbids the timer firing in that flow.
  //
  // Tracking is done via a ref of currently-checked working-set IDs so we
  // fire exactly once per transition (not on every re-render).
  const checkedWorkingSetIdsRef = useRef<Set<string>>(new Set());
  // Hydration guard: the first time `setsQ.data` arrives we initialise the
  // ref WITHOUT firing the timer for any pre-checked sets (e.g. a session
  // resumed from history). Only subsequent transitions count.
  const checkedHydratedRef = useRef(false);
  useEffect(() => {
    if (!setsQ.data) return;
    const currentlyChecked = new Set<string>();
    for (const s of setsQ.data) {
      if (s.completed_at != null && s.set_type === "working") {
        currentlyChecked.add(s.id);
      }
    }
    if (!checkedHydratedRef.current) {
      checkedHydratedRef.current = true;
      checkedWorkingSetIdsRef.current = currentlyChecked;
      return;
    }
    // Collect IDs newly added (transitioned to checked since last update).
    const newlyChecked: string[] = [];
    for (const id of currentlyChecked) {
      if (!checkedWorkingSetIdsRef.current.has(id)) newlyChecked.push(id);
    }
    checkedWorkingSetIdsRef.current = currentlyChecked;
    // Bulk transitions (Check-all-and-finish flips every unchecked set in
    // one PATCH) must NOT fire the timer.
    if (newlyChecked.length !== 1) return;
    const s = setsQ.data.find((x) => x.id === newlyChecked[0]);
    if (!s) return;
    const rest = restByExercise.get(s.exercise_id);
    if (rest && rest > 0) restTimer.start(rest);
  }, [setsQ.data, restByExercise, restTimer]);

  // Build the ordered list of exercises for this session:
  // - if from a routine: use routine_exercises in their position order
  // - plus any exercise that has logged sets in this session (so deleted-from-routine
  //   exercises still show), preserving their first-logged order
  // - plus user-added ad-hoc exercises picked during the session
  const orderedExercises: ExerciseRow[] = useMemo(() => {
    const exMap = new Map((exercisesQ.data ?? []).map((e) => [e.id, e]));
    const out: ExerciseRow[] = [];
    const seen = new Set<string>();

    // 1) Routine exercises in position order
    for (const re of routineExercisesQ.data ?? []) {
      const ex = exMap.get(re.exercise_id);
      if (ex && !seen.has(ex.id)) {
        out.push(ex);
        seen.add(ex.id);
      }
    }

    // 2) Any exercise with logged sets in this session (in first-occurrence order)
    for (const s of setsQ.data ?? []) {
      if (!seen.has(s.exercise_id)) {
        const ex = exMap.get(s.exercise_id);
        if (ex) {
          out.push(ex);
          seen.add(ex.id);
        }
      }
    }

    // 3) Ad-hoc additions during this session
    for (const id of adHocExerciseIds) {
      if (!seen.has(id)) {
        const ex = exMap.get(id);
        if (ex) {
          out.push(ex);
          seen.add(ex.id);
        }
      }
    }

    // Client-side removals are session-local, not persisted.
    const filtered = out.filter((e) => !removedExerciseIds.has(e.id));

    // Apply user-controlled reorder: items present in the override come
    // first in override order; any items not in the override (newly added
    // since the reorder) keep their default position appended.
    if (exerciseOrderOverride) {
      const overrideSet = new Set(exerciseOrderOverride);
      const byId = new Map(filtered.map((e) => [e.id, e]));
      const reordered: ExerciseRow[] = [];
      for (const id of exerciseOrderOverride) {
        const ex = byId.get(id);
        if (ex) reordered.push(ex);
      }
      for (const ex of filtered) {
        if (!overrideSet.has(ex.id)) reordered.push(ex);
      }
      return reordered;
    }

    return filtered;
  }, [
    exercisesQ.data,
    routineExercisesQ.data,
    setsQ.data,
    adHocExerciseIds,
    exerciseOrderOverride,
    removedExerciseIds,
  ]);

  const moveExercise = (exerciseId: string, direction: "up" | "down") => {
    const currentOrder = orderedExercises.map((e) => e.id);
    const idx = currentOrder.indexOf(exerciseId);
    if (idx === -1) return;
    const target = direction === "up" ? idx - 1 : idx + 1;
    if (target < 0 || target >= currentOrder.length) return;
    const next = [...currentOrder];
    [next[idx], next[target]] = [next[target]!, next[idx]!];
    setExerciseOrderOverride(next);
  };

  const setsByExercise = useMemo(() => {
    const map = new Map<string, SetRow[]>();
    for (const s of setsQ.data ?? []) {
      const list = map.get(s.exercise_id) ?? [];
      list.push(s);
      map.set(s.exercise_id, list);
    }
    return map;
  }, [setsQ.data]);

  const handleRemoveExercise = async (ex: ExerciseRow, setCount: number) => {
    if (!sessionId) return;
    if (logSet.isPending) return;

    const ok = await confirmDelete({
      title: `Remove ${ex.name}?`,
      message:
        setCount > 0
          ? `${setCount} logged set${setCount === 1 ? "" : "s"} for this exercise will be removed from this workout. This can't be undone.`
          : `This exercise will be removed from this workout.`,
      confirmLabel: "Remove",
      cancelLabel: "Cancel",
    });
    if (!ok) return;
    try {
      if (setCount > 0) {
        await removeExerciseFromSession.mutateAsync(ex.id);
      }
      setRemovedExerciseIds((prev) => {
        const next = new Set(prev);
        next.add(ex.id);
        return next;
      });
    } catch (err) {
      console.warn("Remove exercise failed", err);
    }
  };

  const uncheckedCount = useMemo(
    () =>
      (setsQ.data ?? []).filter((s) => s.completed_at == null).length,
    [setsQ.data],
  );

  const finishAfterMutation = async () => {
    if (!sessionId) return;
    try {
      await finish.mutateAsync(sessionId);
      router.replace(`/(app)/workout/verdict/${sessionId}`);
    } catch (err) {
      console.warn("Finish failed", err);
    }
  };

  const onFinish = async () => {
    if (!sessionId) return;

    // Zero unchecked sets → keep today's 2-button confirm path (window.confirm
    // on web, Alert.alert on native). Existing e2e specs that hit Finish with
    // no logged sets continue to work without modal-aware updates.
    if (uncheckedCount === 0) {
      const ok = await confirmDelete({
        title: "Finish workout?",
        message: "You can review it later from History.",
        confirmLabel: "Finish",
        cancelLabel: "Keep going",
      });
      if (!ok) return;
      await finishAfterMutation();
      return;
    }

    // Otherwise open the 3-option dialog.
    setFinishModalOpen(true);
  };

  const handleCheckAllAndFinish = async () => {
    if (!sessionId) return;
    setFinishModalOpen(false);
    try {
      await bulkCheckAll.mutateAsync();
    } catch (err) {
      console.warn("Bulk check-all failed", err);
      return;
    }
    await finishAfterMutation();
  };

  const onCancel = async () => {
    if (!sessionId) return;
    const ok = await confirmDelete({
      title: "Cancel workout?",
      message:
        "This session will be discarded — no sets will be saved. This can't be undone.",
      confirmLabel: "Cancel workout",
      cancelLabel: "Keep going",
    });
    if (!ok) return;
    // Navigate away BEFORE firing the mutation. The useSoftDeleteSession
    // hook invalidates the "sessions" query prefix on success, which would
    // trigger a refetch of useSession(sessionId) — and since the row now
    // has deleted_at != null, getSession's `.single()` 406s. Unmounting
    // the live screen first means there's no consumer to refetch.
    router.replace("/(app)/workout");
    try {
      await cancelSession.mutateAsync(sessionId);
    } catch (err) {
      // Soft failure mode: the session simply stays in the DB. The user
      // will see it in History as an in-progress session and can finish
      // or delete it from there.
      console.warn("Cancel session failed", err);
    }
  };

  const handleDiscardUncheckedAndFinish = async () => {
    if (!sessionId) return;
    setFinishModalOpen(false);
    try {
      await bulkDiscardUnchecked.mutateAsync();
    } catch (err) {
      console.warn("Bulk discard unchecked failed", err);
      return;
    }
    await finishAfterMutation();
  };

  if (session.isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-black">
        <Stack.Screen options={{ title: "Workout", headerShown: true }} />
        <ActivityIndicator />
      </View>
    );
  }

  if (session.isError || !session.data) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-6 dark:bg-black">
        <Stack.Screen options={{ title: "Workout", headerShown: true }} />
        <Text className="text-base text-red-500">
          {session.error instanceof Error
            ? session.error.message
            : "Session not found"}
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white dark:bg-black">
      <Stack.Screen options={{ title: "Workout", headerShown: true }} />

      <SessionHeader
        startedAt={session.data.started_at}
        onFinish={onFinish}
        finishing={finish.isPending}
        volumeKg={totalVolumeKg}
        unit={unit}
      />

      <ScrollView contentContainerClassName="pb-24">
        {orderedExercises.length === 0 ? (
          <View className="flex-1 items-center px-6 py-10">
            <Text className="mb-4 text-center text-base text-gray-500">
              No exercises in this session yet. Add one to start logging.
            </Text>
          </View>
        ) : (
          orderedExercises.map((ex, idx) => (
            <ExerciseBlock
              key={ex.id}
              exercise={ex}
              sets={setsByExercise.get(ex.id) ?? []}
              unit={unit}
              isFirst={idx === 0}
              isLast={idx === orderedExercises.length - 1}
              onPressName={() =>
                // Pass the live session as the return target so the progress
                // screen's back button comes back HERE, not to the exercises
                // list (the progress route lives in the exercises tab).
                router.push(
                  `/(app)/exercises/${ex.id}/progress?backHref=${encodeURIComponent(
                    `/(app)/workout/${sessionId}`,
                  )}`,
                )
              }
              onMoveUp={() => moveExercise(ex.id, "up")}
              onMoveDown={() => moveExercise(ex.id, "down")}
              onAddSet={async (input) => {
                if (!sessionId) return;
                try {
                  await logSet.mutateAsync({
                    session_id: sessionId,
                    exercise_id: ex.id,
                    set_type: input.set_type,
                    parent_set_id: input.parent_set_id ?? null,
                  });
                  // Auto-start rest timer for working/dropset using the
                  // routine's target rest, if configured.
                  if (input.set_type !== "warmup") {
                    const rest = restByExercise.get(ex.id);
                    if (rest && rest > 0) restTimer.start(rest);
                  }
                } catch (err) {
                  console.warn("Log set failed", err);
                }
              }}
              onUpdateSet={async (id, patch) => {
                try {
                  await updateSet.mutateAsync({ id, patch });
                } catch (err) {
                  console.warn("Update set failed", err);
                }
              }}
              onUpdateSetMeta={async (id, patch) => {
                try {
                  await updateSetMeta.mutateAsync({ id, patch });
                } catch (err) {
                  console.warn("Update set meta failed", err);
                }
              }}
              onDeleteSet={async (id) => {
                try {
                  await deleteSet.mutateAsync(id);
                } catch (err) {
                  console.warn("Delete set failed", err);
                }
              }}
              onRemove={() =>
                handleRemoveExercise(
                  ex,
                  (setsByExercise.get(ex.id) ?? []).length,
                )
              }
              removeDisabled={logSet.isPending}
              showCheckable
              showVolumeTarget
              liveSessionStartedAt={session.data.started_at}
              pendingCheckSetIds={pendingCheckIds}
              onToggleSetChecked={async (
                id,
                nextChecked,
                { previousSet, currentInput },
              ) => {
                // Mark this set's checkbox as saving (spinner + disabled press
                // in <SetInput>) until the mutation settles. Covers both
                // directions so a rapid re-toggle can't race the in-flight
                // PATCH. The optimistic onMutate still flips the cache
                // instantly, so the row greens immediately underneath.
                setPendingCheckIds((prev) => new Set(prev).add(id));
                try {
                  // Uncheck direction: optimistic clear of completed_at.
                  if (!nextChecked) {
                    await uncheckSetM.mutateAsync(id);
                    return;
                  }

                  // UX polish: dismiss the soft keyboard when the user taps the
                  // check button. Not load-bearing for auto-fill correctness —
                  // the typed values flow through `currentInput` from
                  // <SetInput>'s local state, so there is no cache read to
                  // synchronize. Matches the iOS gym-app idiom of "tap a
                  // non-input control, keyboard goes away".
                  Keyboard.dismiss();

                  const toggled = (setsByExercise.get(ex.id) ?? []).find(
                    (s) => s.id === id,
                  );
                  const isWorking = toggled?.set_type === "working";

                  // Compute the auto-fill payload from the LIVE typed strings.
                  // null = nothing to fill (the common "both fields already
                  // typed" path) — the check then writes only completed_at.
                  // The fill is folded INTO checkSet (one atomic PATCH) so a
                  // checked working set never exists without its weight/reps,
                  // and useCheckSet's optimistic onMutate flips the cache
                  // synchronously so the check button reads "done" instantly.
                  const fill = isWorking
                    ? computeAutoFillPayload({
                        currentInput,
                        previous: previousSet,
                      })
                    : null;

                  // Optimistic rest-timer auto-start. The post-render observer
                  // above is the safety net for the stale-responder race.
                  if (isWorking) {
                    const rest = restByExercise.get(ex.id);
                    if (rest && rest > 0) restTimer.start(rest);
                  }

                  await checkSetM.mutateAsync({ id, fill: fill ?? undefined });
                } catch (err) {
                  console.warn("Toggle set check failed", err);
                } finally {
                  setPendingCheckIds((prev) => {
                    const next = new Set(prev);
                    next.delete(id);
                    return next;
                  });
                }
              }}
            />
          ))
        )}

        <View className="mt-4 gap-2 px-4">
          <Pressable
            onPress={() => setPickerOpen(true)}
            accessibilityRole="button"
            className="flex-row items-center justify-center rounded-lg border border-gray-300 py-3 dark:border-gray-700"
          >
            <Plus color="#6b7280" size={18} />
            <Text className="ml-2 text-base text-black dark:text-white">
              Add exercise
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setPlateCalcOpen(true)}
            accessibilityRole="button"
            className="flex-row items-center justify-center rounded-lg border border-gray-300 py-3 dark:border-gray-700"
          >
            <Calculator color="#6b7280" size={18} />
            <Text className="ml-2 text-base text-black dark:text-white">
              Plate calculator
            </Text>
          </Pressable>
          <Pressable
            onPress={onCancel}
            disabled={cancelSession.isPending}
            accessibilityRole="button"
            accessibilityLabel="Cancel workout"
            className="mt-2 flex-row items-center justify-center rounded-lg bg-red-50 py-3 dark:bg-red-950/30"
          >
            <Text className="text-base font-medium text-red-600 dark:text-red-400">
              {cancelSession.isPending ? "Cancelling…" : "Cancel workout"}
            </Text>
          </Pressable>
        </View>
      </ScrollView>

      <ExercisePicker
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        excludeIds={orderedExercises.map((e) => e.id)}
        onPick={(ex) => {
          setAdHocExerciseIds((prev) =>
            prev.includes(ex.id) ? prev : [...prev, ex.id],
          );
          setPickerOpen(false);
        }}
      />

      <PlateCalculator
        visible={plateCalcOpen}
        onClose={() => setPlateCalcOpen(false)}
        unit={unit}
      />

      <RestTimerOverlay />

      <ChooseActionModal
        visible={finishModalOpen}
        title="Some sets are unchecked"
        message={`You have ${uncheckedCount} unchecked set${
          uncheckedCount === 1 ? "" : "s"
        }. Unchecked sets won't be saved. This can't be undone.`}
        onClose={() => setFinishModalOpen(false)}
        buttons={[
          // iOS HIG vertical stack: primary on top, destructive middle,
          // cancel at the bottom (thumb-reach escape).
          {
            label: "Check all and finish",
            variant: "primary",
            onPress: handleCheckAllAndFinish,
          },
          {
            label: "Finish without saving unchecked",
            variant: "destructive",
            onPress: handleDiscardUncheckedAndFinish,
          },
          {
            label: "Cancel",
            variant: "default",
            onPress: () => setFinishModalOpen(false),
          },
        ]}
      />
    </View>
  );
}
