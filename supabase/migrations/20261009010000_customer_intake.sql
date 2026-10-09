-- Customer intake is separate from candidate assessments and never enrolls a Frigg member.
alter table public.profiles add column screening_profile_version integer not null default 1;
alter table public.profiles add column onboarding_completed_at timestamptz;

create function public.version_screening_profile() returns trigger language plpgsql set search_path = public as $$
begin
  if new.proxy_record is distinct from old.proxy_record or new.date_of_birth is distinct from old.date_of_birth then
    new.screening_profile_version := old.screening_profile_version + 1;
  else new.screening_profile_version := old.screening_profile_version;
  end if;
  return new;
end $$;
create trigger screening_profile_version before update on public.profiles for each row execute function public.version_screening_profile();

create table public.customer_onboarding (
  customer_id uuid primary key references public.profiles(id) on delete cascade,
  draft jsonb not null default '{}',
  confirmed_data jsonb,
  confirmed_version integer,
  confirmed_at timestamptz,
  updated_at timestamptz not null default now()
);
create table public.customer_interview_sessions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  request_key uuid not null,
  cartesia_call_id text unique,
  prompt_version text not null,
  screening_profile_version integer not null,
  consent_version text not null,
  written_consented_at timestamptz not null default now(),
  verbal_consented_at timestamptz,
  withdrawal_at timestamptz,
  readback_at timestamptz,
  status text not null default 'requested' check (status in ('requested','dialing','in_progress','processing','completed','failed','missed','rejected','incomplete','consent_withdrawn','needs_review','dispatch_unknown')),
  failure_code text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  provider_deleted_at timestamptz,
  unique(customer_id, request_key)
);
create unique index customer_one_active_interview on public.customer_interview_sessions(customer_id)
  where status in ('requested','dialing','in_progress','processing','dispatch_unknown')
    or (status = 'consent_withdrawn' and completed_at is null and provider_deleted_at is null);
create index customer_interview_recent on public.customer_interview_sessions(customer_id, created_at desc);
create table public.customer_interview_transcripts (
  session_id uuid primary key references public.customer_interview_sessions(id) on delete cascade,
  provider_call_id text not null unique,
  transcript jsonb not null,
  extraction jsonb,
  completed_at timestamptz not null,
  created_at timestamptz not null default now()
);
create table public.cartesia_webhook_receipts (
  webhook_request_id text primary key,
  event_type text not null,
  provider_call_id text not null,
  payload_hash text not null,
  received_at timestamptz not null default now()
);
create table public.customer_interview_jobs (
  session_id uuid primary key references public.customer_interview_sessions(id) on delete cascade,
  kind text not null check(kind in ('extract','delete')),
  status text not null default 'queued' check(status in ('queued','running','done','failed')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  last_error text
);
alter table public.customer_onboarding enable row level security;
alter table public.customer_interview_sessions enable row level security;
alter table public.customer_interview_transcripts enable row level security;
alter table public.cartesia_webhook_receipts enable row level security;
alter table public.customer_interview_jobs enable row level security;
revoke all on public.customer_onboarding, public.customer_interview_sessions, public.customer_interview_transcripts, public.cartesia_webhook_receipts, public.customer_interview_jobs from anon, authenticated;
grant all on public.customer_onboarding, public.customer_interview_sessions, public.customer_interview_transcripts, public.cartesia_webhook_receipts, public.customer_interview_jobs to service_role;
grant select on public.customer_onboarding, public.customer_interview_sessions, public.customer_interview_transcripts to authenticated;
create policy onboarding_owner on public.customer_onboarding for select to authenticated using (customer_id = auth.uid());
create policy interview_owner on public.customer_interview_sessions for select to authenticated using (customer_id = auth.uid());
create policy transcript_owner on public.customer_interview_transcripts for select to authenticated using (exists(select 1 from public.customer_interview_sessions s where s.id = session_id and s.customer_id = auth.uid()));

create function public.save_customer_onboarding(p_customer uuid, p_data jsonb, p_record jsonb, p_version integer)
returns integer language plpgsql security definer set search_path = public as $$
declare v integer;
begin
  select screening_profile_version into v from profiles where id = p_customer for update;
  if v is distinct from p_version then raise exception 'profile_changed'; end if;
  update profiles set full_name = p_data->>'full_name', date_of_birth = (p_data->>'date_of_birth')::date,
    location = p_data->>'location', gender = p_data->'essentials'->>'gender', seeking_gender = p_data->'essentials'->>'seeking',
    proxy_record = p_record, completed = true, onboarding_step = 4, onboarding_completed_at = now()
    where id = p_customer returning screening_profile_version into v;
  insert into customer_onboarding(customer_id, draft, confirmed_data, confirmed_version, confirmed_at)
    values(p_customer, p_data, p_data, v, now()) on conflict(customer_id) do update
    set draft = excluded.draft, confirmed_data = excluded.confirmed_data, confirmed_version = v, confirmed_at = now(), updated_at = now();
  return v;
end $$;

create function public.reserve_customer_interview(p_customer uuid, p_key uuid, p_prompt text, p_consent text, p_version integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s customer_interview_sessions; v integer;
begin
  select screening_profile_version into v from profiles where id = p_customer for update;
  select * into s from customer_interview_sessions where customer_id = p_customer and request_key = p_key;
  if found then return jsonb_build_object('session',to_jsonb(s),'created',false); end if;
  if v is distinct from p_version then raise exception 'profile_changed'; end if;
  select * into s from customer_interview_sessions where customer_id = p_customer and
    (status in ('requested','dialing','in_progress','processing','dispatch_unknown')
      or (status = 'consent_withdrawn' and completed_at is null and provider_deleted_at is null));
  if found then return jsonb_build_object('session',to_jsonb(s),'created',false); end if;
  if (select count(*) from customer_interview_sessions where customer_id = p_customer and created_at > now() - interval '1 day') >= 3
     or exists(select 1 from customer_interview_sessions where customer_id = p_customer and created_at > now() - interval '1 minute') then raise exception 'rate_limited'; end if;
  insert into customer_interview_sessions(customer_id,request_key,prompt_version,screening_profile_version,consent_version)
    values(p_customer,p_key,p_prompt,p_version,p_consent) returning * into s;
  return jsonb_build_object('session',to_jsonb(s),'created',true);
end $$;

create function public.record_customer_call_decision(p_session uuid, p_decision text)
returns void language plpgsql security definer set search_path = public as $$
declare s customer_interview_sessions;
begin
  select * into s from customer_interview_sessions where id = p_session for update;
  if not found then raise exception 'unknown_session'; end if;
  if p_decision = 'withdrawn' then
    update customer_interview_sessions set withdrawal_at = coalesce(withdrawal_at,now()), status = 'consent_withdrawn' where id = s.id;
    delete from customer_interview_transcripts where session_id = s.id;
    -- Invalidate an extraction lease before it can commit.
    insert into customer_interview_jobs(session_id,kind) values(s.id,'delete') on conflict(session_id) do update
      set kind = 'delete', status = 'queued', lease_token = null, lease_until = null, attempts = 0, available_at = now();
    -- A definitive dispatch rejection created no provider record. Ambiguous dispatches
    -- must remain pending until an operator or webhook binds the actual call.
    if s.cartesia_call_id is null and s.status = 'rejected' then
      update customer_interview_sessions set provider_deleted_at = now(), completed_at = coalesce(completed_at,now()) where id = s.id;
      update customer_interview_jobs set status = 'done' where session_id = s.id;
    end if;
    update profiles set proxy_record = jsonb_set(proxy_record - 'interview', '{ready_for_matching}', 'false') || jsonb_build_object('facts',
      coalesce((select jsonb_agg(f) from jsonb_array_elements(proxy_record->'facts') f where f->>'source_ref' not like 'interview.%'), '[]'::jsonb))
      where id = s.customer_id and proxy_record->'interview'->>'session_id' = s.id::text;
  elsif s.withdrawal_at is null and s.completed_at is null then
    if p_decision = 'confirmed' then update customer_interview_sessions set verbal_consented_at = coalesce(verbal_consented_at,now()) where id = s.id;
    elsif p_decision = 'readback_confirmed' and s.verbal_consented_at is not null then update customer_interview_sessions set readback_at = coalesce(readback_at,now()) where id = s.id;
    else raise exception 'invalid_decision'; end if;
  end if;
end $$;

create function public.ingest_customer_call(p_session uuid, p_call text, p_receipt text, p_type text, p_hash text, p_transcript jsonb, p_ended timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare s customer_interview_sessions; h text;
begin
  select * into s from customer_interview_sessions where id = p_session for update;
  if not found or (s.cartesia_call_id is not null and s.cartesia_call_id <> p_call) then raise exception 'unknown_call'; end if;
  select payload_hash into h from cartesia_webhook_receipts where webhook_request_id = p_receipt;
  if found then
    if h <> p_hash then raise exception 'receipt_conflict'; end if;
    return;
  end if;
  insert into cartesia_webhook_receipts values(p_receipt,p_type,p_call,p_hash,now());
  update customer_interview_sessions set cartesia_call_id = p_call where id = s.id;
  if p_type = 'call_started' then
    update customer_interview_sessions set started_at = coalesce(started_at,now()), status = 'in_progress'
      where id = s.id and completed_at is null and withdrawal_at is null and status in ('requested','dialing','dispatch_unknown');
    return;
  end if;
  if p_type not in ('call_completed','call_failed') then return; end if;
  -- Completion is unique by session, even if Cartesia sends a new receipt ID.
  if s.completed_at is not null then return; end if;
  update customer_interview_sessions set completed_at = p_ended where id = s.id;
  if s.withdrawal_at is not null or s.verbal_consented_at is null then
    update customer_interview_sessions set status = case when s.withdrawal_at is not null then 'consent_withdrawn' else 'missed' end where id = s.id;
    insert into customer_interview_jobs(session_id,kind) values(s.id,'delete') on conflict(session_id) do update set kind='delete',status='queued',available_at=now();
  elsif p_type = 'call_failed' or jsonb_array_length(p_transcript) = 0 then
    update customer_interview_sessions set status = 'incomplete' where id = s.id;
    insert into customer_interview_jobs(session_id,kind) values(s.id,'delete') on conflict do nothing;
  else
    insert into customer_interview_transcripts(session_id,provider_call_id,transcript,completed_at) values(s.id,p_call,p_transcript,p_ended) on conflict do nothing;
    update customer_interview_sessions set status = 'processing' where id = s.id;
    insert into customer_interview_jobs(session_id,kind) values(s.id,'extract') on conflict do nothing;
  end if;
end $$;

create function public.claim_customer_interview_job() returns jsonb language plpgsql security definer set search_path = public as $$
declare j customer_interview_jobs;
begin
  select * into j from customer_interview_jobs where (status='queued' and available_at <= now()) or (status='running' and lease_until < now())
    order by available_at for update skip locked limit 1;
  if not found then return null; end if;
  update customer_interview_jobs set status='running', attempts=attempts+1, lease_token=gen_random_uuid(), lease_until=now()+interval '3 minutes'
    where session_id=j.session_id returning * into j;
  return to_jsonb(j);
end $$;

create function public.finish_customer_interview(p_session uuid, p_lease uuid, p_record jsonb, p_extraction jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare s customer_interview_sessions; v integer;
begin
  select * into s from customer_interview_sessions where id=p_session for update;
  if s.withdrawal_at is not null then return 'withdrawn'; end if;
  perform 1 from customer_interview_jobs where session_id=s.id and lease_token=p_lease and kind='extract' and status='running' for update;
  if not found then return 'lease_lost'; end if;
  select screening_profile_version into v from profiles where id=s.customer_id for update;
  if v <> s.screening_profile_version then
    update customer_interview_sessions set status='needs_review',failure_code='profile_changed' where id=s.id;
  else
    -- Never accept preference edits from the extractor, even after schema validation.
    if (select proxy_record->'preferences' from profiles where id=s.customer_id) is distinct from p_record->'preferences' then raise exception 'preferences_changed'; end if;
    update profiles set proxy_record=p_record where id=s.customer_id returning screening_profile_version into v;
    -- Behavioral updates preserve the already-confirmed onboarding contract.
    update customer_onboarding set confirmed_version=v where customer_id=s.customer_id and confirmed_version=s.screening_profile_version;
    update customer_interview_sessions set status=case when p_record->'interview'->>'status'='complete' then 'completed' else 'incomplete' end where id=s.id;
  end if;
  update customer_interview_transcripts set extraction=p_extraction where session_id=s.id;
  update customer_interview_jobs set status='done',lease_token=null,lease_until=null where session_id=s.id;
  return 'saved';
end $$;

revoke all on function public.save_customer_onboarding(uuid,jsonb,jsonb,integer), public.reserve_customer_interview(uuid,uuid,text,text,integer), public.record_customer_call_decision(uuid,text), public.ingest_customer_call(uuid,text,text,text,text,jsonb,timestamptz), public.claim_customer_interview_job(), public.finish_customer_interview(uuid,uuid,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.save_customer_onboarding(uuid,jsonb,jsonb,integer), public.reserve_customer_interview(uuid,uuid,text,text,integer), public.record_customer_call_decision(uuid,text), public.ingest_customer_call(uuid,text,text,text,text,jsonb,timestamptz), public.claim_customer_interview_job(), public.finish_customer_interview(uuid,uuid,jsonb,jsonb) to service_role;
