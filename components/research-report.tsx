'use client';
import {useState} from 'react';
import type {ResearchReport,Snapshot} from '@/lib/contracts';

const labels={unknown:'Still unanswered',source_supports:'Reported on the website',source_reports_unavailable:'Source reports a barrier',conflicting:'Conflicting information'};
function sourceLink(value:string){try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)?url.href:null;}catch{return null;}}

export function ResearchReportView({report,requirements,currentContentVersion,allowDraft}:{report:ResearchReport;requirements:Snapshot['requirements'];currentContentVersion:number;allowDraft:boolean}){
 const [copyStatus,setCopyStatus]=useState('');
 const research=report.report;
 const earlier=report.content_version!==currentContentVersion;
 const checkedRequirements=report.requirements_snapshot?.length?report.requirements_snapshot:requirements;
 return <section className="research-report" aria-labelledby="research-title"><div className="section-head"><div><p className="kicker">Information, with its source</p><h2 id="research-title">Your venue check</h2><p>Saved <time dateTime={report.created_at}>{new Date(report.created_at).toLocaleString()}</time></p></div><span className="state">For your review</span></div>
 {research.mode==='local_test'&&<p className="notice">Synthetic verification result. This is test data, not a live venue check.</p>}
 {earlier&&<p className="notice">This check belongs to an earlier visit version. Review it against your current arrangements.</p>}
 <p className="research-summary">{research.summary}</p><p className="small">Website statements are reported evidence. They do not confirm the entire visit or replace a specific answer from the venue.</p>
 <div className="research-findings">{research.findings.map(finding=><article className="research-finding" key={finding.requirement_id}><span className="state">{labels[finding.status]}</span><h3>{checkedRequirements.find(r=>r.id===finding.requirement_id)?.text||'Visit requirement'}</h3><p>{finding.explanation}</p>{finding.citations.map((citation,index)=>{
 const source=research.sources.find(s=>s.id===citation.source_id);const href=source?sourceLink(source.url):null;
 return <figure key={index}><blockquote>{citation.quote}</blockquote><figcaption>{source&&href?<><a href={href} target="_blank" rel="noreferrer">{source.title} ↗</a><span>Read <time dateTime={source.retrieved_at}>{new Date(source.retrieved_at).toLocaleDateString()}</time></span></>:<span>Source unavailable</span>}</figcaption></figure>;
 })}</article>)}</div>
 <section className="research-next"><h3>Questions for the venue</h3>{earlier?<p>This earlier draft is unavailable for reuse because the visit details or permissions changed. Request a fresh check using your current choices.</p>:report.inquiry_draft&&!allowDraft?<p>This draft is unavailable while the visit is paused, cancelled or no longer permits outreach.</p>:report.inquiry_draft?<><p>This draft includes only the requirements you allowed us to share. It has not been sent. Review it before using it.</p><pre>{report.inquiry_draft}</pre><button onClick={async()=>{try{await navigator.clipboard.writeText(report.inquiry_draft);setCopyStatus('Draft copied. No message has been sent.');}catch{setCopyStatus('Copy is unavailable here. You can select the draft text above.');}}}>Copy inquiry draft</button>{copyStatus&&<p role="status">{copyStatus}</p>}</>:<p>No shareable inquiry is prepared. Keep your needs private or review the contact and sharing permissions before requesting outreach.</p>}<p className="small">Maps, alternative search, venue email and calendar synchronization are not connected yet.</p></section>
 </section>;
}
