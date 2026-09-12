export const DEFAULT_STORAGE_KEY = 'receivables-radar:v1';

export function createRepository(storage, key = DEFAULT_STORAGE_KEY) {
  function list() {
    try {
      const parsed = JSON.parse(storage.getItem(key) ?? '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function write(records) {
    storage.setItem(key, JSON.stringify(records));
    return records;
  }

  return {
    list,
    get(id) {
      return list().find((record) => record.id === id) ?? null;
    },
    save(record) {
      const records = list();
      const index = records.findIndex((item) => item.id === record.id);
      if (index >= 0) records[index] = record;
      else records.push(record);
      write(records);
      return record;
    },
    remove(id) {
      return write(list().filter((record) => record.id !== id));
    },
    replaceAll(records) {
      if (!Array.isArray(records)) throw new Error('记录集合必须是数组');
      return write(structuredClone(records));
    },
  };
}
