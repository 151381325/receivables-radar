export function queryReceivables(records, { query = '', status = 'all', risk = 'all', sort = 'date-asc', today } = {}) {
  const keyword = query.trim().toLocaleLowerCase();
  const result = records.filter(record => {
    if (status !== 'all' && record.status !== status) return false;
    if (keyword && !`${record.clientName} ${record.projectName}`.toLocaleLowerCase().includes(keyword)) return false;
    if (risk === 'overdue' && !record.isOverdue) return false;
    if (risk === 'upcoming') {
      const distance = (Date.parse(record.dueDate) - Date.parse(today)) / 86400000;
      if (!Number.isFinite(distance) || distance < 0 || distance > 7 || ['paid', 'paused'].includes(record.status)) return false;
    }
    return true;
  });
  return result.sort((a, b) => {
    if (sort === 'amount-desc') return b.remainingAmount - a.remainingAmount || a.id.localeCompare(b.id);
    if (sort === 'amount-asc') return a.remainingAmount - b.remainingAmount || a.id.localeCompare(b.id);
    if (sort === 'priority') return a.actionPriority - b.actionPriority || a.dueDate.localeCompare(b.dueDate);
    return (sort === 'date-desc' ? -1 : 1) * a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id);
  });
}
