import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;
const root = resolve(fileURLToPath(new URL('./public/', import.meta.url)));
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};
const pool = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
}) : null;
const oauthStates = new Map();
const cookieName = 'cyberlab_admin';

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
function sign(value) {
  return createHmac('sha256', process.env.SESSION_SECRET).update(value).digest('base64url');
}
function makeSession(email) {
  const payload = Buffer.from(JSON.stringify({ email, exp: Date.now() + 8 * 60 * 60 * 1000 })).toString('base64url');
  return payload + '.' + sign(payload);
}
function getSession(req) {
  const raw = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(cookieName + '='));
  if (!raw || !process.env.SESSION_SECRET) return null;
  const token = decodeURIComponent(raw.slice(cookieName.length + 1));
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const supplied = Buffer.from(signature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.exp > Date.now() ? data : null;
  } catch { return null; }
}
function setCookie(res, name, value, maxAge) {
  res.setHeader('Set-Cookie', `${name}=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`);
}
async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10000) throw new Error('Request too large');
  }
  return raw ? JSON.parse(raw) : {};
}
function requireConfig() {
  return Boolean(pool && process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REDIRECT_URI && process.env.ADMIN_EMAIL && process.env.SESSION_SECRET && process.env.PUBLIC_BASE_URL);
}
async function initDatabase() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tracking_links (
      id TEXT PRIMARY KEY,
      destination TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS visitor_events (
      id BIGSERIAL PRIMARY KEY,
      link_id TEXT NOT NULL REFERENCES tracking_links(id) ON DELETE CASCADE,
      visited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      email TEXT,
      email_shared BOOLEAN NOT NULL DEFAULT FALSE,
      user_agent TEXT,
      ip_hash TEXT
    );
  `);
}
function getIpHash(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  return createHmac('sha256', process.env.SESSION_SECRET).update(ip).digest('hex');
}
async function recordVisit(req, linkId, email = null) {
  await pool.query(
    'INSERT INTO visitor_events (link_id, email, email_shared, user_agent, ip_hash) VALUES ($1,$2,$3,$4,$5)',
    [linkId, email, Boolean(email), String(req.headers['user-agent'] || '').slice(0, 500), getIpHash(req)]
  );
}
async function getLink(id) {
  const result = await pool.query('SELECT id, destination FROM tracking_links WHERE id=$1', [id]);
  return result.rows[0] || null;
}
function redirect(res, url) {
  res.writeHead(302, { Location: url, 'Cache-Control': 'no-store' });
  res.end();
}
export function createAppServer() {
  return createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    const url = new URL(request.url, 'http://localhost');
    const pathname = url.pathname;

    try {
      if (pathname.startsWith('/api/') || pathname.startsWith('/auth/') || pathname.startsWith('/go/')) {
        if (pathname === '/auth/google/start' && request.method === 'GET') {
          if (!requireConfig()) return sendJson(response, 503, { error: 'Visitor analytics is not configured yet.' });
          const linkId = url.searchParams.get('link');
          const link = await getLink(linkId);
          if (!link) return sendJson(response, 404, { error: 'Tracking link not found.' });
          const state = randomBytes(24).toString('base64url');
          oauthStates.set(state, { linkId, expires: Date.now() + 10 * 60 * 1000 });
          const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
          auth.search = new URLSearchParams({
            client_id: process.env.GOOGLE_CLIENT_ID,
            redirect_uri: process.env.GOOGLE_REDIRECT_URI,
            response_type: 'code',
            scope: 'openid email',
            include_granted_scopes: 'true',
            state,
            prompt: 'consent select_account',
          }).toString();
          return redirect(response, auth.toString());
        }
        if (pathname === '/auth/google/callback' && request.method === 'GET') {
          if (!requireConfig()) return sendJson(response, 503, { error: 'Visitor analytics is not configured yet.' });
          const state = url.searchParams.get('state');
          const pending = oauthStates.get(state);
          oauthStates.delete(state);
          if (!pending || pending.expires < Date.now() || url.searchParams.get('error')) {
            return sendJson(response, 400, { error: 'Google sign-in was cancelled or expired. No email was collected.' });
          }
          const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              code: url.searchParams.get('code') || '',
              client_id: process.env.GOOGLE_CLIENT_ID,
              client_secret: process.env.GOOGLE_CLIENT_SECRET,
              redirect_uri: process.env.GOOGLE_REDIRECT_URI,
              grant_type: 'authorization_code',
            }),
          });
          if (!tokenResponse.ok) return sendJson(response, 502, { error: 'Google sign-in could not be completed.' });
          const tokens = await tokenResponse.json();
          const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
            headers: { Authorization: `Bearer ${tokens.access_token}` },
          });
          if (!profileResponse.ok) return sendJson(response, 502, { error: 'Google did not return an email address.' });
          const profile = await profileResponse.json();
          if (!profile.email || !profile.email_verified) return sendJson(response, 403, { error: 'Google did not verify this email address.' });
          if (pending.admin) {
            if (profile.email.toLowerCase() !== process.env.ADMIN_EMAIL.toLowerCase()) {
              return sendJson(response, 403, { error: 'This Google account is not the configured administrator.' });
            }
            setCookie(response, cookieName, makeSession(profile.email), 8 * 60 * 60);
            return redirect(response, '/visitor-admin.html');
          }
          await recordVisit(request, pending.linkId, profile.email);
          const link = await getLink(pending.linkId);
          return redirect(response, link.destination);
        }
        if (pathname.startsWith('/go/') && request.method === 'GET') {
          const linkId = pathname.slice(4);
          const link = await getLink(linkId);
          if (!link) return sendJson(response, 404, { error: 'Tracking link not found.' });
          if (url.searchParams.get('skip') === '1') {
            await recordVisit(request, linkId);
            return redirect(response, link.destination);
          }
          return redirect(response, `/consent.html?link=${encodeURIComponent(linkId)}`);
        }
        if (pathname === '/api/admin/me' && request.method === 'GET') {
          const session = getSession(request);
          return sendJson(response, 200, { authenticated: Boolean(session), email: session?.email || null });
        }
        if (pathname === '/auth/admin/start' && request.method === 'GET') {
          if (!requireConfig()) return sendJson(response, 503, { error: 'Visitor analytics is not configured yet.' });
          const state = randomBytes(24).toString('base64url');
          oauthStates.set(state, { admin: true, expires: Date.now() + 10 * 60 * 1000 });
          const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
          auth.search = new URLSearchParams({
            client_id: process.env.GOOGLE_CLIENT_ID,
            redirect_uri: process.env.GOOGLE_REDIRECT_URI,
            response_type: 'code',
            scope: 'openid email',
            state,
            prompt: 'select_account',
          }).toString();
          return redirect(response, auth.toString());
        }
        if (pathname === '/api/admin/links' && request.method === 'POST') {
          const session = getSession(request);
          if (!session || session.email.toLowerCase() !== process.env.ADMIN_EMAIL?.toLowerCase()) return sendJson(response, 401, { error: 'Administrator sign-in required.' });
          const body = await readBody(request);
          let destination;
          try {
            destination = new URL(body.destination);
            if (!['http:', 'https:'].includes(destination.protocol)) throw new Error('Invalid protocol');
          } catch { return sendJson(response, 400, { error: 'Enter a valid http or https destination URL.' }); }
          const id = randomBytes(9).toString('base64url');
          await pool.query('INSERT INTO tracking_links (id,destination) VALUES ($1,$2)', [id, destination.toString()]);
          return sendJson(response, 201, { id, url: `${process.env.PUBLIC_BASE_URL}/go/${id}` });
        }
        if (pathname === '/api/admin/visitors' && request.method === 'GET') {
          const session = getSession(request);
          if (!session || session.email.toLowerCase() !== process.env.ADMIN_EMAIL?.toLowerCase()) return sendJson(response, 401, { error: 'Administrator sign-in required.' });
          const result = await pool.query(`
            SELECT e.id, e.visited_at, e.email, e.email_shared, e.user_agent, l.id AS link_id, l.destination
            FROM visitor_events e JOIN tracking_links l ON l.id=e.link_id
            ORDER BY e.visited_at DESC LIMIT 500
          `);
          return sendJson(response, 200, { visitors: result.rows });
        }
        if (pathname === '/auth/google/callback' && request.method === 'GET') return sendJson(response, 400, { error: 'Invalid callback.' });
        return sendJson(response, 404, { error: 'Not found.' });
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { Allow: 'GET, HEAD' }); response.end('Method Not Allowed'); return;
      }
      let filePath = resolve(root, `.${decodeURIComponent(pathname === '/' ? '/index.html' : pathname)}`);
      if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) { response.writeHead(404); response.end('Not Found'); return; }
      const file = await stat(filePath);
      if (!file.isFile()) throw new Error('Not a file');
      response.writeHead(200, {
        'Content-Type': mimeTypes[extname(filePath)] ?? 'application/octet-stream',
        'Content-Length': file.size,
        'Cache-Control': 'no-cache',
      });
      if (request.method === 'HEAD') response.end();
      else createReadStream(filePath).pipe(response);
    } catch (error) {
      console.error('Request failed:', error.message);
      sendJson(response, 500, { error: 'The request could not be completed.' });
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  const server = createAppServer();
  initDatabase().then(() => server.listen(port, '0.0.0.0', () => {
    console.log(`Cybersecurity Lab listening on port ${port}`);
  })).catch((error) => {
    console.error('Database initialization failed:', error.message);
    process.exit(1);
  });
}
