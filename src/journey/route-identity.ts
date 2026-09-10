import type { JourneyRoute, JourneyRouteLeg } from './types.js';
import { stationNamesMatch } from './station-identity.js';

export interface RequestedStationIdentity {
  name: string;
  tflStopPointId?: string;
}

/**
 * Prefer TfL's canonical StopPoint identity when both sides provide it.
 * Names remain the compatibility fallback for fixtures and older responses.
 */
export function stationIdentityMatches(
  leftName: string,
  leftTflStopPointId: string | undefined,
  rightName: string,
  rightTflStopPointId: string | undefined,
): boolean {
  if (leftTflStopPointId !== undefined && rightTflStopPointId !== undefined) {
    return leftTflStopPointId === rightTflStopPointId;
  }
  return stationNamesMatch(leftName, rightName);
}

/**
 * Journey Planner can connect different transport StopPoints at one
 * interchange (for example Euston Underground and London Euston Rail). The
 * provider's interchange identity is stronger than a display-name fallback
 * and avoids treating a valid transfer as contradictory.
 */
export function stationConnectionMatches(
  leftName: string,
  leftTflStopPointId: string | undefined,
  leftInterchangeId: string | undefined,
  rightName: string,
  rightTflStopPointId: string | undefined,
  rightInterchangeId: string | undefined,
): boolean {
  if (
    leftInterchangeId !== undefined &&
    rightInterchangeId !== undefined &&
    leftInterchangeId === rightInterchangeId
  ) {
    return true;
  }
  return stationIdentityMatches(
    leftName,
    leftTflStopPointId,
    rightName,
    rightTflStopPointId,
  );
}

/**
 * Journey Planner can finish with a short access walk whose arrival point is
 * the station concourse rather than a NaPTAN StopPoint. In that shape, the
 * walk's origin is the requested StopPoint and is the trustworthy identity.
 */
export function destinationStationMatches(
  finalLeg: JourneyRouteLeg,
  destination: RequestedStationIdentity,
): boolean {
  if (
    stationIdentityMatches(
      finalLeg.to,
      finalLeg.toTflStopPointId,
      destination.name,
      destination.tflStopPointId,
    )
  ) {
    return true;
  }
  return (
    finalLeg.mode === 'walk' &&
    finalLeg.fromTflStopPointId !== undefined &&
    destination.tflStopPointId !== undefined &&
    finalLeg.fromTflStopPointId === destination.tflStopPointId
  );
}

export function routeEndpointsMatch(
  route: JourneyRoute,
  origin: RequestedStationIdentity,
  destination: RequestedStationIdentity,
): boolean {
  const firstLeg = route.legs[0];
  const finalLeg = route.legs.at(-1);
  return (
    firstLeg !== undefined &&
    finalLeg !== undefined &&
    stationIdentityMatches(
      firstLeg.from,
      firstLeg.fromTflStopPointId,
      origin.name,
      origin.tflStopPointId,
    ) &&
    destinationStationMatches(finalLeg, destination)
  );
}
