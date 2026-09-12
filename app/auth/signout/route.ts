import { NextResponse } from 'next/server';
import { databaseClient,trustedOrigin } from '@/lib/session';
import { privateJson } from '@/lib/respond';
export async function POST(request:Request){if(!trustedOrigin(request))return privateJson({error:'Request origin rejected.'},403);const db=await databaseClient();const {error}=await db.auth.signOut();if(error)return privateJson({error:'Could not sign out. Please retry.'},503);return NextResponse.redirect(new URL('/signin',process.env.VERRA_ORIGIN!),303);}
