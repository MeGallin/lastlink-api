# Demo route contract v0.1

These two endpoints demonstrate request validation and arithmetic only. They are
not the final passenger journey contract. All data is synthetic, not recorded API
evidence. No source freshness or live confidence is assessed.

## GET /api/v1/demo/scenarios

Returns dataMode=fixture, a warning and one scenario: stratford-waterloo-demo.
Its fictional arrival at 00:20 and departure at 00:35 use explicit +01:00 offsets.
The additional 10-minute transfer is NOT already included in arrivalAt. It is an
illustrative input, not an approved Waterloo transfer allowance or a real train.

## POST /api/v1/demo/journey-check

Content-Type must be application/json. Body maximum: 4kb.

```json
{
  "scenarioId": "stratford-waterloo-demo",
  "safetyBufferMinutes": 5
}
```

Both fields required; no extra fields. scenarioId: string 1–100 characters.
safetyBufferMinutes: integer 0–60 inclusive, no coercion and no default. The range
is a demo validation constraint, not a product policy.

HTTP 200 returns dataMode=fixture, warning, liveJourneyVerified=false, the scenario
and simulation with outcome and margin components. A result never verifies travel.

- Connection margin = departure minus arrival minus additional transfer.
- Remaining after buffer = connection margin minus requested safety buffer.
- Connection margin <= 0: connection_missed (no boarding time remains).
- Positive connection margin but negative remaining buffer: buffer_not_met.
- Positive connection margin and nonnegative remaining buffer: buffer_met.

For this fixture the connection margin is 5 minutes. Buffer 5 produces buffer_met
with zero remaining buffer; buffer 6 produces buffer_not_met with -1. Change the
request in Postman to observe the calculation rather than a canned decision.

Errors use {error:{code,message}}:
400 INVALID_INPUT / INVALID_JSON, 404 SCENARIO_NOT_FOUND, 413 PAYLOAD_TOO_LARGE,
415 UNSUPPORTED_MEDIA_TYPE, generic safe 500 INTERNAL_ERROR. Unknown paths or
unsupported methods retain the existing NOT_FOUND 404 contract.

Responses under /demo use Cache-Control: no-store.

## Not implemented

No station search, real service matching, disruptions, live arrivals, source
freshness, cancellation gating, passenger confidence or production viability
decision. Offset-free provider times and DST ambiguity remain unresolved.
No provider keys, database, AI, Docker or frontend added.
