import { addFollowUp, addPayment, createReceivable } from './domain.js';

const BACKUP_VERSION = 1;

function requireId(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new Error('记录 ID 无效');
  return value;
}

export function validateImportRecords(input) {
  if (!Array.isArray(input) || !input.length || input.length > 500) throw new Error('导入记录必须在1至500条之间');
  const ids = new Set();
  return input.map(source => {
    if (!isValidRecord(source)) throw new Error('备份中的记录结构不完整');
    const id = requireId(source.id);
    if (ids.has(id)) throw new Error('应收记录 ID 重复');
    ids.add(id);
    const createdAt = source.createdAt ?? new Date().toISOString();
    const updatedAt = source.updatedAt ?? createdAt;
    for (const timestamp of [createdAt, updatedAt]) {
      if (typeof timestamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(timestamp) || !Number.isFinite(Date.parse(timestamp))) throw new Error('记录时间格式不正确');
    }
    if (source.paymentRecords.length > 2000 || source.followUpRecords.length > 2000) throw new Error('单笔历史记录过多');
    let normalized = createReceivable({ ...source, paymentRecords: [], followUpRecords: [] }, updatedAt);
    for (const [key, append] of [['paymentRecords', addPayment], ['followUpRecords', addFollowUp]]) {
      const childIds = new Set();
      for (const item of source[key]) {
        const childId = requireId(item?.id);
        if (childIds.has(childId)) throw new Error('历史记录 ID 重复');
        childIds.add(childId);
        normalized = append(normalized, item, updatedAt);
        normalized[key].at(-1).id = childId;
      }
    }
    // Preserve explicitly edited follow-up schedules and backup metadata.
    normalized.nextFollowUpDate = createReceivable(source, updatedAt).nextFollowUpDate;
    return { ...normalized, createdAt, updatedAt, ...(source.version ? { version: source.version } : {}) };
  });
}

function isDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isValidRecord(record) {
  return record
    && typeof record.id === 'string'
    && typeof record.clientName === 'string'
    && typeof record.projectName === 'string'
    && Number.isFinite(Number(record.totalAmount))
    && Number(record.totalAmount) > 0
    && typeof record.invoiceSent === 'boolean'
    && isDate(record.dueDate)
    && Array.isArray(record.paymentRecords)
    && Array.isArray(record.followUpRecords);
}

export function serializeBackup(records, exportedAt = new Date().toISOString()) {
  return JSON.stringify({
    version: BACKUP_VERSION,
    exportedAt,
    records,
  }, null, 2);
}

export function parseBackup(jsonText, existingRecords = []) {
  let backup;
  try {
    backup = JSON.parse(jsonText);
  } catch {
    throw new Error('备份文件无法读取，请选择由回款雷达导出的 JSON 文件');
  }

  if (backup?.version !== BACKUP_VERSION) throw new Error('备份文件版本不受支持');
  if (!Array.isArray(backup.records)) throw new Error('备份文件缺少记录列表');
  const normalizedRecords = backup.records.length ? validateImportRecords(backup.records) : [];

  const records = structuredClone(existingRecords);
  const existingIds = new Set(records.map((record) => record.id));
  let importedCount = 0;
  let skippedCount = 0;

  for (const record of normalizedRecords) {
    if (existingIds.has(record.id)) {
      skippedCount += 1;
      continue;
    }
    records.push(structuredClone(record));
    existingIds.add(record.id);
    importedCount += 1;
  }

  return { records, importedCount, skippedCount };
}
