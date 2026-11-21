-- Additive hardening. 0001–0004 are already applied on the hosted project; do not edit them.
-- Row level security policies run as the signed-in role, so that role still needs EXECUTE
-- on the helper functions. Those helpers move to schema private, which is not in the
-- Data API exposed schemas, so they are not callable at /rest/v1/rpc.
-- Admin RPCs stay in public (the app calls them) and reject anyone who is not an admin.

-- ---------------------------------------------------------------------------
-- Helpers the policies need. Not exposed by PostgREST.
-- ---------------------------------------------------------------------------

create or replace function private.current_person_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id
  from public.people p
  where p.auth_user_id = auth.uid()
    and p.active
    and (p.expires_at is null or p.expires_at > now())
  limit 1
$$;

create or replace function private.is_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select private.current_person_id() is not null
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.people p
    where p.auth_user_id = auth.uid()
      and p.active
      and p.role = 'admin'
      and (p.expires_at is null or p.expires_at > now())
  )
$$;

create or replace function private.in_practice()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.people p
    where p.auth_user_id = auth.uid()
      and p.active
      and (p.expires_at is null or p.expires_at > now())
      and (p.mode = 'practice' or p.role = 'trainee')
  )
$$;

create or replace function private.can_see_site(p_site uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.sites s
    where s.id = p_site
      and (
        private.is_admin()
        or (
          private.is_active()
          and (
            s.is_sandbox
            or exists (
              select 1
              from public.person_sites ps
              where ps.person_id = private.current_person_id()
                and ps.site_id = s.id
            )
          )
        )
      )
  )
$$;

create or replace function private.can_write()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.people p
    where p.id = private.current_person_id()
      and p.role in ('admin', 'tech', 'trainee')
  )
$$;

revoke all on all functions in schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.current_person_id() to authenticated;
grant execute on function private.is_active() to authenticated;
grant execute on function private.is_admin() to authenticated;
grant execute on function private.in_practice() to authenticated;
grant execute on function private.can_see_site(uuid) to authenticated;
grant execute on function private.can_write() to authenticated;

-- Triggers call this. Point it at the private helper so it does not depend on a public grant.
create or replace function private.lock_submitted_times()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.submitted_at is not null
     and (new.start_at is distinct from old.start_at or new.end_at is distinct from old.end_at)
     and not private.is_admin() then
    raise exception 'Submitted times are locked. Request a correction.';
  end if;
  return new;
end;
$$;

revoke all on function private.lock_submitted_times() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Policies keep the same rules, but call private.* (the caller can execute those).
-- ---------------------------------------------------------------------------

create or replace function private.rewrite_policy_expr(expr text)
returns text
language plpgsql
immutable
set search_path = public
as $$
begin
  if expr is null then
    return null;
  end if;
  expr := replace(expr, 'public.is_admin()', '§is_admin§');
  expr := replace(expr, 'is_admin()', '§is_admin§');
  expr := replace(expr, 'public.is_active()', '§is_active§');
  expr := replace(expr, 'is_active()', '§is_active§');
  expr := replace(expr, 'public.in_practice()', '§in_practice§');
  expr := replace(expr, 'in_practice()', '§in_practice§');
  expr := replace(expr, 'public.current_person_id()', '§current_person_id§');
  expr := replace(expr, 'current_person_id()', '§current_person_id§');
  expr := replace(expr, 'public.can_write()', '§can_write§');
  expr := replace(expr, 'can_write()', '§can_write§');
  expr := replace(expr, 'public.can_see_site(', '§can_see_site§');
  expr := replace(expr, 'can_see_site(', '§can_see_site§');
  expr := replace(expr, '§is_admin§', 'private.is_admin()');
  expr := replace(expr, '§is_active§', 'private.is_active()');
  expr := replace(expr, '§in_practice§', 'private.in_practice()');
  expr := replace(expr, '§current_person_id§', 'private.current_person_id()');
  expr := replace(expr, '§can_write§', 'private.can_write()');
  expr := replace(expr, '§can_see_site§', 'private.can_see_site(');
  return expr;
end;
$$;

do $policies$
declare
  r record;
  using_expr text;
  check_expr text;
begin
  for r in
    select policyname, tablename, cmd, roles, permissive, qual, with_check
    from pg_policies
    where schemaname = 'public'
  loop
    using_expr := private.rewrite_policy_expr(r.qual);
    check_expr := private.rewrite_policy_expr(r.with_check);
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
    execute format(
      'create policy %I on public.%I as %s for %s to %s %s %s',
      r.policyname,
      r.tablename,
      case when r.permissive = 'PERMISSIVE' then 'permissive' else 'restrictive' end,
      r.cmd,
      array_to_string(r.roles, ', '),
      case when using_expr is not null then format('using (%s)', using_expr) else '' end,
      case when check_expr is not null then format('with check (%s)', check_expr) else '' end
    );
  end loop;
end
$policies$;

drop function private.rewrite_policy_expr(text);

-- ---------------------------------------------------------------------------
-- Public copies of the helpers are not for the browser. Revoke them.
-- The migration owner keeps EXECUTE so security-definer RPCs can still call them.
-- ---------------------------------------------------------------------------

revoke all on function public.current_person_id() from public, anon, authenticated;
revoke all on function public.is_active() from public, anon, authenticated;
revoke all on function public.is_admin() from public, anon, authenticated;
revoke all on function public.in_practice() from public, anon, authenticated;
revoke all on function public.can_see_site(uuid) from public, anon, authenticated;
revoke all on function public.can_write() from public, anon, authenticated;
revoke all on function public.toronto_date(timestamptz) from public, anon, authenticated;

do $grants$
declare
  r record;
  owner_name text;
begin
  for r in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.proowner
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'current_person_id', 'is_active', 'is_admin', 'in_practice',
        'can_see_site', 'can_write', 'toronto_date'
      )
  loop
    owner_name := pg_get_userbyid(r.proowner);
    execute format(
      'grant execute on function public.%I(%s) to %I',
      r.proname, r.args, owner_name
    );
  end loop;
end
$grants$;

-- Admin-only RPCs. EXECUTE stays granted, and each body refuses a non-admin.
create or replace function public.reset_sandbox()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not private.is_admin() then
    raise exception 'Not allowed.';
  end if;

  delete from public.service_item_completions where is_sandbox;
  delete from public.time_corrections where is_sandbox;
  delete from public.service_sessions where is_sandbox;
  delete from public.site_item_state where is_sandbox;
  delete from public.show_days where is_sandbox;

  insert into public.site_item_state (site_id, item_id, last_done_at, is_sandbox)
  select s.id, i.id,
    case i.key
      when 'milk_bag' then now() - interval '5 days'
      when 'empty_pucks' then now() - interval '3 days'
      when 'arm_calibration' then now() - interval '8 days'
      when 'arm_sensor' then now() - interval '8 days'
      when 'deep_clean_nozzles' then now() - interval '3 days'
      when 'deep_clean_fridges' then now() - interval '3 days'
    end,
    true
  from public.sites s
  join public.models m on m.id = s.model_id
  join public.checklist_templates t on t.model_id = m.id and t.published
  join public.checklist_sections sec on sec.template_id = t.id
  join public.checklist_items i on i.section_id = sec.id
  where s.is_sandbox
    and i.key in ('milk_bag', 'empty_pucks', 'arm_calibration', 'arm_sensor', 'deep_clean_nozzles', 'deep_clean_fridges');

  insert into public.show_days (site_id, date, show_start_time, status, is_sandbox)
  select s.id, current_date, time '18:00', 'scheduled', true
  from public.sites s where s.name = 'PRACTICE – RBC (S5)'
  union all
  select s.id, current_date + 3, time '19:00', 'scheduled', true
  from public.sites s where s.name = 'PRACTICE – RBC (S5)'
  union all
  select s.id, current_date + 10, time '17:30', 'scheduled', true
  from public.sites s where s.name = 'PRACTICE – RBC (S5)';
end;
$$;

revoke all on function public.reset_sandbox() from public, anon;
grant execute on function public.reset_sandbox() to authenticated;

create or replace function public.decide_correction(p_id uuid, p_approve boolean, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.time_corrections;
  v_before jsonb;
  v_after jsonb;
begin
  if not private.is_admin() then
    raise exception 'Not allowed.';
  end if;
  select * into v_row from public.time_corrections where id = p_id for update;
  if not found then
    raise exception 'Request not found.';
  end if;
  if v_row.status <> 'pending' then
    return to_jsonb(v_row);
  end if;

  if p_approve then
    select to_jsonb(s.*) into v_before from public.service_sessions s where s.id = v_row.session_id;
    update public.service_sessions
      set start_at = coalesce(v_row.requested_start, start_at),
          end_at = coalesce(v_row.requested_end, end_at)
      where id = v_row.session_id;
    update public.service_sessions
      set service_date = public.toronto_date(start_at)
      where id = v_row.session_id
        and start_at is not null;
    select to_jsonb(s.*) into v_after from public.service_sessions s where s.id = v_row.session_id;
    insert into public.audit_log (actor, table_name, row_id, action, before, after, reason, at, is_sandbox, created_by)
    values (
      auth.uid(), 'service_sessions', v_row.session_id, 'correction',
      v_before, v_after, coalesce(p_note, v_row.reason), now(), v_row.is_sandbox, auth.uid()
    );
  end if;

  update public.time_corrections
    set status = case when p_approve then 'approved' else 'rejected' end,
        decided_by = private.current_person_id(),
        decided_at = now(),
        decision_note = p_note
    where id = p_id
    returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

revoke all on function public.decide_correction(uuid, boolean, text) from public, anon;
grant execute on function public.decide_correction(uuid, boolean, text) to authenticated;

create or replace function public.set_training_status(
  p_person uuid,
  p_model uuid,
  p_status text,
  p_reviewed integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.training_progress;
begin
  if not private.is_admin() then
    raise exception 'Not allowed.';
  end if;
  if p_status not in ('in_training', 'quiz_passed', 'solo', 'signed_off') then
    raise exception 'Unknown training status.';
  end if;
  insert into public.training_progress (person_id, model_id, status, reviewed_services, created_by)
  values (p_person, p_model, p_status, greatest(coalesce(p_reviewed, 0), 0), auth.uid())
  on conflict (person_id, model_id) do update
    set status = excluded.status,
        reviewed_services = excluded.reviewed_services
  returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

revoke all on function public.set_training_status(uuid, uuid, text, integer) from public, anon;
grant execute on function public.set_training_status(uuid, uuid, text, integer) to authenticated;

create or replace function public.void_session(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.service_sessions;
begin
  if not private.is_admin() then
    raise exception 'Not allowed.';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'Give a reason.';
  end if;
  update public.service_sessions
    set status = 'voided',
        notes = concat_ws(E'\n', notes, 'Voided: ' || trim(p_reason))
    where id = p_id
    returning * into v_row;
  if v_row.id is null then
    raise exception 'Visit not found.';
  end if;
  return to_jsonb(v_row);
end;
$$;

revoke all on function public.void_session(uuid, text) from public, anon;
grant execute on function public.void_session(uuid, text) to authenticated;

-- Every security-definer function keeps a fixed search_path.
do $paths$
declare
  r record;
begin
  for r in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.prosecdef
      and n.nspname in ('public', 'private')
  loop
    execute format(
      'alter function %I.%I(%s) set search_path = public',
      r.nspname, r.proname, r.args
    );
  end loop;
end
$paths$;
