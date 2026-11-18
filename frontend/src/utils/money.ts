/** Formats a backend `numeric` amount (major units, may arrive as a string) in the given ISO currency. */
export function formatMoney(amount: number | string, currency: string): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return '';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: value % 1 === 0 ? 0 : 2 }).format(value);
  } catch {
    return `${value} ${currency}`;
  }
}
