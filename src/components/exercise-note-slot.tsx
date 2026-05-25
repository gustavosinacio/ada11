import { useEffect, useRef, useState } from "react";
import { Pressable, Text, type TextInput, View } from "react-native";
import { z } from "zod";

import { Textarea } from "~/components/ui/textarea";
import {
  useMyExerciseNote,
  useUpsertMyExerciseNote,
} from "~/hooks/use-exercise-note";

/**
 * Per-(user, exercise) note slot. Renders in four places:
 *   1. exercises/[id]/progress screen     — editable, alwaysExpanded
 *   2. <ExerciseBlock> (live + history-edit) — editable, collapsed-when-empty
 *   3. <ReadOnlyExerciseBlock> (history-read) — read-only
 *
 * Owns the empty-body display rule (single source-of-truth):
 *   "empty" === row === null OR row.body.trim() === ""
 *   - read-only + empty   → render `null`
 *   - editable + empty    → "+ Add note" collapsed (or full Textarea if
 *                           alwaysExpanded=true)
 *
 * Commit-on-blur. Local draft state. Length cap is enforced at 3 layers:
 *   - zod max(2000) pre-mutate
 *   - <Textarea maxLength={2000}>
 *   - DB CHECK exercise_notes_body_length_check
 *
 * Loading semantics: returns `null` while the read is `isLoading` — no
 * skeleton, no reflow on slow note queries.
 */

type Props = {
  exerciseId: string;
  /**
   * When true, wires an inline editor and commits on blur. When false, the
   * slot renders read-only Text — or nothing, if the stored body trims to
   * empty. <ReadOnlyExerciseBlock> uses the false path.
   */
  editable: boolean;
  /**
   * When true, force the full <Textarea> in the empty-editable state. The
   * progress screen passes this. <ExerciseBlock> does not, so it gets the
   * collapsed "+ Add note" affordance (vertical density on a 5-8-exercise
   * live workout).
   */
  alwaysExpanded?: boolean;
};

const noteSchema = z.string().max(2000);

export function ExerciseNoteSlot({
  exerciseId,
  editable,
  alwaysExpanded = false,
}: Props): React.JSX.Element | null {
  const noteQ = useMyExerciseNote(exerciseId);
  const upsert = useUpsertMyExerciseNote(exerciseId);
  const inputRef = useRef<TextInput | null>(null);

  // Server-truth value last observed by the slot. Used to gate the resync
  // useEffect so a background refetch (window-focus / cache hydration) does
  // not clobber in-progress typing. The user "owns" the draft from the
  // moment they edit until they blur.
  const lastSyncedFromServer = useRef<string>(noteQ.data?.body ?? "");
  const [draft, setDraft] = useState<string>(noteQ.data?.body ?? "");
  const [expanded, setExpanded] = useState<boolean>(false);
  const [validationError, setValidationError] = useState<string | undefined>(
    undefined,
  );

  // (MIN-v2-1) Gate the resync. The user "owns" the draft from the moment
  // they diverge from the last server snapshot until they blur (which calls
  // commit() and either no-ops or kicks a mutation that updates the snapshot).
  //
  // Decision rule (priority order):
  //   1. If draft has diverged from the last server snapshot, the user is
  //      mid-edit → DO NOT adopt the new server value (would clobber input).
  //   2. Otherwise (draft === lastSyncedFromServer.current), adopt any new
  //      server value.
  //
  // The `expanded` state is intentionally NOT in the gate: on alwaysExpanded
  // surfaces (progress screen) the user is always in "edit mode" without
  // toggling `expanded`. Using divergence-from-snapshot is the universal
  // signal.
  useEffect(() => {
    const serverBody = noteQ.data?.body ?? "";
    const draftHasDiverged = draft !== lastSyncedFromServer.current;
    if (draftHasDiverged) return;
    if (serverBody !== lastSyncedFromServer.current) {
      lastSyncedFromServer.current = serverBody;
      setDraft(serverBody);
    }
    // We intentionally do NOT depend on `draft` here — the guard reads it
    // through closure to decide whether to adopt the server value. Including
    // it would re-run on every keystroke and short-circuit the adopt path
    // on the SAME render that the user's local typing diverged the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteQ.data?.body]);

  // While the first read is in flight, render nothing — no skeleton, no
  // layout reflow when the row arrives.
  if (noteQ.isLoading) return null;

  const row = noteQ.data ?? null;
  const trimmedBody = (row?.body ?? "").trim();
  const isEmpty = trimmedBody === "";

  // -------------------------------------------------------------------------
  // Read-only path.
  // -------------------------------------------------------------------------
  if (!editable) {
    if (isEmpty) return null;
    return (
      <Text className="px-4 py-2 text-sm italic text-gray-600 dark:text-gray-400">
        {row?.body}
      </Text>
    );
  }

  // -------------------------------------------------------------------------
  // Editable path.
  // -------------------------------------------------------------------------
  const commit = () => {
    const next = draft;

    // (MIN-v2-2) Never persist an empty row for a never-existed note. If the
    // row hasn't been created and the user leaves it blank (even whitespace),
    // do nothing — collapse back to the affordance on the calling surface
    // and normalize the draft so subsequent re-opens start fresh.
    if (row == null && next.trim() === "") {
      setValidationError(undefined);
      setDraft("");
      lastSyncedFromServer.current = "";
      if (!alwaysExpanded) setExpanded(false);
      return;
    }

    // No-op when nothing changed.
    if (next === (row?.body ?? "")) {
      setValidationError(undefined);
      if (!alwaysExpanded && next.trim() === "") setExpanded(false);
      return;
    }

    const parsed = noteSchema.safeParse(next);
    if (!parsed.success) {
      setValidationError("Note is too long (max 2000 chars).");
      return;
    }

    setValidationError(undefined);
    // Optimistically remember the value we're sending so the resync guard
    // doesn't overwrite the user's input when TanStack returns the server row.
    const previousSnapshot = lastSyncedFromServer.current;
    lastSyncedFromServer.current = next;
    upsert.mutate(next, {
      onError: () => {
        // Roll back the "last synced" snapshot so a subsequent server refetch
        // can resync the draft to the persisted value.
        lastSyncedFromServer.current = previousSnapshot;
      },
    });
  };

  // Editable + empty + collapsed affordance (default on <ExerciseBlock>).
  if (isEmpty && !alwaysExpanded && !expanded) {
    return (
      <Pressable
        onPress={() => {
          setExpanded(true);
          // Focus shortly after layout so RN/web both reliably attach the
          // input ref before requesting focus.
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
        accessibilityRole="button"
        accessibilityLabel="Add a note for this exercise"
        className="px-4 py-2"
      >
        <Text className="text-sm text-blue-600 dark:text-blue-400">
          + Add note
        </Text>
      </Pressable>
    );
  }

  // Editable + (non-empty OR alwaysExpanded OR user-tapped-to-expand).
  return (
    <View className="px-4 pt-2">
      <Textarea
        ref={inputRef}
        value={draft}
        onChangeText={(t) => {
          setDraft(t);
          if (validationError) setValidationError(undefined);
        }}
        onBlur={commit}
        maxLength={2000}
        placeholder="Add a note for this exercise…"
        accessibilityLabel="Exercise note"
        autoFocus={expanded && isEmpty}
        error={validationError ?? (noteQ.isError ? "Failed to load note" : undefined)}
      />
      {upsert.isError ? (
        <Text className="-mt-2 mb-2 text-xs text-red-500">
          Couldn’t save note. Try again.
        </Text>
      ) : null}
    </View>
  );
}
