import type {
  JourneyConstraintsInput,
  JourneyDestinationInput,
  JourneyLocationInput,
  JourneyRequestValidation,
  ValidatedJourneyCheckRequest,
} from './types.js';
import { parseExplicitInstant } from './time.js';

const MAX_NAME_LENGTH = 120;
const MAX_IDENTIFIER_LENGTH = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function readNonEmptyString(
  value: unknown,
  field: string,
  maximum: number,
  issues: string[],
): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    issues.push(`${field} must be a non-empty string`);
    return undefined;
  }
  if (value.length > maximum) {
    issues.push(`${field} must be at most ${maximum} characters`);
    return undefined;
  }
  return value;
}

function readOptionalString(
  value: unknown,
  field: string,
  maximum: number,
  issues: string[],
): string | undefined {
  if (value === undefined) return undefined;
  return readNonEmptyString(value, field, maximum, issues);
}

function readExplicitInstant(
  value: unknown,
  field: string,
  issues: string[],
): { text: string; atMs: number } | undefined {
  if (typeof value !== 'string') {
    issues.push(
      `${field} must be an ISO-8601 timestamp with an explicit offset`,
    );
    return undefined;
  }
  const instant = parseExplicitInstant(value);
  if (instant === undefined) {
    issues.push(
      `${field} must be an ISO-8601 timestamp with an explicit offset`,
    );
    return undefined;
  }
  return instant;
}

function readOptionalIdentifier(
  value: unknown,
  field: string,
  issues: string[],
): string | undefined {
  return readOptionalString(value, field, MAX_IDENTIFIER_LENGTH, issues);
}

export function validateJourneyCheckRequest(
  value: unknown,
): JourneyRequestValidation {
  const issues: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, issues: ['request must be a JSON object'] };
  }
  if (
    !hasOnlyKeys(value, [
      'origin',
      'destination',
      'arriveBy',
      'onwardDepartureAt',
      'stationTransferMinutes',
      'safetyBufferMinutes',
      'constraints',
    ])
  ) {
    issues.push('request contains an unknown field');
  }

  const origin = isRecord(value.origin)
    ? readOrigin(value.origin, issues)
    : (issues.push('origin must be an object'), undefined);
  const destination = isRecord(value.destination)
    ? readDestination(value.destination, issues)
    : (issues.push('destination must be an object'), undefined);
  const deadline = readDeadline(value, issues);
  const safetyBufferMinutes = readInteger(
    value.safetyBufferMinutes,
    'safetyBufferMinutes',
    0,
    60,
    issues,
  );
  const constraints = readConstraints(value.constraints, issues);

  if (
    origin === undefined ||
    destination === undefined ||
    deadline === undefined ||
    safetyBufferMinutes === undefined ||
    constraints === undefined
  ) {
    return { ok: false, issues };
  }

  const result: ValidatedJourneyCheckRequest = {
    origin,
    destination,
    deadline,
    safetyBufferMinutes,
    constraints,
  };
  return issues.length === 0
    ? { ok: true, value: result }
    : { ok: false, issues };
}

function readOrigin(
  value: Record<string, unknown>,
  issues: string[],
): JourneyLocationInput | undefined {
  if (!hasOnlyKeys(value, ['name', 'tflStopPointId'])) {
    issues.push('origin contains an unknown field');
  }
  const name = readNonEmptyString(
    value.name,
    'origin.name',
    MAX_NAME_LENGTH,
    issues,
  );
  const tflStopPointId = readOptionalIdentifier(
    value.tflStopPointId,
    'origin.tflStopPointId',
    issues,
  );
  if (
    name === undefined ||
    (value.tflStopPointId !== undefined && tflStopPointId === undefined)
  ) {
    return undefined;
  }
  return tflStopPointId === undefined ? { name } : { name, tflStopPointId };
}

function readDestination(
  value: Record<string, unknown>,
  issues: string[],
): JourneyDestinationInput | undefined {
  if (!hasOnlyKeys(value, ['name', 'tflStopPointId'])) {
    issues.push('destination contains an unknown field');
  }
  const name = readNonEmptyString(
    value.name,
    'destination.name',
    MAX_NAME_LENGTH,
    issues,
  );
  const tflStopPointId = readOptionalIdentifier(
    value.tflStopPointId,
    'destination.tflStopPointId',
    issues,
  );
  if (
    name === undefined ||
    (value.tflStopPointId !== undefined && tflStopPointId === undefined)
  ) {
    return undefined;
  }
  return tflStopPointId === undefined ? { name } : { name, tflStopPointId };
}

function readDeadline(
  value: Record<string, unknown>,
  issues: string[],
): ValidatedJourneyCheckRequest['deadline'] | undefined {
  const hasDirectDeadline = value.arriveBy !== undefined;
  const hasOnwardDeparture = value.onwardDepartureAt !== undefined;
  const hasStationTransfer = value.stationTransferMinutes !== undefined;

  if (hasDirectDeadline && hasOnwardDeparture) {
    issues.push('provide arriveBy or onwardDepartureAt, not both');
    return undefined;
  }
  if (!hasDirectDeadline && !hasOnwardDeparture) {
    issues.push('provide arriveBy or onwardDepartureAt');
    return undefined;
  }
  if (hasStationTransfer && !hasOnwardDeparture) {
    issues.push('stationTransferMinutes is only valid with onwardDepartureAt');
    return undefined;
  }

  const direct = hasDirectDeadline
    ? readExplicitInstant(value.arriveBy, 'arriveBy', issues)
    : undefined;
  const onward = hasOnwardDeparture
    ? readExplicitInstant(value.onwardDepartureAt, 'onwardDepartureAt', issues)
    : undefined;
  const stationTransferMinutes = hasOnwardDeparture
    ? readInteger(
        value.stationTransferMinutes,
        'stationTransferMinutes',
        0,
        120,
        issues,
      )
    : undefined;

  if (direct !== undefined) {
    return {
      arriveBy: direct.text,
      arriveByAtMs: direct.atMs,
      source: 'user_input',
    };
  }
  if (onward === undefined || stationTransferMinutes === undefined) {
    return undefined;
  }
  const arriveByAtMs = onward.atMs - stationTransferMinutes * 60_000;
  const arriveBy = new Date(arriveByAtMs).toISOString();
  return {
    arriveBy,
    arriveByAtMs,
    source: 'derived_from_onward_departure',
    onwardDepartureAt: onward.text,
    onwardDepartureAtMs: onward.atMs,
    stationTransferMinutes,
  };
}

function readConstraints(
  value: unknown,
  issues: string[],
): (JourneyConstraintsInput & { stepFreeRequired: boolean }) | undefined {
  if (value === undefined) return { stepFreeRequired: false };
  if (!isRecord(value)) {
    issues.push('constraints must be an object');
    return undefined;
  }
  if (!hasOnlyKeys(value, ['walkingMinutesLimit', 'stepFreeRequired'])) {
    issues.push('constraints contains an unknown field');
  }
  const walkingMinutesLimit = readInteger(
    value.walkingMinutesLimit,
    'constraints.walkingMinutesLimit',
    0,
    180,
    issues,
    true,
  );
  if (
    value.stepFreeRequired !== undefined &&
    typeof value.stepFreeRequired !== 'boolean'
  ) {
    issues.push('constraints.stepFreeRequired must be a boolean');
  }
  if (
    value.walkingMinutesLimit !== undefined &&
    walkingMinutesLimit === undefined
  ) {
    return undefined;
  }
  if (
    value.stepFreeRequired !== undefined &&
    typeof value.stepFreeRequired !== 'boolean'
  ) {
    return undefined;
  }
  const result = {
    stepFreeRequired: value.stepFreeRequired ?? false,
  } as JourneyConstraintsInput & { stepFreeRequired: boolean };
  if (walkingMinutesLimit !== undefined) {
    result.walkingMinutesLimit = walkingMinutesLimit;
  }
  return result;
}

function readInteger(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
  issues: string[],
  optional = false,
): number | undefined {
  if (value === undefined && optional) return undefined;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    issues.push(
      `${field} must be an integer from ${minimum} through ${maximum}`,
    );
    return undefined;
  }
  return value;
}
