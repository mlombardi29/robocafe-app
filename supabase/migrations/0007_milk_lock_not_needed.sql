-- Additive. Do not edit 0001–0006. Do not apply this from the app.
-- There was no server lock. save_completion accepted Done during the timer.
-- The phone already hides Done. This rejects that save once applied.
-- Not needed on Wipe the Cameo is allowed while the timer runs.
-- Other locked steps stay fully locked. They are prep that would interrupt the cleaning.

create or replace function public.save_completion(
  p_session uuid,
  p_item uuid,
  p_state text,
  p_value text,
  p_note text,
  p_override_reason text,
  p_rev integer,
  p_key uuid,
  p_step text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.service_sessions;
  v_row public.service_item_completions;
  v_person uuid;
  v_key text;
  v_locked boolean;
  v_minutes integer;
  v_running boolean;
begin
  v_person := public.current_person_id();
  if v_person is null then
    raise exception 'Not signed in.';
  end if;
  if p_state not in ('done', 'not_needed', 'na', 'override') then
    raise exception 'Unknown step state.';
  end if;
  if p_key is null then
    raise exception 'Missing idempotency key.';
  end if;

  select * into v_session from public.service_sessions where id = p_session;
  if not found then
    raise exception 'Visit not found.';
  end if;
  if v_session.person_id <> v_person and not public.is_admin() then
    raise exception 'Not allowed.';
  end if;
  if v_session.is_sandbox is distinct from public.in_practice() and not public.is_admin() then
    raise exception 'Switch Practice mode so it matches this visit.';
  end if;

  select * into v_row
  from public.service_item_completions
  where session_id = p_session and item_id = p_item;

  if v_session.status <> 'open' then
    if v_row.id is not null then
      return to_jsonb(v_row);
    end if;
    raise exception 'This visit is already submitted.';
  end if;

  if v_row.id is not null and v_row.client_rev > coalesce(p_rev, 0) then
    return to_jsonb(v_row);
  end if;

  select item->>'key', (item->>'locked_during_clean') = 'true'
    into v_key, v_locked
  from jsonb_array_elements(coalesce(v_session.checklist_snapshot->'sections', '[]'::jsonb)) sec
  cross join lateral jsonb_array_elements(coalesce(sec->'items', '[]'::jsonb)) item
  where item->>'id' = p_item::text
  limit 1;

  if v_key is null then
    select i.key, i.locked_during_clean
      into v_key, v_locked
    from public.checklist_items i
    where i.id = p_item;
  end if;

  v_minutes := nullif(v_session.checklist_snapshot->>'milk_clean_minutes', '')::integer;
  if v_minutes is null then
    select m.milk_clean_minutes into v_minutes
    from public.sites s
    join public.models m on m.id = s.model_id
    where s.id = v_session.site_id;
  end if;

  v_running := v_session.milk_clean_started_at is not null
    and v_session.milk_clean_done_at is null
    and coalesce(v_minutes, 0) > 0
    and now() < v_session.milk_clean_started_at + make_interval(mins => v_minutes);

  if v_running and coalesce(v_locked, false) then
    if v_key = 'wipe_cameo' then
      if p_state is distinct from 'not_needed' then
        raise exception 'Done unlocks when milk cleaning finishes. You can mark Not needed now.';
      end if;
    else
      raise exception 'This step stays locked until milk cleaning finishes.';
    end if;
  end if;

  if v_row.id is null then
    insert into public.service_item_completions (
      session_id, item_id, state, value, note, override_reason,
      client_rev, idempotency_key, updated_at, created_by
    ) values (
      p_session, p_item, p_state, p_value, p_note, p_override_reason,
      coalesce(p_rev, 0), p_key, now(), auth.uid()
    )
    on conflict (session_id, item_id) do update
      set state = excluded.state,
          value = excluded.value,
          note = excluded.note,
          override_reason = excluded.override_reason,
          client_rev = excluded.client_rev,
          updated_at = now()
      where public.service_item_completions.client_rev <= excluded.client_rev
    returning * into v_row;
  else
    update public.service_item_completions
      set state = p_state,
          value = p_value,
          note = p_note,
          override_reason = p_override_reason,
          client_rev = coalesce(p_rev, 0),
          updated_at = now()
      where id = v_row.id
        and client_rev <= coalesce(p_rev, 0)
      returning * into v_row;
  end if;

  if p_step is not null then
    update public.service_sessions
      set current_step_key = p_step
      where id = p_session and status = 'open';
  end if;

  return to_jsonb(v_row);
end;
$$;
