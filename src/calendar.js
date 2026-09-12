function compactDate(dateText) {
  return dateText.replaceAll('-', '');
}

function nextDate(dateText) {
  const [year, month, day] = dateText.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function escapeIcs(value) {
  return String(value)
    .replaceAll('\\', '\\\\')
    .replaceAll('\n', '\\n')
    .replaceAll(',', '\\,')
    .replaceAll(';', '\\;');
}

export function buildCalendarEvent(record, eventType = 'followUp') {
  const isFollowUp = eventType === 'followUp';
  const date = isFollowUp ? record.nextFollowUpDate : record.dueDate;
  if (!date) throw new Error(isFollowUp ? '该记录尚未设置下次跟进日期' : '该记录尚未设置付款截止日期');

  const label = isFollowUp ? '回款跟进' : '付款到期';
  const summary = `${label}：${record.clientName}`;
  const description = `${record.projectName}，剩余待收 ¥${Number(record.remainingAmount).toFixed(2)}`;
  const uid = `${record.id}-${eventType}@receivables-radar.local`;

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Receivables Radar//CN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${escapeIcs(uid)}`,
    `DTSTART;VALUE=DATE:${compactDate(date)}`,
    `DTEND;VALUE=DATE:${compactDate(nextDate(date))}`,
    `SUMMARY:${escapeIcs(summary)}`,
    `DESCRIPTION:${escapeIcs(description)}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}
