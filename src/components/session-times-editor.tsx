/**
 * SessionTimesEditor — read-only display of session start/duration on the
 * History detail screen, with a tap-to-reveal form for editing `started_at`
 * and `ended_at`.
 *
 * Draft state is initialized imperatively inside the `useState` initializer
 * and re-derived inside `openEdit()` — there is no prop-sync `useEffect`,
 * which would race with post-mutation `setQueryData(KEYS.detail, row)` and
 * potentially wipe an in-flight draft.
 */

import { Pencil } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, TextInput, useColorScheme, View } from "react-native";

import { Button } from "~/components/ui/button";
import {
  formatDateTime,
  formatDuration,
} from "~/utils/format-session-times";
import {
  countSetsOutsideRange,
  decomposeIso,
  maskTimeInput,
  messageFor,
  type TimesDraft,
  validateTimes,
} from "~/utils/session-times-form";

export type SessionTimesEditorProps = {
  /** Current ISO UTC start time. */
  startedAt: string;
  /** Current ISO UTC end time. Required — editor only renders for finished sessions. */
  endedAt: string;
  /** `completed_at` for each set in this session — feeds the soft "outside range" advisory. */
  setsCompletedAt: readonly (string | null)[];
  /** Mutation in flight. Save shows spinner; Cancel is disabled. */
  isSubmitting: boolean;
  /** Mutation error message to render verbatim. */
  submitError: string | null;
  onSubmit: (times: { started_at: string; ended_at: string }) => void;
  /** Called when the user taps Cancel — parent should call `mutation.reset()`. */
  onCancel?: () => void;
};

function makeDraft(startedAt: string, endedAt: string): TimesDraft {
  const s = decomposeIso(startedAt);
  const e = decomposeIso(endedAt);
  return {
    startDate: s.date,
    startTime: s.time,
    endDate: e.date,
    endTime: e.time,
  };
}

export function SessionTimesEditor(props: SessionTimesEditorProps) {
  const colorScheme = useColorScheme();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<TimesDraft>(() =>
    makeDraft(props.startedAt, props.endedAt),
  );
  const [error, setError] = useState<string | null>(null);

  const openEdit = () => {
    setDraft(makeDraft(props.startedAt, props.endedAt));
    setError(null);
    setEditing(true);
  };

  const onSave = () => {
    const result = validateTimes(draft, new Date());
    if (!result.ok) {
      setError(messageFor(result.error.kind));
      return;
    }
    setError(null);
    props.onSubmit({
      started_at: result.started_at,
      ended_at: result.ended_at,
    });
    // Editor closes after isSubmitting transitions true→false with no submitError.
  };

  const onCancel = () => {
    props.onCancel?.();
    setError(null);
    setEditing(false);
  };

  // Close on successful submit (isSubmitting true → false with no error).
  const prevSubmitting = useRef(false);
  useEffect(() => {
    if (prevSubmitting.current && !props.isSubmitting && !props.submitError) {
      setEditing(false);
    }
    prevSubmitting.current = props.isSubmitting;
  }, [props.isSubmitting, props.submitError]);

  // Compute "sets outside range" only when the draft is valid in shape.
  // We bypass the "end-in-future" rule here by passing a far-future "now".
  const outsideCount = useMemo(() => {
    const farFutureNow = new Date(Date.now() + 365 * 24 * 3600 * 1000);
    const result = validateTimes(draft, farFutureNow);
    if (!result.ok) return 0;
    return countSetsOutsideRange(
      result.started_at,
      result.ended_at,
      props.setsCompletedAt,
    );
  }, [draft, props.setsCompletedAt]);

  if (!editing) {
    const pencilColor = colorScheme === "dark" ? "#9ca3af" : "#6b7280";
    return (
      <Pressable
        onPress={openEdit}
        accessibilityRole="button"
        accessibilityLabel="Edit start and end times"
        className="mt-3"
      >
        <View className="flex-row items-center justify-between">
          <Text className="text-sm text-gray-500">
            {formatDateTime(props.startedAt)}
          </Text>
          <Pencil color={pencilColor} size={16} />
        </View>
        <Text className="mt-0.5 text-sm text-gray-500">
          Duration: {formatDuration(props.startedAt, props.endedAt)}
        </Text>
      </Pressable>
    );
  }

  return (
    <View className="mt-3 gap-2">
      <Text className="text-xs uppercase text-gray-500 dark:text-gray-400">
        Start
      </Text>
      <View className="flex-row gap-2">
        <TextInput
          value={draft.startDate}
          onChangeText={(v) => setDraft((d) => ({ ...d, startDate: v }))}
          placeholder="YYYY-MM-DD"
          placeholderTextColor="#9ca3af"
          keyboardType="numeric"
          maxLength={10}
          accessibilityLabel="Start date"
          className="flex-[2] rounded-md border border-gray-300 px-3 py-2 text-black dark:border-gray-700 dark:text-white"
        />
        <TextInput
          value={draft.startTime}
          onChangeText={(v) =>
            setDraft((d) => ({ ...d, startTime: maskTimeInput(d.startTime, v) }))
          }
          placeholder="HH:mm"
          placeholderTextColor="#9ca3af"
          keyboardType="numeric"
          maxLength={5}
          accessibilityLabel="Start time"
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-black dark:border-gray-700 dark:text-white"
        />
      </View>

      <Text className="mt-1 text-xs uppercase text-gray-500 dark:text-gray-400">
        End
      </Text>
      <View className="flex-row gap-2">
        <TextInput
          value={draft.endDate}
          onChangeText={(v) => setDraft((d) => ({ ...d, endDate: v }))}
          placeholder="YYYY-MM-DD"
          placeholderTextColor="#9ca3af"
          keyboardType="numeric"
          maxLength={10}
          accessibilityLabel="End date"
          className="flex-[2] rounded-md border border-gray-300 px-3 py-2 text-black dark:border-gray-700 dark:text-white"
        />
        <TextInput
          value={draft.endTime}
          onChangeText={(v) =>
            setDraft((d) => ({ ...d, endTime: maskTimeInput(d.endTime, v) }))
          }
          placeholder="HH:mm"
          placeholderTextColor="#9ca3af"
          keyboardType="numeric"
          maxLength={5}
          accessibilityLabel="End time"
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-black dark:border-gray-700 dark:text-white"
        />
      </View>

      {error ? (
        <Text className="mt-1 text-xs text-red-500">{error}</Text>
      ) : null}
      {props.submitError ? (
        <Text className="mt-1 text-xs text-red-500">{props.submitError}</Text>
      ) : null}
      {outsideCount > 0 ? (
        <Text className="mt-1 text-xs text-amber-600 dark:text-amber-400">
          {outsideCount === 1
            ? "1 set in this session was logged outside this time range."
            : `${outsideCount} sets in this session were logged outside this time range.`}
        </Text>
      ) : null}

      <View className="mt-1 flex-row gap-2">
        <View className="flex-1">
          <Button
            label="Save"
            variant="primary"
            loading={props.isSubmitting}
            onPress={onSave}
          />
        </View>
        <View className="flex-1">
          <Button
            label="Cancel"
            variant="secondary"
            disabled={props.isSubmitting}
            onPress={onCancel}
          />
        </View>
      </View>
    </View>
  );
}
