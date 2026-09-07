import type {
  JourneyCheckRequestInput,
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
): { text: string; atMs: number; localServiceDate: string } | undefined {
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
      'protectedDeparture',
      'safetyBufferMinutes',
      'constraints',
    ])
  ) {
    issues.push('request contains an unknown field');
  }

  const originValue = value.origin;
  const origin = isRecord(originValue)
    ? readOrigin(originValue, issues)
    : (issues.push('origin must be an object'), undefined);
  const destinationValue = value.destination;
  const destination = isRecord(destinationValue)
    ? readDestination(destinationValue, issues)
    : (issues.push('destination must be an object'), undefined);
  const protectedDepartureValue = value.protectedDeparture;
  const protectedDeparture = isRecord(protectedDepartureValue)
    ? readProtectedDeparture(protectedDepartureValue, issues)
    : (issues.push('protectedDeparture must be an object'), undefined);

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
    protectedDeparture === undefined ||
    safetyBufferMinutes === undefined ||
    constraints === undefined
  ) {
    return { ok: false, issues };
  }

  const result: ValidatedJourneyCheckRequest = {
    origin,
    destination,
    protectedDeparture,
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
): JourneyCheckRequestInput['origin'] | undefined {
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
): JourneyCheckRequestInput['destination'] | undefined {
  if (!hasOnlyKeys(value, ['name', 'nationalRailCrs'])) {
    issues.push('destination contains an unknown field');
  }
  const name = readNonEmptyString(
    value.name,
    'destination.name',
    MAX_NAME_LENGTH,
    issues,
  );
  const nationalRailCrs = readOptionalString(
    value.nationalRailCrs,
    'destination.nationalRailCrs',
    3,
    issues,
  );
  if (nationalRailCrs !== undefined && !/^[A-Z]{3}$/.test(nationalRailCrs)) {
    issues.push('destination.nationalRailCrs must be three uppercase letters');
  }
  if (
    name === undefined ||
    (value.nationalRailCrs !== undefined &&
      (nationalRailCrs === undefined || !/^[A-Z]{3}$/.test(nationalRailCrs)))
  ) {
    return undefined;
  }
  return nationalRailCrs === undefined ? { name } : { name, nationalRailCrs };
}

function readProtectedDeparture(
  value: Record<string, unknown>,
  issues: string[],
): ValidatedJourneyCheckRequest['protectedDeparture'] | undefined {
  if (!hasOnlyKeys(value, ['at', 'kind', 'serviceLabel'])) {
    issues.push('protectedDeparture contains an unknown field');
  }
  const instant = readExplicitInstant(
    value.at,
    'protectedDeparture.at',
    issues,
  );
  if (value.kind !== 'national_rail_departure') {
    issues.push('protectedDeparture.kind must be national_rail_departure');
  }
  const serviceLabel = readOptionalString(
    value.serviceLabel,
    'protectedDeparture.serviceLabel',
    MAX_NAME_LENGTH,
    issues,
  );
  if (
    instant === undefined ||
    value.kind !== 'national_rail_departure' ||
    (value.serviceLabel !== undefined && serviceLabel === undefined)
  ) {
    return undefined;
  }
  const base = {
    at: instant.text,
    kind: 'national_rail_departure' as const,
    atMs: instant.atMs,
    localServiceDate: instant.localServiceDate,
  };
  return serviceLabel === undefined ? base : { ...base, serviceLabel };
}

function readConstraints(
  value: unknown,
  issues: string[],
):
  | (JourneyCheckRequestInput['constraints'] & { stepFreeRequired: boolean })
  | undefined {
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
  } as JourneyCheckRequestInput['constraints'] & { stepFreeRequired: boolean };
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
