import type {
  NormalizedJourneyPlan,
  ProviderSnapshot,
} from '../src/providers/contracts.js';

const acceptProviderSnapshot = (
  snapshot: ProviderSnapshot<NormalizedJourneyPlan>,
): void => {
  void snapshot;
};

const validFailureSnapshot: ProviderSnapshot<NormalizedJourneyPlan> = {
  dataMode: 'live',
  value: null,
  evidence: [],
  failure: {
    code: 'PROVIDER_UNAVAILABLE',
    message: 'Provider unavailable',
  },
};

acceptProviderSnapshot(validFailureSnapshot);

const invalidFailureSnapshot = {
  dataMode: 'live' as const,
  value: { route: null, transferMinutes: 0 },
  evidence: [],
  failure: {
    code: 'PROVIDER_UNAVAILABLE' as const,
    message: 'Provider unavailable',
  },
};

// @ts-expect-error Failure snapshots must not carry a normalized value.
acceptProviderSnapshot(invalidFailureSnapshot);
