import { personalSession } from '@/lib/session';
import { privateJson,databaseError } from '@/lib/respond';
export async function GET(){const session=await personalSession();if(!session)return privateJson({error:'Sign in to see your visits.'},401);const result=await session.db.rpc('arrangement_snapshot');return result.error?databaseError(result.error):privateJson(result.data);}
