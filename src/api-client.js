export class ApiError extends Error {
  constructor(message, { code = 'API_ERROR', status = 0 } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

export function createApiClient(fetchImpl = globalThis.fetch, { onAuthRequired = () => {}, getSessionGeneration = () => 0 } = {}) {
  async function request(path, options = {}) {
    const generation = getSessionGeneration();
    let response;
    try {
      response = await fetchImpl(path, {
        ...options,
        credentials: 'same-origin',
        cache: 'no-store',
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
    if (generation !== getSessionGeneration()) {
      throw new ApiError('账号状态已变化，已忽略旧会话响应', { code: 'SESSION_CHANGED' });
    }
    if (!response.ok) {
      if (response.status === 401 && body?.error?.code === 'AUTH_REQUIRED') onAuthRequired();
      throw new ApiError(body?.error?.message ?? '请求失败，请稍后重试', {
        code: body?.error?.code ?? 'API_ERROR',
        status: response.status,
      });
    }
    return body;
  }

  const post = (path, input) => request(path, { method: 'POST', body: JSON.stringify(input ?? {}) });
  const put = (path, input) => request(path, { method: 'PUT', body: JSON.stringify(input ?? {}) });
  const patch = (path, input) => request(path, { method: 'PATCH', body: JSON.stringify(input ?? {}) });
  const remove = (path, input) => request(path, { method: 'DELETE', body: JSON.stringify(input ?? {}) });
  return {
    request,
    getCurrentUser: () => request('/api/auth/me'),
    getEntitlements: () => request('/api/account/entitlements'),
    register: (input) => post('/api/auth/register', input),
    verifyEmail: (token) => post('/api/auth/verify-email', { token }),
    resendVerification: (email) => post('/api/auth/resend-verification', { email }),
    login: (input) => post('/api/auth/login', input),
    logout: () => post('/api/auth/logout'),
    deleteAccount: input => remove('/api/account', input),
    requestPasswordReset: (email) => post('/api/auth/request-password-reset', { email }),
    resetPassword: (input) => post('/api/auth/reset-password', input),
    listReceivables: async () => (await request('/api/receivables')).records,
    createReceivable: (input) => post('/api/receivables', input).then((body) => body.record),
    updateReceivable: (id, input) => put(`/api/receivables/${encodeURIComponent(id)}`, input).then((body) => body.record),
    addPayment: (id, input) => post(`/api/receivables/${encodeURIComponent(id)}/payments`, input).then((body) => body.record),
    removePayment: (id, paymentId, version) => remove(`/api/receivables/${encodeURIComponent(id)}/payments/${encodeURIComponent(paymentId)}`, { version }).then(body => body.record),
    addFollowUp: (id, input) => post(`/api/receivables/${encodeURIComponent(id)}/follow-ups`, input).then((body) => body.record),
    deleteReceivable: (id, version) => remove(`/api/receivables/${encodeURIComponent(id)}`, { version }),
    importReceivables: (records) => post('/api/receivables/import', { records }),
    getAdminSummary: () => request('/api/admin/summary'),
    listAdminUsers: ({ page = 1, pageSize = 20, status = 'all', query = '' } = {}) => {
      const search = new URLSearchParams({
        page: String(page), pageSize: String(pageSize), status, query,
      });
      return request(`/api/admin/users?${search}`);
    },
    setAdminUserDisabled: (id, disabled) => patch(
      `/api/admin/users/${encodeURIComponent(id)}/status`, { disabled },
    ),
  };
}
