// Loopback-only test transport. Never deploy or use this for real accounts.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { database,people,rpc,rpcDefinitions } from './database';

await mkdir('.local-data',{recursive:true});
const db=await database('.local-data/preview');
const origin='http://127.0.0.1:3120';
const expiry=Math.floor(Date.now()/1000)+86400;
const users=people.map((id,index)=>({id,aud:'authenticated',role:'authenticated',email:`local-person-${index+1}@example.test`,email_confirmed_at:new Date().toISOString(),app_metadata:{provider:'email',providers:['email']},user_metadata:{},created_at:new Date().toISOString()}));
const tokens=users.map(user=>[Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({sub:user.id,aud:'authenticated',role:'authenticated',exp:expiry,iat:expiry-86400})).toString('base64url'),'local-test-signature'].join('.'));
const server=createServer(async(req,res)=>{
 res.setHeader('Cache-Control','private, no-store');
 const url=new URL(req.url||'/', 'http://127.0.0.1:3121');
 const reply=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
 const index=tokens.indexOf((req.headers.authorization||'').replace('Bearer ',''));
 try{
  if(url.pathname==='/'){
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>Verra local preview</title><body style="background:#F4EDE1;color:#1F2E35;font:18px/1.7 system-ui;max-width:640px;margin:70px auto;padding:25px"><h1>Verra local preview</h1><p>These synthetic accounts use a database on this computer. This test service does not send email or run an agent. It is separate from the real product sign-in service.</p><p><a href="/enter/0">Open local account 1</a></p><p><a href="/enter/1">Open local account 2</a></p><p><a href="${origin}">View the public product page</a></p></body></html>`);return;
  }
  if(req.method==='GET'&&/^\/enter\/[01]$/.test(url.pathname)){
   const i=Number(url.pathname.at(-1));const session={access_token:tokens[i],refresh_token:`local-refresh-${i}`,token_type:'bearer',expires_in:86400,expires_at:expiry,user:users[i]};
   const cookie='base64-'+Buffer.from(JSON.stringify(session)).toString('base64url');
   res.writeHead(303,{'Set-Cookie':`sb-127-auth-token=${cookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`,Location:origin+'/visits'});res.end();return;
  }
  if(url.pathname==='/auth/v1/user'){reply(index<0?401:200,index<0?{message:'No local test session'}:users[index]);return;}
  if(url.pathname==='/auth/v1/logout'){res.writeHead(204);res.end();return;}
  if(url.pathname.startsWith('/auth/')){reply(503,{message:'Email login is not connected in this local test service.'});return;}
  if(req.method!=='POST'||!url.pathname.startsWith('/rest/v1/rpc/')){reply(404,{message:'Unsupported local route'});return;}
  if(index<0){reply(401,{code:'42501',message:'Sign in required'});return;}
  const name=url.pathname.split('/').at(-1)!;
  if(!Object.hasOwn(rpcDefinitions,name)){reply(404,{message:'Unknown function'});return;}
  let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>45000){reply(413,{message:'Request too large'});return;}}
  const input=JSON.parse(raw||'{}');
  const result=await rpc(db,users[index].id,name as keyof typeof rpcDefinitions,input);
  reply(200,result??null);
 }catch(error){const e=error as {code?:string};reply(400,{code:e.code||'22023',message:'Local database rejected the request'});}
});
await new Promise<void>(resolve=>server.listen(3121,'127.0.0.1',resolve));
const app=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3120'],{stdio:'inherit',env:{...process.env,SUPABASE_PRODUCT_URL:'http://127.0.0.1:3121',SUPABASE_PRODUCT_KEY:'local-preview-publishable-key',VERRA_ORIGIN:origin}});
console.log('Local product account launcher: http://127.0.0.1:3121');
let closing=false;
async function close(){if(closing)return;closing=true;app.kill('SIGTERM');server.close();await db.close();}
process.on('SIGINT',()=>void close());process.on('SIGTERM',()=>void close());app.on('exit',()=>void close());
