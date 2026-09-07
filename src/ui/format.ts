const numberFormat = new Intl.NumberFormat('cs-CZ');
export const formatCount = (value: number) => numberFormat.format(value);
export const formatDecimal = (value: number, digits = 1) => new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
export const formatDateTime = (value: string | number) => new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
