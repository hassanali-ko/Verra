import test from 'node:test';
import assert from 'node:assert/strict';
import {initialDemo,updateSample,demoStateSchema} from '../lib/demo-model';
test('sample decisions preserve requirements, require sharing and respect pause/cancel',()=>{
 const visit=initialDemo().visits[0];const blocked={...visit,shared:[false,true,false]};assert.equal(updateSample(blocked,'approve'),blocked);
 const waiting=updateSample(visit,'approve');assert.equal(waiting.stage,'waiting');assert.deepEqual(waiting.needs,visit.needs);
 const paused=updateSample(waiting,'pause');assert.equal(updateSample(paused,'reply'),paused);
 const plan=updateSample(updateSample(paused,'resume'),'reply');assert.equal(plan.stage,'plan');assert.deepEqual(plan.needs,visit.needs);
 const cancelled=updateSample(waiting,'cancel');assert(cancelled.shared.every(v=>!v));assert.equal(updateSample(cancelled,'reply'),cancelled);assert.equal(updateSample(cancelled,'resume'),cancelled);
 assert.equal(updateSample({...waiting,id:'sample-custom'},'reply').stage,'waiting');
 const declined=updateSample(visit,'decline');assert.equal(declined.stage,'declined');assert.deepEqual(declined.needs,visit.needs);assert.equal(updateSample(declined,'reopen').stage,'review');
 assert(demoStateSchema.safeParse(initialDemo()).success);assert(!demoStateSchema.safeParse({visits:[{title:'tampered'}],needs:[]}).success);
});
