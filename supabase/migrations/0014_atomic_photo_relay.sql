-- Additive. Apply after 0013. Do not apply this from the app.
-- This file does not update existing visit rows.
-- A new start can record photo eligibility in the same transaction.
-- A start that omits p_photo_audit, and a retry of an existing visit, leave the snapshot alone.
-- Sending stays disabled. Reorder addresses are not stored in this file.

alter table public.photo_audit_shots
  add column if not exists content_version integer not null default 1;

alter table private.drive_file_acks
  add column if not exists content_sha256 text,
  add column if not exists byte_size integer,
  add column if not exists content_version integer;

create table if not exists private.notification_recipients (
  kind text not null check (kind in ('reorder')),
  slot text not null check (slot in ('michael', 'kajsa')),
  email text,
  primary key (kind, slot)
);
revoke all on table private.notification_recipients from public, anon, authenticated;

create or replace function private.photo_audit_required(
  p_person uuid,
  p_site uuid,
  p_sandbox boolean,
  p_except uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select count(*) < 3
  from (
    select s.session_id
    from public.photo_audit_shots s
    join public.service_sessions ss on ss.id = s.session_id
    where s.person_id = p_person
      and s.site_id = p_site
      and ss.is_sandbox = p_sandbox
      and ss.status = 'completed'
      and s.session_id is distinct from p_except
    group by s.session_id
    having count(*) filter (where s.review_status = 'ok' and s.storage_state = 'stored') = 7
  ) ok_visits
$$;

revoke all on function private.photo_audit_required(uuid, uuid, boolean, uuid) from public, anon, authenticated;

-- Existing visit: return it unchanged. New visit with p_photo_audit true: the field is part of the insert.
drop function if exists public.start_session(uuid, uuid, timestamptz, boolean);

create function public.start_session(
  p_id uuid,
  p_site uuid,
  p_start timestamptz,
  p_estimated boolean default false,
  p_photo_audit boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person uuid;
  v_site public.sites;
  v_template public.checklist_templates;
  v_row public.service_sessions;
  v_snap jsonb;
  v_practice boolean;
  v_inserted boolean := false;
begin
  v_person := private.current_person_id();
  if v_person is null then
    raise exception 'Not signed in.';
  end if;
  if p_id is null or p_site is null or p_start is null then
    raise exception 'Start needs a session, a site, and a time.';
  end if;

  select * into v_row from public.service_sessions where id = p_id;
  if found then
    if v_row.person_id <> v_person and not private.is_admin() then
      raise exception 'Not allowed.';
    end if;
    return to_jsonb(v_row);
  end if;

  select * into v_site from public.sites where id = p_site;
  if not found then
    raise exception 'Site not found.';
  end if;
  if not private.can_see_site(p_site) then
    raise exception 'Not allowed.';
  end if;
  if not v_site.active and not private.is_admin() then
    raise exception 'This kiosk is offline for the season.';
  end if;

  v_practice := private.in_practice();
  if v_site.is_sandbox is distinct from v_practice then
    raise exception 'Switch Practice mode so it matches this site.';
  end if;

  select * into v_template
  from public.checklist_templates
  where model_id = v_site.model_id and published
  order by version desc
  limit 1;
  if v_template.id is null then
    raise exception 'No published checklist for this kiosk.';
  end if;

  select jsonb_build_object(
    'version', v_template.version,
    'template_id', v_template.id,
    'model_code', m.code,
    'milk_clean_minutes', m.milk_clean_minutes,
    'sections', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'title', s.title,
          'phase', s.phase,
          'position', s.position,
          'items', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', i.id,
                'key', i.key,
                'title', i.title,
                'details', i.details,
                'required', i.required,
                'cadence_type', i.cadence_type,
                'cadence_days', i.cadence_days,
                'threshold_label', i.threshold_label,
                'locked_during_clean', i.locked_during_clean,
                'blocks_clean_start', i.blocks_clean_start,
                'status', i.status,
                'position', i.position
              )
              order by i.position
            )
            from public.checklist_items i
            where i.section_id = s.id
          ), '[]'::jsonb)
        )
        order by s.position
      )
      from public.checklist_sections s
      where s.template_id = v_template.id
    ), '[]'::jsonb)
  )
  into v_snap
  from public.models m
  where m.id = v_site.model_id;

  if p_photo_audit is true then
    v_snap := v_snap || jsonb_build_object(
      'photo_audit',
      jsonb_build_object('required', private.photo_audit_required(v_person, p_site, v_site.is_sandbox, p_id))
    );
  end if;

  begin
    insert into public.service_sessions (
      id, site_id, person_id, template_id, template_version, checklist_snapshot,
      service_date, start_at, start_estimated, status, idempotency_key, created_by, is_sandbox
    ) values (
      p_id, p_site, v_person, v_template.id, v_template.version, v_snap,
      public.toronto_date(p_start), p_start, coalesce(p_estimated, false), 'open', p_id, auth.uid(), v_site.is_sandbox
    )
    returning * into v_row;
    v_inserted := true;
  exception
    when unique_violation then
      select * into v_row from public.service_sessions where id = p_id;
      if not found then
        raise exception 'A visit is already open.';
      end if;
  end;

  if v_inserted and p_photo_audit is true and not (v_row.checklist_snapshot ? 'photo_audit') then
    raise exception 'Photo audit eligibility was not recorded.';
  end if;
  return to_jsonb(v_row);
end;
$$;

revoke all on function public.start_session(uuid, uuid, timestamptz, boolean, boolean) from public, anon;
grant execute on function public.start_session(uuid, uuid, timestamptz, boolean, boolean) to authenticated;

create or replace function public.register_photo_shot(
  p_session uuid,
  p_shot_key text,
  p_label text,
  p_sha text,
  p_bytes integer,
  p_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.service_sessions;
  v_person uuid;
  v_row public.photo_audit_shots;
  v_sha text := nullif(trim(coalesce(p_sha, '')), '');
begin
  v_person := private.current_person_id();
  if v_person is null then
    raise exception 'Not signed in.';
  end if;
  if p_shot_key not in ('overall', 'cleaning', 'beans', 'powders', 'cups', 'closed', 'spouts') then
    raise exception 'Unknown photo.';
  end if;
  if v_sha is not null and v_sha !~ '^[0-9a-f]{64}$' then
    raise exception 'Photo details do not match.';
  end if;
  if p_bytes is null or p_bytes < 1 then
    raise exception 'Photo details do not match.';
  end if;
  select * into v_session from public.service_sessions where id = p_session;
  if not found then
    raise exception 'Visit not found.';
  end if;
  if v_session.person_id <> v_person then
    raise exception 'Not allowed.';
  end if;
  if private.in_practice() and v_session.is_sandbox = false then
    raise exception 'Practice cannot change a live visit.';
  end if;
  if v_session.is_sandbox is distinct from private.in_practice() then
    raise exception 'Switch Practice mode so it matches this visit.';
  end if;

  insert into public.photo_audit_shots (
    session_id, person_id, site_id, shot_key, shot_label, content_sha256, byte_size,
    content_version, storage_state, is_sandbox, idempotency_key, created_by
  ) values (
    p_session, v_session.person_id, v_session.site_id, p_shot_key,
    coalesce(nullif(trim(p_label), ''), p_shot_key), v_sha, p_bytes,
    1, 'local_only', v_session.is_sandbox, p_key, auth.uid()
  )
  on conflict (session_id, shot_key) do update
    set shot_label = excluded.shot_label,
        content_version = case
          when public.photo_audit_shots.content_sha256 is not distinct from excluded.content_sha256
           and public.photo_audit_shots.byte_size is not distinct from excluded.byte_size
          then public.photo_audit_shots.content_version
          else public.photo_audit_shots.content_version + 1
        end,
        content_sha256 = excluded.content_sha256,
        byte_size = excluded.byte_size,
        storage_state = case
          when public.photo_audit_shots.content_sha256 is not distinct from excluded.content_sha256
           and public.photo_audit_shots.byte_size is not distinct from excluded.byte_size
           and public.photo_audit_shots.storage_state = 'stored' then 'stored'
          else 'local_only'
        end,
        drive_file_id = case
          when public.photo_audit_shots.content_sha256 is not distinct from excluded.content_sha256
           and public.photo_audit_shots.byte_size is not distinct from excluded.byte_size
           and public.photo_audit_shots.storage_state = 'stored' then public.photo_audit_shots.drive_file_id
          else null
        end,
        review_status = case
          when public.photo_audit_shots.content_sha256 is not distinct from excluded.content_sha256
           and public.photo_audit_shots.byte_size is not distinct from excluded.byte_size
           and public.photo_audit_shots.storage_state = 'stored' then public.photo_audit_shots.review_status
          else 'pending'
        end,
        review_note = case
          when public.photo_audit_shots.content_sha256 is not distinct from excluded.content_sha256
           and public.photo_audit_shots.byte_size is not distinct from excluded.byte_size
           and public.photo_audit_shots.storage_state = 'stored' then public.photo_audit_shots.review_note
          else null
        end,
        reviewed_by = case
          when public.photo_audit_shots.content_sha256 is not distinct from excluded.content_sha256
           and public.photo_audit_shots.byte_size is not distinct from excluded.byte_size
           and public.photo_audit_shots.storage_state = 'stored' then public.photo_audit_shots.reviewed_by
          else null
        end,
        reviewed_at = case
          when public.photo_audit_shots.content_sha256 is not distinct from excluded.content_sha256
           and public.photo_audit_shots.byte_size is not distinct from excluded.byte_size
           and public.photo_audit_shots.storage_state = 'stored' then public.photo_audit_shots.reviewed_at
          else null
        end
  returning * into v_row;

  delete from private.drive_file_acks
  where shot_id = v_row.id
    and (
      content_sha256 is distinct from v_row.content_sha256
      or byte_size is distinct from v_row.byte_size
      or content_version is distinct from v_row.content_version
    );
  return to_jsonb(v_row);
end;
$$;

drop function if exists public.record_drive_ack(uuid, text);

create function public.record_drive_ack(
  p_id uuid,
  p_file text,
  p_sha text,
  p_bytes integer,
  p_version integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.photo_audit_shots;
  v_file text := trim(coalesce(p_file, ''));
begin
  if v_file !~ '^[A-Za-z0-9_-]{10,128}$' then
    raise exception 'Drive did not return a file.';
  end if;
  if p_sha !~ '^[0-9a-f]{64}$' or p_bytes is null or p_bytes < 1 or p_version is null or p_version < 1 then
    raise exception 'Photo details do not match.';
  end if;
  select * into v_row from public.photo_audit_shots where id = p_id for update;
  if not found then
    raise exception 'Photo not found.';
  end if;
  if v_row.content_sha256 is distinct from p_sha
     or v_row.byte_size is distinct from p_bytes
     or v_row.content_version is distinct from p_version then
    raise exception 'This photo changed before Drive confirmed it.';
  end if;
  insert into private.drive_file_acks (shot_id, file_id, content_sha256, byte_size, content_version)
  values (p_id, v_file, p_sha, p_bytes, p_version)
  on conflict (shot_id) do update
    set file_id = excluded.file_id,
        content_sha256 = excluded.content_sha256,
        byte_size = excluded.byte_size,
        content_version = excluded.content_version,
        created_at = now();
end;
$$;

revoke all on function public.record_drive_ack(uuid, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.record_drive_ack(uuid, text, text, integer, integer) to service_role;

create or replace function public.mark_photo_stored(p_id uuid, p_drive_file_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.photo_audit_shots;
  v_person uuid;
  v_file text := trim(coalesce(p_drive_file_id, ''));
begin
  v_person := private.current_person_id();
  if v_person is null then
    raise exception 'Not signed in.';
  end if;
  if v_file !~ '^[A-Za-z0-9_-]{10,128}$' then
    raise exception 'Drive did not return a file.';
  end if;
  select * into v_row from public.photo_audit_shots where id = p_id for update;
  if not found then
    raise exception 'Photo not found.';
  end if;
  if v_row.person_id <> v_person then
    raise exception 'Not allowed.';
  end if;
  if private.in_practice() and v_row.is_sandbox = false then
    raise exception 'Practice cannot change a live visit.';
  end if;
  if v_row.is_sandbox is distinct from private.in_practice() then
    raise exception 'Switch Practice mode so it matches this visit.';
  end if;
  if not exists (
    select 1 from private.drive_file_acks
    where shot_id = p_id
      and file_id = v_file
      and content_sha256 is not distinct from v_row.content_sha256
      and byte_size is not distinct from v_row.byte_size
      and content_version is not distinct from v_row.content_version
  ) then
    raise exception 'Drive did not confirm this file.';
  end if;
  update public.photo_audit_shots
    set storage_state = 'stored',
        drive_file_id = v_file
    where id = p_id
    returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.review_photo_shot(p_id uuid, p_status text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.photo_audit_shots;
begin
  if not private.is_admin() then
    raise exception 'Not allowed.';
  end if;
  if p_status not in ('ok', 'redo') then
    raise exception 'Mark the photo ok or redo.';
  end if;
  select * into v_row from public.photo_audit_shots where id = p_id for update;
  if not found then
    raise exception 'Photo not found.';
  end if;
  if private.in_practice() and v_row.is_sandbox = false then
    raise exception 'Practice cannot change a live visit.';
  end if;
  if v_row.is_sandbox is distinct from private.in_practice() then
    raise exception 'Switch Practice mode so it matches this visit.';
  end if;
  if v_row.storage_state <> 'stored' or v_row.drive_file_id is null then
    raise exception 'This photo is not in Drive yet.';
  end if;
  if not exists (
    select 1 from private.drive_file_acks
    where shot_id = p_id
      and file_id = v_row.drive_file_id
      and content_sha256 is not distinct from v_row.content_sha256
      and byte_size is not distinct from v_row.byte_size
      and content_version is not distinct from v_row.content_version
  ) then
    raise exception 'Drive did not confirm this file.';
  end if;
  update public.photo_audit_shots
    set review_status = p_status,
        review_note = nullif(trim(coalesce(p_note, '')), ''),
        reviewed_by = private.current_person_id(),
        reviewed_at = now()
    where id = p_id
    returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.save_kc_confirmation(
  p_session uuid,
  p_sku uuid,
  p_filled_to_max boolean,
  p_quantity numeric,
  p_confirmed boolean,
  p_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.service_sessions;
  v_person uuid;
  v_row public.kc_confirmations;
begin
  v_person := private.current_person_id();
  if v_person is null then
    raise exception 'Not signed in.';
  end if;
  select * into v_session from public.service_sessions where id = p_session;
  if not found then
    raise exception 'Visit not found.';
  end if;
  if v_session.person_id <> v_person and not private.is_admin() then
    raise exception 'Not allowed.';
  end if;
  if private.in_practice() and v_session.is_sandbox = false then
    raise exception 'Practice cannot change a live visit.';
  end if;
  if v_session.is_sandbox is distinct from private.in_practice() then
    raise exception 'Switch Practice mode so it matches this visit.';
  end if;
  if v_session.status <> 'open' then
    raise exception 'This visit is already submitted.';
  end if;
  if p_confirmed and not coalesce(p_filled_to_max, true) and p_quantity is null then
    raise exception 'Type the quantity you entered in KC Manager.';
  end if;
  insert into public.kc_confirmations (
    session_id, sku_id, filled_to_max, typed_quantity, confirmed, is_sandbox, idempotency_key, created_by
  ) values (
    p_session, p_sku, coalesce(p_filled_to_max, true), p_quantity, coalesce(p_confirmed, false),
    v_session.is_sandbox, p_key, auth.uid()
  )
  on conflict (session_id, sku_id) do update
    set filled_to_max = excluded.filled_to_max,
        typed_quantity = excluded.typed_quantity,
        confirmed = excluded.confirmed
  returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.freeze_photo_audit(p_session uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.service_sessions;
  v_person uuid;
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
  if private.in_practice() and v_session.is_sandbox = false then
    raise exception 'Practice cannot change a live visit.';
  end if;
  if v_session.is_sandbox is distinct from private.in_practice() then
    raise exception 'Switch Practice mode so it matches this visit.';
  end if;
  if v_session.checklist_snapshot is null or v_session.status <> 'open' then
    return jsonb_build_object('required', false);
  end if;
  if v_session.checklist_snapshot ? 'photo_audit' then
    return v_session.checklist_snapshot -> 'photo_audit';
  end if;

  v_required := private.photo_audit_required(v_session.person_id, v_session.site_id, v_session.is_sandbox, p_session);
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
  if private.in_practice() and v_session.is_sandbox = false then
    raise exception 'Practice cannot change a live visit.';
  end if;
  if v_session.is_sandbox is distinct from private.in_practice() then
    raise exception 'Switch Practice mode so it matches this visit.';
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
      where k.session_id = p_id and k.sku_id = i.sku_id and k.confirmed
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
  where c.session_id = p_id and c.state = 'done'
  on conflict (site_id, item_id) do update
    set last_done_at = excluded.last_done_at,
        last_done_by = excluded.last_done_by;
  return to_jsonb(v_session);
end;
$$;

create or replace function public.record_dupont_pickup(
  p_sku uuid,
  p_for_site uuid,
  p_qty numeric,
  p_note text,
  p_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person uuid;
  v_existing public.inventory_tx;
  v_on_hand numeric;
  v_sandbox boolean;
  v_row public.inventory_tx;
begin
  v_person := private.current_person_id();
  if v_person is null or not private.can_write() then
    raise exception 'Not allowed.';
  end if;
  if p_for_site is null or p_qty is null or p_qty <= 0 then
    raise exception 'Say which kiosk this pickup is for and how many.';
  end if;
  if not private.can_see_site(p_for_site) then
    raise exception 'Not allowed.';
  end if;
  select s.is_sandbox into v_sandbox from public.sites s where s.id = p_for_site;
  if private.in_practice() and v_sandbox = false then
    raise exception 'Practice cannot change live stock.';
  end if;
  if v_sandbox is distinct from private.in_practice() then
    raise exception 'Switch Practice mode so it matches this site.';
  end if;
  perform pg_advisory_xact_lock(hashtext(p_sku::text)::bigint);
  if p_key is not null then
    select * into v_existing from public.inventory_tx where idempotency_key = p_key;
    if found then
      if v_existing.person_id is distinct from v_person
         or v_existing.for_site_id is distinct from p_for_site
         or v_existing.sku_id is distinct from p_sku
         or v_existing.delta_base is distinct from -p_qty
         or v_existing.is_sandbox is distinct from private.in_practice() then
        raise exception 'That save belongs to another pickup.';
      end if;
      return to_jsonb(v_existing);
    end if;
  end if;
  if not exists (select 1 from public.skus where id = p_sku and source = 'dupont' and active) then
    raise exception 'That item is not a Dupont item.';
  end if;
  select coalesce(sum(delta_base), 0) into v_on_hand
  from public.inventory_tx
  where sku_id = p_sku and location = 'dupont' and site_id is null and is_sandbox = private.in_practice();
  if p_qty > v_on_hand then
    raise exception 'That is more than is on hand.';
  end if;
  insert into public.inventory_tx (
    sku_id, type, delta_base, person_id, site_id, location, for_site_id, note, is_sandbox, idempotency_key, created_by
  ) values (
    p_sku, 'withdrawal', -p_qty, v_person, null, 'dupont', p_for_site,
    nullif(trim(coalesce(p_note, '')), ''), private.in_practice(), p_key, auth.uid()
  )
  returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.preview_ops_notification(
  p_kind text,
  p_key uuid,
  p_request_send boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.notification_outbox;
  v_recipients jsonb := '[]'::jsonb;
  v_note text;
begin
  if not private.is_admin() then
    raise exception 'Not allowed.';
  end if;
  if p_key is null then
    raise exception 'Missing save id.';
  end if;
  if p_kind not in ('pickup', 'reorder') then
    raise exception 'Unknown notification.';
  end if;
  if p_kind = 'reorder' then
    select coalesce(jsonb_agg(lower(trim(email)) order by slot), '[]'::jsonb)
      into v_recipients
    from private.notification_recipients
    where kind = 'reorder'
      and slot in ('michael', 'kajsa')
      and email is not null
      and length(trim(email)) > 3
      and position('@' in email) > 1;
    if jsonb_array_length(v_recipients) is distinct from 2 then
      v_recipients := '[]'::jsonb;
      v_note := 'Reorder recipients are not configured. Sending is disabled.';
    else
      v_note := 'Sending is disabled. This row is a preview only.';
    end if;
  else
    v_note := 'No next tech is assigned. None was guessed. Sending is disabled.';
  end if;
  insert into public.notification_outbox (
    kind, status, sender, recipients, payload, sent, is_sandbox, idempotency_key, created_by
  ) values (
    p_kind,
    'disabled',
    'michael@certainventures.ca',
    v_recipients,
    jsonb_build_object(
      'requested_send', coalesce(p_request_send, false),
      'practice', private.in_practice(),
      'recipient_count', jsonb_array_length(v_recipients),
      'note', v_note
    ),
    false,
    private.in_practice(),
    p_key,
    auth.uid()
  )
  on conflict (idempotency_key) do nothing;
  select * into v_row from public.notification_outbox where idempotency_key = p_key;
  return jsonb_build_object(
    'sent', false,
    'status', 'disabled',
    'id', v_row.id,
    'sender', 'michael@certainventures.ca',
    'recipient_count', jsonb_array_length(v_row.recipients)
  );
end;
$$;
