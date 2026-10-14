export const FEATURE_CATALOG = Object.freeze({
  core_receivables: { name: '应收与跟进', status: 'available', plan: 'free' },
  data_backup: { name: '数据备份', status: 'available', plan: 'free' },
  advanced_reminders: { name: '高级提醒与摘要', status: 'planned', plan: 'vip' },
  advanced_reports: { name: '回款分析与月报', status: 'planned', plan: 'vip' },
  branded_statements: { name: '品牌化对账单', status: 'planned', plan: 'vip' },
  bulk_tools: { name: '批量处理与周期应收', status: 'planned', plan: 'vip' },
});

export function getFreeEntitlements() {
  return { plan: 'free', expiresAt: null, features: Object.fromEntries(Object.entries(FEATURE_CATALOG).map(([code, feature]) => [code, feature.status === 'available' && feature.plan === 'free'])) };
}

export function requireFeature(entitlements, code) {
  if (FEATURE_CATALOG[code]?.status !== 'available' || entitlements?.features?.[code] !== true) {
    const error = new Error('此功能尚未开放或当前账号没有使用权限');
    error.code = 'FEATURE_UNAVAILABLE';
    throw error;
  }
}
