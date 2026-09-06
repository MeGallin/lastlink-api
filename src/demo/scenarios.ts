// Synthetic test data, not a timetable or a verified service.
export const demoWarning =
  'Fictional test data only. Do not use for travel decisions.';

export const scenarios = [
  {
    id: 'stratford-waterloo-demo',
    origin: 'Stratford',
    destination: 'Waterloo National Rail',
    arrivalAt: '2026-09-07T00:20:00+01:00',
    protectedDepartureAt: '2026-09-07T00:35:00+01:00',
    additionalTransferMinutes: 10,
    description:
      'Fictional arrival before an additional transfer not included in arrivalAt.',
  },
] as const;
