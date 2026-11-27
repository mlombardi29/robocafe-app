-- Editable charges (Michael Nov 15).
-- Tech: edit own unpaid charge until end of the Toronto calendar day it was logged.
-- Admin: edit any non-voided charge (paid ones allowed; UI warns before save).
-- Hosted apply requires separate approval. Additive; does not rewrite 0017.

alter table public.charges
  add column if not exists voided boolean not null default false,
  add column if not exists edited_at timestamptz,
  add column if not exists edited_by uuid references public.people (id);

create table if not exists public.charge_edits (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  charge_id uuid not null references public.charges (id) on delete cascade,
  edited_by uuid not null references public.people (id),
  previous_amount numeric,
  previous_site_id uuid,
  previous_note text,
  previous_receipt_url text,
  previous_paid boolean,
  new_amount numeric,
  new_site_id uuid,
  new_note text,
  new_receipt_url text,
  new_paid boolean,
  reason text
);

create index if not exists charge_edits_charge_id_idx on public.charge_edits (charge_id, created_at desc);

alter table public.charge_edits enable row level security;

drop policy if exists charge_edits_select on public.charge_edits;
create policy charge_edits_select on public.charge_edits
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1
      from public.charges c
      where c.id = charge_id
        and c.person_id = public.current_person_id()
    )
  );

drop policy if exists charge_edits_admin on public.charge_edits;
create policy charge_edits_admin on public.charge_edits
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select on public.charge_edits to authenticated;
grant insert on public.charge_edits to authenticated;

-- True while now is still on the Toronto calendar day of created_at (before local midnight).
create or replace function public.charge_same_toronto_day(p_created timestamptz, p_now timestamptz default now())
returns boolean
language sql
stable
set search_path = public
as $$
  select public.toronto_date(p_created) = public.toronto_date(p_now)
$$;

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

revoke all on function public.charge_same_toronto_day(timestamptz, timestamptz) from public, anon;
grant execute on function public.charge_same_toronto_day(timestamptz, timestamptz) to authenticated;

revoke all on function public.edit_charge(uuid, numeric, uuid, text, text, uuid) from public, anon;
grant execute on function public.edit_charge(uuid, numeric, uuid, text, text, uuid) to authenticated;

insert into public.config (key, value)
values ('edit_charges_migration', '0018')
on conflict (key) do update set value = excluded.value;
