export async function requireAdmin(request, reply) {
  if (!request.user?.isAdmin) {
    return reply.code(403).send({
      error: { code: 'ADMIN_REQUIRED', message: '需要管理员权限' },
    });
  }
}
