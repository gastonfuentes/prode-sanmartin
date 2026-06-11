-- Migration: 025_list_participants
-- Participants list with an `active` flag for the Participantes panel.
--
-- Background: the soft-baja feature (migration 024) broke an implicit invariant —
-- "every profile is whitelisted". A revoked user keeps their profile (so their
-- history survives) but is no longer in allowed_emails. The Participantes panel
-- queried public.profiles directly, so revoked users still showed with no marker.
--
-- This RPC returns every profile plus an `active` flag (email still in
-- allowed_emails, OR an admin) so the UI can tag inactive users "Inactivo"
-- WITHOUT hiding them — their points stay in the standings. SECURITY DEFINER
-- because allowed_emails/admins have no client RLS. Available to all authenticated
-- users (the panel is shared game info, not admin-only).

create or replace function public.list_participants()
returns table (
  id           uuid,
  display_name text,
  avatar_url   text,
  active       boolean
)
language sql
security definer set search_path = public
stable
as $$
  select
    pr.id,
    pr.display_name,
    pr.avatar_url,
    (
      exists (select 1 from public.allowed_emails ae where ae.email = pr.email)
      or exists (select 1 from public.admins a where a.email = pr.email)
    ) as active
  from public.profiles pr
  order by pr.display_name;
$$;

comment on function public.list_participants() is
  'Every profile plus an active flag (email in allowed_emails OR admin) for the '
  'Participantes panel. SECURITY DEFINER — reads allowed_emails/admins (no client '
  'RLS). Lets the UI tag revoked users "Inactivo" without hiding them or dropping '
  'their standings points.';

grant execute on function public.list_participants() to authenticated;
