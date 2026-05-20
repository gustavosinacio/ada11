-- =============================================================================
-- 0006_add_source_flag.sql
-- Hand-written. Adds a nullable `source` flag to sessions and exercises so
-- records originating from external imports (e.g. the Strong CSV importer
-- under scripts/import-strong.ts) can be distinguished from native data.
--
-- Convention: source IS NULL  → record was created in-app (native).
--             source = 'strong' → record was created by the Strong importer.
--
-- Future external sources extend the CHECK constraint via a new migration.
-- Existing rows stay null — no backfill needed; null is the documented native
-- value.
-- =============================================================================

-- 1. sessions.source column + CHECK + partial index.
alter table public.sessions add column source text;

alter table public.sessions add constraint sessions_source_valid
  check (source is null or source in ('strong'));

-- Partial index — only imported rows are indexed; native (NULL) rows are
-- excluded to keep the index small. Useful for future queries like
-- "list all imported sessions" without scanning the whole table.
create index sessions_user_source_idx on public.sessions (user_id, source)
  where source is not null;

-- 2. exercises.source column + CHECK.
--    No partial index here — the exercise list is small (~30-200 rows per user)
--    and source-filtered queries are not on the hot path.
alter table public.exercises add column source text;

alter table public.exercises add constraint exercises_source_valid
  check (source is null or source in ('strong'));

-- 3. No RLS policy changes — existing policies gate on auth.uid() = user_id,
--    which covers the new column. The CHECK constraints are server-side guards
--    against arbitrary string values arriving via PostgREST.
