-- Additive. Apply after 0014. Do not apply this from the app.
-- Does not update existing visit rows or their checklist snapshots.
-- New visits get not_needed_allowed on insert. Older snapshots omit it and stay finishable.

update public.checklist_items i
set title = 'Long Water Pour',
    details = $txt$1. Scroll through the product pages on the Cameo. You may need to press Next a few times.
2. Select the Long Water Pour.
3. With a container underneath the Cameo nozzle, this water will be used for the syrup cleaning. You may need to dispense it twice.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'long_water' and m.code in ('s35', 's5');

update public.checklist_items i
set details = $txt$1. Scan in with the KCM app. The options appear after that scan.
2. On the order pickup tablet, press Maintenance Mode.$txt$
from public.checklist_sections s
where i.section_id = s.id and i.key = 'maintenance_mode';

update public.checklist_items i
set details = $txt$If you need to remove any balls that are cracked, do so, or else it will damage the machine.$txt$
from public.checklist_sections s
where i.section_id = s.id and i.key = 'cleaning_balls';

update public.checklist_items i
set details = $txt$1. Cameo menu, top middle, Clean.
2. Follow the prompts on the screen.

Additional info
The cleaning runs about 11 minutes.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'start_milk_clean' and m.code = 's35';

update public.checklist_items i
set details = $txt$1. Cameo menu, top middle, Clean.
2. Follow the prompts on the screen.

Additional info
The cleaning runs about 18 minutes.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'start_milk_clean' and m.code = 's5';

update public.checklist_items i
set details = $txt$1. Follow the prompts on the milk module screen.

Additional info
The cleaning runs about 9 minutes. Don't touch the module while it runs.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'start_milk_clean' and m.code = 's22';

update public.checklist_items i
set details = $txt$1. Open the syrup drawer.
2. Press Clean.
3. Follow the prompts on the syrup containers.
4. At the final tube refill, when syrup is visible from all spouts, press OK so it does not keep pouring.
5. Wipe the bottles with hot water.
6. Push the nozzles at the end of the tubes fully down so they reach deep into the liquid, not just the surface.
7. Caps tight on top.
8. Run a pipe cleaner through the syrup nozzles so they don't clog.

Additional info
At UofT (2.2), move the cup holder out of the way. At Sinai (3.5) and RBC (S5), park the robotic arm out of the way.$txt$
from public.checklist_sections s
where i.section_id = s.id and i.key = 'syrup';

update public.checklist_items i
set title = 'Clean the powder nozzles',
    details = $txt$1. Lay a damp paper towel under the dispenser first to catch fallout.
2. Turn the nozzles upward and take out the funnels.
3. Check for powder buildup or residue. If there is residue, deep clean it, and it must be completely dry before you put it back. Wetness causes more buildup.
4. Vacuum any loose powder with the handheld vacuum.
5. Turn all three powder spouts back to down-facing, or powder drinks come out as plain hot water.$txt$
from public.checklist_sections s
where i.section_id = s.id and i.key = 'powder_clean';

update public.checklist_items i
set title = 'Clean Robot Claw (delicately)',
    details = $txt$1. The arm and claw are very sensitive to pressure and easy to knock off calibration.
2. Use very hot water on a towel and press lightly.
3. Don't scrub and don't push.$txt$
from public.checklist_sections s
where i.section_id = s.id and i.key = 'claw';

update public.checklist_items i
set details = $txt$1. The drink dispensing elevators sit higher when the kiosk is running than when they are open for servicing.
2. They slide down to the customer opening, and there is less space at the top.
3. Leave clear space above anything you put back, and do not stack anything into that path.
4. A blocked elevator takes the kiosk out of service and can break it.

Additional info
Other doors on the kiosk are separate. Do not block those either.$txt$
from public.checklist_sections s
where i.section_id = s.id and i.key = 'door_check';

update public.checklist_items i
set details = $txt$1. On the order tablet go to Robot API.
2. Press Get Weight. It should read 0 g.
3. Press Close Claw and place the weighing cup from the top into the claw.
4. Press Get Weight. 190–210 g inclusive is successful.
5. Remove the weighing cup. Open the claw using the button.
6. If the weight is outside that range, still remove the cup and open the claw, then press Auto Calibrate. The robot picks up the cup itself.
7. When it does, read the displayed weight. It should say 200 and success.

Additional info
Do not press a manual Calibrate 200 command. This weight check is not the cup presence sensor.$txt$
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where i.section_id = s.id and i.key = 'arm_calibration' and m.code in ('s35', 's5');

create or replace function private.stamp_visit_not_needed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  denied text[] := array[
    'kc_sign_in', 'gloves', 'maintenance_mode', 'long_water', 'start_milk_clean',
    'syrup', 'powder_clean', 'glass', 'wipe_cameo', 'door_check', 'exit_maint', 'test_drink'
  ];
begin
  if new.checklist_snapshot is null then
    return new;
  end if;
  new.checklist_snapshot := jsonb_set(
    new.checklist_snapshot,
    '{sections}',
    coalesce((
      select jsonb_agg(
        jsonb_set(
          sec,
          '{items}',
          coalesce((
            select jsonb_agg(
              case
                when item->>'key' = any (denied) then item || jsonb_build_object('not_needed_allowed', false)
                else item || jsonb_build_object('not_needed_allowed', true)
              end
              order by ord
            )
            from jsonb_array_elements(coalesce(sec->'items', '[]'::jsonb)) with ordinality as t(item, ord)
          ), '[]'::jsonb)
        )
        order by sord
      )
      from jsonb_array_elements(coalesce(new.checklist_snapshot->'sections', '[]'::jsonb)) with ordinality as s(sec, sord)
    ), '[]'::jsonb)
  );
  return new;
end;
$$;

revoke all on function private.stamp_visit_not_needed() from public, anon, authenticated;

drop trigger if exists service_sessions_stamp_not_needed on public.service_sessions;
create trigger service_sessions_stamp_not_needed
  before insert on public.service_sessions
  for each row execute function private.stamp_visit_not_needed();

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
  v_skip text;
  v_minutes integer;
  v_running boolean;
begin
  v_person := private.current_person_id();
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
  if v_session.person_id <> v_person and not private.is_admin() then
    raise exception 'Not allowed.';
  end if;
  if v_session.is_sandbox is distinct from private.in_practice() and not private.is_admin() then
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

  select item->>'key', (item->>'locked_during_clean') = 'true', item->>'not_needed_allowed'
    into v_key, v_locked, v_skip
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

  if p_state = 'not_needed' and v_skip = 'false' then
    raise exception 'This step is part of every service.';
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
