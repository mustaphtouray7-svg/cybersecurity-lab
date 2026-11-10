const commonPasswords = new Set([
  'password', 'password123', 'qwerty123', 'letmein', 'welcome123', 'admin123',
  'iloveyou', '123456789012', 'changeme',
]);

export function assessPassphrase(value) {
  const text = String(value ?? '');
  const lower = text.toLowerCase();
  const longEnough = text.length >= 14;
  const hasVariety = /[a-z]/.test(text) && /[A-Z]/.test(text) && /\d/.test(text)
    || /\s/.test(text) && text.trim().split(/\s+/).length >= 4;
  const common = commonPasswords.has(lower) || /^(.)\1+$/.test(lower);
  const score = text.length === 0 ? 0
    : common ? 1
      : Math.max(1, Number(longEnough) + Number(hasVariety) + Number(new Set(text).size >= 8) + Number(text.length >= 20));
  const labels = ['WAITING', 'WEAK', 'FAIR', 'GOOD', 'STRONG'];

  return {
    score: Math.min(score, 4),
    label: labels[Math.min(score, 4)],
    longEnough,
    hasVariety,
    uniqueEnough: !common && new Set(text).size >= 8,
  };
}

export function getCompletionPercent(completed) {
  return Math.round((completed.length / 3) * 100);
}