-- Additive. Do not edit 0001–0008. Do not apply this from the app.
-- No pay rates, SKUs, stock counts, or lock-box codes are inserted.
-- Practice mode is forced onto pay and warehouse rows so a practice session
-- cannot write live payroll or live stock.
-- Reorder notices are stored as held. Nothing in this file sends email.

-- ---------------------------------------------------------------------------
-- Pay rates. The rate in force is the latest effective_on on or before the shift.
-- ---------------------------------------------------------------------------

create table public.pay_rates (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  is_sandbox boolean not null default false,
  legacy_id text,
  idempotency_key uuid unique,
  person_id uuid not null references public.people (id) on delete cascade,
  hourly_rate numeric(10,2) not null check (hourly_rate >= 0),
  effective_on date not null,
  unique (person_id, effective_on, is_sandbox)
);

alter table public.payments
  add column period_start date,
  add column period_end date,
  add column paid_on date,
  add column status text not null default 'draft' check (status in ('draft', 'submitted', 'paid')),
  add column hours numeric(10,2),
  add column hourly_rate numeric(10,2);

create table public.payment_lines (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  is_sandbox boolean not null default false,
  legacy_id text,
  idempotency_key uuid unique,
  payment_id uuid not null references public.payments (id) on delete cascade,
  session_id uuid not null references public.service_sessions (id),
  included boolean not null default true,
  minutes integer not null check (minutes >= 0),
  amount numeric(10,2) not null,
  unique (payment_id, session_id)
);

-- Warehouse versus a kiosk. Dupont has no site. A site row is not Dupont.
alter table public.inventory_tx
  add column location text not null default 'site',
  add column note text;

alter table public.inventory_tx
  add constraint inventory_tx_location_check check (location in ('dupont', 'site'));

alter table public.inventory_tx
  add constraint inventory_tx_place_check check (
    (location = 'dupont' and site_id is null)
    or (location = 'site' and site_id is not null)
  ) not valid;

create table public.reorder_notices (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  is_sandbox boolean not null default false,
  legacy_id text,
  idempotency_key uuid unique,
  site_id uuid not null references public.sites (id) on delete cascade,
  sku_id uuid not null references public.skus (id),
  on_hand numeric not null,
  low_threshold numeric not null,
  notice_on date not null,
  status text not null default 'held' check (status in ('held', 'sent')),
  unique (site_id, sku_id, notice_on, is_sandbox)
);

-- ---------------------------------------------------------------------------
-- Sandbox stamps
-- ---------------------------------------------------------------------------

create or replace function private.stamp_caller_sandbox()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if private.in_practice() then
    new.is_sandbox := true;
  end if;
  return new;
end;
$$;

create trigger pay_rates_stamp_sandbox
  before insert or update on public.pay_rates
  for each row execute function private.stamp_caller_sandbox();

create trigger payments_stamp_sandbox
  before insert or update on public.payments
  for each row execute function private.stamp_caller_sandbox();

create trigger skus_stamp_sandbox
  before insert or update on public.skus
  for each row execute function private.stamp_caller_sandbox();

create trigger sku_packs_stamp_sandbox
  before insert or update on public.sku_packs
  for each row execute function private.stamp_caller_sandbox();

create or replace function private.stamp_sandbox_from_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sandbox boolean;
begin
  select p.is_sandbox into v_sandbox from public.payments p where p.id = new.payment_id;
  if not found then
    raise exception 'Pay run not found.';
  end if;
  new.is_sandbox := v_sandbox;
  return new;
end;
$$;

create trigger payment_lines_stamp_sandbox
  before insert or update of payment_id on public.payment_lines
  for each row execute function private.stamp_sandbox_from_payment();

create or replace function private.stamp_inventory_tx()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sandbox boolean;
begin
  if new.site_id is not null then
    select s.is_sandbox into v_sandbox from public.sites s where s.id = new.site_id;
    if not found then
      raise exception 'site not found';
    end if;
    new.location := 'site';
    new.is_sandbox := v_sandbox;
  else
    new.location := 'dupont';
    new.is_sandbox := private.in_practice();
  end if;
  return new;
end;
$$;

create trigger inventory_tx_stamp_sandbox
  before insert or update of site_id on public.inventory_tx
  for each row execute function private.stamp_inventory_tx();

create trigger reorder_notices_stamp_sandbox
  before insert or update of site_id on public.reorder_notices
  for each row execute function private.stamp_sandbox_from_site();

-- ---------------------------------------------------------------------------
-- Rates and weekly pay. Amounts are computed here from approved shift times.
-- ---------------------------------------------------------------------------

create or replace function public.set_pay_rate(
  p_person uuid,
  p_rate numeric,
  p_effective date,
  p_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.pay_rates;
  v_sandbox boolean;
begin
  if not private.is_admin() then
    raise exception 'Not allowed.';
  end if;
  if p_person is null or p_rate is null or p_rate < 0 or p_effective is null then
    raise exception 'Rate, person, and the date it starts are required.';
  end if;
  v_sandbox := private.in_practice();
  insert into public.pay_rates (person_id, hourly_rate, effective_on, is_sandbox, idempotency_key, created_by)
  values (p_person, p_rate, p_effective, v_sandbox, p_key, auth.uid())
  on conflict (person_id, effective_on, is_sandbox) do update
    set hourly_rate = excluded.hourly_rate
  returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

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
  if p_status = 'submitted' and v_pay.status = 'paid' then
    raise exception 'This pay run is already paid.';
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
-- One stock change. Recount stores the difference from what is on hand.
-- ---------------------------------------------------------------------------

create or replace function public.record_stock(
  p_sku uuid,
  p_site uuid,
  p_action text,
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
  v_sandbox boolean;
  v_on_hand numeric;
  v_delta numeric;
  v_type text;
  v_row public.inventory_tx;
begin
  if not private.can_write() then
    raise exception 'Not allowed.';
  end if;
  if p_sku is null or p_action not in ('add', 'take', 'recount') or p_qty is null then
    raise exception 'Pick an item, an action, and a quantity.';
  end if;
  if p_action = 'recount' and p_qty < 0 then
    raise exception 'A recount cannot be negative.';
  end if;
  if p_action <> 'recount' and p_qty <= 0 then
    raise exception 'Enter how many you added or took.';
  end if;

  if p_site is null then
    if not private.is_admin() then
      raise exception 'Only an admin can change Dupont stock.';
    end if;
    v_sandbox := private.in_practice();
  else
    if not private.can_see_site(p_site) then
      raise exception 'Not allowed at that site.';
    end if;
    select s.is_sandbox into v_sandbox from public.sites s where s.id = p_site;
    if not found then
      raise exception 'site not found';
    end if;
    if v_sandbox is distinct from private.in_practice() and not private.is_admin() then
      raise exception 'Switch practice mode to match that site.';
    end if;
    if private.in_practice() and v_sandbox = false then
      raise exception 'Practice cannot change live stock.';
    end if;
  end if;

  select coalesce(sum(t.delta_base), 0) into v_on_hand
  from public.inventory_tx t
  where t.sku_id = p_sku
    and t.is_sandbox = v_sandbox
    and (
      (p_site is null and t.location = 'dupont' and t.site_id is null)
      or (t.site_id = p_site and t.location = 'site')
    );

  if p_action = 'add' then
    v_delta := p_qty;
    v_type := 'receipt';
  elsif p_action = 'take' then
    if p_qty > v_on_hand then
      raise exception 'That is more than is on hand.';
    end if;
    v_delta := -p_qty;
    v_type := 'withdrawal';
  else
    v_delta := p_qty - v_on_hand;
    v_type := 'adjustment';
  end if;

  insert into public.inventory_tx (
    sku_id, type, delta_base, person_id, site_id, location, note, is_sandbox, idempotency_key, created_by
  ) values (
    p_sku,
    v_type,
    v_delta,
    private.current_person_id(),
    p_site,
    case when p_site is null then 'dupont' else 'site' end,
    nullif(trim(coalesce(p_note, '')), ''),
    v_sandbox,
    p_key,
    auth.uid()
  )
  returning * into v_row;
  return to_jsonb(v_row) || jsonb_build_object('on_hand', v_on_hand + v_delta);
end;
$$;

-- Held reorder list only. Status stays held. No email is sent.
create or replace function public.preview_reorder(p_day date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date := coalesce(p_day, (now() at time zone 'America/Toronto')::date);
  v_row record;
  v_on_hand numeric;
  v_count integer := 0;
begin
  if not private.is_admin() then
    raise exception 'Not allowed.';
  end if;
  for v_row in
    select ss.site_id, ss.sku_id, ss.low_threshold, s.is_sandbox
    from public.site_skus ss
    join public.sites s on s.id = ss.site_id
    where ss.low_threshold is not null
      and s.is_sandbox = private.in_practice()
  loop
    select coalesce(sum(t.delta_base), 0) into v_on_hand
    from public.inventory_tx t
    where t.sku_id = v_row.sku_id
      and t.site_id = v_row.site_id
      and t.location = 'site'
      and t.is_sandbox = v_row.is_sandbox;
    if v_on_hand < v_row.low_threshold then
      insert into public.reorder_notices (
        site_id, sku_id, on_hand, low_threshold, notice_on, status, is_sandbox, created_by
      ) values (
        v_row.site_id, v_row.sku_id, v_on_hand, v_row.low_threshold, v_day, 'held', v_row.is_sandbox, auth.uid()
      )
      on conflict (site_id, sku_id, notice_on, is_sandbox) do update
        set on_hand = excluded.on_hand,
            low_threshold = excluded.low_threshold,
            status = 'held';
      v_count := v_count + 1;
    end if;
  end loop;
  return jsonb_build_object('sent', false, 'held', v_count, 'notice_on', v_day);
end;
$$;

revoke all on function public.set_pay_rate(uuid, numeric, date, uuid) from public, anon;
revoke all on function public.save_pay_run(uuid, date, date, uuid[], uuid) from public, anon;
revoke all on function public.mark_pay_run(uuid, text, date) from public, anon;
revoke all on function public.record_stock(uuid, uuid, text, numeric, text, uuid) from public, anon;
revoke all on function public.preview_reorder(date) from public, anon;
grant execute on function public.set_pay_rate(uuid, numeric, date, uuid) to authenticated;
grant execute on function public.save_pay_run(uuid, date, date, uuid[], uuid) to authenticated;
grant execute on function public.mark_pay_run(uuid, text, date) to authenticated;
grant execute on function public.record_stock(uuid, uuid, text, numeric, text, uuid) to authenticated;
grant execute on function public.preview_reorder(date) to authenticated;

alter table public.pay_rates enable row level security;
alter table public.payment_lines enable row level security;
alter table public.reorder_notices enable row level security;

create policy pay_rates_select on public.pay_rates
  for select to authenticated
  using (
    private.is_admin()
    or (person_id = private.current_person_id() and is_sandbox = private.in_practice())
  );

create policy pay_rates_admin on public.pay_rates
  for all to authenticated
  using (private.is_admin())
  with check (private.is_admin());

create policy payment_lines_select on public.payment_lines
  for select to authenticated
  using (
    private.is_admin()
    or exists (
      select 1
      from public.payments p
      where p.id = payment_id
        and p.person_id = private.current_person_id()
        and p.is_sandbox = private.in_practice()
    )
  );

create policy payment_lines_admin on public.payment_lines
  for all to authenticated
  using (private.is_admin())
  with check (private.is_admin());

create policy reorder_select on public.reorder_notices
  for select to authenticated
  using (
    private.is_admin()
    or (private.can_see_site(site_id) and is_sandbox = private.in_practice())
  );

create policy reorder_admin on public.reorder_notices
  for all to authenticated
  using (private.is_admin())
  with check (private.is_admin());

grant select, insert, update, delete on public.pay_rates to authenticated;
grant select, insert, update, delete on public.payment_lines to authenticated;
grant select, insert, update, delete on public.reorder_notices to authenticated;
-- skus, sku_packs, site_skus, inventory_tx, and payments already have grants in 0002.
