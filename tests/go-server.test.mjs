// 构建并启动 Go 自部署后端，运行与 Worker 相同的接口测试。
// 未安装 Go 时自动跳过；也可以用 QUIZ_SERVER_BIN 指定已构建的可执行文件。
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawn} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {apiContract, httpClient} from './api-contract.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
let hasGo = !!process.env.QUIZ_SERVER_BIN;
if (!hasGo) try {execFileSync('go', ['version'], {stdio: 'ignore'}); hasGo = true;} catch {}

const freePort = () => new Promise((resolve, reject) => {
  const server = createServer().listen(0, '127.0.0.1', () => {const {port} = server.address(); server.close(() => resolve(port));}).on('error', reject);
});

async function startGoServer() {
  const dir = mkdtempSync(join(tmpdir(), 'quiz-go-test-'));
  let bin = process.env.QUIZ_SERVER_BIN;
  if (!bin) {
    bin = join(dir, 'quiz-server');
    execFileSync('go', ['build', '-o', bin, './server/cmd/quiz-server'], {cwd: root, stdio: 'inherit'});
  }
  const port = await freePort();
  const child = spawn(bin, ['-addr', `127.0.0.1:${port}`, '-db', join(dir, 'quiz.db')], {stdio: ['ignore', 'ignore', 'pipe']});
  let log = '';
  child.stderr.on('data', chunk => {log += chunk;});
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; ; i++) {
    try {if ((await fetch(base + '/api/auth/me')).ok) break;} catch {}
    if (i > 100 || child.exitCode !== null) throw Error(`Go server did not start:\n${log}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return {base, https: false, client: httpClient(base), close: () => {child.kill(); rmSync(dir, {recursive: true, force: true});}};
}

if (hasGo) {
  let server;
  apiContract('go server', async () => (server = await startGoServer()));
  test('go server serves the embedded frontend', async () => {
    const response = await fetch(server.base + '/');
    assert.equal(response.status, 200);
    assert.match(await response.text(), /<script type="module" src="app.js">/);
    assert.equal((await fetch(server.base + '/missing.js')).status, 404);
  });
} else {
  test('go server contract tests', {skip: 'Go is not installed'}, () => {});
}
