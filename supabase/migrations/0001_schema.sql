-- KioskOps v1 schema. Not applied to the hosted project by this repo.
-- Hosted tables are not auto-exposed: grants and RLS are in 0002_rls_grants.sql.
-- Trigger helpers live in schema private so PostgREST does not expose them.

-- Supabase has pgcrypto. Some local engines already ship gen_random_uuid() without it.
do $ext$
begin
  create extension if not exists pgcrypto;
exception
  when others then
    null;
end
$ext$;

-- Supabase already has these roles. Local/test databases may not.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.people (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  is_sandbox boolean not null default false,
  legacy_id text,
  auth_user_id uuid unique,
  full_name text not null,
  goes_by text not null,
  email text,
  phone text,
  role text not null check (role in ('admin', 'tech', 'trainee', 'visitor')),
  active boolean not null default true,
  mode text not null default 'live' check (mode in ('live', 'practice')),
  expires_at timestamptz
);

create unique index people_email_lower on public.people (lower(email)) where email is not null;

-- PIN hashes. No grants to anon or authenticated (0002). Service role only.
create table public.auth_pins (
  person_id uuid primary key references public.people (id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  is_sandbox boolean not null default false,
  legacy_id text,
  pin_hash text not null,
  must_change boolean not null default true,
  failed_count integer not null default 0,
  locked_until timestamptz,
  changed_at timestamptz
);

create table public.login_attempts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  is_sandbox boolean not null default false,
  legacy_id text,
  ip_hash text not null,
  person_id uuid references public.people (id) on delete set null,
  ok boolean not null,
  at timestamptz not null default now()
);

create index login_attempts_ip_at on public.login_attempts (ip_hash, at);

create table public.models (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  is_sandbox boolean not null default false,
  legacy_id text,
  code text not null unique check (code in ('s35', 's22', 's5')),
  name text not null,
  milk_clean_minutes integer not null check (milk_clean_minutes > 0)
);

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  is_sandbox boolean not null default false,
  legacy_id text,
  name text not null,
  short_name text not null,
  model_id uuid not null references public.models (id),
  serial text,
  cadence text not null check (cadence in ('daily', 'mwf', 'show_days')),
  -- TODO: UofT opening time is unknown. Leave null so the Monday red flag stays off.
  opening_time time,
  active boolean not null default true,
  lockbox_note text
);

create table public.person_sites (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  is_sandbox boolean not null default false,
  legacy_id text,
  person_id uuid not null references public.people (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  unique (person_id, site_id)
);

create table public.checklist_templates (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  is_sandbox boolean not null default false,
  legacy_id text,
  model_id uuid not null references public.models (id),
  version integer not null default 1 check (version > 0),
  published boolean not null default false,
  label text,
  unique (model_id, version)
);

create table public.checklist_sections (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  is_sandbox boolean not null default false,
  legacy_id text,
  template_id uuid not null references public.checklist_templates (id) on delete cascade,
  position integer not null,
  title text not null,
  phase text not null check (phase in (
    'before_maint', 'prep', 'clean_start', 'during_clean', 'after_clean', 'close', 'rare'
  )),
  unique (template_id, position)
);

create table public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  is_sandbox boolean not null default false,
  legacy_id text,
  section_id uuid not null references public.checklist_sections (id) on delete cascade,
  position integer not null,
  key text not null,
  title text not null,
  details text,
  required boolean not null default true,
  cadence_type text not null check (cadence_type in (
    'every_visit', 'every_n_days', 'weekly', 'biweekly', 'monthly',
    'below_threshold', 'check_decide'
  )),
  cadence_days integer,
  threshold_label text,
  photo_url text,
  locked_during_clean boolean not null default false,
  blocks_clean_start boolean not null default false,
  -- pending_validation: arm sensor check. Criteria are not invented.
  status text not null default 'active' check (status in ('active', 'pending_validation')),
  unique (section_id, position),
  unique (section_id, key)
);

create table public.site_item_settings (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  is_sandbox boolean not null default false,
  legacy_id text,
  idempotency_key uuid unique,
  site_id uuid not null references public.sites (id) on delete cascade,
  item_id uuid not null references public.checklist_items (id) on delete cascade,
  -- TODO: per-site fill level X is not set. Null means the step says "Check. Fill if low."
  threshold_value numeric,
  threshold_unit text,
  enabled boolean not null default true,
  unique (site_id, item_id)
);

create table public.site_item_state (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  is_sandbox boolean not null default false,
  legacy_id text,
  site_id uuid not null references public.sites (id) on delete cascade,
  item_id uuid not null references public.checklist_items (id) on delete cascade,
  last_done_at timestamptz,
  last_done_by uuid references public.people (id),
  unique (site_id, item_id)
);

create table public.service_sessions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  is_sandbox boolean not null default false,
  legacy_id text,
  idempotency_key uuid unique,
  site_id uuid not null references public.sites (id),
  person_id uuid not null references public.people (id),
  template_id uuid references public.checklist_templates (id),
  template_version integer,
  checklist_snapshot jsonb,
  service_date date not null,
  start_at timestamptz,
  end_at timestamptz,
  start_estimated boolean not null default false,
  status text not null default 'open' check (status in ('open', 'completed', 'voided')),
  current_step_key text,
  milk_clean_started_at timestamptz,
  milk_clean_done_at timestamptz,
  milk_clean_override_reason text,
  notes text,
  submitted_at timestamptz
);

create unique index service_sessions_one_open
  on public.service_sessions (site_id, person_id)
  where status = 'open';

create unique index service_sessions_no_dup
  on public.service_sessions (site_id, service_date, person_id, start_at)
  where status <> 'voided';

create index service_sessions_site_date on public.service_sessions (site_id, service_date);

create table public.service_item_completions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  is_sandbox boolean not null default false,
  legacy_id text,
  idempotency_key uuid unique,
  session_id uuid not null references public.service_sessions (id) on delete cascade,
  item_id uuid not null references public.checklist_items (id),
  state text not null check (state in ('done', 'not_needed', 'na', 'override')),
  value text,
  note text,
  override_reason text,
  client_rev integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (session_id, item_id)
);

create table public.time_corrections (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  is_sandbox boolean not null default false,
  legacy_id text,
  idempotency_key uuid unique,
  session_id uuid not null references public.service_sessions (id) on delete cascade,
  requested_by uuid not null references public.people (id),
  reason text not null,
  requested_start timestamptz,
  requested_end timestamptz,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by uuid references public.people (id),
  decided_at timestamptz,
  decision_note text,
  was_paid boolean not null default false
);

create table public.training_progress (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  is_sandbox boolean not null default false,
  legacy_id text,
  person_id uuid not null references public.people (id) on delete cascade,
  model_id uuid not null references public.models (id),
  status text not null default 'in_training' check (status in (
    'in_training', 'quiz_passed', 'solo', 'signed_off'
  )),
  reviewed_services integer not null default 0,
  unique (person_id, model_id)
);

create table public.quiz_questions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  is_sandbox boolean not null default false,
  legacy_id text,
  model_id uuid not null references public.models (id),
  position integer not null,
  prompt text not null,
  choices jsonb not null,
  answer_index integer not null,
  explanation text,
  -- Draft until Michael reviews the questions.
  draft boolean not null default true,
  unique (model_id, position)
);

create table public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  is_sandbox boolean not null default false,
  legacy_id text,
  idempotency_key uuid unique,
  person_id uuid not null references public.people (id) on delete cascade,
  model_id uuid not null references public.models (id),
  answers jsonb not null,
  score integer not null,
  passed boolean not null
);

create table public.schedule_rules (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  is_sandbox boolean not null default false,
  legacy_id text,
  site_id uuid not null references public.sites (id) on delete cascade,
  rule text not null check (rule in ('daily', 'mwf', 'show_days')),
  -- Off until an opening time is known. See sites.opening_time.
  due_before_opening boolean not null default false,
  unique (site_id)
);

create table public.show_days (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  is_sandbox boolean not null default false,
  legacy_id text,
  idempotency_key uuid unique,
  site_id uuid not null references public.sites (id) on delete cascade,
  date date not null,
  show_start_time time,
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  unique (site_id, date)
);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  is_sandbox boolean not null default false,
  legacy_id text,
  actor uuid,
  table_name text not null,
  row_id uuid,
  action text not null,
  before jsonb,
  after jsonb,
  reason text,
  at timestamptz not null default now()
);

create index audit_log_row on public.audit_log (table_name, row_id);

-- key is the primary key (config is a dictionary). Other standard columns still exist.
create table public.config (
  key text primary key,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  is_sandbox boolean not null default false,
  legacy_id text,
  value text
);

-- Reminders created when a person is deactivated. No codes are stored here.
create table public.offboarding_tasks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  is_sandbox boolean not null default false,
  legacy_id text,
  idempotency_key uuid unique,
  person_id uuid not null references public.people (id) on delete cascade,
  site_id uuid references public.sites (id),
  title text not null,
  done boolean not null default false,
  done_at timestamptz,
  done_by uuid references public.people (id)
);

-- Empty until an admin enters codes later. Never seed values.
create table public.site_codes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  is_sandbox boolean not null default false,
  legacy_id text,
  site_id uuid not null references public.sites (id) on delete cascade,
  label text not null,
  code text not null
);

-- Phase 2 tables: schema only, no UI, no seed data.
create table public.skus (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  is_sandbox boolean not null default false,
  legacy_id text,
  name text not null,
  base_unit text,
  category text,
  subcategory text,
  source text check (source in ('dupont', 'grocery')),
  reorder_threshold numeric,
  active boolean not null default true
);

create table public.sku_packs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  is_sandbox boolean not null default false,
  legacy_id text,
  sku_id uuid not null references public.skus (id) on delete cascade,
  name text not null,
  per_base numeric not null check (per_base > 0)
);

create table public.site_skus (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  is_sandbox boolean not null default false,
  legacy_id text,
  site_id uuid not null references public.sites (id) on delete cascade,
  sku_id uuid not null references public.skus (id),
  target_level numeric,
  low_threshold numeric,
  kc_max numeric,
  kc_warn numeric,
  unique (site_id, sku_id)
);

create table public.inventory_tx (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  is_sandbox boolean not null default false,
  legacy_id text,
  idempotency_key uuid unique,
  sku_id uuid not null references public.skus (id),
  type text not null check (type in ('receipt', 'withdrawal', 'adjustment')),
  delta_base numeric not null,
  person_id uuid references public.people (id),
  site_id uuid references public.sites (id)
);

create table public.stock_flags (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  is_sandbox boolean not null default false,
  legacy_id text,
  idempotency_key uuid unique,
  site_id uuid not null references public.sites (id),
  sku_id uuid references public.skus (id),
  status text not null check (status in ('low', 'out')),
  resolved_at timestamptz,
  resolved_by uuid references public.people (id)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  is_sandbox boolean not null default false,
  legacy_id text,
  idempotency_key uuid unique,
  person_id uuid not null references public.people (id),
  amount numeric,
  voided boolean not null default false
);

create table public.charges (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  is_sandbox boolean not null default false,
  legacy_id text,
  idempotency_key uuid unique,
  person_id uuid not null references public.people (id),
  site_id uuid references public.sites (id),
  amount numeric,
  receipt_url text,
  paid boolean not null default false
);

-- ---------------------------------------------------------------------------
-- Helpers (public, security definer, search_path locked). Caller is auth.uid().
-- ---------------------------------------------------------------------------

create or replace function public.current_person_id()
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

create or replace function public.is_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_person_id() is not null
$$;

create or replace function public.is_admin()
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

-- Trainee accounts are always in practice, even if mode was stored as live.
create or replace function public.in_practice()
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

-- Sandbox sites are visible to every active person. Live sites need an assignment.
create or replace function public.can_see_site(p_site uuid)
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
        public.is_admin()
        or (
          public.is_active()
          and (
            s.is_sandbox
            or exists (
              select 1
              from public.person_sites ps
              where ps.person_id = public.current_person_id()
                and ps.site_id = s.id
            )
          )
        )
      )
  )
$$;

create or replace function public.toronto_date(p_at timestamptz)
returns date
language sql
stable
set search_path = public
as $$
  select (p_at at time zone 'America/Toronto')::date
$$;

-- ---------------------------------------------------------------------------
-- Triggers in private (not exposed by the Data API)
-- ---------------------------------------------------------------------------

create or replace function private.force_trainee_practice()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.role = 'trainee' then
    new.mode := 'practice';
  end if;
  return new;
end;
$$;

create trigger people_force_trainee_practice
  before insert or update on public.people
  for each row execute function private.force_trainee_practice();

create or replace function private.stamp_sandbox_from_site()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sandbox boolean;
begin
  select s.is_sandbox into v_sandbox from public.sites s where s.id = new.site_id;
  if not found then
    raise exception 'site not found';
  end if;
  new.is_sandbox := v_sandbox;
  return new;
end;
$$;

create trigger sites_stamp_sessions
  before insert or update of site_id on public.service_sessions
  for each row execute function private.stamp_sandbox_from_site();

create trigger sites_stamp_show_days
  before insert or update of site_id on public.show_days
  for each row execute function private.stamp_sandbox_from_site();

create trigger sites_stamp_state
  before insert or update of site_id on public.site_item_state
  for each row execute function private.stamp_sandbox_from_site();

create trigger sites_stamp_settings
  before insert or update of site_id on public.site_item_settings
  for each row execute function private.stamp_sandbox_from_site();

create trigger sites_stamp_rules
  before insert or update of site_id on public.schedule_rules
  for each row execute function private.stamp_sandbox_from_site();

create trigger sites_stamp_person_sites
  before insert or update of site_id on public.person_sites
  for each row execute function private.stamp_sandbox_from_site();

create trigger sites_stamp_site_skus
  before insert or update of site_id on public.site_skus
  for each row execute function private.stamp_sandbox_from_site();

create trigger sites_stamp_flags
  before insert or update of site_id on public.stock_flags
  for each row execute function private.stamp_sandbox_from_site();

create trigger sites_stamp_codes
  before insert or update of site_id on public.site_codes
  for each row execute function private.stamp_sandbox_from_site();

create or replace function private.stamp_sandbox_from_session()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sandbox boolean;
begin
  select s.is_sandbox into v_sandbox from public.service_sessions s where s.id = new.session_id;
  if not found then
    raise exception 'session not found';
  end if;
  new.is_sandbox := v_sandbox;
  return new;
end;
$$;

create trigger sessions_stamp_completions
  before insert or update of session_id on public.service_item_completions
  for each row execute function private.stamp_sandbox_from_session();

create trigger sessions_stamp_corrections
  before insert or update of session_id on public.time_corrections
  for each row execute function private.stamp_sandbox_from_session();

create or replace function private.lock_submitted_times()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.submitted_at is not null
     and (new.start_at is distinct from old.start_at or new.end_at is distinct from old.end_at)
     and not public.is_admin() then
    raise exception 'Submitted times are locked. Request a correction.';
  end if;
  return new;
end;
$$;

create trigger service_sessions_lock_times
  before update on public.service_sessions
  for each row execute function private.lock_submitted_times();

create or replace function private.bump_template_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template uuid;
begin
  select s.template_id into v_template
  from public.checklist_sections s
  where s.id = new.section_id;
  if v_template is not null then
    update public.checklist_templates
      set version = version + 1
      where id = v_template;
  end if;
  return new;
end;
$$;

create trigger checklist_items_bump_version
  after update of title, details, required, cadence_type, cadence_days, status,
    locked_during_clean, blocks_clean_start
  on public.checklist_items
  for each row execute function private.bump_template_version();

create or replace function private.write_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_sandbox boolean;
begin
  if tg_op = 'DELETE' then
    v_id := old.id;
    v_sandbox := old.is_sandbox;
  else
    v_id := new.id;
    v_sandbox := new.is_sandbox;
  end if;
  insert into public.audit_log (actor, table_name, row_id, action, before, after, at, is_sandbox, created_by)
  values (
    auth.uid(),
    tg_table_name,
    v_id,
    tg_op,
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end,
    now(),
    coalesce(v_sandbox, false),
    auth.uid()
  );
  return coalesce(new, old);
end;
$$;

create trigger audit_people
  after insert or update or delete on public.people
  for each row execute function private.write_audit();

create trigger audit_sessions
  after insert or update or delete on public.service_sessions
  for each row execute function private.write_audit();

create trigger audit_completions
  after insert or update or delete on public.service_item_completions
  for each row execute function private.write_audit();

create trigger audit_corrections
  after insert or update or delete on public.time_corrections
  for each row execute function private.write_audit();

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

create or replace function public.my_profile()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  select jsonb_build_object(
    'id', p.id,
    'full_name', p.full_name,
    'goes_by', p.goes_by,
    'email', p.email,
    'phone', p.phone,
    'role', p.role,
    'mode', p.mode,
    'active', p.active,
    'must_change_pin', coalesce(a.must_change, false)
  )
  into v
  from public.people p
  left join public.auth_pins a on a.person_id = p.id
  where p.auth_user_id = auth.uid();
  return v;
end;
$$;

create or replace function public.set_mode(p_mode text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person public.people;
begin
  if p_mode not in ('live', 'practice') then
    raise exception 'Mode must be live or practice.';
  end if;
  select * into v_person from public.people where id = public.current_person_id();
  if v_person.id is null then
    raise exception 'Not signed in.';
  end if;
  if v_person.role = 'trainee' and p_mode <> 'practice' then
    raise exception 'Trainees stay in practice.';
  end if;
  update public.people set mode = p_mode where id = v_person.id;
  return public.my_profile();
end;
$$;

create or replace function public.start_session(
  p_id uuid,
  p_site uuid,
  p_start timestamptz,
  p_estimated boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person uuid;
  v_site public.sites;
  v_template public.checklist_templates;
  v_row public.service_sessions;
  v_snap jsonb;
  v_practice boolean;
begin
  v_person := public.current_person_id();
  if v_person is null then
    raise exception 'Not signed in.';
  end if;
  if p_id is null or p_site is null or p_start is null then
    raise exception 'Start needs a session, a site, and a time.';
  end if;

  select * into v_row from public.service_sessions where id = p_id;
  if found then
    if v_row.person_id <> v_person and not public.is_admin() then
      raise exception 'Not allowed.';
    end if;
    return to_jsonb(v_row);
  end if;

  select * into v_site from public.sites where id = p_site;
  if not found then
    raise exception 'Site not found.';
  end if;
  if not public.can_see_site(p_site) then
    raise exception 'Not allowed.';
  end if;
  if not v_site.active and not public.is_admin() then
    raise exception 'This kiosk is offline for the season.';
  end if;

  v_practice := public.in_practice();
  if v_site.is_sandbox is distinct from v_practice then
    raise exception 'Switch Practice mode so it matches this site.';
  end if;

  select * into v_template
  from public.checklist_templates
  where model_id = v_site.model_id and published
  order by version desc
  limit 1;
  if v_template.id is null then
    raise exception 'No published checklist for this kiosk.';
  end if;

  select jsonb_build_object(
    'version', v_template.version,
    'template_id', v_template.id,
    'model_code', m.code,
    'milk_clean_minutes', m.milk_clean_minutes,
    'sections', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'title', s.title,
          'phase', s.phase,
          'position', s.position,
          'items', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', i.id,
                'key', i.key,
                'title', i.title,
                'details', i.details,
                'required', i.required,
                'cadence_type', i.cadence_type,
                'cadence_days', i.cadence_days,
                'threshold_label', i.threshold_label,
                'locked_during_clean', i.locked_during_clean,
                'blocks_clean_start', i.blocks_clean_start,
                'status', i.status,
                'position', i.position
              )
              order by i.position
            )
            from public.checklist_items i
            where i.section_id = s.id
          ), '[]'::jsonb)
        )
        order by s.position
      )
      from public.checklist_sections s
      where s.template_id = v_template.id
    ), '[]'::jsonb)
  )
  into v_snap
  from public.models m
  where m.id = v_site.model_id;

  begin
    insert into public.service_sessions (
      id, site_id, person_id, template_id, template_version, checklist_snapshot,
      service_date, start_at, start_estimated, status, idempotency_key, created_by, is_sandbox
    ) values (
      p_id, p_site, v_person, v_template.id, v_template.version, v_snap,
      public.toronto_date(p_start), p_start, coalesce(p_estimated, false), 'open', p_id, auth.uid(), v_site.is_sandbox
    )
    returning * into v_row;
  exception
    when unique_violation then
      select * into v_row from public.service_sessions where id = p_id;
      if not found then
        raise;
      end if;
  end;
  return to_jsonb(v_row);
end;
$$;

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
begin
  v_person := public.current_person_id();
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
  if v_session.person_id <> v_person and not public.is_admin() then
    raise exception 'Not allowed.';
  end if;
  if v_session.is_sandbox is distinct from public.in_practice() and not public.is_admin() then
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

create or replace function public.set_milk_clean(
  p_id uuid,
  p_action text,
  p_override_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.service_sessions;
  v_person uuid;
  v_missing integer;
begin
  v_person := public.current_person_id();
  if v_person is null then
    raise exception 'Not signed in.';
  end if;
  select * into v_session from public.service_sessions where id = p_id;
  if not found then
    raise exception 'Visit not found.';
  end if;
  if v_session.person_id <> v_person and not public.is_admin() then
    raise exception 'Not allowed.';
  end if;
  if v_session.status <> 'open' then
    return to_jsonb(v_session);
  end if;

  if p_action = 'done' then
    update public.service_sessions
      set milk_clean_done_at = coalesce(milk_clean_done_at, now())
      where id = p_id
      returning * into v_session;
    return to_jsonb(v_session);
  end if;

  if p_action <> 'start' then
    raise exception 'Unknown milk-cleaning action.';
  end if;
  if v_session.milk_clean_started_at is not null then
    return to_jsonb(v_session);
  end if;

  select count(*) into v_missing
  from jsonb_array_elements(coalesce(v_session.checklist_snapshot -> 'sections', '[]'::jsonb)) sec
  cross join lateral jsonb_array_elements(sec -> 'items') item
  where coalesce((item ->> 'blocks_clean_start')::boolean, false)
    and not exists (
      select 1
      from public.service_item_completions c
      where c.session_id = p_id
        and c.item_id = (item ->> 'id')::uuid
        and c.state in ('done', 'not_needed')
    );

  if v_missing > 0 and nullif(trim(coalesce(p_override_reason, '')), '') is null then
    raise exception 'Finish the prep steps first, or give a reason to start anyway.';
  end if;

  update public.service_sessions
    set milk_clean_started_at = now(),
        milk_clean_override_reason = nullif(trim(coalesce(p_override_reason, '')), '')
    where id = p_id
    returning * into v_session;
  return to_jsonb(v_session);
end;
$$;

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
begin
  v_person := public.current_person_id();
  if v_person is null then
    raise exception 'Not signed in.';
  end if;
  select * into v_session from public.service_sessions where id = p_id for update;
  if not found then
    raise exception 'Visit not found.';
  end if;
  if v_session.person_id <> v_person and not public.is_admin() then
    raise exception 'Not allowed.';
  end if;
  if v_session.status = 'completed' then
    return to_jsonb(v_session);
  end if;
  if v_session.status = 'voided' then
    raise exception 'This visit was voided.';
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
  if not public.is_admin() then
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
        decided_by = public.current_person_id(),
        decided_at = now(),
        decision_note = p_note
    where id = p_id
    returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.submit_quiz(p_model uuid, p_answers jsonb, p_key uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person uuid;
  v_existing public.quiz_attempts;
  v_total integer;
  v_correct integer;
  v_passed boolean;
  v_row public.quiz_attempts;
  v_practice boolean;
begin
  v_person := public.current_person_id();
  if v_person is null then
    raise exception 'Not signed in.';
  end if;
  if p_key is null then
    raise exception 'Missing idempotency key.';
  end if;

  select * into v_existing from public.quiz_attempts where idempotency_key = p_key;
  if found then
    return to_jsonb(v_existing);
  end if;

  select count(*) into v_total from public.quiz_questions where model_id = p_model;
  if v_total = 0 then
    raise exception 'This model has no quiz yet.';
  end if;

  select count(*) into v_correct
  from public.quiz_questions q
  where q.model_id = p_model
    and jsonb_typeof(p_answers -> (q.position - 1)) = 'number'
    and (p_answers ->> (q.position - 1))::int = q.answer_index;

  v_passed := (v_correct * 100) >= (80 * v_total);
  v_practice := public.in_practice();

  insert into public.quiz_attempts (
    person_id, model_id, answers, score, passed, idempotency_key, is_sandbox, created_by
  ) values (
    v_person, p_model, coalesce(p_answers, '[]'::jsonb), v_correct, v_passed, p_key, v_practice, auth.uid()
  )
  returning * into v_row;

  if v_passed then
    insert into public.training_progress (person_id, model_id, status, is_sandbox, created_by)
    values (v_person, p_model, 'quiz_passed', v_practice, auth.uid())
    on conflict (person_id, model_id) do update
      set status = 'quiz_passed'
      where public.training_progress.status = 'in_training';
  elsif not exists (
    select 1 from public.training_progress where person_id = v_person and model_id = p_model
  ) then
    insert into public.training_progress (person_id, model_id, status, is_sandbox, created_by)
    values (v_person, p_model, 'in_training', v_practice, auth.uid());
  end if;

  return to_jsonb(v_row);
end;
$$;

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
  if not public.is_admin() then
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

create or replace function public.void_session(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.service_sessions;
begin
  if not public.is_admin() then
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
