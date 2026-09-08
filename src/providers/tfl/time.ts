import {
  parseExplicitInstant,
  type ParsedInstant,
} from '../../journey/time.js';

const londonClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/**
 * TfL Journey Planner's offset-free fields are London wall times, not the
 * server's local time. Limit inferred dates to modern GMT/BST years. Validate
 * both possible offsets against IANA rules; accept exactly one matching instant.
 * Never guess either occurrence of a repeated hour or roll a missing hour forward.
 * Explicit-offset values retain their original representation.
 */
export function parseTflInstant(value: unknown): ParsedInstant | undefined {
  const explicit = parseExplicitInstant(value);
  if (explicit !== undefined) return explicit;
  if (
    typeof value !== 'string' ||
    !/^20[0-9]{2}-[0-9]{2}-[0-9]{2}T(?:[01][0-9]|2[0-3]):[0-5][0-9](?::[0-5][0-9](?:\.[0-9]{1,3})?)?$/.test(
      value,
    )
  ) {
    return undefined;
  }
  // Appending Z is only a calendar-validation/field-comparison aid, not an
  // interpretation of the provider's timezone.
  const wall = parseExplicitInstant(value + 'Z');
  if (wall === undefined) return undefined;
  const expected = new Date(wall.atMs).toISOString().slice(0, 19);
  const matches: ParsedInstant[] = [];
  for (const suffix of ['+00:00', '+01:00']) {
    const candidate = parseExplicitInstant(value + suffix);
    if (candidate === undefined) continue;
    const parts = new Map(
      londonClock
        .formatToParts(candidate.atMs)
        .map((part) => [part.type, part.value]),
    );
    const local = `${parts.get('year')}-${parts.get('month')}-${parts.get('day')}T${parts.get('hour')}:${parts.get('minute')}:${parts.get('second')}`;
    if (local === expected) matches.push(candidate);
  }
  return matches.length === 1 ? matches[0] : undefined;
}
