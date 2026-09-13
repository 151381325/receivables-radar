# Cloud Foundation and Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a locally testable and production-deployable cloud foundation with PostgreSQL-backed email/password accounts, secure cookie sessions, and strict user isolation, without yet moving receivable records out of LocalStorage.

**Architecture:** Keep the existing static UI and domain modules intact. Add a Fastify API under `server/`, PostgreSQL migrations under `server/db/migrations/`, and Docker Compose/Caddy deployment files under `deploy/`; the browser talks to same-origin `/api`, while PostgreSQL remains private to the container network.

**Tech Stack:** Node.js 22 LTS, Fastify, PostgreSQL 16, `pg`, `argon2`, `@fastify/cookie`, `@fastify/rate-limit`, `nodemailer`, Node built-in test runner, Docker Compose, Caddy, Ubuntu 24.04 LTS.

**Spec:** `docs/superpowers/specs/2026-09-13-cloud-web-and-mobile-design.md`

## Global Constraints

- Target Tencent Cloud Lighthouse in Shanghai: 2 vCPU, 2GB RAM, 40–50GB SSD, Ubuntu 24.04 LTS.
- Keep the existing warm option-B responsive interface and large typography.
- Public routes use one origin; the API prefix is `/api`.
- Passwords use Argon2id; authentication uses `HttpOnly`, `Secure`, `SameSite=Lax` cookies.
- PostgreSQL is never published to the host network in production.
- Secrets, `.env`, certificates, email credentials, logs, and backups must never be committed.
- This plan does not migrate receivable data, add PWA files, package Android, or publish externally.
- Every API query involving user-owned data must include the authenticated `user_id`.
- External purchase, real-name verification, ICP submission, DNS change, and production deployment require explicit user approval.

## Plan Split

| Plan | Deliverable | Dependency |
|---|---|---|
| This plan | Local/production foundation, accounts, sessions, email verification | Confirmed design |
| Plan 2 | Receivable API, cloud repository, conflicts, LocalStorage import | This plan accepted |
| Plan 3 | PWA, Capacitor Android, local notifications | Cloud web accepted |
| Plan 4 | ICP/APP filing, software copyright, store package | Android test build accepted |

---

### Task 1: Establish the server package and configuration contract

**Files:**
- Modify: `package.json`
- Modify: `.gitignore`
- Create: `.env.example`
- Create: `server/config.js`
- Create: `tests/server/config.test.js`

**Interfaces:**
- Produces: `loadConfig(env)` returning `{ nodeEnv, host, port, databaseUrl, sessionCookieName, appOrigin, smtp }`.
- Consumes: environment variables documented in `.env.example`; no real credentials.

- [ ] **Step 1: Write the failing configuration test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../../server/config.js';

test('loadConfig rejects missing required values', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'test' }), /DATABASE_URL/);
});

test('loadConfig normalizes the public configuration', () => {
  const config = loadConfig({
    NODE_ENV: 'test', DATABASE_URL: 'postgres://test:test@db/test',
    APP_ORIGIN: 'https://example.test', SESSION_COOKIE_NAME: 'rr_session',
    SMTP_HOST: 'smtp.example.test', SMTP_PORT: '465', SMTP_SECURE: 'true',
    SMTP_USER: 'sender@example.test', SMTP_PASS: 'secret', MAIL_FROM: 'sender@example.test',
  });
  assert.equal(config.port, 3000);
  assert.equal(config.smtp.secure, true);
});
```

- [ ] **Step 2: Run the test and verify the missing-module failure**

Run: `node --test tests/server/config.test.js`  
Expected: FAIL because `server/config.js` does not exist.

- [ ] **Step 3: Add dependencies and scripts**

Set `package.json` scripts to include:

```json
{
  "dev:api": "node --watch server/main.js",
  "start:api": "node server/main.js",
  "db:migrate": "node server/db/migrate.js",
  "test": "node --test",
  "build": "node scripts/build.mjs"
}
```

Install runtime packages with:

```powershell
npm install fastify @fastify/cookie @fastify/rate-limit pg argon2 nodemailer
```

- [ ] **Step 4: Implement strict configuration loading**

```js
function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function loadConfig(env = process.env) {
  return {
    nodeEnv: env.NODE_ENV ?? 'development',
    host: env.HOST ?? '0.0.0.0',
    port: Number(env.PORT ?? 3000),
    databaseUrl: required(env, 'DATABASE_URL'),
    sessionCookieName: env.SESSION_COOKIE_NAME ?? 'rr_session',
    appOrigin: required(env, 'APP_ORIGIN'),
    smtp: {
      host: required(env, 'SMTP_HOST'), port: Number(env.SMTP_PORT ?? 465),
      secure: env.SMTP_SECURE !== 'false', user: required(env, 'SMTP_USER'),
      pass: required(env, 'SMTP_PASS'), from: required(env, 'MAIL_FROM'),
    },
  };
}
```

Document every variable with non-secret example values in `.env.example`. Add `server-data/`, `backups/`, and `*.sql.gz` to `.gitignore`.

- [ ] **Step 5: Run configuration and existing tests**

Run: `npm test`  
Expected: all existing tests and both configuration tests PASS.

- [ ] **Step 6: Review and commit this unit**

Review: `git diff -- package.json package-lock.json .gitignore .env.example server/config.js tests/server/config.test.js`  
Commit after user approval: `git commit -m "chore: add server configuration foundation"`

---

### Task 2: Create PostgreSQL migrations and a transaction wrapper

**Files:**
- Create: `server/db/migrations/001_auth.sql`
- Create: `server/db/pool.js`
- Create: `server/db/migrate.js`
- Create: `tests/server/db-schema.test.js`

**Interfaces:**
- Produces: `createPool(databaseUrl)`, `withTransaction(pool, work)`, and idempotent migration command.
- Schema produces: `users`, `sessions`, `email_tokens`, and `schema_migrations` tables.

- [ ] **Step 1: Write the schema contract test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('auth migration defines constrained account tables', async () => {
  const sql = await readFile(new URL('../../server/db/migrations/001_auth.sql', import.meta.url), 'utf8');
  for (const fragment of ['CREATE TABLE users', 'email_normalized', 'password_hash',
    'CREATE TABLE sessions', 'token_hash', 'expires_at', 'CREATE TABLE email_tokens']) {
    assert.match(sql, new RegExp(fragment));
  }
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test tests/server/db-schema.test.js`  
Expected: FAIL with file-not-found for `001_auth.sql`.

- [ ] **Step 3: Add the initial schema**

The migration must define UUID primary keys, unique lowercase `email_normalized`, nullable `email_verified_at`, `disabled_at`, timestamps, hashed session/token values, expiries, token purpose constrained to `verify_email` or `reset_password`, and indexes on active token/session lookup columns. Never store a raw session or email token.

```sql
CREATE TABLE users (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  email_normalized text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  email_verified_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

- [ ] **Step 4: Implement pool, transaction, and ordered migrations**

`withTransaction(pool, work)` must execute `BEGIN`, call `work(client)`, then `COMMIT`; on error it must `ROLLBACK` and rethrow. `migrate.js` creates `schema_migrations`, reads sorted `.sql` files, and records each filename in the same transaction.

- [ ] **Step 5: Run tests and an integration migration**

Run: `npm test`  
Expected: all tests PASS.  
Run against a disposable PostgreSQL container: `npm run db:migrate`  
Expected: migration `001_auth.sql` recorded once; a second run applies nothing.

- [ ] **Step 6: Review and commit this unit**

Review: `git diff -- server/db tests/server/db-schema.test.js`  
Commit after user approval: `git commit -m "feat: add authentication database schema"`

---

### Task 3: Implement account and token repositories

**Files:**
- Create: `server/auth/crypto.js`
- Create: `server/auth/account-repository.js`
- Create: `tests/server/account-repository.test.js`

**Interfaces:**
- Produces: `normalizeEmail(email)`, `hashOpaqueToken(token)`, `createAccountRepository(pool)`.
- Repository methods: `createUser({ email, passwordHash })`, `findUserByEmail(email)`, `findUserById(id)`, `createEmailToken({ userId, purpose, tokenHash, expiresAt })`, `consumeEmailToken({ purpose, tokenHash, now })`, `markEmailVerified(userId, now)`, `replacePassword(userId, passwordHash, now)`, `disableUser(userId, now)`.

- [ ] **Step 1: Write failing repository tests**

Cover normalized uniqueness (`User@Example.com` equals `user@example.com`), one-time token consumption, expired token rejection, and disabled-user lookup. Use a disposable test database and truncate auth tables before each test.

```js
test('email tokens are single-use', async () => {
  const token = await repo.createEmailToken(fixture);
  assert.ok(await repo.consumeEmailToken({ ...lookup, now }));
  assert.equal(await repo.consumeEmailToken({ ...lookup, now }), null);
});
```

- [ ] **Step 2: Run the repository tests and verify failure**

Run: `node --test tests/server/account-repository.test.js`  
Expected: FAIL because repository exports do not exist.

- [ ] **Step 3: Implement normalization, token hashing, and SQL methods**

Use `crypto.randomUUID()` for IDs and SHA-256 only for high-entropy opaque tokens. Password hashing is handled separately with Argon2id. Every token consumption operation must use one SQL transaction and `DELETE ... RETURNING` with expiry and purpose conditions.

- [ ] **Step 4: Run repository tests**

Run: `node --test tests/server/account-repository.test.js`  
Expected: all repository tests PASS.

- [ ] **Step 5: Review and commit this unit**

Review: `git diff -- server/auth tests/server/account-repository.test.js`  
Commit after user approval: `git commit -m "feat: add account persistence"`

---

### Task 4: Build the Fastify application shell and session authentication

**Files:**
- Create: `server/app.js`
- Create: `server/main.js`
- Create: `server/auth/session-service.js`
- Create: `server/plugins/authenticate.js`
- Create: `tests/server/session.test.js`

**Interfaces:**
- Produces: `buildApp({ config, pool, mailer, clock })`, `createSessionService(pool, config)`, and `request.user` for protected routes.
- Routes produced: `GET /api/health`, `GET /api/auth/me`, `POST /api/auth/logout`.

- [ ] **Step 1: Write failing injection tests**

```js
test('health is public and me requires a session', async () => {
  const app = await buildTestApp();
  assert.equal((await app.inject({ method: 'GET', url: '/api/health' })).statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: '/api/auth/me' })).statusCode, 401);
});
```

Also test that logout deletes the server session and returns an expired cookie.

- [ ] **Step 2: Run and verify missing implementation**

Run: `node --test tests/server/session.test.js`  
Expected: FAIL because `buildApp` does not exist.

- [ ] **Step 3: Implement opaque server-side sessions**

Generate 32 random bytes, return the base64url raw value only in the cookie, and persist only its SHA-256 hash. Set a 30-day expiry. Authentication hashes the presented cookie, queries a non-expired session joined to an enabled user, assigns `{ id, email, emailVerified }` to `request.user`, and otherwise returns `{ error: { code: 'AUTH_REQUIRED', message: '请先登录' } }`.

- [ ] **Step 4: Build the application shell**

Register cookie parsing and rate limiting, add a request ID, expose `/api/health`, and use a single error handler that never leaks stack traces in production. `main.js` loads config, pool, and mailer, runs migrations before listening, and handles graceful shutdown.

- [ ] **Step 5: Run session and full tests**

Run: `npm test`  
Expected: all tests PASS and unauthenticated `/api/auth/me` returns 401.

- [ ] **Step 6: Review and commit this unit**

Review: `git diff -- server tests/server/session.test.js`  
Commit after user approval: `git commit -m "feat: add secure server sessions"`

---

### Task 5: Add registration and email verification

**Files:**
- Create: `server/auth/mailer.js`
- Create: `server/routes/auth.js`
- Create: `tests/server/register.test.js`

**Interfaces:**
- Consumes: account repository, session service, configured SMTP transport.
- Produces: `POST /api/auth/register`, `POST /api/auth/verify-email`, and `createMailer(config.smtp)`.

- [ ] **Step 1: Write failing route tests**

Test invalid email, password shorter than 10 characters, missing agreement, duplicate normalized email, successful registration, expired verification token, and single-use verification. Capture email using a fake mailer exposing `sendVerification({ email, token })`.

```js
const response = await app.inject({ method: 'POST', url: '/api/auth/register', payload: {
  email: 'owner@example.com', password: 'correct horse battery', acceptedTerms: true,
}});
assert.equal(response.statusCode, 201);
assert.equal(sent[0].email, 'owner@example.com');
```

- [ ] **Step 2: Run tests and verify route-not-found failures**

Run: `node --test tests/server/register.test.js`  
Expected: FAIL because auth routes are not registered.

- [ ] **Step 3: Implement registration validation and Argon2id hashing**

Accept only trimmed email up to 254 characters, password from 10 to 128 characters, and `acceptedTerms === true`. Hash passwords with `argon2.hash(password, { type: argon2.argon2id })`. Return the same generic conflict message for normalized duplicates.

- [ ] **Step 4: Implement verification mail and token use**

Create a 32-byte random token, store only its hash with a 30-minute expiry, and email a same-origin `/verify-email?token=...` link. Verification consumes the token once, marks the account verified, and creates a session cookie.

- [ ] **Step 5: Add rate-limit tests and run the suite**

Verify registration and verification endpoints return 429 after their configured limits.  
Run: `npm test`  
Expected: all tests PASS.

- [ ] **Step 6: Review and commit this unit**

Review: `git diff -- server/auth server/routes tests/server/register.test.js`  
Commit after user approval: `git commit -m "feat: add email account registration"`

---

### Task 6: Add login and password reset

**Files:**
- Modify: `server/auth/mailer.js`
- Modify: `server/routes/auth.js`
- Create: `tests/server/login-reset.test.js`

**Interfaces:**
- Produces: `POST /api/auth/login`, `POST /api/auth/request-password-reset`, `POST /api/auth/reset-password`.
- Mailer adds: `sendPasswordReset({ email, token })`.

- [ ] **Step 1: Write failing login and reset tests**

Test correct login, wrong password, unverified account, disabled account, generic reset response for unknown email, expired token, single-use token, and invalidation of all previous sessions after reset.

- [ ] **Step 2: Run tests and verify route-not-found failures**

Run: `node --test tests/server/login-reset.test.js`  
Expected: FAIL until routes are implemented.

- [ ] **Step 3: Implement login without account enumeration**

Use one generic 401 response for unknown email, wrong password, unverified account, and disabled account. Verify with `argon2.verify`, then rotate the session and set the secure cookie. Rate-limit by both IP and normalized email.

- [ ] **Step 4: Implement reset request and completion**

Reset request always returns 202. For an eligible account, issue a 30-minute one-time token and send `/reset-password?token=...`. Completion validates a 10–128 character password, consumes the token in a transaction, updates Argon2id hash, deletes all user sessions, and creates a fresh session.

- [ ] **Step 5: Run all tests**

Run: `npm test`  
Expected: all tests PASS, including session invalidation.

- [ ] **Step 6: Review and commit this unit**

Review: `git diff -- server/auth server/routes tests/server/login-reset.test.js`  
Commit after user approval: `git commit -m "feat: add login and password recovery"`

---

### Task 7: Add the browser authentication screens

**Files:**
- Modify: `index.html`
- Modify: `src/styles.css`
- Modify: `src/app.js`
- Create: `src/api-client.js`
- Create: `src/auth-ui.js`
- Create: `tests/api-client.test.js`

**Interfaces:**
- Produces: `createApiClient(fetchImpl)` with `request(path, options)`, `getCurrentUser()`, `register(input)`, `verifyEmail(token)`, `login(input)`, `logout()`, `requestPasswordReset(email)`, `resetPassword(input)`.
- Produces: `mountAuthUI({ root, api, onAuthenticated })`.

- [ ] **Step 1: Write failing API-client tests**

```js
test('request maps API errors to a stable Error', async () => {
  const api = createApiClient(async () => new Response(JSON.stringify({
    error: { code: 'AUTH_REQUIRED', message: '请先登录' },
  }), { status: 401, headers: { 'content-type': 'application/json' } }));
  await assert.rejects(api.getCurrentUser(), (error) => error.code === 'AUTH_REQUIRED');
});
```

Also verify `credentials: 'same-origin'` is always passed.

- [ ] **Step 2: Run and verify missing-module failure**

Run: `node --test tests/api-client.test.js`  
Expected: FAIL because `src/api-client.js` does not exist.

- [ ] **Step 3: Implement the API client**

Parse JSON only when content type is JSON, map non-2xx responses to errors with `code`, preserve a user-friendly message, and use `credentials: 'same-origin'`.

- [ ] **Step 4: Add authentication views without replacing the business UI**

Add login, registration, verification-result, forgot-password, and reset-password panels using the existing color, spacing, typography, button, form, and dialog patterns. Start the existing app only after `/api/auth/me` succeeds. Add a visible account menu with email and logout. Do not seed example receivables for authenticated cloud users.

- [ ] **Step 5: Add accessibility and manual state checks**

Ensure labels bind to inputs, errors use `role="alert"`, keyboard focus moves to the first invalid field, submit buttons show a busy state, and success messages explain the next action. Manually test desktop and 390px layouts.

- [ ] **Step 6: Run tests and build**

Run: `npm test`  
Expected: all tests PASS.  
Run: `npm run build`  
Expected: `dist/` contains auth modules and the existing UI.

- [ ] **Step 7: Review and commit this unit**

Review: `git diff -- index.html src tests/api-client.test.js scripts/build.mjs`  
Commit after user approval: `git commit -m "feat: add account authentication UI"`

---

### Task 8: Add local Docker deployment and production hardening

**Files:**
- Create: `Dockerfile`
- Create: `compose.yaml`
- Create: `deploy/Caddyfile`
- Create: `deploy/backup.sh`
- Create: `deploy/restore-check.sh`
- Create: `docs/operations/cloud-runbook.md`
- Modify: `README.md`
- Modify: `scripts/build.mjs`
- Create: `tests/deployment-config.test.js`

**Interfaces:**
- Produces: `docker compose up --build` running `web`, `api`, `db`, and `backup` services.
- HTTP contract: `/api/health` proxies to API; all other routes serve Web assets.

- [ ] **Step 1: Write failing deployment configuration tests**

Read `compose.yaml` and `deploy/Caddyfile`; assert that PostgreSQL has no `ports:` mapping, only Caddy publishes `80:80` and `443:443`, API has a health check, and `/api/*` is reverse-proxied.

- [ ] **Step 2: Run and verify missing-file failure**

Run: `node --test tests/deployment-config.test.js`  
Expected: FAIL because deployment files do not exist.

- [ ] **Step 3: Create production-oriented containers**

Use a multi-stage Node image: install locked dependencies with `npm ci`, run `npm test` and `npm run build`, then copy only runtime dependencies, `server/`, migrations, and `dist/` to the runtime stage. Run the Node process as a non-root user.

- [ ] **Step 4: Define Compose and Caddy boundaries**

Add health checks, restart policies, a private database volume, and a read-only Web asset mount where possible. Keep the database off host ports. Configure Caddy for compression, `/api/*` proxying, static files, and security headers; inject the real domain only through environment configuration.

- [ ] **Step 5: Implement backup and restore verification scripts**

`backup.sh` runs `pg_dump` in custom format, encrypts output using a supplied backup secret, uploads to the configured Tencent COS target, and deletes local temporary output after a successful upload. `restore-check.sh` restores the newest backup into a temporary database and runs record-count/schema checks without touching production.

- [ ] **Step 6: Write the operator runbook**

Document exact prerequisites, `.env` creation, migration, local start, health check, log inspection, backup, restore test, upgrade, rollback, and emergency session invalidation commands. Explicitly state that production deployment, DNS, firewall, payment, and filing require user approval.

- [ ] **Step 7: Verify locally**

Run: `docker compose config`  
Expected: valid configuration with no published PostgreSQL port.  
Run: `docker compose up --build -d`  
Expected: all services healthy.  
Run: `Invoke-WebRequest http://localhost/api/health`  
Expected: HTTP 200 and JSON health response.  
Run: `npm test`  
Expected: all tests PASS.

- [ ] **Step 8: Inspect secrets and changes, then prepare commit**

Run: `rg -n "password|token|secret|authorization" . --glob '!node_modules/**' --glob '!.git/**'` and inspect every match.  
Review: `git status --short` and `git diff --stat`.  
Commit after user approval: `git commit -m "chore: add secure cloud deployment"`

---

## Phase Acceptance Gate

Do not start the receivable-cloud-sync plan until all conditions pass:

- `npm test` and `npm run build` pass from a clean checkout.
- Local Docker stack starts and `/api/health` returns 200.
- Registration, verification, login, logout, reset, and session expiry are demonstrated.
- Two test accounts cannot read or mutate each other's account/session data.
- PostgreSQL has no public host port.
- No real credential or generated backup appears in `git status` or repository history.
- Backup restoration succeeds in a disposable database.
- Desktop and 390px mobile authentication screens are visually accepted by the user.
- No purchase, DNS mutation, filing submission, deployment, commit, or push occurs without the required explicit approval.
