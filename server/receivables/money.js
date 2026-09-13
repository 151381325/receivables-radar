function normalizeYuan(value) {
  const text = String(value ?? '').trim();
  if (/^-\d+(?:\.\d{1,2})?$/.test(text)) throw new Error('金额必须大于0');
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) {
    if (/^\d+\.\d{3,}$/.test(text)) throw new Error('金额最多两位小数');
    throw new Error('金额格式不正确');
  }
  return text;
}

export function yuanToFen(value) {
  const text = normalizeYuan(value);
  const [whole, fraction = ''] = text.split('.');
  const fen = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(fen) || fen <= 0) throw new Error('金额必须大于0');
  return fen;
}

export function fenToYuan(value) {
  if (!Number.isSafeInteger(value)) throw new Error('金额必须是整数分');
  return value / 100;
}
