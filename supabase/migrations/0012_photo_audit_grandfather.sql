-- Additive. Do not edit 0001–0011. Do not apply this from the app.
-- Apply after 0011_ops_batch.sql. Applying this file updates no existing visit rows by itself.
-- freeze_photo_audit writes photo_audit.required onto one open visit, and only when that
-- visit does not already have the field. A second call does not change it.
-- Visits without the field, including visits opened before this feature and visits
-- started by an older phone, are not required to have photo-audit shots.
-- Required checklist steps and KC Manager lines are unchanged.

create or replace function public.freeze_photo_audit(p_session uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.service_sessions;
  v_person uuid;
  v_ok integer;
  v_required boolean;
  v_flag jsonb;
begin
  v_person := private.current_person_id();
  if v_person is null then
    raise exception 'Not signed in.';
  end if;
  select * into v_session from public.service_sessions where id = p_session for update;
  if not found then
    raise exception 'Visit not found.';
  end if;
  if v_session.person_id <> v_person and not private.is_admin() then
    raise exception 'Not allowed.';
  end if;
  if v_session.is_sandbox is distinct from private.in_practice() and not private.is_admin() then
    raise exception 'Switch Practice mode so it matches this visit.';
  end if;
  if v_session.checklist_snapshot is null or v_session.status <> 'open' then
    return jsonb_build_object('required', false);
  end if;
  if v_session.checklist_snapshot ? 'photo_audit' then
    return v_session.checklist_snapshot -> 'photo_audit';
  end if;

  select count(*) into v_ok
  from (
    select s.session_id
    from public.photo_audit_shots s
    join public.service_sessions ss on ss.id = s.session_id
    where s.person_id = v_session.person_id
      and s.site_id = v_session.site_id
      and ss.is_sandbox = v_session.is_sandbox
      and s.session_id <> p_session
    group by s.session_id
    having count(*) filter (where s.review_status = 'ok' and s.storage_state = 'stored') = 7
  ) ok_visits;
  v_required := v_ok < 3;
  v_flag := jsonb_build_object('required', v_required);

  update public.service_sessions
    set checklist_snapshot = checklist_snapshot || jsonb_build_object('photo_audit', v_flag)
    where id = p_session
      and status = 'open'
      and checklist_snapshot is not null
      and not (checklist_snapshot ? 'photo_audit');
  return v_flag;
end;
$$;

-- Same completion rule as corrected 0011. Repeated here so a database that already
-- ran the first draft of 0011 (photos required whenever fewer than three audits
-- existed) is corrected without editing that applied file.
create or replace function public.complete_session(
  p_id uuid,
  p_end timestamptz,
  p_start_estimate timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.service_sessions;
  v_person uuid;
  v_start timestamptz;
  v_end timestamptz;
  v_estimated boolean;
  v_missing integer;
  v_photos integer;
  v_kc integer;
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
  if v_session.status = 'completed' then
    return to_jsonb(v_session);
  end if;
  if v_session.status = 'voided' then
    raise exception 'This visit was voided.';
  end if;

  select count(*) into v_missing
  from jsonb_array_elements(coalesce(v_session.checklist_snapshot -> 'sections', '[]'::jsonb)) sec
  cross join lateral jsonb_array_elements(coalesce(sec -> 'items', '[]'::jsonb)) item
  where coalesce((item ->> 'required')::boolean, true)
    and not (
      exists (
        select 1 from public.service_item_completions c
        where c.session_id = p_id
          and c.item_id = (item ->> 'id')::uuid
          and c.state in ('done', 'not_needed')
      )
      or (
        item ->> 'key' = 'start_milk_clean'
        and v_session.milk_clean_started_at is not null
      )
    );
  if v_missing > 0 then
    raise exception 'Required steps are still open.';
  end if;

  select count(*) into v_kc
  from public.service_item_completions c
  join public.checklist_items i on i.id = c.item_id
  join public.site_skus ss on ss.site_id = v_session.site_id and ss.sku_id = i.sku_id
  where c.session_id = p_id
    and c.state = 'done'
    and ss.kc_max is not null
    and not exists (
      select 1 from public.kc_confirmations k
      where k.session_id = p_id
        and k.sku_id = i.sku_id
        and k.confirmed
    );
  if v_kc > 0 then
    raise exception 'KC Manager lines are not confirmed.';
  end if;

  if coalesce((v_session.checklist_snapshot -> 'photo_audit' ->> 'required') = 'true', false) then
    select count(distinct shot_key) into v_photos
    from public.photo_audit_shots
    where session_id = p_id
      and shot_key in ('overall', 'cleaning', 'beans', 'powders', 'cups', 'closed', 'spouts');
    if v_photos < 7 then
      raise exception 'Photo audit shots are still missing.';
    end if;
  end if;

  v_estimated := v_session.start_estimated;
  v_start := v_session.start_at;
  if v_start is null then
    if p_start_estimate is null then
      raise exception 'Add a start time. Next time, tap Start now when you arrive.';
    end if;
    v_start := p_start_estimate;
    v_estimated := true;
  end if;
  v_end := coalesce(p_end, v_session.end_at, now());

  update public.service_sessions
    set start_at = v_start,
        end_at = v_end,
        start_estimated = v_estimated,
        service_date = public.toronto_date(v_start),
        status = 'completed',
        submitted_at = coalesce(submitted_at, now())
    where id = p_id
    returning * into v_session;

  insert into public.site_item_state (site_id, item_id, last_done_at, last_done_by, is_sandbox, created_by)
  select v_session.site_id, c.item_id, v_session.end_at, v_session.person_id, v_session.is_sandbox, auth.uid()
  from public.service_item_completions c
  where c.session_id = p_id
    and c.state = 'done'
  on conflict (site_id, item_id) do update
    set last_done_at = excluded.last_done_at,
        last_done_by = excluded.last_done_by;

  return to_jsonb(v_session);
end;
$$;

revoke all on function public.freeze_photo_audit(uuid) from public, anon;
grant execute on function public.freeze_photo_audit(uuid) to authenticated;
