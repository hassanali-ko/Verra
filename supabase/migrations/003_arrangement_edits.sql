-- Personal revision history and edits. State changes have a separate version from content.
alter table public.cases add column content_version integer not null default 1;
alter table public.agent_reports add column content_version integer not null default 1;
alter table public.agent_reports add column requirements_snapshot jsonb not null default '[]';
update public.agent_reports a set requirements_snapshot=(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]') from public.case_requirements r where r.case_id=a.case_id);

create table public.case_revisions(
 id uuid primary key default gen_random_uuid(),case_id uuid not null references public.cases(id) on delete cascade,
 request_key uuid not null,input_fingerprint text not null,previous_version integer not null,result_version integer not null,
 snapshot jsonb not null,created_at timestamptz not null default now(),unique(case_id,request_key)
);
alter table public.case_revisions enable row level security;
create policy owned_revisions on public.case_revisions for select to authenticated using(public.owns_case(case_id));
revoke all on public.case_revisions from anon,authenticated;
grant select on public.case_revisions to authenticated;

create function public.capture_research_context() returns trigger language plpgsql security definer set search_path='' as $$
begin
 select content_version into new.content_version from public.cases where id=new.case_id;
 select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]') into new.requirements_snapshot from public.case_requirements r where r.case_id=new.case_id;
 return new;
end; $$;
revoke all on function public.capture_research_context() from public,anon,authenticated;
create trigger research_context before insert on public.agent_reports for each row execute function public.capture_research_context();

create function public.edit_arrangement(p_case uuid,p_version integer,p_key uuid,p_input jsonb,p_recipient_reviewed boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare current_case public.cases; previous public.case_revisions; permission public.case_permissions;
 requirement jsonb; requirement_id uuid; kept uuid[]:='{}'; existing public.case_requirements;
 fingerprint text; before_edit jsonb; scope_changed boolean; recipient_changed boolean; result_version integer;
begin
 select * into current_case from public.cases where id=p_case and owner_id=auth.uid() for update;
 if not found then raise exception 'Case unavailable' using errcode='42501';end if;
 if p_key is null or p_version is null then raise exception 'Missing revision request' using errcode='22023';end if;
 fingerprint:=md5(jsonb_build_object('input',p_input,'version',p_version,'reviewed',coalesce(p_recipient_reviewed,false))::text);
 select * into previous from public.case_revisions where case_id=p_case and request_key=p_key;
 if found then
  if previous.input_fingerprint<>fingerprint then raise exception 'Retry details changed' using errcode='40001';end if;
  return jsonb_build_object('caseId',p_case,'version',previous.result_version);
 end if;
 if current_case.version<>p_version then raise exception 'Case changed' using errcode='40001';end if;
 if current_case.state in ('cancelled','closed') then raise exception 'Case is closed' using errcode='22023';end if;
 if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>45000
  or not p_input ?& array['title','category','venue_name','venue_url','contact_email','timezone','visit_date','requirements','outreach_allowed']
  or exists(select 1 from jsonb_object_keys(p_input) k where k<>all(array['title','category','venue_name','venue_url','contact_email','timezone','visit_date','requirements','outreach_allowed'])) then
  raise exception 'Invalid arrangement' using errcode='22023';end if;
 if exists(select 1 from unnest(array['title','category','venue_name','venue_url','contact_email','timezone','visit_date']) k where jsonb_typeof(p_input->k) is distinct from 'string')
  or jsonb_typeof(p_input->'outreach_allowed') is distinct from 'boolean' then raise exception 'Invalid field type' using errcode='22023';end if;
 if not exists(select 1 from pg_timezone_names where name=p_input->>'timezone') then raise exception 'Unknown timezone' using errcode='22023';end if;
 if jsonb_typeof(p_input->'requirements') is distinct from 'array' or jsonb_array_length(p_input->'requirements') not between 1 and 30 then raise exception 'Add requirements' using errcode='22023';end if;
 if length(p_input->>'venue_url')>2000 or length(p_input->>'contact_email')>254 then raise exception 'Contact too long' using errcode='22023';end if;
 if p_input->>'contact_email'<>'' and p_input->>'contact_email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Invalid email' using errcode='22023';end if;
 if (p_input->>'outreach_allowed')::boolean and p_input->>'contact_email'='' then raise exception 'Choose a recipient' using errcode='22023';end if;
 for requirement in select value from jsonb_array_elements(p_input->'requirements') loop
  if jsonb_typeof(requirement) is distinct from 'object'
   or exists(select 1 from jsonb_object_keys(requirement) k where k<>all(array['id','text','hard','share_allowed']))
   or jsonb_typeof(requirement->'text') is distinct from 'string' or length(trim(requirement->>'text')) not between 3 and 1000
   or jsonb_typeof(requirement->'hard') is distinct from 'boolean' or jsonb_typeof(requirement->'share_allowed') is distinct from 'boolean' then raise exception 'Invalid requirement' using errcode='22023';end if;
  if requirement ? 'id' then
   requirement_id:=(requirement->>'id')::uuid;
   if requirement_id is null or requirement_id=any(kept) or not exists(select 1 from public.case_requirements where id=requirement_id and case_id=p_case) then raise exception 'Invalid requirement reference' using errcode='22023';end if;
   kept:=array_append(kept,requirement_id);
  end if;
 end loop;
 recipient_changed:=current_case.venue_name<>trim(p_input->>'venue_name') or current_case.venue_url<>p_input->>'venue_url' or current_case.contact_email<>p_input->>'contact_email';
 if recipient_changed and ((p_input->>'outreach_allowed')::boolean or exists(select 1 from jsonb_array_elements(p_input->'requirements') r where (r->>'share_allowed')::boolean)) and not coalesce(p_recipient_reviewed,false) then
  raise exception 'Review sharing for the changed venue' using errcode='22023';end if;
 scope_changed:=current_case.title<>trim(p_input->>'title') or current_case.category<>p_input->>'category' or recipient_changed
  or current_case.timezone<>p_input->>'timezone' or current_case.visit_date is distinct from nullif(p_input->>'visit_date','')::date;
 select * into permission from public.case_permissions where case_id=p_case;
 before_edit:=jsonb_build_object('case',to_jsonb(current_case)-'owner_id'-'creation_key'-'creation_fingerprint',
  'requirements',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]') from public.case_requirements r where r.case_id=p_case),'permission',to_jsonb(permission));
 -- The case lock is taken before jobs, matching worker/control lock order.
 update public.outbox_jobs set state='cancelled',lease_until=null,lease_owner=null,execution_started_at=null where case_id=p_case and state in ('queued','claimed');
 delete from public.case_requirements where case_id=p_case and not(id=any(kept));
 for requirement in select value from jsonb_array_elements(p_input->'requirements') loop
  if requirement ? 'id' then
   select * into existing from public.case_requirements where id=(requirement->>'id')::uuid and case_id=p_case;
   update public.case_requirements set text=trim(requirement->>'text'),hard=(requirement->>'hard')::boolean,share_allowed=(requirement->>'share_allowed')::boolean,
    state=case when scope_changed or existing.text<>trim(requirement->>'text') or existing.hard<>(requirement->>'hard')::boolean then 'unknown' else existing.state end,
    version=version+1,updated_at=now() where id=existing.id;
  else
   insert into public.case_requirements(case_id,text,hard,share_allowed) values(p_case,trim(requirement->>'text'),(requirement->>'hard')::boolean,(requirement->>'share_allowed')::boolean);
  end if;
 end loop;
 update public.case_permissions set recipient=p_input->>'contact_email',outreach_allowed=(p_input->>'outreach_allowed')::boolean,
  followup_limit=0,version=version+1,updated_at=now() where case_id=p_case;
 update public.cases set title=trim(p_input->>'title'),category=p_input->>'category',venue_name=trim(p_input->>'venue_name'),venue_url=p_input->>'venue_url',
  contact_email=p_input->>'contact_email',timezone=p_input->>'timezone',visit_date=nullif(p_input->>'visit_date','')::date,
  state=case when current_case.state='paused' then 'paused' else 'ready' end,version=version+1,content_version=content_version+1,updated_at=now()
  where id=p_case returning version into result_version;
 insert into public.case_revisions(case_id,request_key,input_fingerprint,previous_version,result_version,snapshot) values(p_case,p_key,fingerprint,p_version,result_version,before_edit);
 insert into public.case_events(case_id,actor_id,kind,detail) values(p_case,auth.uid(),'visit_edited',jsonb_build_object('previousVersion',p_version,'version',result_version,'workStopped',true));
 return jsonb_build_object('caseId',p_case,'version',result_version);
end; $$;
revoke all on function public.edit_arrangement(uuid,integer,uuid,jsonb,boolean) from public,anon;
grant execute on function public.edit_arrangement(uuid,integer,uuid,jsonb,boolean) to authenticated;

create or replace function public.arrangement_snapshot() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501';end if;
 return jsonb_build_object(
 'profile',(select to_jsonb(p)-'user_id' from public.access_profiles p where user_id=auth.uid()),
 'cases',(select coalesce(jsonb_agg(to_jsonb(c) order by c.updated_at desc),'[]') from public.cases c where owner_id=auth.uid()),
 'requirements',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]') from public.case_requirements r join public.cases c on c.id=r.case_id where c.owner_id=auth.uid()),
 'permissions',(select coalesce(jsonb_agg(to_jsonb(p)),'[]') from public.case_permissions p join public.cases c on c.id=p.case_id where c.owner_id=auth.uid()),
 'jobs',(select coalesce(jsonb_agg(to_jsonb(j)-'lease_owner'-'execution_started_at' order by j.created_at desc),'[]') from public.outbox_jobs j join public.cases c on c.id=j.case_id where c.owner_id=auth.uid()),
 'reports',(select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc),'[]') from public.agent_reports r join public.cases c on c.id=r.case_id where c.owner_id=auth.uid()),
 'revisions',(select coalesce(jsonb_agg(to_jsonb(r)-'input_fingerprint'-'request_key' order by r.created_at desc),'[]') from public.case_revisions r join public.cases c on c.id=r.case_id where c.owner_id=auth.uid()),
 'events',(select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc),'[]') from public.case_events e join public.cases c on c.id=e.case_id where c.owner_id=auth.uid()));
end; $$;
