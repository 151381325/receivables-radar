function money(value) {
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function chineseDate(dateText) {
  const [year, month, day] = dateText.split('-').map(Number);
  return `${year}年${month}月${day}日`;
}

export function buildReminderMessage(record) {
  const context = {
    client: record.clientName,
    project: record.projectName,
    amount: money(record.remainingAmount),
    due: chineseDate(record.dueDate),
  };

  if (record.promiseOverdue && record.latestPromiseDate) {
    return {
      stage: 'promise_overdue',
      text: `${context.client}您好，想跟您确认一下「${context.project}」的款项。此前确认的${chineseDate(record.latestPromiseDate)}已经到了，目前剩余 ¥${context.amount} 尚未到账，麻烦告知一下新的付款安排，谢谢。`,
    };
  }

  if (record.isOverdue && record.overdueDays > 7) {
    return {
      stage: 'overdue_formal',
      text: `${context.client}您好，「${context.project}」剩余款项 ¥${context.amount} 已超过约定付款日 ${context.due} 共 ${record.overdueDays} 天。为便于双方安排，请您今天确认具体付款日期，谢谢。`,
    };
  }

  if (record.isOverdue && record.overdueDays >= 4) {
    return {
      stage: 'overdue_clear',
      text: `${context.client}您好，跟进一下「${context.project}」剩余款项 ¥${context.amount}，约定付款日为 ${context.due}。请问目前预计哪天可以安排付款？`,
    };
  }

  if (record.isOverdue) {
    return {
      stage: 'overdue_gentle',
      text: `${context.client}您好，提醒一下「${context.project}」剩余款项 ¥${context.amount}，付款日是 ${context.due}。想确认下款项是否已经安排，感谢。`,
    };
  }

  return {
    stage: 'pre_due',
    text: `${context.client}您好，提前提醒一下「${context.project}」剩余款项 ¥${context.amount} 将于 ${context.due} 到期。如付款资料还需要补充，请随时告诉我，谢谢。`,
  };
}
