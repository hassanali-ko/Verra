import { z } from 'zod';
export const categories=['everyday','dining','class','appointment','entertainment','accommodation'] as const;
export const requirementInput=z.object({text:z.string().trim().min(3).max(1000),hard:z.boolean(),share_allowed:z.boolean()}).strict();
export const arrangementInput=z.object({
 title:z.string().trim().min(3).max(160),category:z.enum(categories),venue_name:z.string().trim().min(2).max(160),
 venue_url:z.union([z.literal(''),z.url().max(2000).refine(s=>/^https?:\/\//.test(s))]),contact_email:z.union([z.literal(''),z.email().max(254)]),
 timezone:z.string().max(100).refine(zone=>{try{new Intl.DateTimeFormat('en',{timeZone:zone});return true;}catch{return false;}}),
 visit_date:z.union([z.literal(''),z.iso.date()]),requirements:z.array(requirementInput).min(1).max(30),outreach_allowed:z.boolean(),
}).strict().refine(v=>!v.outreach_allowed||Boolean(v.contact_email),{message:'Add the venue email before allowing outreach.'});
export type ArrangementInput=z.infer<typeof arrangementInput>;
export const editArrangementInput=arrangementInput.safeExtend({requirements:z.array(requirementInput.extend({id:z.uuid().optional()})).min(1).max(30)});
export type EditArrangementInput=z.infer<typeof editArrangementInput>;
export type Visit={content_version:number;id:string;title:string;category:string;venue_name:string;venue_url:string;contact_email:string;timezone:string;visit_date:string|null;state:string;version:number};
export type ResearchReport={content_version:number;requirements_snapshot:Snapshot["requirements"];id:string;case_id:string;job_id:string;case_version:number;inquiry_draft:string;created_at:string;report:{mode:'live'|'local_test';model_id:string;summary:string;venue_match:'matched'|'uncertain'|'mismatch';sources:{id:string;url:string;title:string;retrieved_at:string}[];findings:{requirement_id:string;status:'unknown'|'source_supports'|'source_reports_unavailable'|'conflicting';explanation:string;citations:{source_id:string;quote:string}[]}[]}};
export type CaseRevision={id:string;case_id:string;previous_version:number;result_version:number;created_at:string;snapshot:{case:Visit;requirements:Snapshot["requirements"];permission:{recipient:string;outreach_allowed:boolean}}};
export type Snapshot={revisions:CaseRevision[];profile:{display_name:string;needs:string[]}|null;cases:Visit[];requirements:{id:string;case_id:string;text:string;hard:boolean;share_allowed:boolean;state:string}[];permissions:{case_id:string;recipient:string;outreach_allowed:boolean}[];jobs:{id:string;case_id:string;state:string;last_error?:string|null}[];reports:ResearchReport[];events:{id:number;case_id:string;kind:string;created_at:string}[]};
