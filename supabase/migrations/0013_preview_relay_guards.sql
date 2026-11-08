-- Additive. Do not edit 0001–0012. Do not apply this from the app.
-- Apply after 0012. This file replaces functions and adds an outbox.
-- It does not update existing visit rows and does not send mail.
-- Sending stays disabled even when a caller asks for a send.

-- Replacing a photo drops the previous Drive id and approval until a new file is stored.
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
  if v_session.is_sandbox is distinct from private.in_practice() and not private.is_admin() then
    raise exception 'Switch Practice mode so it matches this visit.';
  end if;

  insert into public.photo_audit_shots (
    session_id, person_id, site_id, shot_key, shot_label, content_sha256, byte_size,
    storage_state, is_sandbox, idempotency_key, created_by
  ) values (
    p_session, v_session.person_id, v_session.site_id, p_shot_key,
    coalesce(nullif(trim(p_label), ''), p_shot_key), v_sha, p_bytes,
    'local_only', v_session.is_sandbox, p_key, auth.uid()
  )
  on conflict (session_id, shot_key) do update
    set shot_label = excluded.shot_label,
        content_sha256 = excluded.content_sha256,
        byte_size = excluded.byte_size,
        storage_state = case
          when public.photo_audit_shots.content_sha256 is not distinct from excluded.content_sha256
           and public.photo_audit_shots.storage_state = 'stored' then 'stored'
          else 'local_only'
        end,
        drive_file_id = case
          when public.photo_audit_shots.content_sha256 is not distinct from excluded.content_sha256
           and public.photo_audit_shots.storage_state = 'stored' then public.photo_audit_shots.drive_file_id
          else null
        end,
        review_status = case
          when public.photo_audit_shots.content_sha256 is not distinct from excluded.content_sha256
           and public.photo_audit_shots.storage_state = 'stored' then public.photo_audit_shots.review_status
          else 'pending'
        end,
        review_note = case
          when public.photo_audit_shots.content_sha256 is not distinct from excluded.content_sha256
           and public.photo_audit_shots.storage_state = 'stored' then public.photo_audit_shots.review_note
          else null
        end,
        reviewed_by = case
          when public.photo_audit_shots.content_sha256 is not distinct from excluded.content_sha256
           and public.photo_audit_shots.storage_state = 'stored' then public.photo_audit_shots.reviewed_by
          else null
        end,
        reviewed_at = case
          when public.photo_audit_shots.content_sha256 is not distinct from excluded.content_sha256
           and public.photo_audit_shots.storage_state = 'stored' then public.photo_audit_shots.reviewed_at
          else null
        end
  returning * into v_row;
  if v_row.storage_state = 'local_only' then
    delete from private.drive_file_acks where shot_id = v_row.id;
  end if;
  return to_jsonb(v_row);
end;
$$;

-- Written only by the upload function after Drive returns a file. Empty until then.
create table if not exists private.drive_file_acks (
  shot_id uuid primary key references public.photo_audit_shots (id) on delete cascade,
  file_id text not null check (file_id ~ '^[A-Za-z0-9_-]{10,128}$'),
  created_at timestamptz not null default now()
);
revoke all on table private.drive_file_acks from public, anon, authenticated;

create or replace function public.record_drive_ack(p_id uuid, p_file text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_file text := trim(coalesce(p_file, ''));
begin
  if v_file !~ '^[A-Za-z0-9_-]{10,128}$' then
    raise exception 'Drive did not return a file.';
  end if;
  if not exists (select 1 from public.photo_audit_shots where id = p_id) then
    raise exception 'Photo not found.';
  end if;
  insert into private.drive_file_acks (shot_id, file_id)
  values (p_id, v_file)
  on conflict (shot_id) do update set file_id = excluded.file_id, created_at = now();
end;
$$;

revoke all on function public.record_drive_ack(uuid, text) from public, anon, authenticated;
grant execute on function public.record_drive_ack(uuid, text) to service_role;

drop function if exists public.mark_photo_stored(uuid, text, text);

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
  if v_row.storage_state = 'stored' and v_row.drive_file_id = v_file then
    return to_jsonb(v_row);
  end if;
  if v_row.drive_file_id is not null and v_row.drive_file_id <> v_file then
    raise exception 'This photo already has a different Drive file.';
  end if;
  if not exists (
    select 1 from private.drive_file_acks where shot_id = p_id and file_id = v_file
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
  if private.in_practice() and v_session.is_sandbox = false then
    raise exception 'Practice cannot change a live visit.';
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
      and ss.status = 'completed'
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
  perform pg_advisory_xact_lock(hashtext(p_sku::text)::bigint);
  if p_key is not null then
    select * into v_existing from public.inventory_tx where idempotency_key = p_key;
    if found then
      if v_existing.person_id is distinct from v_person or v_existing.for_site_id is distinct from p_for_site then
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

-- Practice cannot complete a live visit. Photo and KC rules are otherwise unchanged.
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

create table if not exists public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  is_sandbox boolean not null default false,
  legacy_id text,
  idempotency_key uuid unique,
  kind text not null check (kind in ('pickup', 'reorder')),
  status text not null default 'disabled' check (status in ('preview', 'disabled')),
  sender text not null,
  recipients jsonb not null,
  payload jsonb not null,
  sent boolean not null default false check (sent = false)
);

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
  v_recipients jsonb;
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
    select coalesce(jsonb_agg(email) filter (where email is not null), '[]'::jsonb)
      into v_recipients
    from public.people
    where role = 'admin' and active;
  else
    v_recipients := '[]'::jsonb;
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
      'note', case
        when p_kind = 'pickup' then 'No next tech is assigned. None was guessed. Sending is disabled.'
        else 'Sending is disabled. This row is a preview only.'
      end
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

revoke all on function public.preview_ops_notification(text, uuid, boolean) from public, anon;
grant execute on function public.preview_ops_notification(text, uuid, boolean) to authenticated;

alter table public.notification_outbox enable row level security;
drop policy if exists notification_admin on public.notification_outbox;
create policy notification_admin on public.notification_outbox
  for select to authenticated
  using (private.is_admin());
grant select on public.notification_outbox to authenticated;

-- Direct table writes would skip the practice guard and could mark a photo stored.
drop policy if exists photo_admin on public.photo_audit_shots;
drop policy if exists kc_admin on public.kc_confirmations;
revoke insert, update, delete on public.photo_audit_shots from authenticated;
revoke insert, update, delete on public.kc_confirmations from authenticated;

create or replace function private.reorder_notice_stays_held()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from 'held' then
    raise exception 'Sending is disabled.';
  end if;
  return new;
end;
$$;

drop trigger if exists reorder_notices_no_send on public.reorder_notices;
create trigger reorder_notices_no_send
  before insert or update on public.reorder_notices
  for each row execute function private.reorder_notice_stays_held();

revoke insert, update, delete on public.reorder_notices from authenticated;
