-- Verra product database only. No team workspace data belongs here.
create table public.access_profiles(
 user_id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null default '' check(length(display_name)<=100),
 needs jsonb not null default '[]' check(jsonb_typeof(needs)='array' and jsonb_array_length(needs)<=30),
 updated_at timestamptz not null default now()
);
create table public.cases(
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id) on delete cascade,
 creation_key uuid not null,creation_fingerprint text not null,unique(owner_id,creation_key),
 title text not null check(length(trim(title)) between 3 and 160),category text not null check(category in ('everyday','dining','class','appointment','entertainment','accommodation')),
 venue_name text not null check(length(trim(venue_name)) between 2 and 160),venue_url text not null default '' check(venue_url='' or venue_url ~ '^https?://'),
 contact_email text not null default '',timezone text not null,visit_date date,
 state text not null default 'draft' check(state in ('draft','ready','researching','awaiting_permission','contacting','waiting_for_venue','needs_decision','arranging_alternative','arrangement_confirmed','paused','cancelled','closed','error')),
 version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.case_requirements(
 id uuid primary key default gen_random_uuid(),case_id uuid not null references public.cases(id) on delete cascade,
 text text not null check(length(trim(text)) between 3 and 1000),category text not null default 'other',hard boolean not null default true,share_allowed boolean not null default false,
 state text not null default 'unknown' check(state in ('unknown','awaiting_answer','venue_confirmed','reported_unavailable','conflicting')),
 version integer not null default 1,updated_at timestamptz not null default now()
);
create table public.case_permissions(
 case_id uuid primary key references public.cases(id) on delete cascade,
 recipient text not null default '',outreach_allowed boolean not null default false,
 followup_limit integer not null default 0 check(followup_limit between 0 and 3),min_followup_hours integer not null default 48 check(min_followup_hours>=24),
 version integer not null default 1,updated_at timestamptz not null default now()
);
create table public.outbox_jobs(
 id uuid primary key default gen_random_uuid(),case_id uuid not null references public.cases(id) on delete cascade,
 request_key uuid not null,case_version integer not null,kind text not null default 'research',
 state text not null default 'queued' check(state in ('queued','claimed','succeeded','failed','cancelled')),
 attempts integer not null default 0,available_at timestamptz not null default now(),lease_until timestamptz,lease_owner text,
 created_at timestamptz not null default now(),unique(case_id,request_key)
);
create unique index one_active_case_job on public.outbox_jobs(case_id) where state in ('queued','claimed');
create table public.case_events(
 id bigint generated always as identity primary key,case_id uuid not null references public.cases(id) on delete cascade,
 actor_id uuid references auth.users(id) on delete set null,kind text not null,detail jsonb not null default '{}',created_at timestamptz not null default now()
);
create function public.owns_case(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.cases where id=p_id and owner_id=auth.uid());
$$;
revoke all on function public.owns_case(uuid) from public,anon;
grant execute on function public.owns_case(uuid) to authenticated;
alter table public.access_profiles enable row level security;
alter table public.cases enable row level security;
alter table public.case_requirements enable row level security;
alter table public.case_permissions enable row level security;
alter table public.outbox_jobs enable row level security;
alter table public.case_events enable row level security;
create policy personal_profile on public.access_profiles for select to authenticated using(user_id=auth.uid());
create policy owned_cases on public.cases for select to authenticated using(owner_id=auth.uid());
create policy owned_requirements on public.case_requirements for select to authenticated using(public.owns_case(case_id));
create policy owned_permissions on public.case_permissions for select to authenticated using(public.owns_case(case_id));
create policy owned_jobs on public.outbox_jobs for select to authenticated using(public.owns_case(case_id));
create policy owned_events on public.case_events for select to authenticated using(public.owns_case(case_id));
revoke all on public.access_profiles,public.cases,public.case_requirements,public.case_permissions,public.outbox_jobs,public.case_events from anon,authenticated;
grant select on public.access_profiles,public.cases,public.case_requirements,public.case_permissions,public.outbox_jobs,public.case_events to authenticated;

create function public.save_access_profile(p_name text,p_needs jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501';end if;
 if jsonb_typeof(p_needs) is distinct from 'array' or jsonb_array_length(p_needs)>30 then raise exception 'Invalid needs' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements(p_needs) n where jsonb_typeof(n)<>'string' or length(trim(n #>> '{}')) not between 3 and 1000) then raise exception 'Invalid need' using errcode='22023';end if;
 insert into public.access_profiles(user_id,display_name,needs) values(auth.uid(),trim(p_name),p_needs)
 on conflict(user_id) do update set display_name=excluded.display_name,needs=excluded.needs,updated_at=now();
end; $$;
create function public.create_arrangement(p_input jsonb,p_key uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare case_id uuid;requirement jsonb;previous public.cases;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501';end if;
 if p_key is null then raise exception 'A request key is required' using errcode='22023';end if;
 -- Serializes creation retries for this account without storing another copy of personal needs.
 perform 1 from auth.users where id=auth.uid() for update;
 select * into previous from public.cases where owner_id=auth.uid() and creation_key=p_key;
 if found then
  if previous.creation_fingerprint<>md5(p_input::text) then raise exception 'This request was already saved with different details' using errcode='40001';end if;
  return previous.id;
 end if;
 if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>40000 or exists(select 1 from jsonb_object_keys(p_input) k where k<>all(array['title','category','venue_name','venue_url','contact_email','timezone','visit_date','requirements','outreach_allowed'])) then raise exception 'Invalid arrangement' using errcode='22023';end if;
 if not exists(select 1 from pg_timezone_names where name=p_input->>'timezone') then raise exception 'Unknown timezone' using errcode='22023';end if;
 if jsonb_typeof(p_input->'requirements') is distinct from 'array' or jsonb_array_length(p_input->'requirements') not between 1 and 30 then raise exception 'Add requirements' using errcode='22023';end if;
 if length(coalesce(p_input->>'venue_url',''))>2000 or length(coalesce(p_input->>'contact_email',''))>254 then raise exception 'Contact too long' using errcode='22023';end if;
 if coalesce(p_input->>'contact_email','')<>'' and p_input->>'contact_email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Invalid email' using errcode='22023';end if;
 if (p_input->>'outreach_allowed')::boolean and coalesce(p_input->>'contact_email','')='' then raise exception 'Choose an outreach recipient' using errcode='22023';end if;
 insert into public.cases(owner_id,creation_key,creation_fingerprint,title,category,venue_name,venue_url,contact_email,timezone,visit_date)
 values(auth.uid(),p_key,md5(p_input::text),trim(p_input->>'title'),p_input->>'category',trim(p_input->>'venue_name'),p_input->>'venue_url',p_input->>'contact_email',p_input->>'timezone',nullif(p_input->>'visit_date','')::date) returning id into case_id;
 for requirement in select value from jsonb_array_elements(p_input->'requirements') loop
  if jsonb_typeof(requirement) is distinct from 'object' or exists(select 1 from jsonb_object_keys(requirement) k where k<>all(array['text','hard','share_allowed'])) then raise exception 'Invalid requirement' using errcode='22023';end if;
  insert into public.case_requirements(case_id,text,hard,share_allowed) values(case_id,requirement->>'text',(requirement->>'hard')::boolean,(requirement->>'share_allowed')::boolean);
 end loop;
 insert into public.case_permissions(case_id,recipient,outreach_allowed) values(case_id,p_input->>'contact_email',(p_input->>'outreach_allowed')::boolean);
 insert into public.case_events(case_id,actor_id,kind,detail) values(case_id,auth.uid(),'created',jsonb_build_object('state','draft'));
 return case_id;
end; $$;
create function public.request_case_work(p_case uuid,p_version integer,p_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare current_case public.cases;job public.outbox_jobs;
begin
 select * into current_case from public.cases where id=p_case and owner_id=auth.uid() for update;
 if not found then raise exception 'Case unavailable' using errcode='42501';end if;
 select * into job from public.outbox_jobs where case_id=p_case and request_key=p_key;
 if found then return jsonb_build_object('caseId',p_case,'jobId',job.id,'status',job.state,'revision',job.case_version);end if;
 if current_case.version<>p_version then raise exception 'Case changed' using errcode='40001';end if;
 if current_case.state not in ('draft','ready','error') then raise exception 'Case cannot start in this state' using errcode='22023';end if;
 update public.cases set state='researching',version=version+1,updated_at=now() where id=p_case returning * into current_case;
 insert into public.outbox_jobs(case_id,request_key,case_version) values(p_case,p_key,current_case.version) returning * into job;
 insert into public.case_events(case_id,actor_id,kind,detail) values(p_case,auth.uid(),'work_accepted',jsonb_build_object('jobId',job.id));
 return jsonb_build_object('caseId',p_case,'jobId',job.id,'status','accepted','revision',current_case.version);
end; $$;
create function public.control_case(p_case uuid,p_version integer,p_action text) returns void language plpgsql security definer set search_path='' as $$
declare current_case public.cases;next_state text;
begin
 select * into current_case from public.cases where id=p_case and owner_id=auth.uid() for update;
 if not found then raise exception 'Case unavailable' using errcode='42501';end if;
 if current_case.version<>p_version then raise exception 'Case changed' using errcode='40001';end if;
 if current_case.state in ('cancelled','closed') then raise exception 'Case is closed' using errcode='22023';end if;
 next_state:=case p_action when 'pause' then 'paused' when 'resume' then 'ready' when 'cancel' then 'cancelled' else null end;
 if next_state is null or (p_action='resume' and current_case.state<>'paused') then raise exception 'Invalid action' using errcode='22023';end if;
 update public.cases set state=next_state,version=version+1,updated_at=now() where id=p_case;
 update public.outbox_jobs set state='cancelled',lease_until=null,lease_owner=null where case_id=p_case and state in ('queued','claimed');
 if p_action='cancel' then update public.case_permissions set outreach_allowed=false,version=version+1,updated_at=now() where case_id=p_case;end if;
 insert into public.case_events(case_id,actor_id,kind) values(p_case,auth.uid(),p_action);
end; $$;
create function public.arrangement_snapshot() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501';end if;
 return jsonb_build_object(
 'profile',(select to_jsonb(p)-'user_id' from public.access_profiles p where user_id=auth.uid()),
 'cases',(select coalesce(jsonb_agg(to_jsonb(c) order by c.updated_at desc),'[]') from public.cases c where owner_id=auth.uid()),
 'requirements',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.case_requirements r join public.cases c on c.id=r.case_id where c.owner_id=auth.uid()),
 'permissions',(select coalesce(jsonb_agg(to_jsonb(p)),'[]') from public.case_permissions p join public.cases c on c.id=p.case_id where c.owner_id=auth.uid()),
 'jobs',(select coalesce(jsonb_agg(to_jsonb(j) order by j.created_at desc),'[]') from public.outbox_jobs j join public.cases c on c.id=j.case_id where c.owner_id=auth.uid()),
 'events',(select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc),'[]') from public.case_events e join public.cases c on c.id=e.case_id where c.owner_id=auth.uid()));
end; $$;
revoke all on function public.save_access_profile(text,jsonb),public.create_arrangement(jsonb,uuid),public.request_case_work(uuid,integer,uuid),public.control_case(uuid,integer,text),public.arrangement_snapshot() from public,anon;
grant execute on function public.save_access_profile(text,jsonb),public.create_arrangement(jsonb,uuid),public.request_case_work(uuid,integer,uuid),public.control_case(uuid,integer,text),public.arrangement_snapshot() to authenticated;
