-- Exports the shape of the database for tests/e2e.mjs, which checks every request the portal makes
-- against it. Run on a scratch database where supabase/tests/supabase-stubs.sql and
-- supabase/schema.sql ran:
--   psql -d bannuar_test -tA -f tests/schema-snapshot.sql > tests/schema-snapshot.json
select json_build_object(
  'columns', (select json_object_agg(t, cols) from (
      select table_name t, json_agg(column_name order by column_name) cols
      from information_schema.columns where table_schema = 'public' group by table_name) x),
  -- foreign keys with their columns, and primary keys: together they say which embeds PostgREST
  -- can resolve, and which ones are ambiguous without a hint
  'fks', (select json_agg(json_build_object(
      'name', c.conname, 'from', c.conrelid::regclass::text, 'to', c.confrelid::regclass::text,
      'cols', (select json_agg(a.attname order by a.attnum) from pg_attribute a
               where a.attrelid = c.conrelid and a.attnum = any (c.conkey))) order by c.conname)
    from pg_constraint c where c.contype = 'f' and c.connamespace = 'public'::regnamespace),
  'pks', (select json_object_agg(c.conrelid::regclass::text,
      (select json_agg(a.attname order by a.attnum) from pg_attribute a
       where a.attrelid = c.conrelid and a.attnum = any (c.conkey)))
    from pg_constraint c where c.contype = 'p' and c.connamespace = 'public'::regnamespace),
  'functions', (select json_object_agg(proname, json_build_object(
      'args', coalesce(proargnames[1:pronargs], '{}'), 'defaults', pronargdefaults))
    from pg_proc where pronamespace = 'public'::regnamespace)
);
