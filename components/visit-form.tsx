'use client';
import {useState} from 'react';
import {categories,type EditArrangementInput,type Visit,type Snapshot} from '@/lib/contracts';

export type EditTarget={visit:Visit;requirements:Snapshot['requirements'];outreachAllowed:boolean};
export function VisitForm({needs,editing,latestVersion,onSaved,onDirty,onReload}:{needs:string[];editing?:EditTarget;latestVersion?:number;onSaved:(id:string)=>Promise<void>;onDirty:(dirty:boolean)=>void;onReload?:()=>Promise<void>}){
 const [draft,setDraft]=useState<EditArrangementInput>(()=>editing?{
  title:editing.visit.title,category:editing.visit.category as EditArrangementInput['category'],venue_name:editing.visit.venue_name,venue_url:editing.visit.venue_url,
  contact_email:editing.visit.contact_email,timezone:editing.visit.timezone,visit_date:editing.visit.visit_date||'',outreach_allowed:editing.outreachAllowed,
  requirements:editing.requirements.map(({id,text,hard,share_allowed})=>({id,text,hard,share_allowed})),
 }:{title:'',category:'everyday',venue_name:'',venue_url:'',contact_email:'',timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,visit_date:'',requirements:needs.length?needs.map(text=>({text,hard:true,share_allowed:false})):[{text:'',hard:true,share_allowed:false}],outreach_allowed:false});
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[conflict,setConflict]=useState(false),[recipientReviewed,setRecipientReviewed]=useState(false);
 const [attempt,setAttempt]=useState<{key:string;body:string}|null>(null),[savedId,setSavedId]=useState('');
 const recipientChanged=Boolean(editing&&(draft.venue_name!==editing.visit.venue_name||draft.venue_url!==editing.visit.venue_url||draft.contact_email!==editing.visit.contact_email));
 const sharingReview=recipientChanged&&(draft.outreach_allowed||draft.requirements.some(r=>r.share_allowed));
 const locked=busy||Boolean(attempt)||Boolean(savedId)||conflict;
 function change(key:string,value:unknown){
  onDirty(true);
  if(editing&&['venue_name','venue_url','contact_email'].includes(key))setRecipientReviewed(false);
  setDraft(d=>{
   const next={...d,[key]:value};
   if(editing&&['venue_name','venue_url','contact_email'].includes(key)){
    next.outreach_allowed=false;next.requirements=d.requirements.map(r=>({...r,share_allowed:false}));
   }
   return next;
  });
 }
 const needChange=(index:number,key:string,value:unknown)=>change('requirements',draft.requirements.map((r,i)=>i===index?{...r,[key]:value}:r));
 async function submit(event:React.FormEvent){
  event.preventDefault();setBusy(true);setError('');
  try{
   if(savedId){await onSaved(savedId);return;}
   const current=attempt||{key:crypto.randomUUID(),body:JSON.stringify(editing?{version:editing.visit.version,visit:draft,recipientReviewed}:draft)};
   setAttempt(current);
   const response=await fetch(editing?`/api/cases/${editing.visit.id}`:'/api/cases',{method:editing?'PATCH':'POST',headers:{'Content-Type':'application/json','Idempotency-Key':current.key},body:current.body});
   const body=await response.json();
   if(!response.ok){
    // A definite validation/conflict rejection did not commit. An unknown server outcome keeps the exact request for a safe retry.
    if(response.status<500){setAttempt(null);setConflict(response.status===409);}
    setError(body.error||'Could not confirm this change. Retry the same save.');return;
   }
   setSavedId(body.caseId);setAttempt(null);onDirty(false);await onSaved(body.caseId);
  }catch{setError('Could not confirm the save. Your details are kept here. Retry the same save to check its result without duplicating it.');}
  finally{setBusy(false);}
 }
 async function openLatest(){
  if(!confirm('Discard these unsaved edits and open the latest saved visit?'))return;
  setBusy(true);
  try{await onReload?.();}catch{setError('The latest visit could not be loaded. Your unsaved words are still here. Try again when connected.');}
  finally{setBusy(false);}
 }
 return <form className="visit-form" onSubmit={event=>void submit(event)}>
  {editing&&latestVersion!==undefined&&latestVersion!==editing.visit.version&&!savedId&&<p className="notice" role="status">This visit changed while you were editing. Your words are kept here; the saved version will not be overwritten.</p>}
  <fieldset disabled={locked}><legend>The visit</legend>
   <label>A name for this plan<input required minLength={3} maxLength={160} placeholder="For example, Saturday pottery class" value={draft.title} onChange={e=>change('title',e.target.value)}/></label>
   <div className="two-fields"><label>Type of visit<select value={draft.category} onChange={e=>change('category',e.target.value)}>{categories.map(c=><option key={c} value={c}>{c}</option>)}</select></label><label>Date, if known<input type="date" value={draft.visit_date} onChange={e=>change('visit_date',e.target.value)}/></label></div>
   <label>Time zone<input required value={draft.timezone} onChange={e=>change('timezone',e.target.value)}/></label>
   <label>Place or venue<input required minLength={2} maxLength={160} value={draft.venue_name} onChange={e=>change('venue_name',e.target.value)}/></label>
   <div className="two-fields"><label>Website, if known<input type="url" maxLength={2000} value={draft.venue_url} onChange={e=>change('venue_url',e.target.value)}/></label><label>Venue email, if known<input type="email" maxLength={254} value={draft.contact_email} onChange={e=>change('contact_email',e.target.value)}/></label></div>
  </fieldset>
  <fieldset disabled={locked}><legend>What needs to work</legend><p>Separate each need so its answer can be checked independently.</p>
   {recipientChanged&&<p className="notice">The venue or contact changed. Sharing choices were cleared. Choose what this venue may receive.</p>}
   {draft.requirements.map((r,index)=><div className="need-entry" key={r.id||index}><label>Requirement {index+1}<textarea required minLength={3} maxLength={1000} value={r.text} onChange={e=>needChange(index,'text',e.target.value)}/></label><div className="need-options"><label className="checkbox"><input type="checkbox" checked={r.hard} onChange={e=>needChange(index,'hard',e.target.checked)}/>This is a hard requirement</label><label className="checkbox"><input type="checkbox" checked={r.share_allowed} onChange={e=>needChange(index,'share_allowed',e.target.checked)}/>May be shared with this venue</label>{draft.requirements.length>1&&<button type="button" onClick={()=>change('requirements',draft.requirements.filter((_,i)=>i!==index))}>Remove requirement {index+1}</button>}</div></div>)}
   <button type="button" disabled={draft.requirements.length>=30} onClick={()=>change('requirements',[...draft.requirements,{text:'',hard:true,share_allowed:false}])}>+ Add another need</button>
  </fieldset>
  <fieldset disabled={locked}><legend>Your permission</legend><label className="checkbox"><input type="checkbox" checked={draft.outreach_allowed} onChange={e=>change('outreach_allowed',e.target.checked)}/>Allow Verra to contact this venue about the needs I marked for sharing.</label><p className="small">This saves your permission. Sending messages is not connected yet. It does not allow follow-ups, other recipients, bookings or payments.</p>
   {sharingReview&&<label className="checkbox"><input type="checkbox" required checked={recipientReviewed} onChange={e=>{onDirty(true);setRecipientReviewed(e.target.checked);}}/>I reviewed the changed venue and contact for these sharing choices.</label>}
  </fieldset>
  {editing&&<p className="small">Saving preserves the previous details, stops old checks and marks previous research as earlier information. A paused visit stays paused. Your other visits are unaffected.</p>}
  {error&&<p className="notice" role="alert">{error}</p>}
  {attempt&&!busy&&<p className="notice">The previous save has an uncertain result. Retry it before making more changes.</p>}
  {conflict?<button type="button" disabled={busy} onClick={()=>void openLatest()}>Open latest saved visit</button>:<button className="primary" disabled={busy}>{busy?'Saving…':savedId?'Open saved visit':attempt?'Retry the same save':editing?'Save changes':'Save this visit'}</button>}
 </form>;
}
