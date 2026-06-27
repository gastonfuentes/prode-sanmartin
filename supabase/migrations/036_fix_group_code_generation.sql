-- Migration: 036_fix_group_code_generation
--
-- Hotfix: admin_create_group() failed in production with
-- "function gen_random_bytes(integer) does not exist".
--
-- Root cause: mig 035 generated the invite code with gen_random_bytes(6), which
-- lives in the pgcrypto extension. On Supabase, pgcrypto is installed in the
-- `extensions` schema, NOT in `public`. admin_create_group is declared with
-- `set search_path = public`, so gen_random_bytes was never resolvable and every
-- create-group call raised at runtime (surfaced to the admin as the generic
-- "No se pudo crear el grupo. Intentá de nuevo.").
--
-- Fix: generate the code from gen_random_uuid(), which is core Postgres (lives in
-- pg_catalog, always on the implicit search_path) — no pgcrypto, no `extensions`
-- schema dependency. Produces 8 lowercase hex chars (0-9a-f), URL-safe and
-- consistent with join_group()'s case-insensitive compare (lower(invite_code)).
--
-- Only the code-generation line changes; the admin gate, empty-name validation,
-- unique_violation retry loop, and grant are identical to mig 035.

create or replace function public.admin_create_group(p_name text)
returns table (id bigint, name text, invite_code text)
language plpgsql
security definer set search_path = public
as $$
declare
  v_name  text := trim(p_name);
  v_code  text;
  v_id    bigint;
  v_name_out text;
  v_code_out text;
begin
  if not public.is_admin() then
    raise exception 'Not authorized: admin access required'
      using errcode = 'P0001';
  end if;

  if v_name = '' then
    raise exception 'Group name cannot be empty'
      using errcode = 'P0001';
  end if;

  loop
    -- gen_random_uuid() is core Postgres (pg_catalog) — no pgcrypto / extensions
    -- schema needed. 8 lowercase hex chars are plenty of entropy for an invite code.
    v_code := substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);

    begin
      insert into public.groups (name, invite_code)
      values (v_name, v_code)
      returning groups.id, groups.name, groups.invite_code
      into v_id, v_name_out, v_code_out;

      exit;  -- success, leave the retry loop
    exception
      when unique_violation then
        -- invite_code collision (extremely rare) — retry
        null;
    end;
  end loop;

  return query select v_id, v_name_out, v_code_out;
end;
$$;

comment on function public.admin_create_group(text) is
  'Admin-only: create a new group with a randomly generated invite code '
  '(gen_random_uuid-based, mig 036 — no pgcrypto dependency). Retries on the rare '
  'invite_code unique_violation. Raises P0001 for non-admins or empty names.';

grant execute on function public.admin_create_group(text) to authenticated;
