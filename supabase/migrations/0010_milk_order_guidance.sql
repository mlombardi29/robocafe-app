-- Additive. Do not edit 0001–0009. Do not apply this from the app.
-- Checklist order is guidance. Starting milk cleaning no longer waits for prep steps
-- or an override reason. The timer still has to be started before it can be marked done.
-- Locked-during-clean rules in save_completion are unchanged.

create or replace function public.set_milk_clean(
  p_id uuid,
  p_action text,
  p_override_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.service_sessions;
  v_person uuid;
begin
  v_person := private.current_person_id();
  if v_person is null then
    raise exception 'Not signed in.';
  end if;
  select * into v_session from public.service_sessions where id = p_id for update;
  if not found then
    raise exception 'Visit not found.';
  end if;
  if v_session.person_id <> v_person and not private.is_admin() then
    raise exception 'Not allowed.';
  end if;
  if v_session.is_sandbox is distinct from private.in_practice() and not private.is_admin() then
    raise exception 'Switch Practice mode so it matches this visit.';
  end if;
  if v_session.status <> 'open' then
    return to_jsonb(v_session);
  end if;

  if p_action = 'done' then
    if v_session.milk_clean_started_at is null then
      raise exception 'Start milk cleaning before marking it done.';
    end if;
    update public.service_sessions
      set milk_clean_done_at = coalesce(milk_clean_done_at, now())
      where id = p_id
      returning * into v_session;
    return to_jsonb(v_session);
  end if;

  if p_action <> 'start' then
    raise exception 'Unknown milk-cleaning action.';
  end if;
  if v_session.milk_clean_started_at is not null then
    return to_jsonb(v_session);
  end if;

  -- p_override_reason is accepted so older phones still call this function.
  -- Order no longer requires it.
  update public.service_sessions
    set milk_clean_started_at = now(),
        milk_clean_override_reason = nullif(trim(coalesce(p_override_reason, '')), '')
    where id = p_id
    returning * into v_session;
  return to_jsonb(v_session);
end;
$$;

revoke all on function public.set_milk_clean(uuid, text, text) from public, anon;
grant execute on function public.set_milk_clean(uuid, text, text) to authenticated;
