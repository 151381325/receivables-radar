import test from 'node:test';
import assert from 'node:assert/strict';

import { loadConfig } from '../../server/config.js';

test('缺少数据库连接时拒绝启动', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'test' }), /DATABASE_URL/);
});

test('规范化服务端公开配置', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://test:test@db/test',
    APP_ORIGIN: 'https://example.test',
    SESSION_COOKIE_NAME: 'rr_session',
    SMTP_HOST: 'smtp.example.test',
    SMTP_PORT: '465',
    SMTP_SECURE: 'true',
    SMTP_USER: 'sender@example.test',
    SMTP_PASS: 'not-a-real-secret',
    MAIL_FROM: 'sender@example.test',
  });

  assert.deepEqual(config, {
    nodeEnv: 'test',
    host: '0.0.0.0',
    port: 3000,
    databaseUrl: 'postgres://test:test@db/test',
    sessionCookieName: 'rr_session',
    appOrigin: 'https://example.test',
    smtp: {
      host: 'smtp.example.test',
      port: 465,
      secure: true,
      user: 'sender@example.test',
      pass: 'not-a-real-secret',
      from: 'sender@example.test',
    },
  });
});

test('端口和 SMTP 安全标记必须有效', () => {
  const base = {
    DATABASE_URL: 'postgres://test:test@db/test',
    APP_ORIGIN: 'https://example.test',
    SMTP_HOST: 'smtp.example.test',
    SMTP_USER: 'sender@example.test',
    SMTP_PASS: 'not-a-real-secret',
    MAIL_FROM: 'sender@example.test',
  };

  assert.throws(() => loadConfig({ ...base, PORT: 'abc' }), /PORT/);
  assert.throws(() => loadConfig({ ...base, SMTP_SECURE: 'sometimes' }), /SMTP_SECURE/);
});
