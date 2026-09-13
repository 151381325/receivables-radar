export function createAuthenticate(sessionService, clock = () => new Date()) {
  return async function authenticate(request, reply) {
    const token = request.cookies[sessionService.cookieName];
    const user = await sessionService.findUserByToken(token, clock());
    if (!user) {
      return reply.code(401).send({
        error: { code: 'AUTH_REQUIRED', message: '请先登录' },
      });
    }
    request.user = user;
  };
}
