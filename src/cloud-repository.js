export function createCloudRepository(api) {
  let records = [];
  let revision = 0;
  let loadSequence = 0;
  const replace = (record) => {
    revision += 1;
    const index = records.findIndex((item) => item.id === record.id);
    records = index < 0 ? [...records, record] : records.map((item) => item.id === record.id ? record : item);
    return record;
  };
  return {
    list: () => structuredClone(records),
    get: (id) => structuredClone(records.find((item) => item.id === id) ?? null),
    clear() { records = []; revision += 1; loadSequence += 1; },
    async load() {
      const startingRevision = revision;
      const sequence = ++loadSequence;
      const response = await api.listReceivables();
      if (revision === startingRevision && loadSequence === sequence) records = response;
      return this.list();
    },
    async create(input) { return replace(await api.createReceivable(input)); },
    async update(id, input) { return replace(await api.updateReceivable(id, input)); },
    async addPayment(id, input) { return replace(await api.addPayment(id, input)); },
    async removePayment(id, paymentId, version) { return replace(await api.removePayment(id, paymentId, version)); },
    async addFollowUp(id, input) { return replace(await api.addFollowUp(id, input)); },
    async remove(id, version) { await api.deleteReceivable(id, version); revision += 1; records = records.filter((item) => item.id !== id); },
    async importRecords(input) { const result = await api.importReceivables(input); revision += 1; records = result.records; return result; },
  };
}
