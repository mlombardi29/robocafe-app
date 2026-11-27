-- Per-trip pay (owner rules, effective 2026-11-25, not backdated).
-- Additive. Does not edit 0001–0019. Does not apply itself to the hosted project.
-- Does not send email and does not upload a receipt photo.
--
-- Kiosk servicing stays hourly. save_pay_run's shift loop is the 0009 loop.
-- payments.amount and payments.hours stay the shift totals.
--
-- A warehouse pickup copies trip_rate_warehouse_pickup (default $12).
-- A milk run copies trip_rate_milk_run (default $10) ONCE, however many sites
-- it names, and writes one linked charges row for the actual milk cost.
-- Later rate edits do not rewrite rate_amount on existing rows.
--
-- Daily cap: one non-voided warehouse pickup AND one non-voided milk run
-- per technician per trip_on date (up to two trips, one of each kind).
-- The only enforcement is unique index trip_logs_one_kind_per_day on
-- (person_id, trip_on, kind, is_sandbox) WHERE voided = false.
-- Live and practice are separate slots. Voiding the row frees that kind.
-- Drop that one index to relax the cap. trip_on is the America/Toronto
-- calendar date the tech logged. Future dates are rejected.
--
-- Receipt photo upload is not live (no storage bucket). receipt_url stays
-- null until a later change writes it. The tech must attest they have the
-- paper receipt. The milk charge stays unpaid until an admin sets
-- receipt_received_at. The flat trip pay is not held for the receipt.
--
-- Pay-run disbursement (mark paid) does not double-pay:
-- payments.reimbursements_amount is only charges this run marks paid.
-- A charge already paid on the Charges page is left untouched.
-- A milk charge with no receipt_received_at is left unpaid.
-- If the week is already paid when the receipt comes in, Kajsa marks that
-- charge paid on Charges. It is not added back onto the locked pay run.

alter table public.payments
  add column trips_amount numeric(10,2) not null default 0,
  add column reimbursements_amount numeric(10,2) not null default 0;

comment on column public.payments.amount is
  'Shift pay only. Trip pay is trips_amount. Reimbursements this run marks paid are reimbursements_amount.';

comment on column public.payments.trips_amount is
  'Flat trip pay for non-voided trips in the week. Not hourly shift pay.';

comment on column public.payments.reimbursements_amount is
  'Charges this pay run marks paid. Excludes charges already paid on Charges, and milk charges still waiting for a receipt.';

-- ---------------------------------------------------------------------------
-- Trips
-- ---------------------------------------------------------------------------

create table public.trip_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  is_sandbox boolean not null default false,
  legacy_id text,
  idempotency_key uuid unique,
  person_id uuid not null references public.people (id),
  trip_on date not null,
  kind text not null check (kind in ('warehouse_pickup', 'milk_run')),
  rate_amount numeric(10,2) not null check (rate_amount >= 0),
  note text,
  milk_cost numeric(10,2),
  receipt_attested boolean not null default false,
  -- Reserved for a later photo upload. Logging never writes this.
  receipt_url text,
  receipt_received_at timestamptz,
  receipt_received_by uuid references public.people (id),
  charge_id uuid unique,
  payment_id uuid references public.payments (id),
  voided boolean not null default false,
  edited_at timestamptz,
  edited_by uuid references public.people (id),
  check (
    (kind = 'warehouse_pickup' and milk_cost is null and receipt_attested = false)
    or (kind = 'milk_run' and milk_cost is not null and milk_cost > 0 and receipt_attested = true)
  )
);

comment on column public.trip_logs.rate_amount is
  'Rate copied from config at log time. A later config change does not rewrite this.';

comment on column public.trip_logs.receipt_url is
  'Always null until receipt photo upload exists. Paper receipts use receipt_attested and receipt_received_at.';

comment on column public.trip_logs.receipt_attested is
  'Tech confirmed they have the paper receipt and will hand it in. Required for a milk run.';

comment on column public.trip_logs.receipt_received_at is
  'Admin marked the paper receipt received. The linked milk charge stays unpaid until this is set.';

create table public.trip_log_sites (
  trip_log_id uuid not null references public.trip_logs (id) on delete cascade,
  site_id uuid not null references public.sites (id),
  is_sandbox boolean not null default false,
  primary key (trip_log_id, site_id)
);

-- One of each kind. A voided row leaves the unique index, so the slot can be used again.
create unique index trip_logs_one_kind_per_day
  on public.trip_logs (person_id, trip_on, kind, is_sandbox)
  where voided = false;

create index trip_logs_payment_idx
  on public.trip_logs (payment_id)
  where payment_id is not null;

create index trip_log_sites_site_idx
  on public.trip_log_sites (site_id);

create table public.trip_edits (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  idempotency_key uuid unique,
  trip_log_id uuid not null references public.trip_logs (id) on delete cascade,
  edited_by uuid not null references public.people (id),
  previous_note text,
  new_note text,
  previous_site_ids uuid[],
  new_site_ids uuid[],
  previous_milk_cost numeric,
  new_milk_cost numeric,
  previous_voided boolean,
  new_voided boolean,
  previous_receipt_received_at timestamptz,
  new_receipt_received_at timestamptz,
  reason text
);

create index trip_edits_trip_idx
  on public.trip_edits (trip_log_id, created_at desc);

alter table public.charges
  add column trip_log_id uuid unique references public.trip_logs (id),
  add column payment_id uuid references public.payments (id);

alter table public.trip_logs
  add constraint trip_logs_charge_id_fkey
  foreign key (charge_id) references public.charges (id);

create index charges_payment_idx
  on public.charges (payment_id)
  where payment_id is not null;

comment on column public.charges.trip_log_id is
  'Set when the charge is the one milk-cost reimbursement for a milk run. One charge, not one per site.';

comment on column public.charges.payment_id is
  'Pay run that marked this charge paid. Null when it was marked paid on Charges, so a later pay run skips it.';

-- ---------------------------------------------------------------------------
-- Sandbox stamps. The daily cap is the unique index above, not a trigger.
-- ---------------------------------------------------------------------------

create trigger trip_logs_00_stamp_sandbox
  before insert on public.trip_logs
  for each row execute function private.stamp_caller_sandbox();

create or replace function private.stamp_trip_site()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sandbox boolean;
  v_site_sandbox boolean;
begin
  select t.is_sandbox into v_sandbox from public.trip_logs t where t.id = new.trip_log_id;
  if not found then
    raise exception 'Trip not found.';
  end if;
  select s.is_sandbox into v_site_sandbox from public.sites s where s.id = new.site_id;
  if not found then
    raise exception 'site not found';
  end if;
  if v_site_sandbox is distinct from v_sandbox then
    raise exception 'Site does not match this trip''s mode.';
  end if;
  new.is_sandbox := v_sandbox;
  return new;
end;
$$;

create trigger trip_log_sites_stamp_sandbox
  before insert or update of site_id, trip_log_id on public.trip_log_sites
  for each row execute function private.stamp_trip_site();

create or replace function private.assert_trip_site_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_kind text;
  v_sandbox boolean;
  v_count integer;
  v_bad integer;
begin
  if tg_table_name = 'trip_log_sites' then
    v_id := coalesce(new.trip_log_id, old.trip_log_id);
  else
    v_id := coalesce(new.id, old.id);
  end if;

  select t.kind, t.is_sandbox into v_kind, v_sandbox
  from public.trip_logs t
  where t.id = v_id;
  if not found then
    return null;
  end if;

  select count(*)::integer into v_count
  from public.trip_log_sites tls
  where tls.trip_log_id = v_id;

  select count(*)::integer into v_bad
  from public.trip_log_sites tls
  join public.sites s on s.id = tls.site_id
  where tls.trip_log_id = v_id
    and s.is_sandbox is distinct from v_sandbox;

  if v_bad > 0 then
    raise exception 'Site does not match this trip''s mode.';
  end if;
  if v_kind = 'milk_run' and v_count < 1 then
    raise exception 'A milk run needs at least one site.';
  end if;
  if v_kind = 'warehouse_pickup' and v_count > 0 then
    raise exception 'A warehouse pickup does not use a site.';
  end if;
  return null;
end;
$$;

create constraint trigger trip_logs_sites_check
  after insert or update of kind on public.trip_logs
  deferrable initially deferred
  for each row execute function private.assert_trip_site_rules();

create constraint trigger trip_log_sites_check
  after insert or update or delete on public.trip_log_sites
  deferrable initially deferred
  for each row execute function private.assert_trip_site_rules();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function private.trip_config_amount(p_key text)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_raw text;
  v_amount numeric;
begin
  select c.value into v_raw from public.config c where c.key = p_key;
  v_raw := btrim(coalesce(v_raw, ''));
  if v_raw !~ '^[0-9]+(\.[0-9]{1,2})?$' then
    raise exception 'Trip rate % is not set.', p_key;
  end if;
  v_amount := round(v_raw::numeric, 2);
  if v_amount < 0 then
    raise exception 'Trip rate % is not set.', p_key;
  end if;
  return v_amount;
end;
$$;

create or replace function private.trip_effective_on()
returns date
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_raw text;
begin
  select c.value into v_raw from public.config c where c.key = 'trip_pay_effective_on';
  v_raw := btrim(coalesce(v_raw, ''));
  if v_raw !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    return date '2026-11-25';
  end if;
  return v_raw::date;
end;
$$;

create or replace function private.trip_paid_locked(p_payment uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.payments p
    where p.id = p_payment
      and p.status = 'paid'
      and p.voided = false
  )
$$;

create or replace function private.trip_site_ids(p_trip uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(tls.site_id order by tls.site_id), '{}'::uuid[])
  from public.trip_log_sites tls
  where tls.trip_log_id = p_trip
$$;

create or replace function private.trip_payload(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.trip_logs;
begin
  select * into v_row from public.trip_logs where id = p_id;
  if not found then
    raise exception 'Trip not found.';
  end if;
  return to_jsonb(v_row) || jsonb_build_object('site_ids', to_jsonb(private.trip_site_ids(p_id)));
end;
$$;

create or replace function private.distinct_sites(p_sites uuid[])
returns uuid[]
language sql
immutable
as $$
  select coalesce(array_agg(distinct site_id), '{}'::uuid[])
  from unnest(coalesce(p_sites, '{}'::uuid[])) as site_id
  where site_id is not null
$$;

create or replace function private.replace_trip_sites(p_trip uuid, p_sites uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site uuid;
begin
  delete from public.trip_log_sites where trip_log_id = p_trip;
  foreach v_site in array private.distinct_sites(p_sites)
  loop
    insert into public.trip_log_sites (trip_log_id, site_id)
    values (p_trip, v_site);
  end loop;
end;
$$;

create or replace function private.require_trip_sites(
  p_kind text,
  p_sites uuid[],
  p_sandbox boolean
)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sites uuid[] := private.distinct_sites(p_sites);
  v_site uuid;
  v_site_sandbox boolean;
begin
  if p_kind = 'milk_run' and coalesce(array_length(v_sites, 1), 0) < 1 then
    raise exception 'A milk run needs at least one site.';
  end if;
  if p_kind = 'warehouse_pickup' and coalesce(array_length(v_sites, 1), 0) > 0 then
    raise exception 'A warehouse pickup does not use a site.';
  end if;

  foreach v_site in array v_sites
  loop
    if not private.can_see_site(v_site) then
      raise exception 'Not allowed at that site.';
    end if;
    select s.is_sandbox into v_site_sandbox from public.sites s where s.id = v_site;
    if not found then
      raise exception 'site not found';
    end if;
    if v_site_sandbox is distinct from p_sandbox then
      raise exception 'Switch practice mode to match that site.';
    end if;
  end loop;
  return v_sites;
end;
$$;

-- Charges this pay run should mark paid. Already-paid Charges-page rows are
-- excluded. Milk charges still waiting on a receipt are excluded.
create or replace function private.pay_run_reimbursement_ids(
  p_person uuid,
  p_start date,
  p_end date,
  p_sandbox boolean,
  p_payment uuid
)
returns table (id uuid, amount numeric)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.amount
  from public.charges c
  left join public.trip_logs t on t.id = c.trip_log_id
  where c.person_id = p_person
    and c.is_sandbox = p_sandbox
    and c.voided = false
    and (
      (c.paid = false and c.payment_id is null)
      or c.payment_id = p_payment
    )
    and coalesce(t.trip_on, (c.created_at at time zone 'America/Toronto')::date)
        between p_start and p_end
    and (
      c.trip_log_id is null
      or (t.voided = false and t.receipt_received_at is not null)
    )
$$;

create or replace function private.sync_pay_run_extras(p_payment uuid, p_lock boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay public.payments;
  v_trips numeric(10,2);
  v_reimb numeric(10,2);
begin
  select * into v_pay from public.payments where id = p_payment for update;
  if not found then
    raise exception 'Pay run not found.';
  end if;
  if v_pay.status = 'paid' then
    return;
  end if;
  if v_pay.period_start is null or v_pay.period_end is null then
    update public.payments
      set trips_amount = 0,
          reimbursements_amount = 0
      where id = p_payment;
    return;
  end if;

  select coalesce(round(sum(t.rate_amount), 2), 0) into v_trips
  from public.trip_logs t
  where t.person_id = v_pay.person_id
    and t.is_sandbox = v_pay.is_sandbox
    and t.voided = false
    and t.trip_on >= private.trip_effective_on()
    and t.trip_on between v_pay.period_start and v_pay.period_end
    and (t.payment_id is null or t.payment_id = v_pay.id);

  select coalesce(round(sum(r.amount), 2), 0) into v_reimb
  from private.pay_run_reimbursement_ids(
    v_pay.person_id, v_pay.period_start, v_pay.period_end, v_pay.is_sandbox, v_pay.id
  ) r;

  update public.payments
    set trips_amount = v_trips,
        reimbursements_amount = v_reimb
    where id = v_pay.id;

  if not p_lock then
    return;
  end if;

  update public.trip_logs t
    set payment_id = v_pay.id
  where t.person_id = v_pay.person_id
    and t.is_sandbox = v_pay.is_sandbox
    and t.voided = false
    and t.trip_on >= private.trip_effective_on()
    and t.trip_on between v_pay.period_start and v_pay.period_end
    and (t.payment_id is null or t.payment_id = v_pay.id);

  update public.charges c
    set paid = true,
        payment_id = v_pay.id
  where c.id in (
    select r.id
    from private.pay_run_reimbursement_ids(
      v_pay.person_id, v_pay.period_start, v_pay.period_end, v_pay.is_sandbox, v_pay.id
    ) r
  );
end;
$$;

revoke all on function private.stamp_trip_site() from public, anon, authenticated;
revoke all on function private.assert_trip_site_rules() from public, anon, authenticated;
revoke all on function private.trip_config_amount(text) from public, anon, authenticated;
revoke all on function private.trip_effective_on() from public, anon, authenticated;
revoke all on function private.trip_paid_locked(uuid) from public, anon, authenticated;
revoke all on function private.trip_site_ids(uuid) from public, anon, authenticated;
revoke all on function private.trip_payload(uuid) from public, anon, authenticated;
revoke all on function private.distinct_sites(uuid[]) from public, anon, authenticated;
revoke all on function private.replace_trip_sites(uuid, uuid[]) from public, anon, authenticated;
revoke all on function private.require_trip_sites(text, uuid[], boolean) from public, anon, authenticated;
revoke all on function private.pay_run_reimbursement_ids(uuid, date, date, boolean, uuid) from public, anon, authenticated;
revoke all on function private.sync_pay_run_extras(uuid, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- log / edit / void / receipt
-- The trip is always the signed-in person. There is no person argument.
-- ---------------------------------------------------------------------------

create or replace function public.log_trip(
  p_kind text,
  p_on date,
  p_sites uuid[],
  p_note text,
  p_milk_cost numeric,
  p_receipt_attested boolean,
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
  v_row public.trip_logs;
  v_sites uuid[];
  v_rate numeric(10,2);
  v_milk numeric(10,2);
  v_note text;
  v_charge uuid;
  v_constraint text;
begin
  if not private.can_write() then
    raise exception 'Not allowed.';
  end if;
  if p_key is null or p_on is null or p_kind is null then
    raise exception 'Pick a trip and a day.';
  end if;
  if p_kind not in ('warehouse_pickup', 'milk_run') then
    raise exception 'Pick a warehouse pickup or a milk run.';
  end if;

  v_person := private.current_person_id();
  if v_person is null then
    raise exception 'Sign in again.';
  end if;

  select * into v_row from public.trip_logs where idempotency_key = p_key;
  if found then
    if v_row.person_id is distinct from v_person and not private.is_admin() then
      raise exception 'Not allowed.';
    end if;
    return private.trip_payload(v_row.id);
  end if;

  if p_on < private.trip_effective_on() then
    raise exception 'Trip pay starts on %. Earlier days are not trips.', private.trip_effective_on();
  end if;
  if p_on > (now() at time zone 'America/Toronto')::date then
    raise exception 'A trip cannot be logged for a future day.';
  end if;

  v_sandbox := private.in_practice();
  v_sites := private.require_trip_sites(p_kind, p_sites, v_sandbox);
  v_note := nullif(btrim(coalesce(p_note, '')), '');

  if p_kind = 'milk_run' then
    if p_milk_cost is null or p_milk_cost <= 0 then
      raise exception 'Enter the milk cost.';
    end if;
    if p_receipt_attested is not true then
      raise exception 'Confirm you have the receipt and will hand it in.';
    end if;
    v_rate := private.trip_config_amount('trip_rate_milk_run');
    v_milk := round(p_milk_cost, 2);
    if v_milk <= 0 then
      raise exception 'Enter the milk cost.';
    end if;
  else
    if p_milk_cost is not null then
      raise exception 'A warehouse pickup has no milk cost.';
    end if;
    v_rate := private.trip_config_amount('trip_rate_warehouse_pickup');
    v_milk := null;
  end if;

  begin
    insert into public.trip_logs (
      person_id, trip_on, kind, rate_amount, note, milk_cost,
      receipt_attested, receipt_url, is_sandbox, idempotency_key, created_by
    ) values (
      v_person, p_on, p_kind, v_rate, v_note, v_milk,
      case when p_kind = 'milk_run' then true else false end,
      null,
      v_sandbox, p_key, auth.uid()
    )
    returning * into v_row;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'trip_logs_one_kind_per_day' then
        if p_kind = 'milk_run' then
          raise exception 'You already logged a milk run for this day.';
        end if;
        raise exception 'You already logged a warehouse pickup for this day.';
      end if;
      raise;
  end;

  perform private.replace_trip_sites(v_row.id, v_sites);

  if p_kind = 'milk_run' then
    insert into public.charges (
      person_id, site_id, amount, note, receipt_url, paid, voided,
      is_sandbox, idempotency_key, created_by, trip_log_id
    ) values (
      v_person, null, v_milk, 'Milk run', null, false, false,
      v_sandbox, gen_random_uuid(), auth.uid(), v_row.id
    )
    returning id into v_charge;

    update public.trip_logs
      set charge_id = v_charge
    where id = v_row.id
    returning * into v_row;
  end if;

  return private.trip_payload(v_row.id);
end;
$$;

create or replace function public.edit_trip(
  p_id uuid,
  p_sites uuid[],
  p_note text,
  p_milk_cost numeric,
  p_receipt_attested boolean,
  p_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person uuid;
  v_admin boolean;
  v_row public.trip_logs;
  v_sites uuid[];
  v_old_sites uuid[];
  v_note text;
  v_milk numeric(10,2);
  v_charge public.charges;
begin
  if not private.can_write() then
    raise exception 'Not allowed.';
  end if;
  if p_id is null or p_key is null then
    raise exception 'Pick a trip.';
  end if;

  v_person := private.current_person_id();
  if v_person is null then
    raise exception 'Sign in again.';
  end if;
  v_admin := private.is_admin();

  if exists (select 1 from public.trip_edits e where e.idempotency_key = p_key) then
    return private.trip_payload((select e.trip_log_id from public.trip_edits e where e.idempotency_key = p_key));
  end if;

  select * into v_row from public.trip_logs where id = p_id for update;
  if not found then
    raise exception 'Trip not found.';
  end if;
  if v_row.voided then
    raise exception 'That trip was voided.';
  end if;
  if private.trip_paid_locked(v_row.payment_id) then
    raise exception 'This trip is on a paid week. It can''t be changed.';
  end if;

  if not v_admin then
    if v_row.person_id is distinct from v_person then
      raise exception 'Not allowed.';
    end if;
    if v_row.is_sandbox is distinct from private.in_practice() then
      raise exception 'Switch practice mode to match that trip.';
    end if;
    if not public.charge_same_toronto_day(v_row.created_at, now()) then
      raise exception 'Ask an admin to change this. The same-day edit window has ended.';
    end if;
  end if;

  if v_row.charge_id is not null then
    select * into v_charge from public.charges where id = v_row.charge_id for update;
    if v_charge.paid and not v_admin then
      raise exception 'Ask an admin to change a paid charge.';
    end if;
  end if;

  v_sites := private.require_trip_sites(v_row.kind, p_sites, v_row.is_sandbox);
  v_note := nullif(btrim(coalesce(p_note, '')), '');
  v_old_sites := private.trip_site_ids(v_row.id);

  if v_row.kind = 'milk_run' then
    if p_milk_cost is null or p_milk_cost <= 0 then
      raise exception 'Enter the milk cost.';
    end if;
    if p_receipt_attested is not true then
      raise exception 'Confirm you have the receipt and will hand it in.';
    end if;
    v_milk := round(p_milk_cost, 2);
    if v_milk <= 0 then
      raise exception 'Enter the milk cost.';
    end if;
  else
    if p_milk_cost is not null then
      raise exception 'A warehouse pickup has no milk cost.';
    end if;
    v_milk := null;
  end if;

  insert into public.trip_edits (
    trip_log_id, edited_by, created_by, idempotency_key,
    previous_note, new_note,
    previous_site_ids, new_site_ids,
    previous_milk_cost, new_milk_cost,
    previous_voided, new_voided,
    previous_receipt_received_at, new_receipt_received_at,
    reason
  ) values (
    v_row.id, v_person, auth.uid(), p_key,
    v_row.note, v_note,
    v_old_sites, v_sites,
    v_row.milk_cost, v_milk,
    false, false,
    v_row.receipt_received_at, v_row.receipt_received_at,
    'edit trip'
  );

  perform private.replace_trip_sites(v_row.id, v_sites);

  update public.trip_logs
    set note = v_note,
        milk_cost = v_milk,
        edited_at = now(),
        edited_by = v_person
    where id = v_row.id
    returning * into v_row;

  if v_row.charge_id is not null then
    insert into public.charge_edits (
      charge_id, edited_by, created_by,
      previous_amount, previous_site_id, previous_note, previous_receipt_url, previous_paid,
      new_amount, new_site_id, new_note, new_receipt_url, new_paid,
      reason
    ) values (
      v_charge.id, v_person, auth.uid(),
      v_charge.amount, v_charge.site_id, v_charge.note, v_charge.receipt_url, v_charge.paid,
      v_milk, null, 'Milk run', v_charge.receipt_url, v_charge.paid,
      case when v_admin and v_charge.paid then 'admin edit of paid charge' else 'edit trip milk cost' end
    );

    update public.charges
      set amount = v_milk,
          note = 'Milk run',
          edited_at = now(),
          edited_by = v_person
      where id = v_row.charge_id;
  end if;

  return private.trip_payload(v_row.id);
end;
$$;

create or replace function public.void_trip(p_id uuid, p_key uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person uuid;
  v_row public.trip_logs;
  v_charge public.charges;
begin
  if not private.is_admin() then
    raise exception 'Not allowed.';
  end if;
  if p_id is null or p_key is null then
    raise exception 'Pick a trip.';
  end if;

  v_person := private.current_person_id();
  if v_person is null then
    raise exception 'Sign in again.';
  end if;

  if exists (select 1 from public.trip_edits e where e.idempotency_key = p_key) then
    return private.trip_payload((select e.trip_log_id from public.trip_edits e where e.idempotency_key = p_key));
  end if;

  select * into v_row from public.trip_logs where id = p_id for update;
  if not found then
    raise exception 'Trip not found.';
  end if;
  if v_row.voided then
    return private.trip_payload(v_row.id);
  end if;
  if private.trip_paid_locked(v_row.payment_id) then
    raise exception 'This trip is on a paid week. It can''t be changed.';
  end if;

  if v_row.charge_id is not null then
    select * into v_charge from public.charges where id = v_row.charge_id for update;
    if v_charge.paid then
      raise exception 'Unmark the milk reimbursement on Charges before voiding this trip.';
    end if;
  end if;

  insert into public.trip_edits (
    trip_log_id, edited_by, created_by, idempotency_key,
    previous_note, new_note,
    previous_site_ids, new_site_ids,
    previous_milk_cost, new_milk_cost,
    previous_voided, new_voided,
    previous_receipt_received_at, new_receipt_received_at,
    reason
  ) values (
    v_row.id, v_person, auth.uid(), p_key,
    v_row.note, v_row.note,
    private.trip_site_ids(v_row.id), private.trip_site_ids(v_row.id),
    v_row.milk_cost, v_row.milk_cost,
    false, true,
    v_row.receipt_received_at, v_row.receipt_received_at,
    'void trip'
  );

  update public.trip_logs
    set voided = true,
        edited_at = now(),
        edited_by = v_person
    where id = v_row.id
    returning * into v_row;

  if v_row.charge_id is not null then
    update public.charges
      set voided = true,
          edited_at = now(),
          edited_by = v_person
      where id = v_row.charge_id
        and paid = false;
  end if;

  return private.trip_payload(v_row.id);
end;
$$;

-- Marks the paper receipt received or clears that mark. Does not pay the
-- milk charge and does not change the flat trip rate. Allowed after the
-- week is paid so the reimbursement can still be paid from Charges.
create or replace function public.set_trip_receipt(
  p_id uuid,
  p_received boolean,
  p_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person uuid;
  v_row public.trip_logs;
  v_charge public.charges;
  v_at timestamptz;
begin
  if not private.is_admin() then
    raise exception 'Not allowed.';
  end if;
  if p_id is null or p_received is null or p_key is null then
    raise exception 'Pick a trip.';
  end if;

  v_person := private.current_person_id();
  if v_person is null then
    raise exception 'Sign in again.';
  end if;

  if exists (select 1 from public.trip_edits e where e.idempotency_key = p_key) then
    return private.trip_payload((select e.trip_log_id from public.trip_edits e where e.idempotency_key = p_key));
  end if;

  select * into v_row from public.trip_logs where id = p_id for update;
  if not found then
    raise exception 'Trip not found.';
  end if;
  if v_row.voided then
    raise exception 'That trip was voided.';
  end if;
  if v_row.kind <> 'milk_run' then
    raise exception 'A warehouse pickup has no milk receipt.';
  end if;

  if not p_received and v_row.charge_id is not null then
    select * into v_charge from public.charges where id = v_row.charge_id;
    if v_charge.paid then
      raise exception 'That milk reimbursement is already paid.';
    end if;
  end if;

  v_at := case when p_received then now() else null end;

  insert into public.trip_edits (
    trip_log_id, edited_by, created_by, idempotency_key,
    previous_note, new_note,
    previous_site_ids, new_site_ids,
    previous_milk_cost, new_milk_cost,
    previous_voided, new_voided,
    previous_receipt_received_at, new_receipt_received_at,
    reason
  ) values (
    v_row.id, v_person, auth.uid(), p_key,
    v_row.note, v_row.note,
    private.trip_site_ids(v_row.id), private.trip_site_ids(v_row.id),
    v_row.milk_cost, v_row.milk_cost,
    v_row.voided, v_row.voided,
    v_row.receipt_received_at, v_at,
    case when p_received then 'receipt received' else 'receipt cleared' end
  );

  update public.trip_logs
    set receipt_received_at = v_at,
        receipt_received_by = case when p_received then v_person else null end,
        edited_at = now(),
        edited_by = v_person
    where id = v_row.id
    returning * into v_row;

  return private.trip_payload(v_row.id);
end;
$$;

revoke all on function public.log_trip(text, date, uuid[], text, numeric, boolean, uuid) from public, anon;
revoke all on function public.edit_trip(uuid, uuid[], text, numeric, boolean, uuid) from public, anon;
revoke all on function public.void_trip(uuid, uuid) from public, anon;
revoke all on function public.set_trip_receipt(uuid, boolean, uuid) from public, anon;
grant execute on function public.log_trip(text, date, uuid[], text, numeric, boolean, uuid) to authenticated;
grant execute on function public.edit_trip(uuid, uuid[], text, numeric, boolean, uuid) to authenticated;
grant execute on function public.void_trip(uuid, uuid) to authenticated;
grant execute on function public.set_trip_receipt(uuid, boolean, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Charges that belong to a trip are edited on the trip.
-- A milk charge cannot be marked paid until the receipt is received.
-- ---------------------------------------------------------------------------

create or replace function public.edit_charge(
  p_id uuid,
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
  v_row public.charges;
  v_admin boolean;
  v_note text;
  v_receipt text;
  v_sandbox boolean;
begin
  if not private.can_write() then
    raise exception 'Not allowed.';
  end if;
  if p_id is null then
    raise exception 'Pick a charge.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter a positive amount.';
  end if;

  v_person := private.current_person_id();
  if v_person is null then
    raise exception 'Sign in again.';
  end if;
  v_admin := private.is_admin();

  select * into v_row from public.charges where id = p_id for update;
  if not found then
    raise exception 'Charge not found.';
  end if;

  if v_row.voided then
    raise exception 'That charge was voided.';
  end if;
  if v_row.trip_log_id is not null then
    raise exception 'Change a milk run from the trip, not the charge.';
  end if;

  if not v_admin then
    if v_row.person_id is distinct from v_person then
      raise exception 'Not allowed.';
    end if;
    if v_row.paid then
      raise exception 'Ask an admin to change a paid charge.';
    end if;
    if not public.charge_same_toronto_day(v_row.created_at, now()) then
      raise exception 'Ask an admin to change this. The same-day edit window has ended.';
    end if;
    if v_row.is_sandbox is distinct from private.in_practice() then
      raise exception 'Switch practice mode to match that charge.';
    end if;
  end if;

  v_note := nullif(trim(coalesce(p_note, '')), '');
  v_receipt := nullif(trim(coalesce(p_receipt_url, '')), '');

  if p_site is not null then
    if not private.can_see_site(p_site) and not v_admin then
      raise exception 'Not allowed at that site.';
    end if;
    select s.is_sandbox into v_sandbox from public.sites s where s.id = p_site;
    if not found then
      raise exception 'site not found';
    end if;
    if v_sandbox is distinct from v_row.is_sandbox and not v_admin then
      raise exception 'Site does not match this charge''s mode.';
    end if;
  end if;

  insert into public.charge_edits (
    charge_id, edited_by, created_by,
    previous_amount, previous_site_id, previous_note, previous_receipt_url, previous_paid,
    new_amount, new_site_id, new_note, new_receipt_url, new_paid,
    reason
  ) values (
    v_row.id, v_person, auth.uid(),
    v_row.amount, v_row.site_id, v_row.note, v_row.receipt_url, v_row.paid,
    p_amount, p_site, v_note, v_receipt, v_row.paid,
    case when v_admin and v_row.paid then 'admin edit of paid charge' else 'edit charge' end
  );

  update public.charges
  set
    amount = p_amount,
    site_id = p_site,
    note = v_note,
    receipt_url = v_receipt,
    edited_at = now(),
    edited_by = v_person,
    idempotency_key = coalesce(idempotency_key, p_key)
  where id = p_id
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

  select * into v_row from public.charges where id = p_id for update;
  if not found then
    raise exception 'Charge not found.';
  end if;

  if p_paid and v_row.voided then
    raise exception 'That charge was voided.';
  end if;
  if p_paid and exists (
    select 1
    from public.trip_logs t
    where t.id = v_row.trip_log_id
      and t.voided = false
      and t.receipt_received_at is null
  ) then
    raise exception 'Mark the receipt received before paying this milk reimbursement.';
  end if;

  update public.charges
  set paid = p_paid,
      payment_id = case when p_paid then payment_id else null end,
      idempotency_key = coalesce(idempotency_key, p_key)
  where id = p_id
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

-- ---------------------------------------------------------------------------
-- Weekly pay. Shift minutes and the hourly amount are unchanged from 0009.
-- Trip and reimbursement totals are separate columns, refreshed after that.
-- ---------------------------------------------------------------------------

create or replace function public.save_pay_run(
  p_person uuid,
  p_start date,
  p_end date,
  p_sessions uuid[],
  p_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sandbox boolean;
  v_pay public.payments;
  v_session public.service_sessions;
  v_rate numeric(10,2);
  v_mins integer;
  v_amount numeric(10,2);
  v_total numeric(10,2) := 0;
  v_minutes integer := 0;
  v_seen integer := 0;
  v_id uuid;
begin
  if not private.is_admin() then
    raise exception 'Not allowed.';
  end if;
  if p_person is null or p_start is null or p_end is null or p_start > p_end then
    raise exception 'Pick a person and a week.';
  end if;
  v_sandbox := private.in_practice();

  select * into v_pay
  from public.payments
  where person_id = p_person
    and period_start = p_start
    and period_end = p_end
    and is_sandbox = v_sandbox
    and voided = false
  order by created_at desc
  limit 1;

  if found and v_pay.status <> 'draft' then
    raise exception 'This week is already submitted.';
  end if;

  if not found then
    insert into public.payments (
      person_id, period_start, period_end, status, amount, hours, is_sandbox, idempotency_key, created_by
    ) values (
      p_person, p_start, p_end, 'draft', 0, 0, v_sandbox, p_key, auth.uid()
    )
    returning * into v_pay;
  else
    delete from public.payment_lines where payment_id = v_pay.id;
  end if;

  foreach v_id in array coalesce(p_sessions, '{}'::uuid[])
  loop
    select * into v_session
    from public.service_sessions
    where id = v_id
      and person_id = p_person
      and status = 'completed'
      and is_sandbox = v_sandbox
      and service_date between p_start and p_end;
    if not found then
      raise exception 'One of those shifts is not in this week for this person, or practice does not match.';
    end if;
    if v_session.start_at is null or v_session.end_at is null or v_session.end_at < v_session.start_at then
      raise exception 'A shift is missing a start or end.';
    end if;
    v_mins := round(extract(epoch from (v_session.end_at - v_session.start_at)) / 60.0)::integer;
    select r.hourly_rate into v_rate
    from public.pay_rates r
    where r.person_id = p_person
      and r.is_sandbox = v_sandbox
      and r.effective_on <= v_session.service_date
    order by r.effective_on desc
    limit 1;
    if v_rate is null then
      raise exception 'Set a pay rate that starts on or before this shift.';
    end if;
    v_amount := round((v_mins / 60.0) * v_rate, 2);
    insert into public.payment_lines (payment_id, session_id, included, minutes, amount, is_sandbox, created_by)
    values (v_pay.id, v_session.id, true, v_mins, v_amount, v_sandbox, auth.uid());
    v_total := v_total + v_amount;
    v_minutes := v_minutes + v_mins;
    v_seen := v_seen + 1;
  end loop;

  update public.payments
    set amount = v_total,
        hours = round(v_minutes / 60.0, 2)
    where id = v_pay.id
    returning * into v_pay;

  perform private.sync_pay_run_extras(v_pay.id, false);
  select * into v_pay from public.payments where id = v_pay.id;
  return to_jsonb(v_pay) || jsonb_build_object('lines', v_seen);
end;
$$;

create or replace function public.mark_pay_run(p_id uuid, p_status text, p_paid_on date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay public.payments;
  v_sandbox boolean;
begin
  if not private.is_admin() then
    raise exception 'Not allowed.';
  end if;
  if p_status not in ('submitted', 'paid') then
    raise exception 'Mark it submitted or paid.';
  end if;
  v_sandbox := private.in_practice();
  select * into v_pay from public.payments where id = p_id for update;
  if not found then
    raise exception 'Pay run not found.';
  end if;
  if v_pay.is_sandbox is distinct from v_sandbox then
    raise exception 'Switch practice mode to match this pay run.';
  end if;
  if p_status = 'paid' and p_paid_on is null then
    raise exception 'Pick the date it was paid.';
  end if;
  if v_pay.status = 'paid' and p_status = 'paid' then
    return to_jsonb(v_pay);
  end if;
  if p_status = 'submitted' and v_pay.status = 'paid' then
    raise exception 'This pay run is already paid.';
  end if;

  if p_status = 'paid' then
    perform private.sync_pay_run_extras(p_id, true);
  else
    perform private.sync_pay_run_extras(p_id, false);
  end if;

  update public.payments
    set status = p_status,
        paid_on = case when p_status = 'paid' then p_paid_on else paid_on end
    where id = p_id
    returning * into v_pay;
  return to_jsonb(v_pay);
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS. Techs read their own rows in the current mode. Writes go through RPCs.
-- ---------------------------------------------------------------------------

alter table public.trip_logs enable row level security;
alter table public.trip_log_sites enable row level security;
alter table public.trip_edits enable row level security;

create policy trip_logs_select on public.trip_logs
  for select to authenticated
  using (
    private.is_admin()
    or (
      person_id = private.current_person_id()
      and is_sandbox = private.in_practice()
    )
  );

create policy trip_logs_admin on public.trip_logs
  for all to authenticated
  using (private.is_admin())
  with check (private.is_admin());

create policy trip_log_sites_select on public.trip_log_sites
  for select to authenticated
  using (
    private.is_admin()
    or exists (
      select 1
      from public.trip_logs t
      where t.id = trip_log_id
        and t.person_id = private.current_person_id()
        and t.is_sandbox = private.in_practice()
    )
  );

create policy trip_log_sites_admin on public.trip_log_sites
  for all to authenticated
  using (private.is_admin())
  with check (private.is_admin());

create policy trip_edits_select on public.trip_edits
  for select to authenticated
  using (
    private.is_admin()
    or exists (
      select 1
      from public.trip_logs t
      where t.id = trip_log_id
        and t.person_id = private.current_person_id()
        and t.is_sandbox = private.in_practice()
    )
  );

create policy trip_edits_admin on public.trip_edits
  for all to authenticated
  using (private.is_admin())
  with check (private.is_admin());

revoke all on public.trip_logs from public, anon;
revoke all on public.trip_log_sites from public, anon;
revoke all on public.trip_edits from public, anon;
grant select, insert, update on public.trip_logs to authenticated;
grant select, insert, update, delete on public.trip_log_sites to authenticated;
grant select, insert on public.trip_edits to authenticated;

insert into public.config (key, value) values
  ('trip_rate_warehouse_pickup', '12'),
  ('trip_rate_milk_run', '10'),
  ('trip_pay_effective_on', '2026-11-25')
on conflict (key) do nothing;

insert into public.config (key, value) values
  ('trip_pay_migration', '0020')
on conflict (key) do update set value = excluded.value;
