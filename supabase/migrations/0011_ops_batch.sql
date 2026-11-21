-- Additive. Do not edit 0001–0010. Do not apply this from the app.
-- No SKUs, stock counts, KC numbers, photos, or site codes are inserted.
-- This file does not update existing visit rows.
-- Photo audit is required only when a visit snapshot says photo_audit.required = true.
-- Visits already open, and starts from older phones, do not have that field, so they are not asked for photos.
-- 0012_photo_audit_grandfather.sql is what writes the field for a new visit. Apply 0011, then 0012, before using photo audit.
-- Drive upload is not performed here. Photo rows store metadata only.
-- Email is not sent.

alter table public.checklist_items
  add column if not exists sku_id uuid references public.skus (id) on delete set null;

alter table public.inventory_tx
  add column if not exists for_site_id uuid references public.sites (id);

create table if not exists public.photo_audit_shots (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  is_sandbox boolean not null default false,
  legacy_id text,
  idempotency_key uuid unique,
  session_id uuid not null references public.service_sessions (id) on delete cascade,
  person_id uuid not null references public.people (id),
  site_id uuid not null references public.sites (id),
  shot_key text not null check (shot_key in ('overall', 'cleaning', 'beans', 'powders', 'cups', 'closed', 'spouts')),
  shot_label text not null,
  content_sha256 text,
  byte_size integer,
  storage_state text not null default 'local_only' check (storage_state in ('local_only', 'stored')),
  drive_file_id text,
  review_status text not null default 'pending' check (review_status in ('pending', 'ok', 'redo')),
  review_note text,
  reviewed_by uuid references public.people (id),
  reviewed_at timestamptz,
  unique (session_id, shot_key)
);

create table if not exists public.kc_confirmations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  is_sandbox boolean not null default false,
  legacy_id text,
  idempotency_key uuid unique,
  session_id uuid not null references public.service_sessions (id) on delete cascade,
  sku_id uuid not null references public.skus (id),
  filled_to_max boolean not null default true,
  typed_quantity numeric,
  confirmed boolean not null default false,
  unique (session_id, sku_id)
);

create index if not exists photo_audit_person_site on public.photo_audit_shots (person_id, site_id);
create unique index if not exists stock_flags_one_open
  on public.stock_flags (site_id, sku_id)
  where resolved_at is null and sku_id is not null;

-- ---------------------------------------------------------------------------
-- Photos. Bytes stay off this table. Review needs a Drive file id.
-- ---------------------------------------------------------------------------

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
  if v_session.person_id <> v_person and not private.is_admin() then
    raise exception 'Not allowed.';
  end if;
  if v_session.is_sandbox is distinct from private.in_practice() and not private.is_admin() then
    raise exception 'Switch Practice mode so it matches this visit.';
  end if;

  insert into public.photo_audit_shots (
    session_id, person_id, site_id, shot_key, shot_label, content_sha256, byte_size,
    storage_state, is_sandbox, idempotency_key, created_by
  ) values (
    p_session, v_session.person_id, v_session.site_id, p_shot_key, coalesce(nullif(trim(p_label), ''), p_shot_key),
    nullif(trim(coalesce(p_sha, '')), ''), p_bytes, 'local_only', v_session.is_sandbox, p_key, auth.uid()
  )
  on conflict (session_id, shot_key) do update
    set shot_label = excluded.shot_label,
        content_sha256 = excluded.content_sha256,
        byte_size = excluded.byte_size,
        review_status = case
          when public.photo_audit_shots.review_status = 'redo' then 'pending'
          else public.photo_audit_shots.review_status
        end
  returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.mark_photo_stored(p_id uuid, p_drive_file_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.photo_audit_shots;
  v_person uuid;
begin
  v_person := private.current_person_id();
  if v_person is null then
    raise exception 'Not signed in.';
  end if;
  if nullif(trim(coalesce(p_drive_file_id, '')), '') is null then
    raise exception 'Drive did not return a file.';
  end if;
  select * into v_row from public.photo_audit_shots where id = p_id for update;
  if not found then
    raise exception 'Photo not found.';
  end if;
  if v_row.person_id <> v_person and not private.is_admin() then
    raise exception 'Not allowed.';
  end if;
  update public.photo_audit_shots
    set storage_state = 'stored',
        drive_file_id = trim(p_drive_file_id)
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
  if v_row.storage_state <> 'stored' or v_row.drive_file_id is null then
    raise exception 'This photo is not in Drive yet.';
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

-- ---------------------------------------------------------------------------
-- Flags and Dupont pickup. Pickup reduces Dupont stock once per idempotency key.
-- ---------------------------------------------------------------------------

create or replace function public.set_stock_flag(
  p_site uuid,
  p_sku uuid,
  p_status text,
  p_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person uuid;
  v_sandbox boolean;
  v_row public.stock_flags;
begin
  v_person := private.current_person_id();
  if v_person is null or not private.can_write() then
    raise exception 'Not allowed.';
  end if;
  if not private.can_see_site(p_site) then
    raise exception 'Not allowed.';
  end if;
  select s.is_sandbox into v_sandbox from public.sites s where s.id = p_site;
  if not found then
    raise exception 'Site not found.';
  end if;
  if v_sandbox is distinct from private.in_practice() and not private.is_admin() then
    raise exception 'Switch Practice mode so it matches this site.';
  end if;
  if private.in_practice() and v_sandbox = false then
    raise exception 'Practice cannot change live stock.';
  end if;

  if p_status = 'clear' then
    update public.stock_flags
      set resolved_at = now(),
          resolved_by = v_person
      where site_id = p_site
        and sku_id = p_sku
        and resolved_at is null
      returning * into v_row;
    return coalesce(to_jsonb(v_row), '{}'::jsonb);
  end if;
  if p_status not in ('low', 'out') then
    raise exception 'Flag Low or Out.';
  end if;

  select * into v_row
  from public.stock_flags
  where idempotency_key = p_key;
  if found then
    return to_jsonb(v_row);
  end if;

  update public.stock_flags
    set status = p_status
    where site_id = p_site
      and sku_id = p_sku
      and resolved_at is null
    returning * into v_row;
  if found then
    return to_jsonb(v_row);
  end if;

  insert into public.stock_flags (site_id, sku_id, status, is_sandbox, idempotency_key, created_by)
  values (p_site, p_sku, p_status, v_sandbox, p_key, auth.uid())
  returning * into v_row;
  return to_jsonb(v_row);
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
  v_existing public.inventory_tx;
  v_on_hand numeric;
  v_sandbox boolean;
  v_row public.inventory_tx;
begin
  if not private.can_write() then
    raise exception 'Not allowed.';
  end if;
  if p_key is not null then
    select * into v_existing from public.inventory_tx where idempotency_key = p_key;
    if found then
      return to_jsonb(v_existing);
    end if;
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
    p_sku, 'withdrawal', -p_qty, private.current_person_id(), null, 'dupont', p_for_site,
    nullif(trim(coalesce(p_note, '')), ''), private.in_practice(), p_key, auth.uid()
  )
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

-- ---------------------------------------------------------------------------
-- Complete checks required steps, Not needed, a real milk start, KC lines, and photos.
-- Order is not checked. Prep does not have to precede milk cleaning.
-- ---------------------------------------------------------------------------

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

  -- Missing photo_audit means this visit started before the rule, or the client
  -- did not opt in. Do not treat that as "photos required".
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

revoke all on function public.register_photo_shot(uuid, text, text, text, integer, uuid) from public, anon;
revoke all on function public.mark_photo_stored(uuid, text) from public, anon;
revoke all on function public.review_photo_shot(uuid, text, text) from public, anon;
revoke all on function public.set_stock_flag(uuid, uuid, text, uuid) from public, anon;
revoke all on function public.record_dupont_pickup(uuid, uuid, numeric, text, uuid) from public, anon;
revoke all on function public.save_kc_confirmation(uuid, uuid, boolean, numeric, boolean, uuid) from public, anon;
grant execute on function public.register_photo_shot(uuid, text, text, text, integer, uuid) to authenticated;
grant execute on function public.mark_photo_stored(uuid, text) to authenticated;
grant execute on function public.review_photo_shot(uuid, text, text) to authenticated;
grant execute on function public.set_stock_flag(uuid, uuid, text, uuid) to authenticated;
grant execute on function public.record_dupont_pickup(uuid, uuid, numeric, text, uuid) to authenticated;
grant execute on function public.save_kc_confirmation(uuid, uuid, boolean, numeric, boolean, uuid) to authenticated;

alter table public.photo_audit_shots enable row level security;
alter table public.kc_confirmations enable row level security;

drop policy if exists photo_select on public.photo_audit_shots;
create policy photo_select on public.photo_audit_shots
  for select to authenticated
  using (
    private.is_admin()
    or (
      person_id = private.current_person_id()
      and is_sandbox = private.in_practice()
    )
  );

drop policy if exists photo_admin on public.photo_audit_shots;
create policy photo_admin on public.photo_audit_shots
  for all to authenticated
  using (private.is_admin())
  with check (private.is_admin());

drop policy if exists kc_select on public.kc_confirmations;
create policy kc_select on public.kc_confirmations
  for select to authenticated
  using (
    private.is_admin()
    or exists (
      select 1 from public.service_sessions s
      where s.id = session_id
        and s.person_id = private.current_person_id()
        and s.is_sandbox = private.in_practice()
    )
  );

drop policy if exists kc_admin on public.kc_confirmations;
create policy kc_admin on public.kc_confirmations
  for all to authenticated
  using (private.is_admin())
  with check (private.is_admin());

grant select, insert, update, delete on public.photo_audit_shots to authenticated;
grant select, insert, update, delete on public.kc_confirmations to authenticated;
