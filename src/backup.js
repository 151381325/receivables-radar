const BACKUP_VERSION = 1;

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
  if (!backup.records.every(isValidRecord)) throw new Error('备份中的记录结构不完整');

  const records = structuredClone(existingRecords);
  const existingIds = new Set(records.map((record) => record.id));
  let importedCount = 0;
  let skippedCount = 0;

  for (const record of backup.records) {
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
