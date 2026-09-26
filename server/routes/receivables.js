import { createReceivableRepository } from '../receivables/repository.js';
import { addFollowUp, addPayment, createReceivable, updateReceivable } from '../../src/domain.js';

export async function registerReceivableRoutes(app, { pool, authenticate }) {
  const repository = createReceivableRepository(pool);
  app.get('/api/receivables', { preHandler: authenticate }, async (request) => ({
    records: await repository.list(request.user.id),
  }));
  app.post('/api/receivables', { preHandler: authenticate }, async (request, reply) => {
    try {
      const record = createReceivable(request.body ?? {});
      const created = await repository.create(request.user.id, record);
      return reply.code(201).send({ record: created });
    } catch (error) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: error.message } });
    }
  });
  app.put('/api/receivables/:id', { preHandler: authenticate }, async (request, reply) => {
    const current = (await repository.list(request.user.id)).find((item) => item.id === request.params.id);
    if (!current) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '记录不存在' } });
    try {
      const record = updateReceivable(current, request.body ?? {});
      const updated = await repository.update(request.user.id, current.id, request.body?.version, record);
      return reply.send({ record: updated });
    } catch (error) {
      return reply.code(error.code === 'STALE_VERSION' ? 409 : 400).send({ error: { code: error.code ?? 'VALIDATION_ERROR', message: error.message } });
    }
  });
  async function change(request, reply, work) {
    const record = (await repository.list(request.user.id)).find((item) => item.id === request.params.id);
    if (!record) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '记录不存在' } });
    try { return reply.send({ record: await work(record) }); }
    catch (error) { return reply.code(error.code === 'STALE_VERSION' ? 409 : 400).send({ error: { code: error.code ?? 'VALIDATION_ERROR', message: error.message } }); }
  }
  app.post('/api/receivables/:id/payments', { preHandler: authenticate }, (request, reply) => change(request, reply, (record) => {
    const updated = addPayment(record, request.body ?? {});
    const payment = updated.paymentRecords.at(-1);
    return repository.addPayment(request.user.id, record.id, request.body?.version, payment);
  }));
  app.post('/api/receivables/:id/follow-ups', { preHandler: authenticate }, (request, reply) => change(request, reply, (record) => {
    const updated = addFollowUp(record, request.body ?? {});
    const followUp = updated.followUpRecords.at(-1);
    return repository.addFollowUp(request.user.id, record.id, request.body?.version, followUp);
  }));
  app.delete('/api/receivables/:id', { preHandler: authenticate }, async (request, reply) => {
    try { return await repository.softDelete(request.user.id, request.params.id, request.body?.version) ? reply.code(204).send() : reply.code(404).send(); }
    catch (error) { return reply.code(409).send({ error: { code: error.code, message: error.message } }); }
  });
  app.post('/api/receivables/import', { preHandler: authenticate }, async (request, reply) => {
    const records = request.body?.records;
    if (!Array.isArray(records) || records.length > 500) return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: '导入记录必须在1至500条之间' } });
    return reply.send(await repository.importRecords(request.user.id, records));
  });
}
