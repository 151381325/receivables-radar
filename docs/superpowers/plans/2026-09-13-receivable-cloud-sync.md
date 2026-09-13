# Receivable Cloud Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store each signed-in user's receivables, payments, and follow-ups in PostgreSQL, with safe browser migration from LocalStorage and clear cloud-sync feedback.

**Architecture:** Add user-scoped business tables and a focused `server/receivables/` repository/router layer. Keep `src/domain.js` as the shared source of business rules; add an async cloud repository used by `src/app.js` after authentication. All API writes use optimistic record versions and return the complete changed record.

**Tech Stack:** Node.js 22, Fastify, PostgreSQL 16, `pg`, existing ES modules and Node built-in test runner, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-13-receivable-cloud-sync-design.md`

## Global Constraints

- Cloud data is the sole formal source; no offline write queue or real-time push.
- Every business query and mutation filters by authenticated `user_id`.
- Store money in integer fen; only browser display/input uses yuan.
- Existing domain validation and UI style remain unchanged.
- Concurrent changes use `version`; stale writes return `409 STALE_VERSION` and never overwrite data.
- Import first downloads the existing JSON backup; duplicate `(user_id, id)` values are skipped and cloud records win.
- PostgreSQL remains private to Docker; real credentials, backups, and generated data remain untracked.
- Each task needs a failing test before production code, a green test run, user review, and explicit approval before its commit.

---

### Task 1: Add user-scoped receivable schema and money conversion

**Files:**
- Create: `server/db/migrations/002_receivables.sql`
- Create: `server/receivables/money.js`
- Create: `tests/server/receivable-schema.test.js`
- Create: `tests/server/money.test.js`

**Interfaces:**
- Produces: `yuanToFen(value)` and `fenToYuan(value)`.
- Produces tables `receivables`, `payments`, `follow_ups`, each with `user_id`; `receivables` uses `(user_id, id)` as its primary key and `version integer NOT NULL DEFAULT 1`.

- [ ] **Step 1: Write failing money tests**

```js
test('yuanToFen keeps decimal money exact', () => {
  assert.equal(yuanToFen(12.34), 1234);
  assert.equal(fenToYuan(1234), 12.34);
  assert.throws(() => yuanToFen(1.234), /最多两位小数/);
});
```

- [ ] **Step 2: Run test to verify red state**

Run: `node --test tests/server/money.test.js tests/server/receivable-schema.test.js`  
Expected: FAIL because the converter and migration do not exist.

- [ ] **Step 3: Write minimal implementation**

Create the three user-scoped tables with integer money columns, foreign keys, `deleted_at`, constraints, and ownership indexes. Implement a converter that rejects non-positive or over-two-decimal yuan input and converts only at the API/database boundary.

- [ ] **Step 4: Run test to verify green state**

Run: `node --test tests/server/money.test.js tests/server/receivable-schema.test.js`  
Expected: PASS; tests assert no `float` or `real` money columns and all ownership/version fields exist.

- [ ] **Step 5: Commit after user approval**

```bash
git add server/db/migrations/002_receivables.sql server/receivables/money.js tests/server/money.test.js tests/server/receivable-schema.test.js
git commit -m "feat: add receivable data schema"
```

### Task 2: Build the user-isolated PostgreSQL repository

**Files:**
- Create: `server/receivables/repository.js`
- Create: `tests/server/receivable-repository.test.js`

**Interfaces:**
- Produces `createReceivableRepository(pool)` with `list(userId)`, `create(userId, record)`, `update(userId, id, version, changes)`, `softDelete(userId, id, version)`, `addPayment(userId, id, version, payment)`, `removePayment(userId, id, paymentId, version)`, `addFollowUp(userId, id, version, followUp)`, and `importRecords(userId, records)`.
- Mutations return a hydrated domain-shaped record or `null`; stale versions throw an error with `code = 'STALE_VERSION'`.

- [ ] **Step 1: Write real PostgreSQL integration tests**

```js
test('another user cannot read or mutate an owned receivable', async () => {
  const created = await repository.create(owner.id, fixture);
  assert.deepEqual(await repository.list(other.id), []);
  assert.equal(await repository.update(other.id, created.id, 1, { clientName: 'x' }), null);
});

test('stale version changes nothing', async () => {
  const created = await repository.create(owner.id, fixture);
  await assert.rejects(() => repository.update(owner.id, created.id, 0, {}), { code: 'STALE_VERSION' });
});
```

- [ ] **Step 2: Run test to verify red state**

Run: `DATABASE_URL=<disposable-postgres-url> node --test tests/server/receivable-repository.test.js`  
Expected: FAIL because the repository module does not exist.

- [ ] **Step 3: Write minimal implementation**

Use `withTransaction` for every write. Convert rows to the existing record shape with yuan amounts and child arrays. Scope all SQL with `user_id`; versioned writes use `WHERE user_id = $1 AND id = $2 AND version = $3 AND deleted_at IS NULL`, then increment once.

- [ ] **Step 4: Run test to verify green state**

Run: `DATABASE_URL=<disposable-postgres-url> node --test tests/server/receivable-repository.test.js`  
Expected: PASS for isolation, soft deletion, version conflicts, payment caps, follow-ups, and duplicate-ID import skip counts.

- [ ] **Step 5: Commit after user approval**

```bash
git add server/receivables/repository.js tests/server/receivable-repository.test.js
git commit -m "feat: add user isolated receivable repository"
```

### Task 3: Expose protected receivable API routes

**Files:**
- Create: `server/routes/receivables.js`
- Modify: `server/app.js`
- Create: `tests/server/receivable-routes.test.js`

**Interfaces:**
- Produces all nine `/api/receivables` endpoints from the approved design.
- Consumes `request.user.id` and the Task 2 repository.

- [ ] **Step 1: Write route tests through Fastify injection**

```js
test('write requires authentication and stale versions return a stable error', async () => {
  const anonymous = await app.inject({ method: 'POST', url: '/api/receivables', payload: fixture });
  assert.equal(anonymous.statusCode, 401);
  const stale = await app.inject({ method: 'PUT', url: `/api/receivables/${id}`, payload: { version: 0, ...fixture } });
  assert.equal(stale.json().error.code, 'STALE_VERSION');
});
```

- [ ] **Step 2: Run test to verify red state**

Run: `DATABASE_URL=<disposable-postgres-url> node --test tests/server/receivable-routes.test.js`  
Expected: FAIL because routes are not registered.

- [ ] **Step 3: Write minimal implementation**

Register authenticated list/create/update/delete/payment/follow-up/import routes. Reuse existing domain functions for validation; return `404` for inaccessible records, `400 VALIDATION_ERROR` for invalid input, `409 STALE_VERSION` for conflicts, and import-limit requests to 500 records at 3/minute.

- [ ] **Step 4: Run test to verify green state**

Run: `DATABASE_URL=<disposable-postgres-url> node --test tests/server/receivable-routes.test.js`  
Expected: PASS for every endpoint, user isolation, validation, import counts, and unchanged conflict records.

- [ ] **Step 5: Commit after user approval**

```bash
git add server/routes/receivables.js server/app.js tests/server/receivable-routes.test.js
git commit -m "feat: add protected receivable api"
```

### Task 4: Add browser cloud repository and client methods

**Files:**
- Modify: `src/api-client.js`
- Create: `src/cloud-repository.js`
- Modify: `tests/api-client.test.js`
- Create: `tests/cloud-repository.test.js`

**Interfaces:**
- Produces `createCloudRepository(api)` with async `load`, `create`, `update`, `remove`, `addPayment`, `removePayment`, `addFollowUp`, and `importRecords`.
- API client methods exactly match Task 3 and always use same-origin cookies.

- [ ] **Step 1: Write failing cache sequencing test**

```js
test('cloud repository changes cache only after API success', async () => {
  const api = { createReceivable: async () => { throw new Error('offline'); } };
  const repository = createCloudRepository(api);
  await assert.rejects(() => repository.create(fixture), /offline/);
  assert.deepEqual(repository.list(), []);
});
```

- [ ] **Step 2: Run test to verify red state**

Run: `node --test tests/api-client.test.js tests/cloud-repository.test.js`  
Expected: FAIL because cloud repository methods are missing.

- [ ] **Step 3: Write minimal implementation**

Keep only the last successful cloud records in memory. Replace cache after load/import; replace one record after successful mutations; remove only after successful `204`. Preserve `STALE_VERSION` and network errors for UI handling.

- [ ] **Step 4: Run test to verify green state**

Run: `node --test tests/api-client.test.js tests/cloud-repository.test.js`  
Expected: PASS for cache sequencing, delete, import, same-origin requests, and stable errors.

- [ ] **Step 5: Commit after user approval**

```bash
git add src/api-client.js src/cloud-repository.js tests/api-client.test.js tests/cloud-repository.test.js
git commit -m "feat: add browser cloud repository"
```

### Task 5: Switch business UI to cloud data and sync states

**Files:**
- Modify: `src/app.js`
- Modify: `src/auth-ui.js`
- Modify: `index.html`
- Modify: `src/styles.css`
- Create: `tests/cloud-ui-contract.test.js`

**Interfaces:**
- `auth-ui.js` creates the cloud repository after authentication.
- `app.js` exports `startApp(repository)`; the shell exposes `#sync-status`, `data-retry-sync`, and `data-refresh-records`.

- [ ] **Step 1: Write failing UI contract test**

```js
test('business shell exposes sync and retry controls', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(html.includes('id="sync-status"'));
  assert.ok(html.includes('data-refresh-records'));
  assert.ok(html.includes('data-retry-sync'));
});
```

- [ ] **Step 2: Run test to verify red state**

Run: `node --test tests/cloud-ui-contract.test.js`  
Expected: FAIL because cloud sync controls are absent.

- [ ] **Step 3: Write minimal implementation**

Load cloud records after auth. Disable submitting controls while writing; show “正在同步你的数据”, “已同步”, or “尚未同步” with retry/refresh. On `STALE_VERSION`, reload and show “另一台设备已更新，请确认最新内容后再操作”. Preserve current forms, calculation rules, dialogs, warm theme, and large fonts.

- [ ] **Step 4: Run test and build**

Run: `node --test tests/cloud-ui-contract.test.js && npm test && npm run build`  
Expected: PASS and build includes cloud modules.

- [ ] **Step 5: Commit after user approval**

```bash
git add src/app.js src/auth-ui.js index.html src/styles.css tests/cloud-ui-contract.test.js
git commit -m "feat: sync receivables through cloud api"
```

### Task 6: Add confirmed LocalStorage import and phase verification

**Files:**
- Create: `src/legacy-import.js`
- Modify: `src/app.js`
- Modify: `index.html`
- Modify: `src/styles.css`
- Create: `tests/local-import.test.js`
- Modify: `README.md`
- Modify: `docs/operations/cloud-runbook.md`

**Interfaces:**
- Produces `detectLegacyRecords(storage)`, `markLegacyImportDeferred(storage)`, and `markLegacyImportComplete(storage)`.
- Uses existing `serializeBackup(records)` and `DEFAULT_STORAGE_KEY`.

- [ ] **Step 1: Write failing migration test**

```js
test('legacy data is importable only after backup and confirmation', () => {
  const records = detectLegacyRecords(storageWithTwoRecords);
  assert.equal(records.length, 2);
  assert.equal(markLegacyImportDeferred(storageWithTwoRecords), 'deferred');
});
```

- [ ] **Step 2: Run test to verify red state**

Run: `node --test tests/local-import.test.js`  
Expected: FAIL because migration helpers do not exist.

- [ ] **Step 3: Write minimal implementation**

After first cloud load, offer “备份并导入” or “暂不导入”. Download JSON before API import; set completion only after success; retain LocalStorage always; show import/skip counts; allow deferred import from settings.

- [ ] **Step 4: Run final checks**

Run: `node --test tests/local-import.test.js && npm test && npm run build && docker compose config --quiet`  
Expected: all checks pass. Start the stack and verify `http://localhost/api/health` is HTTP 200. In two profiles, verify account B cannot access A data; create on one A profile, refresh the other, verify conflict feedback and 390px mobile sync feedback.

- [ ] **Step 5: Commit after user approval**

```bash
git add src/legacy-import.js src/app.js index.html src/styles.css tests/local-import.test.js README.md docs/operations/cloud-runbook.md
git commit -m "feat: import local receivables to cloud"
```

