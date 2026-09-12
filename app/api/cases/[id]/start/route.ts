import { z } from 'zod';
import { personalSession,trustedOrigin } from '@/lib/session';
import { privateJson,databaseError } from '@/lib/respond';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 if(!trustedOrigin(request))return privateJson({error:'Request origin rejected.'},403);const session=await personalSession();if(!session)return privateJson({error:'Sign in to continue.'},401);
 let args;try{const raw=await request.text();if(raw.length>1000)throw new Error();args=z.object({version:z.number().int().positive(),requestKey:z.uuid(),id:z.uuid()}).strict().parse({...JSON.parse(raw),id:(await params).id});}catch{return privateJson({error:'The request is invalid.'},400);}
 const result=await session.db.rpc('request_case_work',{p_case:args.id,p_version:args.version,p_key:args.requestKey});return result.error?databaseError(result.error):privateJson(result.data,202);
}
