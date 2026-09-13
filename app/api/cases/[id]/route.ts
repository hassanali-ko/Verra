import {z} from 'zod';
import {personalSession,trustedOrigin} from '@/lib/session';
import {privateJson,databaseError} from '@/lib/respond';
import {editArrangementInput} from '@/lib/contracts';

export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){
 if(!trustedOrigin(request))return privateJson({error:'Request origin rejected.'},403);
 const session=await personalSession();if(!session)return privateJson({error:'Sign in to edit a visit.'},401);
 let input,id,key;
 try{
  const raw=await request.text();if(raw.length>45000)throw new Error();
  input=z.object({version:z.number().int().positive(),visit:editArrangementInput,recipientReviewed:z.boolean()}).strict().parse(JSON.parse(raw));
  id=z.uuid().parse((await params).id);key=z.uuid().parse(request.headers.get('Idempotency-Key'));
 }catch{return privateJson({error:'Check the visit details and sharing choices.'},400);}
 const result=await session.db.rpc('edit_arrangement',{p_case:id,p_version:input.version,p_key:key,p_input:input.visit,p_recipient_reviewed:input.recipientReviewed});
 return result.error?databaseError(result.error):privateJson(result.data);
}
