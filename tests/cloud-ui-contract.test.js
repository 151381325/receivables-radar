import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('业务界面提供同步状态与刷新入口', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  for (const fragment of ['id="sync-status"', 'data-refresh-records', 'data-retry-sync']) assert.ok(html.includes(fragment));
});
