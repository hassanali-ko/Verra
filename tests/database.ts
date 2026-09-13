import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

export const people=['10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002'];
export async function database(directory?:string){
 const db=new PGlite(directory);
 const {rows}=await db.query<{exists:boolean}>("select exists(select 1 from pg_namespace where nspname='auth')");
 if(!rows[0].exists){
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
   create table auth.users(id uuid primary key);
   create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
   grant usage on schema public,auth to anon,authenticated;
   grant execute on function auth.uid() to anon,authenticated;`);
  for(const id of people)await db.query('insert into auth.users values ($1)',[id]);
  await db.exec(await readFile(new URL('../supabase/migrations/001_arrangements.sql',import.meta.url),'utf8'));
 }
 const agentSchema=await db.query<{exists:boolean}>("select exists(select 1 from information_schema.tables where table_schema='public' and table_name='agent_reports')");
 if(!agentSchema.rows[0].exists){
  await db.exec("do $$ begin if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;end $$;grant usage on schema public to service_role;");
  await db.exec(await readFile(new URL('../supabase/migrations/002_agent_research.sql',import.meta.url),'utf8'));
 }
 const revisionSchema=await db.query<{exists:boolean}>("select exists(select 1 from information_schema.tables where table_schema='public' and table_name='case_revisions')");
 if(!revisionSchema.rows[0].exists)await db.exec(await readFile(new URL('../supabase/migrations/003_arrangement_edits.sql',import.meta.url),'utf8'));
 return db;
}
export const rpcDefinitions={
 arrangement_snapshot:{args:[],types:[]},
 save_access_profile:{args:['p_name','p_needs'],types:['text','jsonb']},
 create_arrangement:{args:['p_input','p_key'],types:['jsonb','uuid']},
 request_case_work:{args:['p_case','p_version','p_key'],types:['uuid','integer','uuid']},
 control_case:{args:['p_case','p_version','p_action'],types:['uuid','integer','text']},
 edit_arrangement:{args:['p_case','p_version','p_key','p_input','p_recipient_reviewed'],types:['uuid','integer','uuid','jsonb','boolean']},
} as const;
export const workerDefinitions={
 claim_agent_job:{args:['p_job'],types:['uuid']},
 agent_job_context:{args:['p_job','p_token','p_begin'],types:['uuid','uuid','boolean']},
 finish_agent_job:{args:['p_job','p_token','p_report'],types:['uuid','uuid','jsonb']},
 fail_agent_job:{args:['p_job','p_token','p_code','p_retry'],types:['uuid','uuid','text','boolean']},
} as const;
export async function workerRpc(db:PGlite,name:keyof typeof workerDefinitions,input:Record<string,unknown>={}){
 const definition=workerDefinitions[name];
 const values=definition.args.map((arg,i)=>definition.types[i]==='jsonb'?JSON.stringify(input[arg]):input[arg]??null);
 return db.transaction(async tx=>{
  await tx.exec('set local role service_role');
  return (await tx.query<{result:unknown}>(`select public.${name}(${definition.types.map((type,i)=>`$${i+1}::${type}`).join(',')}) result`,values)).rows[0].result;
 });
}
export async function asUser<T>(db:PGlite,user:string|null,query:string,values:unknown[]=[]){
 return db.transaction(async tx=>{
  await tx.exec(`set local role ${user?'authenticated':'anon'}`);
  await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[user||'']);
  return (await tx.query<T>(query,values)).rows;
 });
}
export async function rpc(db:PGlite,user:string|null,name:keyof typeof rpcDefinitions,input:Record<string,unknown>={}){
 const definition=rpcDefinitions[name];
 const values=definition.args.map((arg,i)=>definition.types[i]==='jsonb'?JSON.stringify(input[arg]):input[arg]);
 const placeholders=definition.types.map((type,i)=>`$${i+1}::${type}`).join(',');
 return (await asUser<{result:unknown}>(db,user,`select public.${name}(${placeholders}) as result`,values))[0].result;
}
export const exampleVisit=()=>({title:'A pottery class',category:'class',venue_name:'Example studio',venue_url:'https://example.org',contact_email:'access@example.org',timezone:'Asia/Karachi',visit_date:'',requirements:[{text:'Step-free route to the classroom',hard:true,share_allowed:true},{text:'A quiet place to rest',hard:false,share_allowed:false}],outreach_allowed:true});
