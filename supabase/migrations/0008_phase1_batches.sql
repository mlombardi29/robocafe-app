-- Additive. Do not edit 0001–0007. Do not apply this from the app.
-- No access codes are inserted. site_codes stays empty.
-- The phone still opens if this file is not applied yet. Closing a visit for good,
-- per-person practice reset, person-held keys, the quiz wording, and 100% certification
-- wait until this file is applied.

-- ---------------------------------------------------------------------------
-- Close your own open visit so another visit can start at that site.
-- The row stays. Live and practice are both allowed. Nothing else is deleted.
-- ---------------------------------------------------------------------------

create or replace function public.abandon_visit(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person uuid;
  v_session public.service_sessions;
begin
  v_person := private.current_person_id();
  if v_person is null then
    raise exception 'Not signed in.';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null or length(trim(p_reason)) < 3 then
    raise exception 'Say why you cannot finish this visit.';
  end if;

  select * into v_session
  from public.service_sessions
  where id = p_id
  for update;
  if not found then
    raise exception 'Visit not found.';
  end if;
  if v_session.person_id <> v_person and not private.is_admin() then
    raise exception 'Not allowed.';
  end if;
  if v_session.status <> 'open' then
    raise exception 'This visit is already closed.';
  end if;

  update public.service_sessions
    set status = 'voided',
        notes = concat_ws(E'\n', notes, 'Closed without completing: ' || trim(p_reason))
    where id = p_id
    returning * into v_session;
  return to_jsonb(v_session);
end;
$$;

revoke all on function public.abandon_visit(uuid, text) from public, anon;
grant execute on function public.abandon_visit(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Practice reset for one person. Does not touch other people or any live row.
-- ---------------------------------------------------------------------------

create or replace function public.reset_person_sandbox(p_person uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not private.is_admin() then
    raise exception 'Not allowed.';
  end if;
  if p_person is null then
    raise exception 'Choose a person.';
  end if;
  if not exists (select 1 from public.people where id = p_person) then
    raise exception 'Person not found.';
  end if;

  delete from public.service_item_completions c
  using public.service_sessions s
  where c.session_id = s.id
    and s.person_id = p_person
    and s.is_sandbox;

  delete from public.time_corrections c
  using public.service_sessions s
  where c.session_id = s.id
    and s.person_id = p_person
    and s.is_sandbox;

  delete from public.service_sessions
  where person_id = p_person
    and is_sandbox;
end;
$$;

revoke all on function public.reset_person_sandbox(uuid) from public, anon;
grant execute on function public.reset_person_sandbox(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Series 2.2 quiz choices may only name steps that exist on that model.
-- ---------------------------------------------------------------------------

update public.quiz_questions q
set choices = '["A test drink","The kiosk is in maintenance mode","Scale calibration check","Exit maintenance mode"]'::jsonb
from public.models m
where q.model_id = m.id
  and m.code = 's22'
  and q.prompt = 'What has to happen before you start the milk-module cleaning?';

update public.quiz_questions q
set choices = '["Change the bag and top up 2% milk, and do not touch the tubes","Change the bag only after the cleaning ends","Top up coffee concentrate and skip the milk","Rinse the tubes in the sink"]'::jsonb
from public.models m
where q.model_id = m.id
  and m.code = 's22'
  and q.prompt = 'During the cleaning, what may you do with the milk?';

update public.quiz_questions q
set choices = '["Skip syrup cleaning","Move the cup holder out of the way","Turn all three powder spouts down","Do it twice"]'::jsonb
from public.models m
where q.model_id = m.id
  and m.code = 's22'
  and q.prompt = 'What is different about syrup cleaning at UofT?';

-- ---------------------------------------------------------------------------
-- Certification requires every question correct. 80% no longer certifies.
-- ---------------------------------------------------------------------------

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

  v_passed := v_correct = v_total;
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

-- ---------------------------------------------------------------------------
-- Keys and passes a person holds. Not a site code. No rows are seeded.
-- ---------------------------------------------------------------------------

create table public.person_access_items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  is_sandbox boolean not null default false,
  legacy_id text,
  person_id uuid not null references public.people (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  kind text not null check (kind in ('key_card', 'paper_pass', 'machine_key')),
  note text,
  issued_at timestamptz not null default now(),
  returned_at timestamptz
);

create index person_access_items_person on public.person_access_items (person_id);

create trigger sites_stamp_access
  before insert or update of site_id on public.person_access_items
  for each row execute function private.stamp_sandbox_from_site();

alter table public.person_access_items enable row level security;

create policy access_select on public.person_access_items
  for select to authenticated
  using (
    private.is_admin()
    or (
      person_id = private.current_person_id()
      and is_sandbox = private.in_practice()
    )
  );

create policy access_admin on public.person_access_items
  for all to authenticated
  using (private.is_admin())
  with check (private.is_admin());

grant select, insert, update, delete on public.person_access_items to authenticated;
