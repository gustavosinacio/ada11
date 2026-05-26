import { Stack, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";

import type { AdminRoutineDetail, AdminSessionDetail } from "~/api/admin";
import {
  useAdminRoutineDetail,
  useAdminRoutinesForUser,
  useAdminSessionDetail,
  useAdminSessionsForUser,
  useAdminUsers,
  useIsAdmin,
} from "~/hooks/use-admin";
import { parseISO } from "~/utils/dates";
import { formatDisplayDate } from "~/utils/format-display-date";
import { formatVolume } from "~/utils/units";
import { sumLiveVolume } from "~/utils/volume-target";

type SessionSet = AdminSessionDetail["sets"][number];
type RoutineSet = AdminRoutineDetail["sets"][number];

type Selection =
  | { kind: "routine"; id: string }
  | { kind: "session"; id: string }
  | null;

/**
 * Admin page — read-only browser of every user's routines + session history.
 *
 * Desktop-first 3-column layout. Selection state lives in the page (not the
 * URL) so navigating "click user → click workout" keeps the user on a single
 * screen with no router push. Mobile fallback: vertical stack of the same
 * three sections.
 *
 * Auth: server-side RLS + the admin_list_users() function guard are the
 * authoritative gate (defense in depth). The client-side useIsAdmin() check
 * just decides whether to render the admin UI or redirect — a non-admin who
 * somehow lands here gets empty results and an error toast, not data.
 */
export default function AdminScreen(): React.JSX.Element {
  const router = useRouter();
  const isAdminQ = useIsAdmin();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);

  // Redirect away when we know the caller isn't an admin. Keeps the URL
  // accessible to admins via direct deep-link / bookmark.
  useEffect(() => {
    if (isAdminQ.data === false) {
      router.replace("/(app)/workout");
    }
  }, [isAdminQ.data, router]);

  const usersQ = useAdminUsers(isAdminQ.data === true);

  // Auto-select the first user once the list loads so the page isn't blank.
  useEffect(() => {
    if (selectedUserId) return;
    const first = usersQ.data?.[0];
    if (first) setSelectedUserId(first.id);
  }, [usersQ.data, selectedUserId]);

  if (isAdminQ.isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-black">
        <ActivityIndicator />
      </View>
    );
  }

  if (isAdminQ.data !== true) {
    // Effect above will replace; this is just the fallback frame.
    return <View className="flex-1 bg-white dark:bg-black" />;
  }

  return (
    <View className="flex-1 bg-white dark:bg-black">
      <Stack.Screen options={{ title: "Admin", headerShown: true }} />
      <View className="flex-1 flex-row">
        <UsersColumn
          users={usersQ.data ?? []}
          loading={usersQ.isLoading}
          error={usersQ.error}
          selectedUserId={selectedUserId}
          onSelect={(id) => {
            setSelectedUserId(id);
            setSelection(null);
          }}
        />
        <UserDetailColumn
          userId={selectedUserId}
          selection={selection}
          onSelect={setSelection}
        />
        <DetailColumn selection={selection} />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Column 1 — Users
// ---------------------------------------------------------------------------

type UsersColumnProps = {
  users: { id: string; email: string | null; created_at: string }[];
  loading: boolean;
  error: unknown;
  selectedUserId: string | null;
  onSelect: (id: string) => void;
};

function UsersColumn({
  users,
  loading,
  error,
  selectedUserId,
  onSelect,
}: UsersColumnProps) {
  return (
    <View className="w-72 border-r border-gray-200 dark:border-gray-800">
      <ColumnHeader title={`Users (${users.length})`} />
      <ScrollView className="flex-1">
        {loading ? (
          <ActivityIndicator className="mt-6" />
        ) : error ? (
          <ColumnError error={error} />
        ) : users.length === 0 ? (
          <Empty text="No users." />
        ) : (
          users.map((u) => {
            const selected = selectedUserId === u.id;
            return (
              <Pressable
                key={u.id}
                onPress={() => onSelect(u.id)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                className={`border-b border-gray-100 px-4 py-3 dark:border-gray-900 ${
                  selected
                    ? "bg-gray-100 dark:bg-gray-900"
                    : "active:bg-gray-50 dark:active:bg-gray-950"
                }`}
              >
                <Text
                  className="text-sm text-black dark:text-white"
                  numberOfLines={1}
                >
                  {u.email ?? "(no email)"}
                </Text>
                <Text className="mt-0.5 text-xs text-gray-500">
                  Created {formatDisplayDate(parseISO(u.created_at))}
                </Text>
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Column 2 — Routines + Sessions for the selected user
// ---------------------------------------------------------------------------

type UserDetailColumnProps = {
  userId: string | null;
  selection: Selection;
  onSelect: (s: Selection) => void;
};

function UserDetailColumn({
  userId,
  selection,
  onSelect,
}: UserDetailColumnProps) {
  const routinesQ = useAdminRoutinesForUser(userId);
  const sessionsQ = useAdminSessionsForUser(userId);

  if (!userId) {
    return (
      <View className="w-96 border-r border-gray-200 dark:border-gray-800">
        <ColumnHeader title="—" />
        <Empty text="Pick a user on the left." />
      </View>
    );
  }

  return (
    <View className="w-96 border-r border-gray-200 dark:border-gray-800">
      <ColumnHeader title="Routines + sessions" />
      <ScrollView className="flex-1">
        <SectionHeader title={`Routines (${routinesQ.data?.length ?? 0})`} />
        {routinesQ.isLoading ? (
          <ActivityIndicator className="my-3" />
        ) : routinesQ.error ? (
          <ColumnError error={routinesQ.error} />
        ) : (routinesQ.data ?? []).length === 0 ? (
          <Empty text="No routines." />
        ) : (
          (routinesQ.data ?? []).map((r) => {
            const selected =
              selection?.kind === "routine" && selection.id === r.id;
            return (
              <Pressable
                key={r.id}
                onPress={() => onSelect({ kind: "routine", id: r.id })}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                className={`border-b border-gray-100 px-4 py-3 dark:border-gray-900 ${
                  selected
                    ? "bg-gray-100 dark:bg-gray-900"
                    : "active:bg-gray-50 dark:active:bg-gray-950"
                }`}
              >
                <Text className="text-sm text-black dark:text-white">
                  {r.name}
                </Text>
              </Pressable>
            );
          })
        )}

        <SectionHeader title={`Sessions (${sessionsQ.data?.length ?? 0})`} />
        {sessionsQ.isLoading ? (
          <ActivityIndicator className="my-3" />
        ) : sessionsQ.error ? (
          <ColumnError error={sessionsQ.error} />
        ) : (sessionsQ.data ?? []).length === 0 ? (
          <Empty text="No sessions." />
        ) : (
          (sessionsQ.data ?? []).map((s) => {
            const selected =
              selection?.kind === "session" && selection.id === s.id;
            const subtitle = s.ended_at
              ? `${formatDisplayDate(parseISO(s.started_at), { includeWeekday: true })}`
              : `${formatDisplayDate(parseISO(s.started_at), { includeWeekday: true })} · in progress`;
            return (
              <Pressable
                key={s.id}
                onPress={() => onSelect({ kind: "session", id: s.id })}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                className={`border-b border-gray-100 px-4 py-3 dark:border-gray-900 ${
                  selected
                    ? "bg-gray-100 dark:bg-gray-900"
                    : "active:bg-gray-50 dark:active:bg-gray-950"
                }`}
              >
                <Text className="text-sm text-black dark:text-white">
                  {s.name ?? "Untitled session"}
                </Text>
                <Text className="mt-0.5 text-xs text-gray-500">{subtitle}</Text>
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Column 3 — Selected routine OR session detail
// ---------------------------------------------------------------------------

function DetailColumn({ selection }: { selection: Selection }) {
  if (!selection) {
    return (
      <View className="flex-1">
        <ColumnHeader title="Detail" />
        <Empty text="Pick a routine or a session." />
      </View>
    );
  }

  if (selection.kind === "routine") {
    return <RoutineDetail routineId={selection.id} />;
  }
  return <SessionDetail sessionId={selection.id} />;
}

function RoutineDetail({ routineId }: { routineId: string }) {
  const detailQ = useAdminRoutineDetail(routineId);
  const setsByExercise = useMemo(() => {
    const map = new Map<string, RoutineSet[]>();
    for (const s of detailQ.data?.sets ?? []) {
      const list = map.get(s.routine_exercise_id) ?? [];
      list.push(s);
      map.set(s.routine_exercise_id, list);
    }
    return map;
  }, [detailQ.data?.sets]);

  return (
    <View className="flex-1">
      <ColumnHeader title="Routine detail" />
      <ScrollView className="flex-1">
        {detailQ.isLoading ? (
          <ActivityIndicator className="my-6" />
        ) : detailQ.error ? (
          <ColumnError error={detailQ.error} />
        ) : detailQ.data ? (
          <View className="p-6">
            <Text className="text-xl font-semibold text-black dark:text-white">
              {detailQ.data.routine.name}
            </Text>
            {detailQ.data.routine.notes ? (
              <Text className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                {detailQ.data.routine.notes}
              </Text>
            ) : null}
            <View className="mt-6">
              {detailQ.data.entries.map((e) => {
                const sets = setsByExercise.get(e.id) ?? [];
                return (
                  <View
                    key={e.id}
                    className="mb-6 border-l-2 border-gray-200 pl-4 dark:border-gray-800"
                  >
                    <Text className="text-base font-medium text-black dark:text-white">
                      {e.exercise.name}
                    </Text>
                    {e.target_rest_seconds ? (
                      <Text className="mt-0.5 text-xs text-gray-500">
                        Rest {e.target_rest_seconds}s
                      </Text>
                    ) : null}
                    {sets.length === 0 ? (
                      <Text className="mt-1 text-xs italic text-gray-500">
                        No sets configured.
                      </Text>
                    ) : (
                      sets.map((s) => (
                        <Text
                          key={s.id}
                          className="mt-1 text-sm text-gray-700 dark:text-gray-300"
                        >
                          Set {s.set_number} · {s.set_type} ·{" "}
                          {s.target_weight ?? "—"} kg × {s.target_reps ?? "—"}
                        </Text>
                      ))
                    )}
                  </View>
                );
              })}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function SessionDetail({ sessionId }: { sessionId: string }) {
  const detailQ = useAdminSessionDetail(sessionId);
  const groups = useMemo<{ exerciseName: string; sets: SessionSet[] }[]>(() => {
    if (!detailQ.data) return [];
    const map = new Map<string, { exerciseName: string; sets: SessionSet[] }>();
    for (const s of detailQ.data.sets) {
      const entry = map.get(s.exercise_id) ?? {
        exerciseName: s.exercise.name,
        sets: [] as SessionSet[],
      };
      entry.sets.push(s);
      map.set(s.exercise_id, entry);
    }
    return [...map.values()];
  }, [detailQ.data]);

  return (
    <View className="flex-1">
      <ColumnHeader title="Session detail" />
      <ScrollView className="flex-1">
        {detailQ.isLoading ? (
          <ActivityIndicator className="my-6" />
        ) : detailQ.error ? (
          <ColumnError error={detailQ.error} />
        ) : detailQ.data ? (
          <View className="p-6">
            <Text className="text-xl font-semibold text-black dark:text-white">
              {detailQ.data.session.name ?? "Untitled session"}
            </Text>
            <Text className="mt-1 text-sm text-gray-500">
              {formatDisplayDate(parseISO(detailQ.data.session.started_at), {
                includeWeekday: true,
              })}
              {detailQ.data.session.ended_at
                ? ` → ${new Date(detailQ.data.session.ended_at).toLocaleTimeString()}`
                : " · in progress"}
            </Text>
            <Text className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Total volume: {formatVolume(sumLiveVolume(detailQ.data.sets), "kg")}
            </Text>
            <View className="mt-6">
              {groups.length === 0 ? (
                <Empty text="No sets logged." />
              ) : (
                groups.map((g, idx) => (
                  <View
                    key={`${g.exerciseName}-${idx}`}
                    className="mb-6 border-l-2 border-gray-200 pl-4 dark:border-gray-800"
                  >
                    <Text className="text-base font-medium text-black dark:text-white">
                      {g.exerciseName}
                    </Text>
                    {g.sets.map((s) => (
                      <Text
                        key={s.id}
                        className={`mt-1 text-sm ${
                          s.completed_at
                            ? "text-gray-700 dark:text-gray-300"
                            : "text-gray-400 italic"
                        }`}
                      >
                        Set {s.set_number} · {s.set_type} ·{" "}
                        {s.weight ?? "—"} kg × {s.reps ?? "—"}
                        {s.rpe ? ` · RPE ${s.rpe}` : ""}
                        {!s.completed_at ? " (unchecked)" : ""}
                      </Text>
                    ))}
                  </View>
                ))
              )}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Tiny shared bits
// ---------------------------------------------------------------------------

function ColumnHeader({ title }: { title: string }) {
  return (
    <View className="border-b border-gray-200 px-4 py-3 dark:border-gray-800">
      <Text className="text-xs uppercase tracking-wide text-gray-500">
        {title}
      </Text>
    </View>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <View className="border-b border-gray-100 bg-gray-50 px-4 py-2 dark:border-gray-900 dark:bg-gray-950">
      <Text className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        {title}
      </Text>
    </View>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <View className="p-6">
      <Text className="text-sm text-gray-500">{text}</Text>
    </View>
  );
}

function ColumnError({ error }: { error: unknown }) {
  const msg = error instanceof Error ? error.message : "Error loading data";
  return (
    <View className="p-4">
      <Text className="text-sm text-red-600 dark:text-red-400">{msg}</Text>
    </View>
  );
}
