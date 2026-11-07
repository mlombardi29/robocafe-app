-- Additive. 0001–0005 are already applied on the hosted project; do not edit them.
-- Requires 0005, which creates private.current_person_id() and private.in_practice().
-- Does not delete visits, completions, or last-done dates. Does not change live rows.
-- No edge function redeploy. The app calls this through the Data API.

create or replace function public.start_fresh_practice(
  p_session uuid,
  p_new_id uuid,
  p_start timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person uuid;
  v_session public.service_sessions;
  v_site public.sites;
  v_open public.service_sessions;
  v_existing public.service_sessions;
begin
  v_person := private.current_person_id();
  if v_person is null then
    raise exception 'Not signed in.';
  end if;
  if p_session is null or p_new_id is null or p_start is null then
    raise exception 'Fresh start needs the current visit, a new visit, and a time.';
  end if;
  if p_session = p_new_id then
    raise exception 'The new visit must be a different id.';
  end if;
  if not private.in_practice() then
    raise exception 'Switch to Practice mode. Live visits were not changed.';
  end if;

  select * into v_session
  from public.service_sessions
  where id = p_session
  for update;
  if not found then
    raise exception 'Visit not found.';
  end if;
  if v_session.person_id <> v_person then
    raise exception 'Not allowed.';
  end if;
  if not v_session.is_sandbox then
    raise exception 'Live visits were not changed.';
  end if;

  select * into v_site from public.sites where id = v_session.site_id;
  if not found or not v_site.is_sandbox then
    raise exception 'Live visits were not changed.';
  end if;

  select * into v_existing
  from public.service_sessions
  where id = p_new_id
  for update;
  if found then
    if v_existing.person_id <> v_person
       or v_existing.site_id <> v_session.site_id
       or not v_existing.is_sandbox then
      raise exception 'Not allowed.';
    end if;
    if v_existing.status <> 'open' then
      raise exception 'Pick a new visit. Nothing was changed.';
    end if;
  end if;

  if v_session.status = 'voided' then
    select * into v_open
    from public.service_sessions
    where site_id = v_session.site_id
      and person_id = v_person
      and status = 'open'
      and is_sandbox
    for update;
    if found then
      return to_jsonb(v_open);
    end if;
    return public.start_session(p_new_id, v_session.site_id, p_start, false);
  end if;

  if v_session.status <> 'open' then
    raise exception 'This visit is already finished. It was not changed.';
  end if;

  update public.service_sessions
    set status = 'voided',
        notes = concat_ws(E'\n', notes, 'Set aside for a fresh practice visit.')
    where id = p_session
      and status = 'open'
      and person_id = v_person
      and is_sandbox;
  if not found then
    raise exception 'This visit was not changed.';
  end if;

  return public.start_session(p_new_id, v_session.site_id, p_start, false);
end;
$$;

revoke all on function public.start_fresh_practice(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.start_fresh_practice(uuid, uuid, timestamptz) to authenticated;
