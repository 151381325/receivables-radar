export function createCloudRepository(api) {
  let records = [];
  const replace = (record) => {
    const index = records.findIndex((item) => item.id === record.id);
    records = index < 0 ? [...records, record] : records.map((item) => item.id === record.id ? record : item);
    return record;
  };
  return {
    list: () => structuredClone(records),
    get: (id) => structuredClone(records.find((item) => item.id === id) ?? null),
    async load() { records = await api.listReceivables(); return this.list(); },
    async create(input) { return replace(await api.createReceivable(input)); },
    async update(id, input) { return replace(await api.updateReceivable(id, input)); },
    async addPayment(id, input) { return replace(await api.addPayment(id, input)); },
    async addFollowUp(id, input) { return replace(await api.addFollowUp(id, input)); },
    async remove(id, version) { await api.deleteReceivable(id, version); records = records.filter((item) => item.id !== id); },
    async importRecords(input) { const result = await api.importReceivables(input); records = result.records; return result; },
  };
}
