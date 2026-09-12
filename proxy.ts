import { createServerClient } from '@supabase/ssr';
import { NextResponse,type NextRequest } from 'next/server';
export async function proxy(request:NextRequest){
 let response=NextResponse.next({request});
 if(!process.env.SUPABASE_PRODUCT_URL||!process.env.SUPABASE_PRODUCT_KEY)return response;
 const client=createServerClient(process.env.SUPABASE_PRODUCT_URL,process.env.SUPABASE_PRODUCT_KEY,{cookies:{getAll:()=>request.cookies.getAll(),setAll(changes){for(const change of changes)request.cookies.set(change.name,change.value);response=NextResponse.next({request});for(const change of changes)response.cookies.set(change.name,change.value,change.options);}}});
 await client.auth.getUser();response.headers.set('Cache-Control','private, no-store');return response;
}
export const config={matcher:['/visits/:path*','/api/:path*','/auth/:path*','/signin']};
