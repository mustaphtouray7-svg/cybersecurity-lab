import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;
const root = resolve(fileURLToPath(new URL('./public/', import.meta.url)));
const mimeTypes = { '.css':'text/css; charset=utf-8', '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml' };
const pool = process.env.DATABASE_URL ? new Pool({ connectionString:process.env.DATABASE_URL, ssl:process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized:false } }) : null;
const cookieName='cyberlab_admin';

function sendJson(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
function sign(value){return createHmac('sha256',process.env.SESSION_SECRET).update(value).digest('base64url');}
function makeSession(){const payload=Buffer.from(JSON.stringify({admin:true,exp:Date.now()+8*60*60*1000})).toString('base64url');return payload+'.'+sign(payload);}
function getSession(req){
 const raw=(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(cookieName+'='));
 if(!raw||!process.env.SESSION_SECRET)return false;
 try{const token=decodeURIComponent(raw.slice(cookieName.length+1));const [payload,sig]=token.split('.');if(!payload||!sig)return false;const a=Buffer.from(sign(payload)),b=Buffer.from(sig);if(a.length!==b.length||!timingSafeEqual(a,b))return false;const data=JSON.parse(Buffer.from(payload,'base64url').toString());return data.admin&&data.exp>Date.now();}catch{return false;}
}
function setCookie(res,name,value,maxAge){res.setHeader('Set-Cookie',`${name}=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`);}
async function readBody(req){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>10000)throw new Error('Request too large');}return raw?JSON.parse(raw):{};}
function configured(){return Boolean(pool&&process.env.SESSION_SECRET&&process.env.ADMIN_PASSWORD&&process.env.PUBLIC_BASE_URL);}
async function initDatabase(){
 if(!pool)return;
 await pool.query(`
 CREATE TABLE IF NOT EXISTS tracking_links(id TEXT PRIMARY KEY,destination TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE TABLE IF NOT EXISTS visitor_events(id BIGSERIAL PRIMARY KEY,link_id TEXT NOT NULL REFERENCES tracking_links(id) ON DELETE CASCADE,visited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),email TEXT,email_shared BOOLEAN NOT NULL DEFAULT FALSE,user_agent TEXT,ip_hash TEXT,consent_token TEXT UNIQUE);
 ALTER TABLE visitor_events ADD COLUMN IF NOT EXISTS consent_token TEXT;
 ALTER TABLE visitor_events ADD COLUMN IF NOT EXISTS referrer TEXT;
 ALTER TABLE visitor_events ADD COLUMN IF NOT EXISTS browser_info TEXT;
 ALTER TABLE visitor_events ADD COLUMN IF NOT EXISTS os_info TEXT;
 ALTER TABLE visitor_events ADD COLUMN IF NOT EXISTS device_type TEXT;
 ALTER TABLE visitor_events ADD COLUMN IF NOT EXISTS language TEXT;
 ALTER TABLE visitor_events ADD COLUMN IF NOT EXISTS timezone TEXT;
 ALTER TABLE visitor_events ADD COLUMN IF NOT EXISTS screen_size TEXT;
 ALTER TABLE visitor_events ADD COLUMN IF NOT EXISTS viewport_size TEXT;
 ALTER TABLE visitor_events ADD COLUMN IF NOT EXISTS platform_info TEXT;
 `);
}
function ipHash(req){const ip=String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim();return createHmac('sha256',process.env.SESSION_SECRET||'temporary').update(ip).digest('hex');}
async function recordVisit(req,linkId){
 const token=randomBytes(24).toString('base64url');
 await pool.query('INSERT INTO visitor_events(link_id,user_agent,ip_hash,consent_token,referrer) VALUES($1,$2,$3,$4,$5)',[linkId,String(req.headers['user-agent']||'').slice(0,500),ipHash(req),token,String(req.headers.referer||'').slice(0,1000)||null]);
 return token;
}
async function visitDestination(token){const r=await pool.query('SELECT l.destination FROM visitor_events e JOIN tracking_links l ON l.id=e.link_id WHERE e.consent_token=$1',[token]);return r.rows[0]?.destination||null;}
function redirect(res,url){res.writeHead(302,{Location:url,'Cache-Control':'no-store'});res.end();}
function safeEqual(a,b){const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&timingSafeEqual(x,y);}
export function createAppServer(){
 return createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  const url=new URL(req.url,'http://localhost'),path=url.pathname;
  try{
   if(path.startsWith('/api/')||path.startsWith('/go/')){
    if(path.startsWith('/go/')&&req.method==='GET'){
     if(!pool)return sendJson(res,503,{error:'Visitor database is not configured.'});
     const linkId=path.slice(4);const link=await pool.query('SELECT id FROM tracking_links WHERE id=$1',[linkId]);if(!link.rows[0])return sendJson(res,404,{error:'Tracking link not found.'});
     const token=await recordVisit(req,linkId);return redirect(res,`/consent.html?token=${encodeURIComponent(token)}`);
    }
    if(path==='/api/visitor/metadata'&&req.method==='POST'){
     const body=await readBody(req);const token=String(body.token||'');
     const clean=(value,max=100)=>typeof value==='string'?value.trim().slice(0,max)||null:null;
     const result=await pool.query(`UPDATE visitor_events SET browser_info=$1,os_info=$2,device_type=$3,language=$4,timezone=$5,screen_size=$6,viewport_size=$7,platform_info=$8 WHERE consent_token=$9 RETURNING id`,[
      clean(body.browser),clean(body.os),clean(body.device),clean(body.language),clean(body.timezone),clean(body.screen),clean(body.viewport),clean(body.platform),token
     ]);
     if(!result.rows[0])return sendJson(res,404,{error:'Visit not found.'});
     return sendJson(res,200,{ok:true});
    }
    if(path==='/api/visitor/share'&&req.method==='POST'){
     const body=await readBody(req);const email=String(body.email||'').trim().toLowerCase();const token=String(body.token||'');
     if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return sendJson(res,400,{error:'Enter a valid email address.'});
     const result=await pool.query('UPDATE visitor_events SET email=$1,email_shared=TRUE WHERE consent_token=$2 RETURNING id',[email,token]);
     if(!result.rows[0])return sendJson(res,404,{error:'This visit link has expired or is invalid.'});
     const destination=await visitDestination(token);return sendJson(res,200,{destination});
    }
    if(path==='/api/visitor/continue'&&req.method==='GET'){
     const token=url.searchParams.get('token')||'';const destination=await visitDestination(token);if(!destination)return sendJson(res,404,{error:'Visit not found.'});return redirect(res,destination);
    }
    if(path==='/api/admin/login'&&req.method==='POST'){
     if(!configured())return sendJson(res,503,{error:'Admin or database configuration is missing.'});
     const body=await readBody(req);if(!safeEqual(body.password||'',process.env.ADMIN_PASSWORD))return sendJson(res,401,{error:'Incorrect admin password.'});
     setCookie(res,cookieName,makeSession(),8*60*60);return sendJson(res,200,{authenticated:true});
    }
    if(path==='/api/admin/logout'&&req.method==='POST'){setCookie(res,cookieName,'',0);return sendJson(res,200,{ok:true});}
    if(path==='/api/admin/me'&&req.method==='GET')return sendJson(res,200,{authenticated:getSession(req)});
    if(path.startsWith('/api/admin/')){
     if(!getSession(req))return sendJson(res,401,{error:'Administrator password required.'});
     if(path==='/api/admin/links'&&req.method==='POST'){
      const body=await readBody(req);let destination;
      try{destination=new URL(body.destination);if(!['http:','https:'].includes(destination.protocol))throw new Error();}catch{return sendJson(res,400,{error:'Enter a valid http or https destination URL.'});}
      const id=randomBytes(9).toString('base64url');await pool.query('INSERT INTO tracking_links(id,destination) VALUES($1,$2)',[id,destination.toString()]);
      return sendJson(res,201,{id,url:`${process.env.PUBLIC_BASE_URL}/go/${id}`});
     }
     if(path==='/api/admin/visitors'&&req.method==='GET'){
      const result=await pool.query('SELECT e.id,e.visited_at,e.email,e.email_shared,e.user_agent,e.referrer,e.browser_info,e.os_info,e.device_type,e.language,e.timezone,e.screen_size,e.viewport_size,e.platform_info,l.id AS link_id,l.destination FROM visitor_events e JOIN tracking_links l ON l.id=e.link_id ORDER BY e.visited_at DESC LIMIT 500');
      return sendJson(res,200,{visitors:result.rows});
     }
     return sendJson(res,404,{error:'Not found.'});
    }
    return sendJson(res,404,{error:'Not found.'});
   }
   if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405,{Allow:'GET, HEAD'});return res.end('Method Not Allowed');}
   const filePath=resolve(root,`.${decodeURIComponent(path==='/'?'/index.html':path)}`);if(filePath!==root&&!filePath.startsWith(`${root}${sep}`)){res.writeHead(404);return res.end('Not Found');}
   const file=await stat(filePath);if(!file.isFile())throw new Error('Not a file');
   res.writeHead(200,{'Content-Type':mimeTypes[extname(filePath)]??'application/octet-stream','Content-Length':file.size,'Cache-Control':'no-cache'});
   if(req.method==='HEAD')res.end();else createReadStream(filePath).pipe(res);
  }catch(error){console.error('Request failed:',error.message);sendJson(res,500,{error:'The request could not be completed.'});}
 });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const port=Number(process.env.PORT)||3000;const server=createAppServer();
 initDatabase().then(()=>server.listen(port,'0.0.0.0',()=>console.log(`Cybersecurity Lab listening on port ${port}`))).catch(error=>{console.error('Database initialization failed:',error.message);process.exit(1);});
}
