import {normalizeQuestion} from '../src/core.js';

const SESSION_COOKIE = 'quiz_session';
const SESSION_DAYS = 30;
const PBKDF2_ITERATIONS = 100000; // Workers 的 PBKDF2 上限
const MAX_QUESTIONS = 10000;
const MAX_CHANGES = 20000;
const USERNAME = /^[A-Za-z0-9_.-]{3,32}$/;

const encoder = new TextEncoder();
const toHex = buffer => [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
const fromHex = hex => new Uint8Array(hex.match(/../g).map(h => parseInt(h, 16)));
const randomHex = bytes => toHex(crypto.getRandomValues(new Uint8Array(bytes)));
const sha256 = async text => toHex(await crypto.subtle.digest('SHA-256', encoder.encode(text)));

class HttpError extends Error {
  constructor(status, code, detail) {
    super(code);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers}
});

export async function hashPassword(password, saltHex = randomHex(16)) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations: PBKDF2_ITERATIONS}, key, 256);
  return {hash: toHex(bits), salt: saltHex};
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function readCookie(request, name) {
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return null;
}

function sessionCookie(request, token, maxAge) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

async function readJSON(request) {
  if (!(request.headers.get('Content-Type') || '').includes('application/json')) throw new HttpError(415, 'json_required');
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
}

async function currentUser(request, env) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  return env.DB.prepare(
    'SELECT users.id, users.username FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?'
  ).bind(await sha256(token), Date.now()).first();
}

async function requireUser(request, env) {
  const user = await currentUser(request, env);
  if (!user) throw new HttpError(401, 'unauthorized');
  return user;
}

async function startSession(request, env, user, status = 200) {
  const token = randomHex(32);
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND expires_at <= ?').bind(user.id, now),
    env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(await sha256(token), user.id, now + SESSION_DAYS * 864e5)
  ]);
  return json({user: {username: user.username}}, status, {'Set-Cookie': sessionCookie(request, token, SESSION_DAYS * 86400)});
}

function readCredentials(body) {
  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  return {username, password};
}

async function register(request, env) {
  const {username, password} = readCredentials(await readJSON(request));
  if (!USERNAME.test(username)) throw new HttpError(400, 'invalid_username');
  if (password.length < 8 || password.length > 128) throw new HttpError(400, 'invalid_password');
  const {hash, salt} = await hashPassword(password);
  const user = {id: crypto.randomUUID(), username};
  try {
    await env.DB.prepare('INSERT INTO users (id, username, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(user.id, username, hash, salt, Date.now()).run();
  } catch (error) {
    if (/UNIQUE/i.test(String(error?.message))) throw new HttpError(409, 'username_taken');
    throw error;
  }
  return startSession(request, env, user, 201);
}

async function login(request, env) {
  const {username, password} = readCredentials(await readJSON(request));
  const row = username && password.length <= 128
    ? await env.DB.prepare('SELECT id, username, password_hash, password_salt FROM users WHERE username = ?').bind(username).first()
    : null;
  // 用户不存在时也计算一次哈希，避免通过响应时间判断用户名是否存在。
  const {hash} = await hashPassword(password.slice(0, 128), row?.password_salt);
  if (!row || !timingSafeEqual(hash, row.password_hash)) throw new HttpError(401, 'invalid_credentials');
  return startSession(request, env, row);
}

async function logout(request, env) {
  const token = readCookie(request, SESSION_COOKIE);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  return json({ok: true}, 200, {'Set-Cookie': sessionCookie(request, '', 0)});
}

async function listQuestions(env, user) {
  const {results} = await env.DB.prepare('SELECT id, question, hint, answer, tags, sort FROM questions WHERE user_id = ? ORDER BY sort, id').bind(user.id).all();
  return results.map(row => ({id: row.id, question: row.question, hint: row.hint, answer: row.answer, tags: JSON.parse(row.tags), sort: row.sort}));
}

function validateChange(item, index) {
  if (typeof item?.id !== 'string' || !item.id || item.id.length > 100) throw new HttpError(400, 'invalid_question', {index});
  if (typeof item.sort !== 'number' || !Number.isFinite(item.sort)) throw new HttpError(400, 'invalid_question', {index});
  try {
    return {...normalizeQuestion(item), id: item.id, sort: item.sort};
  } catch (error) {
    throw new HttpError(400, 'invalid_question', {index, message: error.message});
  }
}

// 每条语句的 JSON 参数控制在约 900 KB，低于 D1 单个值 2 MB 的上限。
export function chunkByBytes(items, limit = 900_000) {
  const chunks = [];
  let chunk = [], size = 2;
  for (const item of items) {
    const bytes = encoder.encode(JSON.stringify(item)).length + 1;
    if (chunk.length && size + bytes > limit) {
      chunks.push(chunk);
      chunk = [];
      size = 2;
    }
    chunk.push(item);
    size += bytes;
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}

const UPSERT_SQL = `INSERT INTO questions (user_id, id, question, hint, answer, tags, sort, updated_at)
  SELECT ?1, json_extract(value, '$.id'), json_extract(value, '$.question'), json_extract(value, '$.hint'),
    json_extract(value, '$.answer'), json_extract(value, '$.tags'), json_extract(value, '$.sort'), ?3
  FROM json_each(?2) WHERE true
  ON CONFLICT (user_id, id) DO UPDATE SET question = excluded.question, hint = excluded.hint, answer = excluded.answer,
    tags = excluded.tags, sort = excluded.sort, updated_at = excluded.updated_at`;

// 增量同步：upsert 新增或修改的题目，remove 删除的题目；replace 先清空整个题库。全部在一个事务中完成。
async function syncQuestions(request, env, user) {
  const body = await readJSON(request);
  const upsert = Array.isArray(body?.upsert) ? body.upsert : [];
  const remove = [...new Set(Array.isArray(body?.remove) ? body.remove.filter(id => typeof id === 'string') : [])];
  const replace = body?.replace === true;
  if (upsert.length + remove.length > MAX_CHANGES) throw new HttpError(413, 'too_many_changes');
  const items = [...new Map(upsert.map((item, index) => {
    const q = validateChange(item, index);
    return [q.id, q];
  })).values()];
  const ids = items.map(q => q.id);

  let total = ids.length;
  if (!replace) {
    const stats = await env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM questions WHERE user_id = ?1) AS total,
      (SELECT COUNT(*) FROM questions WHERE user_id = ?1 AND id IN (SELECT value FROM json_each(?2))) AS existing,
      (SELECT COUNT(*) FROM questions WHERE user_id = ?1 AND id IN (SELECT value FROM json_each(?3)) AND id NOT IN (SELECT value FROM json_each(?2))) AS removed`)
      .bind(user.id, JSON.stringify(ids), JSON.stringify(remove)).first();
    total = stats.total - stats.removed + ids.length - stats.existing;
  }
  if (total > MAX_QUESTIONS) throw new HttpError(413, 'too_many_questions');

  const now = Date.now();
  const statements = [];
  if (replace) statements.push(env.DB.prepare('DELETE FROM questions WHERE user_id = ?').bind(user.id));
  else for (const chunk of chunkByBytes(remove)) {
    statements.push(env.DB.prepare('DELETE FROM questions WHERE user_id = ?1 AND id IN (SELECT value FROM json_each(?2))').bind(user.id, JSON.stringify(chunk)));
  }
  const rows = items.map(q => ({id: q.id, question: q.question, hint: q.hint, answer: q.answer, tags: JSON.stringify(q.tags), sort: q.sort}));
  for (const chunk of chunkByBytes(rows)) statements.push(env.DB.prepare(UPSERT_SQL).bind(user.id, JSON.stringify(chunk), now));
  if (statements.length) await env.DB.batch(statements);
  return json({ok: true, total});
}

export async function handleApi(request, env) {
  const {pathname} = new URL(request.url);
  const method = request.method;
  if (method !== 'GET' && method !== 'HEAD') {
    // 拒绝跨站提交；配合 SameSite Cookie 和 JSON 请求体防御 CSRF。
    const origin = request.headers.get('Origin');
    if (origin && origin !== new URL(request.url).origin) throw new HttpError(403, 'forbidden_origin');
  }
  if (pathname === '/api/auth/me' && method === 'GET') {
    const user = await currentUser(request, env);
    return json({user: user ? {username: user.username} : null});
  }
  if (pathname === '/api/auth/register' && method === 'POST') return register(request, env);
  if (pathname === '/api/auth/login' && method === 'POST') return login(request, env);
  if (pathname === '/api/auth/logout' && method === 'POST') return logout(request, env);
  if (pathname === '/api/questions' && method === 'GET') return json({questions: await listQuestions(env, await requireUser(request, env))});
  if (pathname === '/api/questions/sync' && method === 'POST') return syncQuestions(request, env, await requireUser(request, env));
  throw new HttpError(404, 'not_found');
}

export default {
  async fetch(request, env) {
    const {pathname} = new URL(request.url);
    if (!pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      return await handleApi(request, env);
    } catch (error) {
      if (error instanceof HttpError) return json({error: error.code, ...(error.detail ? {detail: error.detail} : {})}, error.status);
      console.error(error);
      return json({error: 'server_error'}, 500);
    }
  }
};
