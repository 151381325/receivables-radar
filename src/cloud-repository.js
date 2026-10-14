export function createCloudRepository(api) {
  let records = [];
  let revision = 0;
  let loadSequence = 0;
  let sessionGeneration = 0;
  function checkSession(generation) {
    if (generation !== sessionGeneration) {
      const error = new Error('账号状态已变化，已忽略旧会话响应');
      error.code = 'SESSION_CHANGED';
      throw error;
    }
  }
  async function mutate(work, apply) {
    const generation = sessionGeneration;
    const response = await work();
    checkSession(generation);
    return apply(response);
  }
  const replace = (record) => {
    revision += 1;
    const index = records.findIndex((item) => item.id === record.id);
    records = index < 0 ? [...records, record] : records.map((item) => item.id === record.id ? record : item);
    return record;
  };
  return {
    list: () => structuredClone(records),
    get: (id) => structuredClone(records.find((item) => item.id === id) ?? null),
    clear() { records = []; revision += 1; loadSequence += 1; sessionGeneration += 1; },
    async load() {
      const generation = sessionGeneration;
      const startingRevision = revision;
      const sequence = ++loadSequence;
      const response = await api.listReceivables();
      checkSession(generation);
      if (revision === startingRevision && loadSequence === sequence) records = response;
      return this.list();
    },
    create(input) { return mutate(() => api.createReceivable(input), replace); },
    update(id, input) { return mutate(() => api.updateReceivable(id, input), replace); },
    addPayment(id, input) { return mutate(() => api.addPayment(id, input), replace); },
    removePayment(id, paymentId, version) { return mutate(() => api.removePayment(id, paymentId, version), replace); },
    addFollowUp(id, input) { return mutate(() => api.addFollowUp(id, input), replace); },
    remove(id, version) { return mutate(() => api.deleteReceivable(id, version), () => { revision += 1; records = records.filter((item) => item.id !== id); }); },
    importRecords(input) { return mutate(() => api.importReceivables(input), result => { revision += 1; records = result.records; return result; }); },
  };
}
