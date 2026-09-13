import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {database,rpc,workerRpc,asUser,people,exampleVisit} from './database';

test('visit edits preserve history, scope permissions and invalidate old work',async t=>{
 const db=await database();
 const create=()=>rpc(db,people[0],'create_arrangement',{p_input:exampleVisit(),p_key:randomUUID()}) as Promise<string>;
 const snapshot=()=>rpc(db,people[0],'arrangement_snapshot') as Promise<any>;
 const input=async(id:string)=>({...exampleVisit(),requirements:(await snapshot()).requirements.filter((r:any)=>r.case_id===id).map(({id,text,hard,share_allowed}:any)=>({id,text,hard,share_allowed}))});
 const edit=(id:string,version:number,visit:object,key=randomUUID(),reviewed=false)=>rpc(db,people[0],'edit_arrangement',{p_case:id,p_version:version,p_key:key,p_input:visit,p_recipient_reviewed:reviewed});
 try{
  await t.test('owner edits are atomic, safely retryable and reject stale overwrites',async()=>{
   const id=await create(),visit={...await input(id),visit_date:'2026-10-02'},key=randomUUID();
   const result=await edit(id,1,visit,key);assert.deepEqual(await edit(id,1,visit,key),result);
   await assert.rejects(edit(id,1,{...visit,title:'A changed retry'},key),{code:'40001'});
   await assert.rejects(edit(id,1,visit),{code:'40001'});
   const data=await snapshot();assert.equal(data.revisions.filter((r:any)=>r.case_id===id).length,1);
   const revision=data.revisions.find((r:any)=>r.case_id===id);assert.equal(revision.snapshot.case.visit_date,null);
   assert.equal(data.cases.find((c:any)=>c.id===id).content_version,2);
   assert.equal((await asUser(db,people[1],'select * from public.case_revisions')).length,0);
   for(const user of [people[1],null])await assert.rejects(rpc(db,user,'edit_arrangement',{p_case:id,p_version:2,p_key:randomUUID(),p_input:visit,p_recipient_reviewed:false}),{code:'42501'});
  });
  await t.test('editing a claimed case fences late completion and preserves unrelated needs',async()=>{
   const id=await create(),original=await input(id);
   await db.query("update public.case_requirements set state='venue_confirmed' where case_id=$1",[id]);
   const queued=await rpc(db,people[0],'request_case_work',{p_case:id,p_version:1,p_key:randomUUID()}) as any;
   const claim=await workerRpc(db,'claim_agent_job',{p_job:queued.jobId}) as any;
   await workerRpc(db,'agent_job_context',{p_job:claim.job_id,p_token:claim.lease_token,p_begin:true});
   const changed={...original,requirements:original.requirements.map((r:any,i:number)=>i===0?{...r,text:'A revised route to this room',share_allowed:false}:r)};
   await edit(id,2,changed);
   await assert.rejects(workerRpc(db,'agent_job_context',{p_job:claim.job_id,p_token:claim.lease_token,p_begin:false}),{code:'42501'});
   await assert.rejects(workerRpc(db,'finish_agent_job',{p_job:claim.job_id,p_token:claim.lease_token,p_report:{}}),{code:'42501'});
   const data=await snapshot();assert.equal(data.jobs.find((j:any)=>j.id===queued.jobId).state,'cancelled');
   assert.equal(data.requirements.find((r:any)=>r.id===original.requirements[0].id).state,'unknown');
   assert.equal(data.requirements.find((r:any)=>r.id===original.requirements[1].id).state,'venue_confirmed');
   assert.equal(data.cases.find((c:any)=>c.id===id).state,'ready');
  });
  await t.test('changed recipient cannot inherit sharing without explicit review',async()=>{
   const id=await create(),visit={...await input(id),contact_email:'new@example.org'};
   await assert.rejects(edit(id,1,visit),{code:'22023'});
   assert.equal((await snapshot()).cases.find((c:any)=>c.id===id).version,1);
   await edit(id,1,visit,randomUUID(),true);
   assert.equal((await snapshot()).permissions.find((p:any)=>p.case_id===id).recipient,'new@example.org');
   const next={...await input(id),contact_email:'private@example.org',outreach_allowed:false,requirements:visit.requirements.map((r:any)=>({...r,share_allowed:false}))};
   await edit(id,2,next);assert.equal((await snapshot()).permissions.find((p:any)=>p.case_id===id).outreach_allowed,false);
  });
  await t.test('foreign or duplicate requirement IDs roll back; add and removal preserve history',async()=>{
   const id=await create(),other=await create(),original=await input(id),foreign=await input(other);
   await assert.rejects(edit(id,1,{...original,requirements:[foreign.requirements[0]]}),{code:'22023'});
   await assert.rejects(edit(id,1,{...original,requirements:[original.requirements[0],original.requirements[0]]}),{code:'22023'});
   const newNeed={text:'A seat while waiting',hard:true,share_allowed:false};
   await edit(id,1,{...original,requirements:[original.requirements[0],newNeed]});
   const data=await snapshot(),current=data.requirements.filter((r:any)=>r.case_id===id);
   assert.equal(current.length,2);assert(current.some((r:any)=>r.id===original.requirements[0].id));
   assert(!current.some((r:any)=>r.id===original.requirements[1].id));
   assert(data.revisions.find((r:any)=>r.case_id===id).snapshot.requirements.some((r:any)=>r.id===original.requirements[1].id));
  });
  await t.test('research keeps its original requirement words after edits',async()=>{
   const id=await create(),original=await input(id);
   const job=await rpc(db,people[0],'request_case_work',{p_case:id,p_version:1,p_key:randomUUID()}) as any;
   const claim=await workerRpc(db,'claim_agent_job',{p_job:job.jobId}) as any;
   await workerRpc(db,'agent_job_context',{p_job:claim.job_id,p_token:claim.lease_token,p_begin:true});
   await workerRpc(db,'finish_agent_job',{p_job:claim.job_id,p_token:claim.lease_token,p_report:{mode:'local_test',venue_match:'uncertain',sources:[],findings:original.requirements.map((r:any)=>({requirement_id:r.id,status:'unknown',explanation:'Test',citations:[]}))}});
   await edit(id,3,{...original,requirements:[{text:'A different need',hard:true,share_allowed:false}],outreach_allowed:false});
   const data=await snapshot(),report=data.reports.find((r:any)=>r.case_id===id);
   assert.equal(report.content_version,1);assert.equal(data.cases.find((c:any)=>c.id===id).content_version,2);
   assert.equal(report.requirements_snapshot.length,2);assert.equal(report.requirements_snapshot[0].text,original.requirements[0].text);
  });
  await t.test('paused visits stay paused and cancelled visits cannot be edited',async()=>{
   const id=await create(),visit=await input(id);
   await rpc(db,people[0],'control_case',{p_case:id,p_version:1,p_action:'pause'});await edit(id,2,visit);
   assert.equal((await snapshot()).cases.find((c:any)=>c.id===id).state,'paused');
   await rpc(db,people[0],'control_case',{p_case:id,p_version:3,p_action:'cancel'});
   await assert.rejects(edit(id,4,visit),{code:'22023'});
  });
 }finally{await db.close();}
});
