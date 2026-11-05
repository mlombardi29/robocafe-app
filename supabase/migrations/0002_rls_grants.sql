-- Grants and row level security.
-- The hosted project does not auto-expose tables. anon receives no table privileges.
-- auth_pins and login_attempts stay service-role only.

grant usage on schema public to anon, authenticated;

revoke all on all tables in schema public from public;
revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;

revoke all on all functions in schema public from public;
revoke all on all functions in schema public from anon;
grant execute on all functions in schema public to authenticated;

-- Writes from the browser. Deletes go through security-definer RPCs (reset, void).
grant select, insert, update on public.people to authenticated;
grant select, insert, update on public.person_sites to authenticated;
grant select on public.models to authenticated;
grant select, insert, update on public.sites to authenticated;
grant select, insert, update on public.checklist_templates to authenticated;
grant select, insert, update on public.checklist_sections to authenticated;
grant select, insert, update on public.checklist_items to authenticated;
grant select, insert, update on public.site_item_settings to authenticated;
grant select, insert, update on public.site_item_state to authenticated;
grant select, insert on public.service_sessions to authenticated;
grant update (current_step_key, start_at, end_at, notes) on public.service_sessions to authenticated;
grant select, insert, update on public.service_item_completions to authenticated;
grant select, insert, update on public.time_corrections to authenticated;
grant select on public.training_progress to authenticated;
grant select on public.quiz_questions to authenticated;
grant select on public.quiz_attempts to authenticated;
grant select, insert, update on public.schedule_rules to authenticated;
grant select, insert, update on public.show_days to authenticated;
grant select on public.audit_log to authenticated;
grant select, update on public.config to authenticated;
grant select, update on public.offboarding_tasks to authenticated;
grant select, insert, update on public.site_codes to authenticated;

-- Phase 2 tables: readable by signed-in users under the policies below. Writes are admin-only.
grant select on public.skus to authenticated;
grant select on public.sku_packs to authenticated;
grant select on public.site_skus to authenticated;
grant select on public.inventory_tx to authenticated;
grant select on public.stock_flags to authenticated;
grant select on public.payments to authenticated;
grant select on public.charges to authenticated;

grant insert, update on public.skus to authenticated;
grant insert, update on public.sku_packs to authenticated;
grant insert, update on public.site_skus to authenticated;
grant insert, update on public.inventory_tx to authenticated;
grant insert, update on public.stock_flags to authenticated;
grant insert, update on public.payments to authenticated;
grant insert, update on public.charges to authenticated;

create or replace function public.can_write()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.people p
    where p.id = public.current_person_id()
      and p.role in ('admin', 'tech', 'trainee')
  )
$$;

revoke all on function public.can_write() from public, anon;
grant execute on function public.can_write() to authenticated;

-- ---------------------------------------------------------------------------
-- Enable RLS on every public table. No policies on PIN tables.
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select tablename
    from pg_tables
    where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', r.tablename);
    execute format('alter table public.%I force row level security', r.tablename);
  end loop;
end $$;

-- People
create policy people_select on public.people
  for select to authenticated
  using (public.is_admin() or id = public.current_person_id());

create policy people_insert on public.people
  for insert to authenticated
  with check (public.is_admin());

create policy people_update on public.people
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Sites
create policy sites_select on public.sites
  for select to authenticated
  using (
    public.is_admin()
    or (
      public.is_active()
      and public.can_see_site(id)
      and is_sandbox = public.in_practice()
    )
  );

create policy sites_write on public.sites
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Assignments
create policy person_sites_select on public.person_sites
  for select to authenticated
  using (public.is_admin() or person_id = public.current_person_id());

create policy person_sites_write on public.person_sites
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Checklist content: any active signed-in person can read. Admins write.
create policy models_select on public.models
  for select to authenticated
  using (public.is_active());

create policy models_write on public.models
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy templates_select on public.checklist_templates
  for select to authenticated
  using (public.is_active());

create policy templates_write on public.checklist_templates
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy sections_select on public.checklist_sections
  for select to authenticated
  using (public.is_active());

create policy sections_write on public.checklist_sections
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy items_select on public.checklist_items
  for select to authenticated
  using (public.is_active());

create policy items_write on public.checklist_items
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy quiz_questions_select on public.quiz_questions
  for select to authenticated
  using (public.is_active());

create policy quiz_questions_write on public.quiz_questions
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Per-site rows follow practice/live plus site visibility.
create policy settings_select on public.site_item_settings
  for select to authenticated
  using (
    public.is_admin()
    or (
      public.is_active()
      and public.can_see_site(site_id)
      and is_sandbox = public.in_practice()
    )
  );

create policy settings_write on public.site_item_settings
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy state_select on public.site_item_state
  for select to authenticated
  using (
    public.is_admin()
    or (
      public.is_active()
      and public.can_see_site(site_id)
      and is_sandbox = public.in_practice()
    )
  );

create policy state_write on public.site_item_state
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Visits
create policy sessions_select on public.service_sessions
  for select to authenticated
  using (
    public.is_admin()
    or (
      public.is_active()
      and public.can_see_site(site_id)
      and is_sandbox = public.in_practice()
    )
  );

create policy sessions_insert on public.service_sessions
  for insert to authenticated
  with check (
    public.can_write()
    and person_id = public.current_person_id()
    and status = 'open'
    and submitted_at is null
    and public.can_see_site(site_id)
    and is_sandbox = public.in_practice()
  );

create policy sessions_update_own on public.service_sessions
  for update to authenticated
  using (
    public.can_write()
    and person_id = public.current_person_id()
    and status = 'open'
    and is_sandbox = public.in_practice()
  )
  with check (
    public.can_write()
    and person_id = public.current_person_id()
    and status = 'open'
    and is_sandbox = public.in_practice()
  );

-- Admins can update submitted rows (correction RPC also bypasses RLS).
create policy sessions_admin on public.service_sessions
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy completions_select on public.service_item_completions
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1
      from public.service_sessions s
      where s.id = session_id
        and public.can_see_site(s.site_id)
        and s.is_sandbox = public.in_practice()
    )
  );

create policy completions_write on public.service_item_completions
  for insert to authenticated
  with check (
    public.can_write()
    and is_sandbox = public.in_practice()
    and exists (
      select 1
      from public.service_sessions s
      where s.id = session_id
        and s.person_id = public.current_person_id()
        and s.status = 'open'
        and s.is_sandbox = public.in_practice()
    )
  );

create policy completions_update on public.service_item_completions
  for update to authenticated
  using (
    public.can_write()
    and exists (
      select 1
      from public.service_sessions s
      where s.id = session_id
        and s.person_id = public.current_person_id()
        and s.status = 'open'
        and s.is_sandbox = public.in_practice()
    )
  )
  with check (
    public.can_write()
    and is_sandbox = public.in_practice()
    and exists (
      select 1
      from public.service_sessions s
      where s.id = session_id
        and s.person_id = public.current_person_id()
        and s.status = 'open'
    )
  );

create policy corrections_select on public.time_corrections
  for select to authenticated
  using (
    public.is_admin()
    or (
      requested_by = public.current_person_id()
      and is_sandbox = public.in_practice()
    )
  );

create policy corrections_insert on public.time_corrections
  for insert to authenticated
  with check (
    public.can_write()
    and requested_by = public.current_person_id()
    and is_sandbox = public.in_practice()
    and exists (
      select 1
      from public.service_sessions s
      where s.id = session_id
        and s.person_id = public.current_person_id()
    )
  );

create policy corrections_admin on public.time_corrections
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy training_select on public.training_progress
  for select to authenticated
  using (public.is_admin() or person_id = public.current_person_id());

create policy training_admin on public.training_progress
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy attempts_select on public.quiz_attempts
  for select to authenticated
  using (public.is_admin() or person_id = public.current_person_id());

create policy attempts_admin on public.quiz_attempts
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy rules_select on public.schedule_rules
  for select to authenticated
  using (
    public.is_admin()
    or (
      public.is_active()
      and public.can_see_site(site_id)
      and is_sandbox = public.in_practice()
    )
  );

create policy rules_admin on public.schedule_rules
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy shows_select on public.show_days
  for select to authenticated
  using (
    public.is_admin()
    or (
      public.is_active()
      and public.can_see_site(site_id)
      and is_sandbox = public.in_practice()
    )
  );

create policy shows_admin on public.show_days
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy audit_admin on public.audit_log
  for select to authenticated
  using (public.is_admin());

create policy config_select on public.config
  for select to authenticated
  using (public.is_active());

create policy config_admin on public.config
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy offboarding_admin on public.offboarding_tasks
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy codes_select on public.site_codes
  for select to authenticated
  using (
    public.is_active()
    and public.can_see_site(site_id)
    and (public.is_admin() or is_sandbox = public.in_practice())
  );

create policy codes_admin on public.site_codes
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Phase 2
create policy skus_select on public.skus
  for select to authenticated
  using (public.is_active());

create policy skus_admin on public.skus
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy packs_select on public.sku_packs
  for select to authenticated
  using (public.is_active());

create policy packs_admin on public.sku_packs
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy site_skus_select on public.site_skus
  for select to authenticated
  using (
    public.is_admin()
    or (
      public.is_active()
      and public.can_see_site(site_id)
      and is_sandbox = public.in_practice()
    )
  );

create policy site_skus_admin on public.site_skus
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy tx_select on public.inventory_tx
  for select to authenticated
  using (
    public.is_admin()
    or (
      public.is_active()
      and is_sandbox = public.in_practice()
      and (
        person_id = public.current_person_id()
        or (site_id is not null and public.can_see_site(site_id))
      )
    )
  );

create policy tx_admin on public.inventory_tx
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy flags_select on public.stock_flags
  for select to authenticated
  using (
    public.is_admin()
    or (
      public.is_active()
      and public.can_see_site(site_id)
      and is_sandbox = public.in_practice()
    )
  );

create policy flags_admin on public.stock_flags
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy payments_select on public.payments
  for select to authenticated
  using (
    public.is_admin()
    or (
      person_id = public.current_person_id()
      and is_sandbox = public.in_practice()
    )
  );

create policy payments_admin on public.payments
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy charges_select on public.charges
  for select to authenticated
  using (
    public.is_admin()
    or (
      person_id = public.current_person_id()
      and is_sandbox = public.in_practice()
    )
  );

create policy charges_admin on public.charges
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create view public.v_live_sessions
with (security_invoker = true) as
select *
from public.service_sessions
where is_sandbox = false;

grant select on public.v_live_sessions to authenticated;

-- Confirm PIN tables have nothing granted.
revoke all on public.auth_pins from public, anon, authenticated;
revoke all on public.login_attempts from public, anon, authenticated;
