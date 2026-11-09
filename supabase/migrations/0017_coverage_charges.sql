-- E18 coverage request/claim/cancel + E19 charge helpers.
-- Additive. Does not rewrite 0015/0016. Does not send email or call Google.
-- Hosted apply requires separate approval. Fail-closed: no notification_outbox writes.
-- Coverage pay (Michael Nov 8): covered shifts credit time to the person who works
-- the visit and pay that person's normal hourly rate (worker_own_hourly_rate).
-- Reimbursement approval limits stay unset — no limit logic in this file.

alter table public.charges
  add column if not exists note text;

create table if not exists public.schedule_overrides (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  is_sandbox boolean not null default false,
  legacy_id text,
  idempotency_key uuid unique,
  site_id uuid not null references public.sites (id) on delete cascade,
  service_date date not null,
  coverage_requested boolean not null default false,
  requested_by uuid references public.people (id),
  claimed_by uuid references public.people (id),
  original_assignee uuid references public.people (id),
  note text,
  unique (site_id, service_date)
);

create index if not exists schedule_overrides_open
  on public.schedule_overrides (service_date)
  where coverage_requested;

drop trigger if exists sites_stamp_schedule_overrides on public.schedule_overrides;
create trigger sites_stamp_schedule_overrides
  before insert or update of site_id on public.schedule_overrides
  for each row execute function private.stamp_sandbox_from_site();

alter table public.schedule_overrides enable row level security;

drop policy if exists schedule_overrides_select on public.schedule_overrides;
create policy schedule_overrides_select on public.schedule_overrides
  for select to authenticated
  using (
    public.is_admin()
    or (
      public.is_active()
      and public.can_see_site(site_id)
      and is_sandbox = public.in_practice()
    )
  );

drop policy if exists schedule_overrides_admin on public.schedule_overrides;
create policy schedule_overrides_admin on public.schedule_overrides
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select on public.schedule_overrides to authenticated;
grant insert, update on public.schedule_overrides to authenticated;

-- ---------------------------------------------------------------------------
-- Coverage. Idempotent on (site, date). Never sends mail.
-- ---------------------------------------------------------------------------

create or replace function public.request_coverage(
  p_site uuid,
  p_date date,
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
  v_row public.schedule_overrides;
begin
  if not private.can_write() then
    raise exception 'Not allowed.';
  end if;
  if p_site is null or p_date is null or p_key is null then
    raise exception 'Pick a site and a date.';
  end if;
  if not private.can_see_site(p_site) and not private.is_admin() then
    raise exception 'Not allowed at that site.';
  end if;
  v_person := private.current_person_id();
  if v_person is null then
    raise exception 'Sign in again.';
  end if;

  select * into v_row from public.schedule_overrides where idempotency_key = p_key;
  if found then
    return to_jsonb(v_row);
  end if;

  insert into public.schedule_overrides (
    site_id, service_date, coverage_requested, requested_by, claimed_by, note, idempotency_key, created_by
  ) values (
    p_site,
    p_date,
    true,
    v_person,
    null,
    nullif(trim(coalesce(p_note, '')), ''),
    p_key,
    auth.uid()
  )
  on conflict (site_id, service_date) do update
    set coverage_requested = true,
        requested_by = excluded.requested_by,
        claimed_by = null,
        note = coalesce(excluded.note, public.schedule_overrides.note),
        idempotency_key = coalesce(public.schedule_overrides.idempotency_key, excluded.idempotency_key)
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

create or replace function public.claim_coverage(
  p_site uuid,
  p_date date,
  p_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person uuid;
  v_row public.schedule_overrides;
begin
  if not private.can_write() then
    raise exception 'Not allowed.';
  end if;
  if p_site is null or p_date is null or p_key is null then
    raise exception 'Pick a site and a date.';
  end if;
  if not private.can_see_site(p_site) and not private.is_admin() then
    raise exception 'Not allowed at that site.';
  end if;
  v_person := private.current_person_id();
  if v_person is null then
    raise exception 'Sign in again.';
  end if;

  select * into v_row from public.schedule_overrides where idempotency_key = p_key;
  if found then
    return to_jsonb(v_row);
  end if;

  update public.schedule_overrides
  set coverage_requested = false,
      claimed_by = v_person,
      idempotency_key = coalesce(idempotency_key, p_key)
  where site_id = p_site
    and service_date = p_date
    and coverage_requested = true
  returning * into v_row;

  if not found then
    raise exception 'No open coverage request for that day.';
  end if;

  return to_jsonb(v_row);
end;
$$;

create or replace function public.cancel_coverage(
  p_site uuid,
  p_date date,
  p_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person uuid;
  v_row public.schedule_overrides;
begin
  if not private.can_write() then
    raise exception 'Not allowed.';
  end if;
  if p_site is null or p_date is null or p_key is null then
    raise exception 'Pick a site and a date.';
  end if;
  v_person := private.current_person_id();
  if v_person is null then
    raise exception 'Sign in again.';
  end if;

  select * into v_row from public.schedule_overrides where idempotency_key = p_key;
  if found then
    return to_jsonb(v_row);
  end if;

  select * into v_row
  from public.schedule_overrides
  where site_id = p_site and service_date = p_date
  for update;

  if not found or v_row.coverage_requested is not true then
    raise exception 'No open coverage request for that day.';
  end if;
  if not private.is_admin() and v_row.requested_by is distinct from v_person then
    raise exception 'Only the requester or an admin can cancel.';
  end if;

  update public.schedule_overrides
  set coverage_requested = false,
      requested_by = null,
      note = null,
      idempotency_key = coalesce(idempotency_key, p_key)
  where id = v_row.id
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.request_coverage(uuid, date, text, uuid) from public, anon;
revoke all on function public.claim_coverage(uuid, date, uuid) from public, anon;
revoke all on function public.cancel_coverage(uuid, date, uuid) from public, anon;
grant execute on function public.request_coverage(uuid, date, text, uuid) to authenticated;
grant execute on function public.claim_coverage(uuid, date, uuid) to authenticated;
grant execute on function public.cancel_coverage(uuid, date, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Charges. Tech adds own reimbursement; admin marks paid. No Drive upload here.
-- ---------------------------------------------------------------------------

create or replace function public.add_charge(
  p_amount numeric,
  p_site uuid,
  p_note text,
  p_receipt_url text,
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
  v_row public.charges;
begin
  if not private.can_write() then
    raise exception 'Not allowed.';
  end if;
  if p_amount is null or p_amount <= 0 or p_key is null then
    raise exception 'Enter a positive amount.';
  end if;
  v_person := private.current_person_id();
  if v_person is null then
    raise exception 'Sign in again.';
  end if;

  select * into v_row from public.charges where idempotency_key = p_key;
  if found then
    return to_jsonb(v_row);
  end if;

  v_sandbox := private.in_practice();
  if p_site is not null then
    if not private.can_see_site(p_site) and not private.is_admin() then
      raise exception 'Not allowed at that site.';
    end if;
    select s.is_sandbox into v_sandbox from public.sites s where s.id = p_site;
    if not found then
      raise exception 'site not found';
    end if;
    if v_sandbox is distinct from private.in_practice() and not private.is_admin() then
      raise exception 'Switch practice mode to match that site.';
    end if;
  end if;

  insert into public.charges (
    person_id, site_id, amount, note, receipt_url, paid, is_sandbox, idempotency_key, created_by
  ) values (
    v_person,
    p_site,
    p_amount,
    nullif(trim(coalesce(p_note, '')), ''),
    nullif(trim(coalesce(p_receipt_url, '')), ''),
    false,
    v_sandbox,
    p_key,
    auth.uid()
  )
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

create or replace function public.set_charge_paid(
  p_id uuid,
  p_paid boolean,
  p_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.charges;
begin
  if not private.is_admin() then
    raise exception 'Not allowed.';
  end if;
  if p_id is null or p_paid is null then
    raise exception 'Pick a charge.';
  end if;

  if p_key is not null then
    select * into v_row from public.charges where idempotency_key = p_key;
    if found then
      return to_jsonb(v_row);
    end if;
  end if;

  update public.charges
  set paid = p_paid,
      idempotency_key = coalesce(idempotency_key, p_key)
  where id = p_id
  returning * into v_row;

  if not found then
    raise exception 'Charge not found.';
  end if;

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.add_charge(numeric, uuid, text, text, uuid) from public, anon;
revoke all on function public.set_charge_paid(uuid, boolean, uuid) from public, anon;
grant execute on function public.add_charge(numeric, uuid, text, text, uuid) to authenticated;
grant execute on function public.set_charge_paid(uuid, boolean, uuid) to authenticated;

insert into public.config (key, value)
values ('coverage_charges_migration', '0017')
on conflict (key) do update set value = excluded.value;

insert into public.config (key, value)
values ('coverage_pay_rule', 'worker_own_hourly_rate')
on conflict (key) do update set value = excluded.value;

insert into public.config (key, value)
values ('reimbursement_approval_limit', '')
on conflict (key) do update set value = excluded.value;

-- ---------------------------------------------------------------------------
-- Site hours + soft preferred service window (Michael Nov 9).
-- UofT open 10:00–17:30. Servicing during open hours is allowed.
-- Soft, non-blocking hint: best before 11:00 or after 15:00 (avoid lunch).
-- Legacy Monday "before opening" red flag stays off (uoft_before_opening=off).
-- ---------------------------------------------------------------------------

alter table public.sites
  add column if not exists closing_time time,
  add column if not exists soft_prefer_before time,
  add column if not exists soft_prefer_after time;

update public.sites
set
  opening_time = time '10:00',
  closing_time = time '17:30',
  soft_prefer_before = time '11:00',
  soft_prefer_after = time '15:00'
where short_name = 'UofT';

insert into public.config (key, value)
values ('uoft_before_opening', 'off')
on conflict (key) do update set value = excluded.value;
