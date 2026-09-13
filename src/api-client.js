export class ApiError extends Error {
  constructor(message, { code = 'API_ERROR', status = 0 } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

export function createApiClient(fetchImpl = globalThis.fetch) {
  async function request(path, options = {}) {
    let response;
    try {
      response = await fetchImpl(path, {
        ...options,
        credentials: 'same-origin',
        headers: {
          ...(options.body ? { 'content-type': 'application/json' } : {}),
          ...options.headers,
        },
      });
    } catch {
      throw new ApiError('网络连接失败，请检查网络后重试', { code: 'NETWORK_ERROR' });
    }

    const isJson = response.headers.get('content-type')?.includes('application/json');
    const body = isJson ? await response.json() : null;
    if (!response.ok) {
      throw new ApiError(body?.error?.message ?? '请求失败，请稍后重试', {
        code: body?.error?.code ?? 'API_ERROR',
        status: response.status,
      });
    }
    return body;
  }

  const post = (path, input) => request(path, { method: 'POST', body: JSON.stringify(input ?? {}) });
  return {
    request,
    getCurrentUser: () => request('/api/auth/me'),
    register: (input) => post('/api/auth/register', input),
    verifyEmail: (token) => post('/api/auth/verify-email', { token }),
    login: (input) => post('/api/auth/login', input),
    logout: () => post('/api/auth/logout'),
    requestPasswordReset: (email) => post('/api/auth/request-password-reset', { email }),
    resetPassword: (input) => post('/api/auth/reset-password', input),
  };
}
