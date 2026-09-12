import { redirect } from 'next/navigation';
import { personalSession } from '@/lib/session';
import { VisitWorkspace } from '@/components/visits';
export const dynamic='force-dynamic';
export default async function Visits(){const session=await personalSession();if(!session)redirect('/signin');const {data,error}=await session.db.rpc('arrangement_snapshot');if(error)throw new Error('Visits unavailable');return <VisitWorkspace initial={data}/>;}
