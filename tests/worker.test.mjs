import test from 'node:test';
import assert from 'node:assert/strict';
import worker, {chunkByBytes} from '../cloudflare/worker.js';
import {createD1} from './d1-mock.mjs';
import {apiContract, httpClient} from './api-contract.mjs';

function workerBackend() {
  const env = {DB: createD1(), ASSETS: {fetch: async () => new Response('asset')}};
  return {env, https: true, client: httpClient('https://quiz.example', request => worker.fetch(request, env))};
}

apiContract('cloudflare worker', workerBackend);

test('worker stores salted password hashes and serves non-API paths from assets', async () => {
  const backend = workerBackend();
  await backend.client().call('/api/auth/register', {method: 'POST', body: {username: 'hash', password: 'correct horse'}});
  const row = backend.env.DB.raw.prepare('SELECT password_hash, password_salt FROM users').get();
  assert.match(row.password_hash, /^[0-9a-f]{64}$/);
  assert.match(row.password_salt, /^[0-9a-f]{32}$/);
  const response = await worker.fetch(new Request('https://quiz.example/index.html'), backend.env);
  assert.equal(await response.text(), 'asset');
});

test('chunkByBytes splits large payloads without dropping items', () => {
  const items = Array.from({length: 50}, (_, i) => ({i, text: 'x'.repeat(1000)}));
  const chunks = chunkByBytes(items, 10_000);
  assert.ok(chunks.length > 1);
  assert.deepEqual(chunks.flat(), items);
});
