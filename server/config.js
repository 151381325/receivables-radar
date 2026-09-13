function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parsePort(value, name, fallback) {
  const port = Number(value ?? fallback);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }
  return port;
}

function parseBoolean(value, name, fallback) {
  const normalized = value ?? fallback;
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw new Error(`${name} must be true or false`);
}

export function loadConfig(env = process.env) {
  return {
    nodeEnv: env.NODE_ENV ?? 'development',
    host: env.HOST ?? '0.0.0.0',
    port: parsePort(env.PORT, 'PORT', '3000'),
    databaseUrl: required(env, 'DATABASE_URL'),
    sessionCookieName: env.SESSION_COOKIE_NAME?.trim() || 'rr_session',
    appOrigin: required(env, 'APP_ORIGIN'),
    smtp: {
      host: required(env, 'SMTP_HOST'),
      port: parsePort(env.SMTP_PORT, 'SMTP_PORT', '465'),
      secure: parseBoolean(env.SMTP_SECURE, 'SMTP_SECURE', 'true'),
      user: required(env, 'SMTP_USER'),
      pass: required(env, 'SMTP_PASS'),
      from: required(env, 'MAIL_FROM'),
    },
  };
}
