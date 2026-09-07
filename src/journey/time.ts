export interface ParsedInstant {
  text: string;
  atMs: number;
  localServiceDate: string;
}

const instantPattern =
  /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

export function parseExplicitInstant(
  value: unknown,
): ParsedInstant | undefined {
  if (typeof value !== 'string') return undefined;
  const match = instantPattern.exec(value);
  if (match === null) return undefined;
  const localServiceDate = match[1];
  if (localServiceDate === undefined || !isCalendarDate(localServiceDate)) {
    return undefined;
  }
  const atMs = Date.parse(value);
  return Number.isFinite(atMs)
    ? { text: value, atMs, localServiceDate }
    : undefined;
}

function isCalendarDate(value: string): boolean {
  const parts = value.split('-').map(Number);
  const year = parts[0];
  const month = parts[1];
  const day = parts[2];
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    month < 1 ||
    month > 12 ||
    day < 1
  ) {
    return false;
  }
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ][month - 1];
  return daysInMonth !== undefined && day <= daysInMonth;
}
