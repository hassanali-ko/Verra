import { personalSession,trustedOrigin } from '@/lib/session';
import { privateJson,databaseError } from '@/lib/respond';
import { arrangementInput } from '@/lib/contracts';
import { z } from 'zod';
export async function POST(request:Request){
 if(!trustedOrigin(request))return privateJson({error:'Request origin rejected.'},403);
 const session=await personalSession();if(!session)return privateJson({error:'Sign in to create a visit.'},401);
 let input,key;try{const text=await request.text();if(text.length>40000)throw new Error();input=arrangementInput.parse(JSON.parse(text));key=z.uuid().parse(request.headers.get('Idempotency-Key'));}catch{return privateJson({error:'Check the visit details, requirements and sharing permission.'},400);}
 const result=await session.db.rpc('create_arrangement',{p_input:input,p_key:key});return result.error?databaseError(result.error):privateJson({caseId:result.data},201);
}
