-- Product worker RPCs. Lease capabilities are never exposed to browser sessions.
alter table public.outbox_jobs add column execution_started_at timestamptz;
alter table public.outbox_jobs add column last_error text;
create index due_agent_work on public.outbox_jobs(available_at,created_at) where state in ('queued','claimed');

create table public.agent_reports(
 id uuid primary key default gen_random_uuid(),
 case_id uuid not null references public.cases(id) on delete cascade,
 job_id uuid not null unique references public.outbox_jobs(id) on delete cascade,
 case_version integer not null,
 report jsonb not null check(jsonb_typeof(report)='object' and octet_length(report::text)<=100000),
 inquiry_draft text not null default '',
 created_at timestamptz not null default now()
);
alter table public.agent_reports enable row level security;
create policy owned_agent_reports on public.agent_reports for select to authenticated using(public.owns_case(case_id));
revoke all on public.agent_reports from public,anon,authenticated;
grant select on public.agent_reports to authenticated;
revoke select on public.outbox_jobs from authenticated;
grant select(id,case_id,request_key,case_version,kind,state,attempts,available_at,lease_until,created_at,last_error) on public.outbox_jobs to authenticated;

create function public.claim_agent_job(p_job uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.cases;j public.outbox_jobs;token uuid;
begin
 -- Lock cases before jobs, matching pause/cancel. Different workers skip locked cases.
 for c in select c0.* from public.cases c0 where c0.state='researching' and exists(
  select 1 from public.outbox_jobs j0 where j0.case_id=c0.id and (p_job is null or j0.id=p_job) and
   ((j0.state='queued' and j0.available_at<=now()) or (j0.state='claimed' and j0.lease_until<now()))
 ) order by c0.updated_at for update skip locked limit 20 loop
  select * into j from public.outbox_jobs where case_id=c.id and state in ('queued','claimed') for update;
  if not found then continue;end if;
  if j.case_version<>c.version then
   update public.outbox_jobs set state='cancelled',lease_owner=null,lease_until=null where id=j.id;
   continue;
  end if;
  if j.attempts>=3 then
   update public.outbox_jobs set state='failed',last_error='attempts_exhausted',lease_owner=null,lease_until=null where id=j.id;
   update public.cases set state='error',version=version+1,updated_at=now() where id=c.id;
   insert into public.case_events(case_id,kind,detail) values(c.id,'research_failed',jsonb_build_object('code','attempts_exhausted'));
   continue;
  end if;
  token:=gen_random_uuid();
  update public.outbox_jobs set state='claimed',attempts=attempts+1,lease_owner=token::text,
   lease_until=now()+interval '10 minutes',execution_started_at=null,last_error=null where id=j.id;
  return jsonb_build_object('job_id',j.id,'lease_token',token);
 end loop;
 return null;
end; $$;

create function public.agent_job_context(p_job uuid,p_token uuid,p_begin boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.cases;j public.outbox_jobs;
begin
 select c0.* into c from public.cases c0 join public.outbox_jobs j0 on j0.case_id=c0.id where j0.id=p_job for update of c0;
 select * into j from public.outbox_jobs where id=p_job for update;
 if c.id is null or j.id is null or j.state<>'claimed' or j.lease_owner is distinct from p_token::text
  or j.lease_until<=now() or c.state<>'researching' or c.version<>j.case_version then
  raise exception 'Work is no longer active' using errcode='42501';
 end if;
 if p_begin then
  if j.execution_started_at is not null then return null;end if;
  update public.outbox_jobs set execution_started_at=now() where id=j.id;
 end if;
 return jsonb_build_object('job_id',j.id,'case',jsonb_build_object('id',c.id,'version',c.version,'title',c.title,
  'venue_name',c.venue_name,'venue_url',c.venue_url,'visit_date',c.visit_date,'timezone',c.timezone),
  'requirements',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'text',r.text,'hard',r.hard,'share_allowed',r.share_allowed) order by r.id),'[]') from public.case_requirements r where r.case_id=c.id),
  'permissions',(select jsonb_build_object('version',p.version,'recipient',p.recipient,'outreach_allowed',p.outreach_allowed) from public.case_permissions p where p.case_id=c.id));
end; $$;

create function public.finish_agent_job(p_job uuid,p_token uuid,p_report jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare context jsonb;c_id uuid;existing uuid;draft text:='';report_id uuid;permission public.case_permissions;entry jsonb;
begin
 -- A duplicate completion is harmless only for the same still-retained lease token.
 select r.id into existing from public.agent_reports r join public.outbox_jobs j on j.id=r.job_id
  where j.id=p_job and j.lease_owner=p_token::text and j.state='succeeded';
 if found then return existing;end if;
 context:=public.agent_job_context(p_job,p_token,false);c_id:=(context->'case'->>'id')::uuid;
 if not exists(select 1 from public.outbox_jobs where id=p_job and execution_started_at is not null) then
  raise exception 'Execution has not started' using errcode='42501';end if;
 if jsonb_typeof(p_report) is distinct from 'object' or octet_length(p_report::text)>100000
  or jsonb_typeof(p_report->'findings') is distinct from 'array'
  or jsonb_typeof(p_report->'sources') is distinct from 'array'
  or p_report->>'mode' is null or p_report->>'mode' not in ('live','local_test')
  or p_report->>'venue_match' is null or p_report->>'venue_match' not in ('matched','uncertain','mismatch') then
  raise exception 'Invalid research result' using errcode='22023';end if;
 if jsonb_array_length(p_report->'findings')<>(select count(*) from public.case_requirements where case_id=c_id)
  or (select count(distinct value->>'requirement_id') from jsonb_array_elements(p_report->'findings'))<>jsonb_array_length(p_report->'findings') then
  raise exception 'Incomplete requirement results' using errcode='22023';end if;
 for entry in select value from jsonb_array_elements(p_report->'findings') loop
  if not exists(select 1 from public.case_requirements where case_id=c_id and id::text=entry->>'requirement_id')
   or entry->>'status' is null or entry->>'status' not in ('unknown','source_supports','source_reports_unavailable','conflicting') then
   raise exception 'Invalid requirement result' using errcode='22023';end if;
 end loop;
 select * into permission from public.case_permissions where case_id=c_id;
 -- Canonical draft is built from the user's permitted text, never from a free-form model email.
 if permission.outreach_allowed and exists(select 1 from public.case_requirements where case_id=c_id and share_allowed) then
  draft:='Hello,'||chr(10)||chr(10)||'Could you confirm the following access arrangements for a visit to your venue?'||chr(10)||chr(10)||
   (select string_agg('- '||text,chr(10) order by id) from public.case_requirements where case_id=c_id and share_allowed)||chr(10)||chr(10)||
   'Please explain the route to the intended room and any limits that affect these requirements. Thank you.';
 end if;
 insert into public.agent_reports(case_id,job_id,case_version,report,inquiry_draft)
  values(c_id,p_job,(context->'case'->>'version')::integer,p_report,draft) returning id into report_id;
 update public.outbox_jobs set state='succeeded',lease_until=null,last_error=null where id=p_job;
 -- Web research never certifies a visit or invents a venue reply. The person reviews findings.
 update public.cases set state='needs_decision',version=version+1,updated_at=now() where id=c_id;
 insert into public.case_events(case_id,kind,detail) values(c_id,'research_ready',jsonb_build_object('reportId',report_id));
 return report_id;
end; $$;

create function public.fail_agent_job(p_job uuid,p_token uuid,p_code text,p_retry boolean) returns void language plpgsql security definer set search_path='' as $$
declare context jsonb;j public.outbox_jobs;retry boolean;
begin
 if p_code not in ('configuration_missing','provider_unavailable','invalid_output','execution_timeout','dispatch_failed','worker_failed') then
  raise exception 'Invalid failure code' using errcode='22023';end if;
 context:=public.agent_job_context(p_job,p_token,false);
 select * into j from public.outbox_jobs where id=p_job;
 retry:=p_retry and j.attempts<3;
 update public.outbox_jobs set state=case when retry then 'queued' else 'failed' end,
  available_at=now()+make_interval(secs=>30*power(2,j.attempts)::integer),lease_owner=null,lease_until=null,execution_started_at=null,last_error=p_code where id=p_job;
 if not retry then update public.cases set state='error',version=version+1,updated_at=now() where id=j.case_id;end if;
 insert into public.case_events(case_id,kind,detail) values(j.case_id,case when retry then 'research_retry_scheduled' else 'research_failed' end,jsonb_build_object('code',p_code));
end; $$;

revoke all on function public.claim_agent_job(uuid),public.agent_job_context(uuid,uuid,boolean),public.finish_agent_job(uuid,uuid,jsonb),public.fail_agent_job(uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.claim_agent_job(uuid),public.agent_job_context(uuid,uuid,boolean),public.finish_agent_job(uuid,uuid,jsonb),public.fail_agent_job(uuid,uuid,text,boolean) to service_role;

create or replace function public.arrangement_snapshot() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501';end if;
 return jsonb_build_object(
 'profile',(select to_jsonb(p)-'user_id' from public.access_profiles p where user_id=auth.uid()),
 'cases',(select coalesce(jsonb_agg(to_jsonb(c) order by c.updated_at desc),'[]') from public.cases c where owner_id=auth.uid()),
 'requirements',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.case_requirements r join public.cases c on c.id=r.case_id where c.owner_id=auth.uid()),
 'permissions',(select coalesce(jsonb_agg(to_jsonb(p)),'[]') from public.case_permissions p join public.cases c on c.id=p.case_id where c.owner_id=auth.uid()),
 'jobs',(select coalesce(jsonb_agg(to_jsonb(j)-'lease_owner'-'execution_started_at' order by j.created_at desc),'[]') from public.outbox_jobs j join public.cases c on c.id=j.case_id where c.owner_id=auth.uid()),
 'reports',(select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc),'[]') from public.agent_reports r join public.cases c on c.id=r.case_id where c.owner_id=auth.uid()),
 'events',(select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc),'[]') from public.case_events e join public.cases c on c.id=e.case_id where c.owner_id=auth.uid()));
end; $$;
