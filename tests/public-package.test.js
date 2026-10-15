const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const { createPrototypeProjectServer, emptyAnnotationFile } = require('../scripts/serve_prototype_project.js');
const { inspectPageBriefGate } = require('../scripts/check_page_brief_gate.js');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'public-prototype-'));
const fixture = path.join(temp, 'project');
fs.cpSync(path.join(root, 'examples/task-board/prototype'), fixture, { recursive: true });
// Never use a contributor's local annotations as a fixture.
fs.rmSync(path.join(fixture, 'annotations'), { recursive: true, force: true });
let passed = 0;
async function test(name, action) {
  await action();
  passed++;
  console.log(`PASS: ${name}`);
}
async function main() {
  let server;
  try {
    await test('独立目录中的完整案例与离线查看器一致', () => {
      for (const name of fs.readdirSync(path.join(root, 'assets/prototype-viewer'))) {
        const generated = name.endsWith('.svg') ? path.join(fixture, 'assets/prototype-viewer', name) : path.join(fixture, name);
        assert.deepEqual(fs.readFileSync(generated), fs.readFileSync(path.join(root, 'assets/prototype-viewer', name)), name);
      }
      const result = spawnSync(process.execPath, [path.join(root, 'scripts/validate_artifacts.js'), '--project', fixture], { cwd: temp, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /0 个错误，0 个警告/);
    });
    await test('同步器不会污染调用目录中的同名模板', () => {
      const template = path.join(temp, 'templates/prototype-viewer');
      fs.mkdirSync(template, { recursive: true });
      fs.writeFileSync(path.join(template, 'index.html'), 'keep external template');
      const result = spawnSync(process.execPath, [path.join(root, 'scripts/sync_viewer.js'), '--project', fixture], { cwd: temp, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(fs.readFileSync(path.join(template, 'index.html'), 'utf8'), 'keep external template');
    });
    server = createPrototypeProjectServer(fixture);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const send = (value, headers = {}) => fetch(`${base}/api/manual-annotations`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value) });
    const payload = emptyAnnotationFile({ id: 'task-board-demo', name: '公开样例' });
    await test('标注 API 完成读取、写入、磁盘回读', async () => {
      assert.equal((await fetch(`${base}/__health`)).status, 200);
      assert.equal((await fetch(`${base}/assets/prototype-viewer/prototype-mark.svg`)).status, 200);
      assert.equal((await send(payload, { Origin: base })).status, 200);
      const result = await (await fetch(`${base}/api/manual-annotations`)).json();
      assert.deepEqual(result, payload);
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(fixture, 'annotations/manual-annotations.json'))), payload);
    });
    await test('拒绝跨站写入、非本机 Host、项目错配和非法 JSON', async () => {
      assert.equal((await send(payload, { Origin: 'https://example.com' })).status, 403);
      const foreignHostStatus = await new Promise((resolve, reject) => {
        const request = http.request(`${base}/api/manual-annotations`, { method: 'PUT', headers: { Host: 'example.com', 'Content-Type': 'application/json' } }, response => { response.resume(); resolve(response.statusCode); });
        request.on('error', reject);
        request.end(JSON.stringify(payload));
      });
      assert.equal(foreignHostStatus, 403);
      assert.equal((await send({ ...payload, projectId: 'another-project' })).status, 400);
      assert.equal((await fetch(`${base}/api/manual-annotations`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(fixture, 'annotations/manual-annotations.json'))), payload);
    });
    await test('拒绝隐藏文件、越界资源和符号链接逃逸', async () => {
      fs.writeFileSync(path.join(temp, 'outside.txt'), 'outside fixture');
      fs.symlinkSync(path.join(temp, 'outside.txt'), path.join(fixture, 'external.txt'));
      fs.writeFileSync(path.join(fixture, '.hidden'), 'hidden fixture');
      assert.equal((await fetch(`${base}/external.txt`)).status, 403);
      assert.equal((await fetch(`${base}/.hidden`)).status, 403);
      assert.equal((await fetch(`${base}/..%2foutside.txt`)).status, 403);
      fs.rmSync(path.join(fixture, 'annotations'), { recursive: true });
      fs.symlinkSync(temp, path.join(fixture, 'annotations'));
      assert.equal((await send(payload)).status, 403);
      assert.equal(fs.existsSync(path.join(temp, 'manual-annotations.json')), false);
    });
    await test('修改虚构来源会使确认链失效', () => {
      fs.appendFileSync(path.join(fixture, 'docs/PRD.md'), '\nChanged source.\n');
      assert(inspectPageBriefGate(fixture).errors.some(error => error.code === 'REQUIREMENTS_SOURCE_CHANGED'));
    });
    await test('公开包扫描器拒绝敏感文件而不打印内容', () => {
      const scanRoot = path.join(temp, 'audit');
      fs.mkdirSync(scanRoot);
      fs.writeFileSync(path.join(scanRoot, '.env'), 'SAMPLE=fixture');
      const result = spawnSync(process.execPath, [path.join(root, 'scripts/audit-public.mjs'), '--root', scanRoot], { encoding: 'utf8' });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /excluded-artifact/);
      assert.doesNotMatch(result.stderr, /SAMPLE=fixture/);
    });
    console.log(`\n独立包测试：${passed}/7 通过`);
  } finally {
    if (server) await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
