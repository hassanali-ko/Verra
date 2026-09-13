import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {database,rpc,asUser,people,exampleVisit} from './database';

test('agent jobs fence workers, preserve privacy and recover durable work',async t=>{
 const db=await database();
 const worker=async(name:string,types:string[]=[],values:unknown[]=[])=>db.transaction(async tx=>{
  await tx.exec('set local role service_role');
  return (await tx.query<{result:any}>(`select public.${name}(${types.map((v,i)=>`$${i+1}::${v}`).join(',')}) result`,values)).rows[0].result;
 });
 const create=async()=>{
  const id=await rpc(db,people[0],'create_arrangement',{p_input:exampleVisit(),p_key:randomUUID()}) as string;
  await rpc(db,people[0],'request_case_work',{p_case:id,p_version:1,p_key:randomUUID()});return id;
 };
 const context=(claim:any,begin=false)=>worker('agent_job_context',['uuid','uuid','boolean'],[claim.job_id,claim.lease_token,begin]);
 const result=(ctx:any)=>({mode:'local_test',model_id:'test_double',prompt_version:'test',venue_match:'uncertain',summary:'Synthetic database verification',sources:[],findings:ctx.requirements.map((r:any)=>({requirement_id:r.id,status:'unknown',explanation:'No live source',citations:[]}))});
 const finish=(claim:any,report:any)=>worker('finish_agent_job',['uuid','uuid','jsonb'],[claim.job_id,claim.lease_token,JSON.stringify(report)]);
 const fail=(claim:any,retry:boolean)=>worker('fail_agent_job',['uuid','uuid','text','boolean'],[claim.job_id,claim.lease_token,'provider_unavailable',retry]);
 try{
  await t.test('browser sessions cannot invoke workers or read lease capabilities',async()=>{
   for(const user of [people[0],people[1],null])await assert.rejects(asUser(db,user,'select public.claim_agent_job()'),{code:'42501'});
   await assert.rejects(asUser(db,people[0],'select lease_owner from public.outbox_jobs'),{code:'42501'});
  });
  await t.test('only one lease starts and wrong/replayed capabilities cannot execute',async()=>{
   await create();const claim=await worker('claim_agent_job');assert(claim);
   assert.equal(await worker('claim_agent_job'),null);
   await assert.rejects(context({...claim,lease_token:randomUUID()}),{code:'42501'});
   const ctx=await context(claim,true);assert(ctx);assert.equal(await context(claim,true),null);
   const snapshot=await rpc(db,people[0],'arrangement_snapshot') as any;
   assert(snapshot.jobs.every((j:any)=>!Object.hasOwn(j,'lease_owner')));
   const report=result(ctx);const reportId=await finish(claim,report);assert.equal(await finish(claim,report),reportId);
   const saved=await rpc(db,people[0],'arrangement_snapshot') as any;
   assert.equal(saved.reports[0].id,reportId);assert.equal(saved.cases[0].state,'needs_decision');
   assert.match(saved.reports[0].inquiry_draft,/Step-free route/);
   assert.doesNotMatch(saved.reports[0].inquiry_draft,/quiet place/);
   assert(saved.requirements.every((r:any)=>r.state==='unknown'));
   assert.equal((await rpc(db,people[1],'arrangement_snapshot') as any).reports.length,0);
   assert.equal((await asUser(db,people[1],'select * from public.agent_reports')).length,0);
  });
  await t.test('rejects incomplete or cross-case output without committing partial reports',async()=>{
   await create();const claim=await worker('claim_agent_job');const ctx=await context(claim,true);const report=result(ctx);
   await assert.rejects(finish(claim,{...report,findings:[]}));
   await assert.rejects(finish(claim,{...report,findings:report.findings.map((f:any)=>({...f,requirement_id:randomUUID()}))}));
   await assert.rejects(finish(claim,{...report,findings:[report.findings[0],report.findings[0]]}));
   assert.equal((await db.query('select id from public.agent_reports where job_id=$1',[claim.job_id])).rows.length,0);
   await finish(claim,report);
  });
  await t.test('pause and cancellation fence late results',async()=>{
   for(const action of ['pause','cancel']){
    const id=await create();const claim=await worker('claim_agent_job');const ctx=await context(claim,true);
    await rpc(db,people[0],'control_case',{p_case:id,p_version:2,p_action:action});
    await assert.rejects(context(claim),{code:'42501'});await assert.rejects(finish(claim,result(ctx)),{code:'42501'});
    assert.equal((await db.query('select id from public.agent_reports where job_id=$1',[claim.job_id])).rows.length,0);
   }
  });
  await t.test('expired work gets a new token; old workers cannot overwrite recovery',async()=>{
   await create();const old=await worker('claim_agent_job');await context(old,true);
   await db.query("update public.outbox_jobs set lease_until=now()-interval '1 second' where id=$1",[old.job_id]);
   const recovered=await worker('claim_agent_job');assert.equal(recovered.job_id,old.job_id);assert.notEqual(recovered.lease_token,old.lease_token);
   await assert.rejects(context(old),{code:'42501'});
   const ctx=await context(recovered,true);await finish(recovered,result(ctx));
  });
  await t.test('retry backoff is durable and attempts stop at three',async()=>{
   const id=await create();let claim=await worker('claim_agent_job');await context(claim,true);await fail(claim,true);
   assert.equal(await worker('claim_agent_job'),null);
   for(let i=0;i<2;i++){
    await db.query("update public.outbox_jobs set available_at=now()-interval '1 second' where id=$1",[claim.job_id]);
    claim=await worker('claim_agent_job');await context(claim,true);await fail(claim,true);
   }
   const job=(await db.query<{state:string,attempts:number}>('select state,attempts from public.outbox_jobs where id=$1',[claim.job_id])).rows[0];
   assert.equal(job.state,'failed');assert.equal(job.attempts,3);
   assert.equal((await db.query<{state:string}>('select state from public.cases where id=$1',[id])).rows[0].state,'error');
  });
  await t.test('three crashed workers are retired by the next recovery sweep',async()=>{
   const id=await create();let claim;
   for(let i=0;i<3;i++){
    claim=await worker('claim_agent_job');await context(claim,true);
    await db.query("update public.outbox_jobs set lease_until=now()-interval '1 second' where id=$1",[claim.job_id]);
   }
   assert.equal(await worker('claim_agent_job'),null);
   assert.equal((await db.query<{state:string}>('select state from public.cases where id=$1',[id])).rows[0].state,'error');
  });
 }finally{await db.close();}
});
