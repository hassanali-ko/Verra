import { z } from 'zod';
import { personalSession,trustedOrigin } from '@/lib/session';
import { privateJson,databaseError } from '@/lib/respond';
export async function POST(request:Request){
 if(!trustedOrigin(request))return privateJson({error:'Request origin rejected.'},403);const session=await personalSession();if(!session)return privateJson({error:'Sign in to save your needs.'},401);
 let value;try{const raw=await request.text();if(raw.length>32000)throw new Error();value=z.object({display_name:z.string().trim().max(100),needs:z.array(z.string().trim().min(3).max(1000)).max(30)}).strict().parse(JSON.parse(raw));}catch{return privateJson({error:'Use a short name and one need per line.'},400);}
 const result=await session.db.rpc('save_access_profile',{p_name:value.display_name,p_needs:value.needs});return result.error?databaseError(result.error):privateJson({saved:true});
}
