# Journey-check contract v0.1 (proposed)

This is the provider-neutral contract for the first real journey assessment
increment. The current HTTP boundary is fixture-only and exists for controlled
validation; it is not a live journey service. The existing `/api/v1/demo/*`
routes remain synthetic examples and are intentionally unchanged.

The internal validator/evaluator, labelled fixtures and normalized provider
snapshot composition are implemented under `src/journey/` and `src/providers/`.
A fixture-only HTTP boundary is available at the proposed path for controlled
testing; live provider adapters and live journey verification remain deferred.

The contract is designed around one question:

> Can I reach the named destination in time for the protected departure, with the
> requested safety margin, using evidence that is current and complete enough to
> support that conclusion?

## Scope and safety boundary

- The backend is the authority for the deterministic decision. A client or model
  may collect and explain inputs but cannot upgrade an outcome.
- TfL and National Rail/Darwin are upstream authorities when live adapters are
  added. Fixture or cached data must identify its mode and capture time.
- A positive result is never a guarantee. Sudden disruption, platform access and
  passenger circumstances can invalidate a plan.
- Missing, contradictory, stale or ambiguous evidence must result in
  `unable_to_verify`, or in a more conservative negative result where the rule
  explicitly requires it. An empty arrivals response alone is not proof that a
  service has finished.
- No live provider calls, credentials, database, AI or passenger release are
  implied by this document.

## Proposed endpoint

`POST /api/v1/journey-check`

The endpoint will require `Content-Type: application/json`, reject unknown fields
and return `Cache-Control: no-store`. The exact HTTP error envelope will follow
the existing `{ error: { code, message } }` convention.

## Provider adapter boundary

The evaluator accepts normalized evidence and does not know whether it came from
TfL, Darwin, a short-lived cache or a fixture. Provider-specific parsing belongs
inside adapters. The current TypeScript boundary is:

- `JourneyPlannerAdapter.getPlan(request)` returns a `ProviderSnapshot` whose
  value is a normalized route plus the separately represented transfer allowance.
- `ProtectedDepartureAdapter.getProtectedDeparture(request)` returns a
  `ProviderSnapshot` whose value is the reconciled protected event.
- Every snapshot carries `dataMode` and provenance `evidence`; raw provider
  payloads, credentials and provider-specific response shapes do not cross the
  boundary.
- A snapshot may carry one normalized failure (`PROVIDER_UNAVAILABLE`,
  `PROVIDER_RATE_LIMITED` or `ARRIVALS_EMPTY_UNKNOWN`) with a safe message and
  a `null` value. The composition preserves one issue per failed snapshot and
  passes all of them to the evaluator, which returns `unable_to_verify` rather
  than treating an outage or empty response as a successful or definitive
  no-service result.
- `buildJourneyAssessment` combines the two snapshots into the evaluator input
  and rejects mixed data modes rather than silently combining live and cached
  evidence under one answer. A future reviewed policy may define an explicit
  mixed-mode rule.

The credential-free `src/providers/request-budget.ts` utility provides the
per-evaluation reservation primitive for the future live adapters. It keeps
operation budgets separate, deduplicates identical internal request keys and
counts a retry only when the caller supplies a distinct key. A deduplicated
reservation reuses the existing result and must not dispatch another network
request. Keys must never contain credentials, secret-bearing URLs or raw
provider payloads. It is not yet wired into the fixture-only HTTP route; the
actual limits remain a reviewed application policy after the owner's TfL and
RDM products are confirmed.

The credential-neutral `src/providers/http-client.ts` wrapper provides the
future adapters with timeout-aware JSON GETs and conservative mappings for
rate limits, non-success responses, network failures, timeouts and unusable
payloads. It never returns raw upstream errors and does not validate provider
schemas; each adapter must still normalize and validate its own response. It is
also not wired into the fixture-only route until the actual provider products
and endpoint contracts are empirically confirmed.

The current TfL request-builder slice is limited to constructing the official
Journey Planner URL and query parameters from a validated request. It keeps the
app key out of the internal budget key and requires HTTPS without credentials,
query or fragment data in the configured base URL. It does not call TfL, parse
the response or claim that any returned journey is viable; those remain separate
reviewed adapter and empirical-validation steps.
The current request targets the protected-departure instant itself; it does not
subtract transfer or safety-buffer allowances. The candidate-discovery deadline
policy remains a reviewed live-integration decision.

The current fixture adapter implements both contracts with deterministic data. It
uses a frozen evaluation clock and the first matching labelled fixture; the HTTP
request cannot select individual evaluator scenarios. This is deliberate test
infrastructure, not live transport behaviour. Live TfL/Darwin adapters must
return these explicit failure outcomes, use an evaluation clock captured after
retrieval, and add request budgets, timestamp reconciliation and empirical
late-service validation before this route can be considered for a pilot.

## Request

The first version keeps the request small and explicit. Names are user-facing
labels; identifiers are optional hints and must be validated against provider
data rather than trusted as proof of a match.

```json
{
  "origin": {
    "name": "Stratford",
    "tflStopPointId": "940GZZLUSFD"
  },
  "destination": {
    "name": "Waterloo",
    "nationalRailCrs": "WAT"
  },
  "protectedDeparture": {
    "at": "2026-09-07T00:35:00+01:00",
    "kind": "national_rail_departure",
    "serviceLabel": "Illustrative service"
  },
  "safetyBufferMinutes": 5,
  "constraints": {
    "walkingMinutesLimit": 20,
    "stepFreeRequired": false
  }
}
```

### Request rules

| Field                             | Rule                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------- |
| `origin.name`                     | Required non-empty string, maximum 120 characters                                                 |
| `origin.tflStopPointId`           | Optional TfL identifier hint; do not infer one from the name silently                             |
| `destination.name`                | Required non-empty string, maximum 120 characters                                                 |
| `destination.nationalRailCrs`     | Optional three-letter CRS hint for a protected National Rail event                                |
| `protectedDeparture.at`           | Required ISO-8601 timestamp with an explicit offset or `Z`; reject offset-free local times        |
| `protectedDeparture.kind`         | Required enum: `national_rail_departure` initially; more event kinds require a reviewed extension |
| `protectedDeparture.serviceLabel` | Optional display label; not used as a unique service match                                        |
| `safetyBufferMinutes`             | Required integer from 0 through 60; no coercion or default                                        |
| `constraints.walkingMinutesLimit` | Optional integer from 0 through 180; a limit, not a promise of accessible walking time            |
| `constraints.stepFreeRequired`    | Optional boolean, default `false` only when the field is omitted; never inferred                  |

The explicit protected-departure timestamp identifies an instant and its local
calendar date. It does not, by itself, establish the provider's operating service
date. An adapter must preserve the offset and original text, carry the provider's
service-date context, and explicitly match the two. If that match is unavailable
or ambiguous, the event must not be reported as matched; return a conservative
status with `TIME_AMBIGUOUS` or `PROTECTED_EVENT_NOT_MATCHED` as appropriate.

## Response envelope

Successful assessments return HTTP 200 even when the answer is negative or cannot
be verified. The `status` and `dataMode` fields are machine-readable; `summary`
and `nextAction` are short, plain-language text suitable for the mobile result
screen.

The following is an explicitly hypothetical future live-mode response. Its values
are illustrative and do not establish that this service or any provider evidence
exists today.

```json
{
  "contractVersion": "journey-check.v0.1",
  "status": "viable",
  "dataMode": "live",
  "checkedAt": "2026-09-06T22:30:42Z",
  "summary": "A route is currently shown with 13 minutes remaining after your safety buffer.",
  "nextAction": "Leave now and follow the recommended route.",
  "protectedEvent": {
    "kind": "national_rail_departure",
    "at": "2026-09-07T00:35:00+01:00",
    "station": "Waterloo",
    "serviceLabel": "Illustrative service",
    "matchStatus": "matched"
  },
  "margin": {
    "arrivalAt": "2026-09-07T00:07:00+01:00",
    "transferMinutes": 10,
    "safetyBufferMinutes": 5,
    "availableMinutes": 18,
    "remainingAfterBufferMinutes": 13
  },
  "route": {
    "legs": [
      {
        "mode": "tube",
        "from": "Stratford",
        "to": "Waterloo",
        "departureAt": "2026-09-06T23:45:00+01:00",
        "arrivalAt": "2026-09-07T00:07:00+01:00",
        "durationMinutes": 22,
        "providerReference": "redacted-internal-reference"
      }
    ]
  },
  "reasons": [
    {
      "code": "BUFFER_SATISFIED",
      "message": "The calculated margin meets the requested buffer."
    }
  ],
  "evidence": [
    {
      "source": "tfl_journey_planner",
      "kind": "journey_plan",
      "capturedAt": "2026-09-06T22:30:42Z",
      "providerTimestamp": "2026-09-06T22:29:55Z",
      "ageSeconds": 47,
      "completeness": "sufficient",
      "reference": "redacted-internal-reference"
    },
    {
      "source": "darwin_service",
      "kind": "protected_event",
      "capturedAt": "2026-09-06T22:30:42Z",
      "providerTimestamp": "2026-09-06T22:29:55Z",
      "ageSeconds": 47,
      "completeness": "sufficient",
      "reference": "redacted-internal-reference"
    }
  ],
  "warnings": []
}
```

### Decision statuses

| Status             | Meaning                                                                                                                            | Safe interpretation                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `viable`           | Required legs and protected event are matched; evidence is sufficiently current; remaining margin is at least the requested buffer | A route is currently supported, not guaranteed                                |
| `tight`            | A route is matched, but the remaining margin is positive and below the requested buffer or another reviewed fragility rule applies | Treat as fragile; show the shortfall and warning prominently                  |
| `not_viable`       | No evaluated route satisfies the protected event, or the deterministic rules show the connection is missed                         | Do not present the route as a way to catch the event                          |
| `unable_to_verify` | Required evidence is missing, stale, contradictory, ambiguous or unavailable                                                       | Do not guess; explain what could not be checked and give a useful next action |

`tight` is deliberately separate from `not_viable`: it makes a safety-margin
shortfall visible without pretending that the route is impossible. A reviewed
policy may add a further fragility rule, but it must not change the arithmetic or
hide the margin components.

### Result-shape rules

- `route` is an object only when one or more route legs were actually evaluated;
  otherwise it is `null`. Do not fabricate legs for a no-route or provider-failure
  result.
- `margin` is an object only when both a candidate arrival instant and the
  protected-departure instant are resolved with sufficient evidence; otherwise it
  is `null`.
- A confirmed missed connection may return a real `route` and a negative
  `margin.availableMinutes`. `NO_MATCHING_ROUTE`, unresolved cancellation or
  `unable_to_verify` may return both fields as `null`, with reasons and evidence
  explaining why.
- `protectedEvent.matchStatus` must not be `matched` unless the provider service,
  station and service-date context have all been explicitly reconciled.

### Margin fields and decision precedence

- `arrivalAt` is the evaluated arrival at the destination interchange, not merely
  the time a train reaches a platform.
- `transferMinutes` is the additional transfer/access allowance applied after the
  route planner's arrival. It must not duplicate walking already included in the
  planner result.
- `availableMinutes` is `protectedDeparture - arrivalAt - transferMinutes`.
- `remainingAfterBufferMinutes` is `availableMinutes - safetyBufferMinutes`.
- Calculations use instants derived from explicit offsets, not naive wall-clock
  subtraction. DST and provider offset omissions remain a validation risk.
- Negative values are returned when they explain a failed margin; they must not be
  rounded into a reassuring zero.

The evaluator applies these rules in order:

1. Check required evidence, route legs and protected-event matching. Missing,
   stale, contradictory, ambiguous or unavailable evidence produces
   `unable_to_verify`, unless a separate deterministic rule confirms a negative
   result such as a cancellation.
2. When the candidate arrival and protected departure are resolved, calculate
   `availableMinutes` exactly as above.
3. If `availableMinutes <= 0`, return `not_viable` with
   `CONNECTION_MISSED`, regardless of the requested buffer (including a zero
   buffer).
4. If `availableMinutes > 0` and `remainingAfterBufferMinutes >= 0`, return
   `viable`.
5. If `availableMinutes > 0` and `remainingAfterBufferMinutes < 0`, return
   `tight` with `BUFFER_SHORTFALL`.

This names the operands explicitly so the safety buffer is subtracted exactly
once. Further fragility policies remain a reviewed extension.

## Route and evidence records

The `route` and `margin` presence/absence rules above govern negative and
unverifiable results. When a `route` object exists, each returned leg will contain
`mode`, `from`, `to`, `departureAt`, `arrivalAt`, `durationMinutes`, and a provider
or fixture reference. A partial candidate may contain only the legs that were
actually evaluated. A `route: null` result means no candidate route is available;
it must not be represented by fabricated or empty legs.

Each evidence item should expose only provenance needed by the client and
diagnostics:

```json
{
  "source": "tfl_journey_planner",
  "kind": "journey_plan",
  "capturedAt": "2026-09-06T22:30:42Z",
  "providerTimestamp": "2026-09-06T22:29:55Z",
  "ageSeconds": 47,
  "completeness": "sufficient",
  "reference": "redacted-internal-reference"
}
```

`source` is initially one of `tfl_journey_planner`, `tfl_timetable`,
`tfl_arrivals`, `tfl_line_status`, `tfl_stop_point_disruption`,
`darwin_service`, or `fixture`. Raw response bodies and credentials do not belong
in the public response. The response-level `checkedAt` is the instant at which
the decision was evaluated. `ageSeconds` is calculated at that instant as the
elapsed seconds from the valid `providerTimestamp`, or from `capturedAt` when a
provider timestamp is absent. For cached evidence, the original `capturedAt` is
retained and the age therefore increases on later evaluations; reading a cache
must not reset freshness. A future, malformed or otherwise invalid timestamp is
not treated as fresh evidence and must lead to a conservative result. Thresholds
remain policy configuration until empirically validated. A separate ingestion lag
may be derived from `capturedAt - providerTimestamp`, but must not be confused
with evaluation age.

For example, the sample item is 47 seconds old when evaluated at
`2026-09-06T22:30:42Z`. If the same cached item is evaluated at
`2026-09-06T22:32:42Z`, its `ageSeconds` is 167, not 47. The implementation must
cover this increase with a deterministic fixture test.

`protectedEvent.matchStatus=matched` requires protected-event evidence (for
example, a `darwin_service` item) as well as route, station and service-date
reconciliation. The internal normalised protected-event input carries an explicit
`serviceDateMatch` value (`matched`, `not_matched` or `ambiguous`) supplied by the
adapter's reconciliation step. The evaluator must use that attestation rather
than infer a provider operating service date by comparing calendar-date strings.
A Journey Planner response alone cannot establish the identity or existence of the
National Rail departure.

Route-leg `durationMinutes` must agree with its explicit departure and arrival
instants within a small documented ingestion tolerance; a contradiction is not a
viable result. The evaluator also checks route endpoint identity, adjacent-leg
continuity and whether the first leg is still catchable at `checkedAt`.

## Reason codes

The first reviewed set is:

- `BUFFER_SATISFIED`
- `BUFFER_SHORTFALL`
- `CONNECTION_MISSED`
- `NO_MATCHING_ROUTE`
- `PROTECTED_EVENT_NOT_MATCHED`
- `SERVICE_CANCELLED`
- `SERVICE_DISRUPTED`
- `ARRIVALS_EMPTY_UNKNOWN`
- `EVIDENCE_STALE`
- `EVIDENCE_INCOMPLETE`
- `EVIDENCE_CONTRADICTORY`
- `PROVIDER_UNAVAILABLE`
- `PROVIDER_RATE_LIMITED`
- `TIME_AMBIGUOUS`
- `INPUT_AMBIGUOUS`

Codes are stable identifiers; messages can be refined for the mobile experience.
The API should return all material reasons needed to explain a conservative result,
but avoid exposing provider payloads or internal secrets.

## HTTP error contract

Input and transport errors are distinct from an assessment that successfully
returns `unable_to_verify`:

- `400 INVALID_INPUT`: malformed shape, missing required field, unknown field or
  invalid range/type.
- `413 PAYLOAD_TOO_LARGE`: request exceeds the configured JSON limit.
- `415 UNSUPPORTED_MEDIA_TYPE`: request is not JSON.
- `429 RATE_LIMITED`: LastLink rejects the request before an assessment is
  accepted because its own application/request budget is exhausted. Do not retry
  automatically without a reviewed policy.
- `500 INTERNAL_ERROR`: unexpected server failure with a safe generic message.

After a valid request has been accepted, an upstream provider timeout, provider
rate limit or empty response is represented as HTTP 200 `unable_to_verify`, with
`PROVIDER_UNAVAILABLE`, `PROVIDER_RATE_LIMITED` or `ARRIVALS_EMPTY_UNKNOWN` as
appropriate. This is distinct from the application-level 429 admission refusal;
the exact provider translation remains an adapter-level decision within this
boundary.

## Fixture mapping for the next implementation

The existing `stratford-waterloo-demo` can be mapped into this shape as
`dataMode=fixture`, with an explicit warning and `liveJourneyVerified=false`.
It is not a live route and must not be silently exposed through the proposed
production endpoint. Before connecting providers, add deterministic fixtures for:

1. viable route with a positive buffer;
2. tight route with a buffer shortfall;
3. missed connection or cancelled protected event;
4. unable-to-verify due to stale, empty or contradictory evidence;
5. ambiguous after-midnight or offset-free time input.

## Acceptance criteria for implementation

- The request validator is input-driven, strict and independently testable.
- The deterministic evaluator accepts normalised evidence as input and has no
  Express, HTTP client or provider dependency.
- Every status and reason code has a fixture-driven test, including fail-safe cases.
- The response exposes checked-at/freshness information and material warnings
  without claiming passenger certainty.
- Postman covers representative success, tight, not-viable and unable-to-verify
  responses plus invalid input. Provider-failure mappings remain evaluator
  fixtures until a reviewed live-adapter boundary exists.
- The existing demo collection remains passing and clearly labelled synthetic.
- Live TfL/Darwin integration is a separate reviewed increment after this contract
  is accepted; late-service edge cases still require empirical API validation.

## Open decisions retained

- Whether `protectedEvent` needs an explicit Darwin service identifier in v0.2.
- The approved transfer/accessibility allowance policy for Waterloo and comparison
  stations; do not double-count planner walking time.
- Freshness thresholds and the treatment of provider timestamps that omit offsets.
- Whether `tight` is a policy outcome or a presentation of `viable` with a warning.
- Exact provider error-to-status mapping and request-budget behaviour.
