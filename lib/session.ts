import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
export const ready=()=>Boolean(process.env.SUPABASE_PRODUCT_URL&&process.env.SUPABASE_PRODUCT_KEY&&process.env.VERRA_ORIGIN);
export async function databaseClient(){
 if(!ready())throw new Error('Product connection is not configured');
 const store=await cookies();
 return createServerClient(process.env.SUPABASE_PRODUCT_URL!,process.env.SUPABASE_PRODUCT_KEY!,{cookies:{getAll:()=>store.getAll(),setAll(values){try{for(const item of values)store.set(item.name,item.value,item.options);}catch{/* Cookie refresh is handled before page rendering. */}}}});
}
export async function personalSession(){if(!ready())return null;const db=await databaseClient();const {data,error}=await db.auth.getUser();return error||!data.user?null:{db,user:data.user};}
export const trustedOrigin=(request:Request)=>Boolean(process.env.VERRA_ORIGIN&&request.headers.get('origin')===new URL(process.env.VERRA_ORIGIN).origin);
