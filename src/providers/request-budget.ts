export const providerRequestOperations = [
  'journeyPlanner',
  'timetable',
  'arrivals',
  'lineStatus',
  'stopDisruption',
  'darwinBoard',
  'darwinServiceDetails',
] as const;

export type ProviderRequestOperation =
  (typeof providerRequestOperations)[number];

export type ProviderRequestLimits = Readonly<
  Record<ProviderRequestOperation, number>
>;

export type RequestBudgetDecision =
  | {
      allowed: true;
      deduplicated: boolean;
      usage: number;
    }
  | {
      allowed: false;
      deduplicated: false;
      usage: number;
      reason: 'budget_exhausted';
    };

export interface ProviderRequestBudget {
  /**
   * Reserve one request. Identical keys are deduplicated and must reuse the
   * existing result rather than dispatching another network request; retries
   * must use a distinct key so that they consume the configured budget.
   *
   * Keys are internal identifiers and must not contain credentials, query
   * strings with secrets or raw provider payloads.
   */
  reserve(
    operation: ProviderRequestOperation,
    requestKey: string,
  ): RequestBudgetDecision;
  usage(operation: ProviderRequestOperation): number;
}

export function createProviderRequestBudget(
  limits: ProviderRequestLimits,
): ProviderRequestBudget {
  const configuredLimits: ProviderRequestLimits = { ...limits };
  validateLimits(configuredLimits);

  const usageByOperation = new Map<ProviderRequestOperation, number>();
  const keysByOperation = new Map<ProviderRequestOperation, Set<string>>();

  for (const operation of providerRequestOperations) {
    usageByOperation.set(operation, 0);
    keysByOperation.set(operation, new Set());
  }

  return {
    reserve(operation, requestKey) {
      if (requestKey.trim() === '') {
        throw new Error('requestKey must be a non-empty string');
      }

      const usage = usageByOperation.get(operation) ?? 0;
      const keys = keysByOperation.get(operation);
      if (keys === undefined) {
        throw new Error(`Unknown provider operation: ${operation}`);
      }

      if (keys.has(requestKey)) {
        return { allowed: true, deduplicated: true, usage };
      }

      if (usage >= configuredLimits[operation]) {
        return {
          allowed: false,
          deduplicated: false,
          usage,
          reason: 'budget_exhausted',
        };
      }

      keys.add(requestKey);
      const nextUsage = usage + 1;
      usageByOperation.set(operation, nextUsage);
      return { allowed: true, deduplicated: false, usage: nextUsage };
    },

    usage(operation) {
      const currentUsage = usageByOperation.get(operation);
      if (currentUsage === undefined) {
        throw new Error(`Unknown provider operation: ${operation}`);
      }
      return currentUsage;
    },
  };
}

function validateLimits(limits: ProviderRequestLimits): void {
  for (const operation of providerRequestOperations) {
    const limit = limits[operation];
    if (!Number.isInteger(limit) || limit < 0) {
      throw new Error(
        `Request budget for ${operation} must be a non-negative integer`,
      );
    }
  }
}
