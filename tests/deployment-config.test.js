import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readProjectFile = async (path) => (await readFile(new URL(`../${path}`, import.meta.url), 'utf8')).replace(/\r\n/g, '\n');

test('生产数据库不暴露主机端口且只有网关发布 HTTP 端口', async () => {
  const compose = await readProjectFile('compose.yaml');
  const dbBlock = compose.match(/\n  db:\n([\s\S]*?)(?=\n  \w[\w-]*:\n|\nvolumes:)/)?.[1] ?? '';
  assert.ok(dbBlock, '缺少 db 服务');
  assert.ok(!/^\s{4}ports:/m.test(dbBlock), '数据库不得配置 ports');
  assert.match(compose, /"80:80"/);
  assert.match(compose, /"443:443"/);
});

test('API 配置健康检查且 Caddy 同源代理 API 和静态站点', async () => {
  const [compose, caddy] = await Promise.all([
    readProjectFile('compose.yaml'),
    readProjectFile('deploy/Caddyfile'),
  ]);
  const apiBlock = compose.match(/\n  api:\n([\s\S]*?)(?=\n  \w[\w-]*:\n|\nvolumes:)/)?.[1] ?? '';
  assert.match(apiBlock, /^\s{4}healthcheck:/m);
  assert.match(caddy, /handle \/api\/\*/);
  assert.match(caddy, /reverse_proxy api:3000/);
  assert.match(caddy, /file_server/);
});

test('部署包含备份和隔离恢复校验入口', async () => {
  const [compose, backup, restore] = await Promise.all([
    readProjectFile('compose.yaml'),
    readProjectFile('deploy/backup.sh'),
    readProjectFile('deploy/restore-check.sh'),
  ]);
  assert.match(compose, /\n  backup:/);
  assert.match(backup, /pg_dump/);
  assert.match(backup, /openssl/);
  assert.match(restore, /createdb/);
  assert.match(restore, /pg_restore/);
  assert.doesNotMatch(restore, /DROP DATABASE receivables_radar/);
});

test('Web 镜像包含构建产物且 API 以非 root 用户运行', async () => {
  const dockerfile = await readProjectFile('Dockerfile');
  assert.match(dockerfile, /FROM caddy:2-alpine AS web/);
  assert.match(dockerfile, /COPY --from=build \/app\/dist \/srv/);
  assert.match(dockerfile, /FROM node:22-alpine AS api[\s\S]*?USER node/);
});

test('备份镜像在降权前为 postgres 用户准备可写目录', async () => {
  const dockerfile = await readProjectFile('Dockerfile');
  assert.match(dockerfile, /mkdir -p \/backups[\s\S]*?chown postgres:postgres \/backups[\s\S]*?USER postgres/);
});

test('Git 排除密钥目录和数据库备份产物', async () => {
  const gitignore = await readProjectFile('.gitignore');
  for (const entry of ['secrets/', '*.dump', '*.enc']) {
    assert.ok(gitignore.includes(entry), `缺少忽略规则：${entry}`);
  }
});

test('共享临时数据库的集成测试按单进程执行', async () => {
  const packageJson = JSON.parse(await readProjectFile('package.json'));
  assert.match(packageJson.scripts.test, /--test-concurrency=1/);
});
