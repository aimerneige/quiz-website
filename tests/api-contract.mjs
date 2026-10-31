// 两种后端（Cloudflare Worker 与 Go 自部署服务器）共用的接口测试。
// backend.client() 返回一个带独立 Cookie 的客户端；同一个 backend 的客户端共享数据库。
import test from 'node:test';
import assert from 'node:assert/strict';

export const q = (id, sort, extra = {}) => ({id, question: `Q ${id}`, hint: '', answer: `A ${id}`, tags: ['t'], sort, ...extra});

export function apiContract(name, setup) {
  let backend;
  test.before(async () => {backend = await setup();});
  test.after(async () => {await backend?.close?.();});
  const register = async (client, username, password = 'password1') => {
    const result = await client.call('/api/auth/register', {method: 'POST', body: {username, password}});
    assert.equal(result.status, 201, JSON.stringify(result.body));
    return result;
  };

  test(`${name}: register, me, logout and login with a session cookie`, async () => {
    const c = backend.client();
    assert.deepEqual((await c.call('/api/auth/me')).body, {user: null});
    const registered = await register(c, 'Alice', 'correct horse');
    assert.match(registered.cookie, /HttpOnly/i);
    assert.match(registered.cookie, /SameSite=Lax/i);
    if (backend.https) assert.match(registered.cookie, /Secure/i);
    assert.deepEqual((await c.call('/api/auth/me')).body, {user: {username: 'Alice'}});
    assert.equal((await c.call('/api/auth/logout', {method: 'POST'})).status, 200);
    assert.deepEqual((await c.call('/api/auth/me')).body, {user: null});
    assert.equal((await c.call('/api/auth/login', {method: 'POST', body: {username: 'alice', password: 'wrong password'}})).body.error, 'invalid_credentials');
    assert.equal((await c.call('/api/auth/login', {method: 'POST', body: {username: 'nobody', password: 'whatever1'}})).body.error, 'invalid_credentials');
    assert.equal((await c.call('/api/auth/login', {method: 'POST', body: {username: 'alice', password: 'correct horse'}})).status, 200);
    assert.deepEqual((await c.call('/api/auth/me')).body, {user: {username: 'Alice'}});
  });

  test(`${name}: registration validates input and rejects duplicate usernames case-insensitively`, async () => {
    const c = backend.client();
    assert.equal((await c.call('/api/auth/register', {method: 'POST', body: {username: 'ab', password: 'password1'}})).body.error, 'invalid_username');
    assert.equal((await c.call('/api/auth/register', {method: 'POST', body: {username: 'bob', password: 'short'}})).body.error, 'invalid_password');
    assert.equal((await c.call('/api/auth/register', {method: 'POST', body: {username: 42, password: 'password1'}})).body.error, 'invalid_username');
    await register(c, 'bob');
    const duplicate = await c.call('/api/auth/register', {method: 'POST', body: {username: 'BOB', password: 'password1'}});
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.error, 'username_taken');
  });

  test(`${name}: question routes require a session and reject cross-site or non-JSON writes`, async () => {
    const c = backend.client();
    assert.equal((await c.call('/api/questions')).status, 401);
    await register(c, 'carol');
    assert.equal((await c.call('/api/questions/sync', {method: 'POST', body: {upsert: []}, headers: {Origin: 'https://evil.example'}})).body.error, 'forbidden_origin');
    assert.equal((await c.call('/api/questions/sync', {method: 'POST', body: {upsert: []}, headers: {'Content-Type': 'text/plain'}})).status, 415);
    assert.equal((await c.call('/api/questions/sync', {method: 'POST', raw: '{oops', headers: {'Content-Type': 'application/json'}})).body.error, 'invalid_json');
    assert.equal((await c.call('/api/nope')).status, 404);
  });

  test(`${name}: sync saves, orders, updates, deletes and replaces questions per user`, async () => {
    const alice = backend.client();
    await register(alice, 'dora');
    const sync = body => alice.call('/api/questions/sync', {method: 'POST', body});
    const list = async () => (await alice.call('/api/questions')).body.questions;

    assert.equal((await sync({upsert: [q('b', 2), q('a', 1, {hint: '提示', tags: ['科学', '常识']})]})).status, 200);
    let questions = await list();
    assert.deepEqual(questions.map(item => item.id), ['a', 'b']);
    assert.deepEqual(questions[0], {id: 'a', question: 'Q a', hint: '提示', answer: 'A a', tags: ['科学', '常识'], sort: 1});

    await sync({upsert: [q('a', 1, {question: '  edited  ', tags: '科学, 科学 |新'}), q('c', 0.5)], remove: ['b']});
    questions = await list();
    assert.deepEqual(questions.map(item => [item.id, item.question, item.tags]), [['c', 'Q c', ['t']], ['a', 'edited', ['科学', '新']]]);

    await sync({replace: true, upsert: [q('z', 1)]});
    assert.deepEqual((await list()).map(item => item.id), ['z']);

    for (const bad of [{id: 'x', question: '', sort: 1}, {id: '', question: 'Q', sort: 1}, {id: 'x', question: 'Q'}, {id: 'x', question: 'Q', sort: 1, tags: Array.from({length: 21}, (_, i) => `t${i}`)}]) {
      const invalid = await sync({upsert: [bad]});
      assert.equal(invalid.status, 400, JSON.stringify(bad));
      assert.equal(invalid.body.error, 'invalid_question');
    }
    assert.deepEqual((await list()).map(item => item.id), ['z']);

    // 其他用户看不到、也无法修改这些题目。
    const bob = backend.client();
    await register(bob, 'erin');
    assert.deepEqual((await bob.call('/api/questions')).body.questions, []);
    await bob.call('/api/questions/sync', {method: 'POST', body: {upsert: [q('z', 1, {question: 'erin'})], remove: []}});
    assert.equal((await list())[0].question, 'Q z');
  });

  test(`${name}: sync handles a full 10,000 question import and enforces the bank limit`, async () => {
    const c = backend.client();
    await register(c, 'frank');
    const call = body => c.call('/api/questions/sync', {method: 'POST', body});
    const many = Array.from({length: 10000}, (_, i) => q(`id-${i}`, i + 1, {answer: '答'.repeat(100)}));
    assert.equal((await call({replace: true, upsert: many})).status, 200);
    assert.equal((await c.call('/api/questions')).body.questions.length, 10000);
    assert.equal((await call({upsert: [q('one-more', 20000)]})).body.error, 'too_many_questions');
    assert.equal((await c.call('/api/questions')).body.questions.length, 10000);
    assert.equal((await call({upsert: [q('one-more', 20000)], remove: ['id-0']})).status, 200);
    assert.equal((await call({upsert: [q('id-5', 6, {question: 'edit at limit'})]})).status, 200);
  });
}

// 通过 HTTP 访问后端并像浏览器一样保存 Cookie、发送 Origin。
export function httpClient(base, fetcher = fetch) {
  return () => {
    let cookie = '';
    const origin = new URL(base).origin;
    return {
      async call(path, {method = 'GET', body, raw, headers = {}} = {}) {
        const response = await fetcher(new Request(base + path, {
          method,
          headers: {...(body ? {'Content-Type': 'application/json'} : {}), ...(cookie ? {Cookie: cookie} : {}), Origin: origin, ...headers},
          body: raw ?? (body ? JSON.stringify(body) : undefined)
        }));
        const set = response.headers.get('Set-Cookie');
        if (set) cookie = set.split(';')[0];
        return {status: response.status, body: await response.json().catch(() => null), cookie: set};
      }
    };
  };
}
