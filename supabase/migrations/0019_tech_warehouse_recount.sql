-- Techs can read Dupont stock and save a recount. Admins still add and take.
-- Not applied to the hosted project. Apply only when that change is approved.

drop policy if exists tx_select on public.inventory_tx;

create policy tx_select on public.inventory_tx
  for select to authenticated
  using (
    public.is_admin()
    or (
      public.is_active()
      and is_sandbox = public.in_practice()
      and (
        location = 'dupont'
        or person_id = public.current_person_id()
        or (site_id is not null and public.can_see_site(site_id))
      )
    )
  );

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
    if not private.is_admin() and p_action <> 'recount' then
      raise exception 'Only an admin can add or take Dupont stock.';
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
