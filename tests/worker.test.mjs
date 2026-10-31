import test from 'node:test';
import assert from 'node:assert/strict';
import worker, {chunkByBytes} from '../worker/index.js';
import {createD1} from './d1-mock.mjs';

const ORIGIN = 'https://quiz.example';

function client() {
  const env = {DB: createD1(), ASSETS: {fetch: async () => new Response('asset')}};
  let cookie = '';
  const call = async (path, {method = 'GET', body, headers = {}} = {}) => {
    const request = new Request(ORIGIN + path, {
      method,
      headers: {...(body ? {'Content-Type': 'application/json'} : {}), ...(cookie ? {Cookie: cookie} : {}), Origin: ORIGIN, ...headers},
      body: body ? JSON.stringify(body) : undefined
    });
    const response = await worker.fetch(request, env);
    const set = response.headers.get('Set-Cookie');
    if (set) cookie = set.split(';')[0];
    return {status: response.status, body: await response.json().catch(() => null), cookie: set};
  };
  return {env, call, setCookie: value => {cookie = value;}};
}

const q = (id, sort, extra = {}) => ({id, question: `Q ${id}`, hint: '', answer: `A ${id}`, tags: ['t'], sort, ...extra});

test('register, me, logout and login flow with a secure session cookie', async () => {
  const {call, env} = client();
  assert.deepEqual((await call('/api/auth/me')).body, {user: null});
  const registered = await call('/api/auth/register', {method: 'POST', body: {username: 'Alice', password: 'correct horse'}});
  assert.equal(registered.status, 201);
  assert.match(registered.cookie, /HttpOnly/);
  assert.match(registered.cookie, /Secure/);
  assert.match(registered.cookie, /SameSite=Lax/);
  assert.deepEqual((await call('/api/auth/me')).body, {user: {username: 'Alice'}});
  const stored = env.DB.raw.prepare('SELECT password_hash FROM users').get();
  assert.notEqual(stored.password_hash, 'correct horse');

  assert.equal((await call('/api/auth/logout', {method: 'POST'})).status, 200);
  assert.deepEqual((await call('/api/auth/me')).body, {user: null});
  assert.equal((await call('/api/auth/login', {method: 'POST', body: {username: 'alice', password: 'wrong password'}})).body.error, 'invalid_credentials');
  assert.equal((await call('/api/auth/login', {method: 'POST', body: {username: 'nobody', password: 'whatever1'}})).body.error, 'invalid_credentials');
  assert.equal((await call('/api/auth/login', {method: 'POST', body: {username: 'alice', password: 'correct horse'}})).status, 200);
  assert.deepEqual((await call('/api/auth/me')).body, {user: {username: 'Alice'}});
});

test('registration validates input and rejects duplicate usernames case-insensitively', async () => {
  const {call} = client();
  assert.equal((await call('/api/auth/register', {method: 'POST', body: {username: 'ab', password: 'password1'}})).body.error, 'invalid_username');
  assert.equal((await call('/api/auth/register', {method: 'POST', body: {username: 'bob', password: 'short'}})).body.error, 'invalid_password');
  assert.equal((await call('/api/auth/register', {method: 'POST', body: {username: 'bob', password: 'password1'}})).status, 201);
  const duplicate = await call('/api/auth/register', {method: 'POST', body: {username: 'BOB', password: 'password1'}});
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error, 'username_taken');
});

test('question routes require a session and reject cross-site or non-JSON writes', async () => {
  const {call} = client();
  assert.equal((await call('/api/questions')).status, 401);
  await call('/api/auth/register', {method: 'POST', body: {username: 'carol', password: 'password1'}});
  assert.equal((await call('/api/questions/sync', {method: 'POST', body: {upsert: []}, headers: {Origin: 'https://evil.example'}})).status, 403);
  assert.equal((await call('/api/questions/sync', {method: 'POST', body: {upsert: []}, headers: {'Content-Type': 'text/plain'}})).status, 415);
  assert.equal((await call('/api/nope')).status, 404);
  assert.equal(await (await worker.fetch(new Request(ORIGIN + '/index.html'), {ASSETS: {fetch: async () => new Response('asset')}})).text(), 'asset');
});

test('sync saves, orders, updates, deletes and replaces questions per user', async () => {
  const alice = client();
  await alice.call('/api/auth/register', {method: 'POST', body: {username: 'alice', password: 'password1'}});
  const sync = body => alice.call('/api/questions/sync', {method: 'POST', body});
  const list = async () => (await alice.call('/api/questions')).body.questions;

  assert.equal((await sync({upsert: [q('b', 2), q('a', 1, {hint: '提示', tags: ['科学', '常识']})]})).status, 200);
  let questions = await list();
  assert.deepEqual(questions.map(item => item.id), ['a', 'b']);
  assert.deepEqual(questions[0], {id: 'a', question: 'Q a', hint: '提示', answer: 'A a', tags: ['科学', '常识'], sort: 1});

  await sync({upsert: [q('a', 1, {question: 'edited'}), q('c', 0.5)], remove: ['b']});
  questions = await list();
  assert.deepEqual(questions.map(item => [item.id, item.question]), [['c', 'Q c'], ['a', 'edited']]);

  await sync({replace: true, upsert: [q('z', 1)]});
  assert.deepEqual((await list()).map(item => item.id), ['z']);

  const invalid = await sync({upsert: [{id: 'x', question: '', sort: 1}]});
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error, 'invalid_question');
  assert.deepEqual((await list()).map(item => item.id), ['z']);

  // 其他用户看不到、也无法修改这些题目。
  const bob = client();
  bob.env.DB = alice.env.DB;
  await bob.call('/api/auth/register', {method: 'POST', body: {username: 'bob', password: 'password1'}});
  assert.deepEqual((await bob.call('/api/questions')).body.questions, []);
  await bob.call('/api/questions/sync', {method: 'POST', body: {upsert: [q('z', 1, {question: 'bob'})], remove: []}});
  assert.equal((await list())[0].question, 'Q z');
});

test('sync handles a full 10,000 question import and enforces the bank limit', async () => {
  const {call} = client();
  await call('/api/auth/register', {method: 'POST', body: {username: 'dave', password: 'password1'}});
  const many = Array.from({length: 10000}, (_, i) => q(`id-${i}`, i + 1, {answer: '答'.repeat(100)}));
  assert.equal((await call('/api/questions/sync', {method: 'POST', body: {replace: true, upsert: many}})).status, 200);
  assert.equal((await call('/api/questions')).body.questions.length, 10000);
  assert.equal((await call('/api/questions/sync', {method: 'POST', body: {upsert: [q('one-more', 20000)]}})).body.error, 'too_many_questions');
  assert.equal((await call('/api/questions/sync', {method: 'POST', body: {upsert: [q('one-more', 20000)], remove: ['id-0']}})).status, 200);
  assert.equal((await call('/api/questions/sync', {method: 'POST', body: {upsert: [q('id-5', 6, {question: 'edit at limit'})]}})).status, 200);
});

test('chunkByBytes splits large payloads without dropping items', () => {
  const items = Array.from({length: 50}, (_, i) => ({i, text: 'x'.repeat(1000)}));
  const chunks = chunkByBytes(items, 10_000);
  assert.ok(chunks.length > 1);
  assert.deepEqual(chunks.flat(), items);
});
