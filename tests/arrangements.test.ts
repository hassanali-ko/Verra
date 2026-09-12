import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { database,asUser,rpc,people,exampleVisit } from './database';
import type { Snapshot } from '../lib/contracts';

test('personal arrangements: ownership, consent, atomic work and recovery',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'verra-product-'));
 let db=await database(directory);
 const [owner,stranger]=people;
 let caseId='',key='',jobId='';
 try{
  await t.test('creates the case, individual needs and scoped permission atomically',async()=>{
   await rpc(db,owner,'save_access_profile',{p_name:'Local person',p_needs:['A place to sit']});
   const creationKey=randomUUID();
   caseId=await rpc(db,owner,'create_arrangement',{p_input:exampleVisit(),p_key:creationKey}) as string;
   assert.equal(await rpc(db,owner,'create_arrangement',{p_input:exampleVisit(),p_key:creationKey}),caseId);
   await assert.rejects(rpc(db,owner,'create_arrangement',{p_input:{...exampleVisit(),title:'Changed title'},p_key:creationKey}),{code:'40001'});
   const saved=await rpc(db,owner,'arrangement_snapshot') as Snapshot;
   assert.equal(saved.cases.length,1);assert.equal(saved.requirements.length,2);
   assert.equal(saved.requirements.filter(r=>r.share_allowed).length,1);
   assert.equal(saved.permissions[0].outreach_allowed,true);
   assert.equal(saved.events.length,1);assert.equal(saved.profile?.display_name,'Local person');
   assert(saved.requirements.every(r=>r.state==='unknown'));
  });
  await t.test('another account sees no personal rows and cannot mutate them',async()=>{
   const snapshot=await rpc(db,stranger,'arrangement_snapshot') as Snapshot;
   assert.equal(snapshot.profile,null);for(const key of ['cases','requirements','permissions','jobs','events'] as const)assert.equal(snapshot[key].length,0);
   for(const table of ['access_profiles','cases','case_requirements','case_permissions','outbox_jobs','case_events'])assert.equal((await asUser(db,stranger,`select * from public.${table}`)).length,0);
   await assert.rejects(rpc(db,stranger,'control_case',{p_case:caseId,p_version:1,p_action:'cancel'}),{code:'42501'});
   await assert.rejects(rpc(db,stranger,'request_case_work',{p_case:caseId,p_version:1,p_key:randomUUID()}),{code:'42501'});
   await assert.rejects(asUser(db,owner,"update public.cases set owner_id=$1 where id=$2",[stranger,caseId]),{code:'42501'});
   await assert.rejects(rpc(db,null,'arrangement_snapshot'),{code:'42501'});
   await assert.rejects(asUser(db,null,'select * from public.cases'),{code:'42501'});
  });
  await t.test('rejects malformed requirements, recipient escalation and partial creation',async()=>{
   for(const input of [{...exampleVisit(),owner_id:stranger},{...exampleVisit(),contact_email:''},{...exampleVisit(),timezone:'MadeUp/Zone'},{...exampleVisit(),requirements:[{text:'ok',hard:true,share_allowed:true}]},{...exampleVisit(),requirements:[{text:'Valid need',hard:true,share_allowed:true,confirmed:true}]}])await assert.rejects(rpc(db,owner,'create_arrangement',{p_input:input,p_key:randomUUID()}));
   assert.equal((await rpc(db,owner,'arrangement_snapshot') as Snapshot).cases.length,1);
  });
  await t.test('accepts work with one durable job and an idempotent retry',async()=>{
   key=randomUUID();const accepted=await rpc(db,owner,'request_case_work',{p_case:caseId,p_version:1,p_key:key}) as {jobId:string};jobId=accepted.jobId;
   const retry=await rpc(db,owner,'request_case_work',{p_case:caseId,p_version:1,p_key:key}) as {jobId:string};assert.equal(retry.jobId,jobId);
   await assert.rejects(rpc(db,owner,'request_case_work',{p_case:caseId,p_version:1,p_key:randomUUID()}),{code:'40001'});
   assert.equal((await rpc(db,owner,'arrangement_snapshot') as Snapshot).jobs.length,1);
  });
  await t.test('preserves the queued request across a database restart',async()=>{
   await db.close();db=await database(directory);
   const saved=await rpc(db,owner,'arrangement_snapshot') as Snapshot;
   assert.equal(saved.jobs[0].id,jobId);assert.equal(saved.jobs[0].state,'queued');assert.equal(saved.cases[0].version,2);
  });
  await t.test('pause stops queued work; resume requires a fresh request; cancellation revokes outreach',async()=>{
   await rpc(db,owner,'control_case',{p_case:caseId,p_version:2,p_action:'pause'});
   let saved=await rpc(db,owner,'arrangement_snapshot') as Snapshot;assert.equal(saved.jobs[0].state,'cancelled');assert.equal(saved.cases[0].state,'paused');
   await assert.rejects(rpc(db,owner,'request_case_work',{p_case:caseId,p_version:3,p_key:randomUUID()}),{code:'22023'});
   await rpc(db,owner,'control_case',{p_case:caseId,p_version:3,p_action:'resume'});
   await rpc(db,owner,'request_case_work',{p_case:caseId,p_version:4,p_key:randomUUID()});
   await rpc(db,owner,'control_case',{p_case:caseId,p_version:5,p_action:'cancel'});
   saved=await rpc(db,owner,'arrangement_snapshot') as Snapshot;assert.equal(saved.cases[0].state,'cancelled');assert.equal(saved.permissions[0].outreach_allowed,false);assert(saved.jobs.every(j=>j.state==='cancelled'));
   await assert.rejects(rpc(db,owner,'control_case',{p_case:caseId,p_version:6,p_action:'resume'}),{code:'22023'});
  });
 }finally{await db.close();await rm(directory,{recursive:true,force:true});}
});
