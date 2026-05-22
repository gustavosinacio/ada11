import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Calculator, Plus } from "lucide-react-native";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
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
import { useRestTimer } from "~/hooks/use-rest-timer";
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

export default function LiveWorkoutScreen() {
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
                router.push(`/(app)/exercises/${ex.id}/progress`)
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
              onToggleSetChecked={async (id, nextChecked) => {
                try {
                  if (nextChecked) {
                    await checkSetM.mutateAsync(id);
                  } else {
                    await uncheckSetM.mutateAsync(id);
                  }
                } catch (err) {
                  console.warn("Toggle set check failed", err);
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
