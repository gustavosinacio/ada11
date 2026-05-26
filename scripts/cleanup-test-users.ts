/**
 * Defensive sweep for leftover test auth.users.
 *
 * E2E specs already clean up the users they create (`test.afterAll` +
 * `try/finally` calling `deleteUserSafe`). But a process killed mid-run
 * (OOM, SIGKILL) or a manual ad-hoc test (golden-path screenshots, pipeline
 * Tester flows) skips that cleanup and leaves an account behind. Each
 * leftover account also carries a `user_preferences` row (seeded by the
 * `seed_new_user` trigger) and potentially a few exercises / sessions / sets.
 *
 * This script targets auth users whose email matches a test pattern:
 *   ^(e2e-|tester-).*@test\.com$
 *
 * It NEVER touches anything outside that pattern, and refuses to touch the
 * keeper's email (`gsinacio94@gmail.com`) even if the pattern accidentally
 * matched it.
 *
 * Default = dry run. Pass `--yes` to actually delete.
 *
 * Optional `--min-age-hours=N` (default 1) excludes users created within the
 * last N hours, so a deletion run mid-suite doesn't kill in-flight test users.
 *
 * Run:
 *   set -a && . ./.env.local && set +a && npx tsx scripts/cleanup-test-users.ts
 *   set -a && . ./.env.local && set +a && npx tsx scripts/cleanup-test-users.ts --yes
 *   set -a && . ./.env.local && set +a && npx tsx scripts/cleanup-test-users.ts --yes --min-age-hours=0
 */

import { createClient, SupabaseClient, type User } from "@supabase/supabase-js";

const TEST_EMAIL_PATTERN = /^(e2e-|tester-).*@test\.com$/;
const KEEPER_EMAIL = "gsinacio94@gmail.com";
const COUNTED_TABLES = [
  "exercises",
  "routines",
  "routine_exercises",
  "sessions",
  "sets",
  "exercise_notes",
  "user_preferences",
] as const;

type Counts = Record<(typeof COUNTED_TABLES)[number], number>;

function parseArgs(argv: string[]): { yes: boolean; minAgeHours: number } {
  let yes = false;
  let minAgeHours = 1;
  for (const a of argv) {
    if (a === "--yes") yes = true;
    else if (a.startsWith("--min-age-hours=")) {
      const v = Number(a.slice("--min-age-hours=".length));
      if (!Number.isFinite(v) || v < 0) {
        throw new Error(`Invalid --min-age-hours: ${a}`);
      }
      minAgeHours = v;
    } else if (a.startsWith("--")) {
      throw new Error(`Unknown flag: ${a}`);
    }
  }
  return { yes, minAgeHours };
}

async function listAllUsers(admin: SupabaseClient): Promise<User[]> {
  const perPage = 100;
  const all: User[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    all.push(...data.users);
    if (data.users.length < perPage) break;
  }
  return all;
}

async function countAttached(admin: SupabaseClient, userId: string): Promise<Counts> {
  const out = {} as Counts;
  for (const t of COUNTED_TABLES) {
    const { count, error } = await admin
      .from(t)
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId);
    if (error) throw new Error(`count ${t}: ${error.message}`);
    out[t] = count ?? 0;
  }
  return out;
}

async function main() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) throw new Error("Missing Supabase env vars");

  const { yes, minAgeHours } = parseArgs(process.argv.slice(2));
  const cutoffMs = Date.now() - minAgeHours * 60 * 60 * 1000;

  const admin = createClient(url, serviceRole, { auth: { persistSession: false } });

  const users = await listAllUsers(admin);
  const matches = users.filter((u) => {
    if (!u.email) return false;
    if (u.email === KEEPER_EMAIL) return false;
    if (!TEST_EMAIL_PATTERN.test(u.email)) return false;
    const created = u.created_at ? Date.parse(u.created_at) : NaN;
    if (!Number.isFinite(created)) return false;
    return created < cutoffMs;
  });

  console.log(`Mode: ${yes ? "DELETE" : "dry-run"}`);
  console.log(`Pattern: ${TEST_EMAIL_PATTERN}`);
  console.log(`Keeper guard: ${KEEPER_EMAIL} (always excluded)`);
  console.log(`Min age: ${minAgeHours}h (created before ${new Date(cutoffMs).toISOString()})`);
  console.log(`Total auth.users: ${users.length}`);
  console.log(`Match count: ${matches.length}`);
  console.log();

  if (matches.length === 0) {
    console.log("Nothing to clean up.");
    return;
  }

  for (const u of matches) {
    const counts = await countAttached(admin, u.id);
    const fmt = COUNTED_TABLES.map((t) => `${t}=${counts[t]}`).join(" ");
    console.log(`  ${u.id}  ${u.email}  created=${u.created_at}`);
    console.log(`    ${fmt}`);
  }

  if (!yes) {
    console.log();
    console.log("Dry run complete. Re-run with --yes to delete.");
    return;
  }

  console.log("\nDeleting…");
  let okCount = 0;
  for (const u of matches) {
    const { error } = await admin.auth.admin.deleteUser(u.id);
    if (error) {
      console.error(`  ✗ ${u.id} ${u.email} — ${error.message}`);
      continue;
    }
    okCount += 1;
    console.log(`  ✓ ${u.id} ${u.email}`);
  }

  console.log();
  console.log(`Deleted ${okCount} / ${matches.length}.`);

  console.log("\nPost-delete cascade verification (sample first match):");
  if (matches[0]) {
    const counts = await countAttached(admin, matches[0].id);
    const fmt = COUNTED_TABLES.map((t) => `${t}=${counts[t]}`).join(" ");
    console.log(`  ${matches[0].id}: ${fmt}`);
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
