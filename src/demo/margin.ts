export interface MarginInput {
  arrivalMs: number;
  departureMs: number;
  additionalTransferMinutes: number;
  safetyBufferMinutes: number;
}

// Arithmetic demonstration only, not the production viability evaluator.
export function assessDemoMargin(input: MarginInput) {
  if (
    !Number.isFinite(input.arrivalMs) ||
    !Number.isFinite(input.departureMs) ||
    !Number.isFinite(input.additionalTransferMinutes) ||
    input.additionalTransferMinutes < 0 ||
    !Number.isFinite(input.safetyBufferMinutes) ||
    input.safetyBufferMinutes < 0
  ) {
    throw new Error('Invalid margin input');
  }
  const connectionMarginMinutes =
    (input.departureMs - input.arrivalMs) / 60000 -
    input.additionalTransferMinutes;
  const remainingAfterBufferMinutes =
    connectionMarginMinutes - input.safetyBufferMinutes;
  const outcome =
    connectionMarginMinutes <= 0
      ? 'connection_missed'
      : remainingAfterBufferMinutes < 0
        ? 'buffer_not_met'
        : 'buffer_met';
  return {
    outcome,
    additionalTransferMinutes: input.additionalTransferMinutes,
    safetyBufferMinutes: input.safetyBufferMinutes,
    connectionMarginMinutes,
    remainingAfterBufferMinutes,
  };
}
