# Journey check contract v0.2 TfL only

**Status:** Proposed scope-reset contract
**Product boundary:** assess arrival at a TfL station; do not verify onward rail

This contract supersedes the earlier protected-departure design. That design is
not part of the active repository and is not a licence to add Darwin or National
Rail integration.

## Safety boundary

- The backend owns the deterministic decision. A client or language model may
  collect and explain inputs but cannot upgrade an outcome.
- TfL is the only operational provider in this contract. Fixture or cached data
  must identify its mode and capture time.
- A positive result means that current evidence supports reaching the requested
  TfL station by the calculated deadline. It is not a guarantee of operation,
  entrance access, platform access or an onward train.
- Missing, contradictory, stale or ambiguous evidence must produce
  `unable_to_verify`, or a more conservative negative result when a deterministic
  rule proves the route is missed.
- TfL endpoint names may add generic trailing descriptors such as `Station` or
  `Underground Station`; the evaluator removes only that allowlisted suffix
  vocabulary for comparison. It does not use fuzzy or substring matching.
- The response always includes a station-only warning; an onward departure is
  context for deriving the deadline, not an operational rail assertion.

## Endpoint

`POST /api/v1/journey-check`

The endpoint accepts JSON, rejects unknown fields, returns `Cache-Control:
no-store`, and uses the existing `{ error: { code, message } }` input-error
envelope. The route defaults to fixture mode. Explicit server-side live
configuration uses TfL Journey Planner only, with one request per evaluation,
no retries and no fixture fallback. Live mode remains internal validation:
timetable, arrivals and disruption corroboration are not yet connected.

## Request

Provider timestamps are normalized separately from user input. Offset-free TfL
Journey Planner values (years 2000–2099) are treated as Europe/London wall times.
Both GMT and BST candidates are checked against IANA timezone rules and exactly
one must match. Nonexistent or repeated hours remain unresolved, yielding
unable_to_verify through the provider failure path. Normalized route/leg and
search timestamps include explicit offsets; explicit provider offsets are
preserved. This does not relax the user request's explicit-offset requirement.

The direct form is canonical:

```json
{
  "origin": {
    "name": "Stratford",
    "tflStopPointId": "940GZZLUSTD"
  },
  "destination": {
    "name": "Waterloo",
    "tflStopPointId": "940GZZLUWLO"
  },
  "arriveBy": "2026-09-07T00:25:00+01:00",
  "safetyBufferMinutes": 5,
  "constraints": {
    "walkingMinutesLimit": 20,
    "stepFreeRequired": false
  }
}
```

An optional convenience form may derive the station deadline from a user-known
onward departure:

```json
{
  "origin": { "name": "Stratford" },
  "destination": { "name": "Waterloo" },
  "onwardDepartureAt": "2026-09-07T00:35:00+01:00",
  "stationTransferMinutes": 10,
  "safetyBufferMinutes": 5,
  "constraints": {}
}
```

The application must either receive `arriveBy` or receive both
`onwardDepartureAt` and `stationTransferMinutes`, but not both deadline forms.
The onward departure is user context only; no train identity or operation check
is performed.

### Request rules

| Field                             | Rule                                                                        |
| --------------------------------- | --------------------------------------------------------------------------- |
| `origin.name`                     | Required non-empty string, maximum 120 characters                           |
| `origin.tflStopPointId`           | Optional TfL identifier hint; validate against provider evidence            |
| `destination.name`                | Required non-empty string, maximum 120 characters                           |
| `destination.tflStopPointId`      | Optional TfL identifier hint; do not infer silently                         |
| `arriveBy`                        | Required when the direct form is used; ISO-8601 with explicit offset or `Z` |
| `onwardDepartureAt`               | Required with `stationTransferMinutes` when deriving the deadline           |
| `stationTransferMinutes`          | Integer 0–120; user assumption, not a measured platform guarantee           |
| `safetyBufferMinutes`             | Required integer 0–60; no coercion or implicit default                      |
| `constraints.walkingMinutesLimit` | Optional integer 0–180; a limit, not an accessibility guarantee             |
| `constraints.stepFreeRequired`    | Optional boolean, default false only when omitted                           |

All calculations use explicit instants. Offset-free local times, impossible date
values and conflicting deadline forms are invalid. The TfL request builder also
rejects repeated Europe/London wall-clock times rather than choosing an
ambiguous occurrence.

## Response

Successful assessments return HTTP 200 for positive, negative and unverifiable
decisions. Values below are illustrative fixture data only.

```json
{
  "contractVersion": "journey-check.v0.2",
  "status": "viable",
  "dataMode": "fixture",
  "checkedAt": "2026-09-06T22:30:42Z",
  "summary": "A TfL route is currently shown to reach Waterloo with 13 minutes remaining after your safety buffer.",
  "nextAction": "Leave now and follow the evaluated TfL route.",
  "stationOnly": true,
  "stationOnlyWarning": "This checks the TfL journey to the station only. It does not check whether an onward train is running or whether you will board it.",
  "deadline": {
    "arriveBy": "2026-09-07T00:25:00+01:00",
    "source": "user_input",
    "onwardDepartureAt": null,
    "stationTransferMinutes": null
  },
  "margin": {
    "arrivalAt": "2026-09-07T00:07:00+01:00",
    "transferMinutes": 0,
    "safetyBufferMinutes": 5,
    "availableMinutes": 18,
    "remainingAfterBufferMinutes": 13
  },
  "route": {
    "arrivalAt": "2026-09-07T00:07:00+01:00",
    "legs": [
      {
        "mode": "tube",
        "lineName": "Jubilee",
        "from": "Stratford",
        "to": "Waterloo",
        "departureAt": "2026-09-06T23:45:00+01:00",
        "arrivalAt": "2026-09-07T00:07:00+01:00",
        "durationMinutes": 22,
        "providerReference": "redacted-fixture-reference"
      }
    ]
  },
  "reasons": [
    {
      "code": "BUFFER_SATISFIED",
      "message": "The calculated station-arrival margin meets the requested buffer."
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
      "reference": "redacted-fixture-reference"
    }
  ],
  "warnings": ["Fixture data only; do not use for travel decisions."]
}
```

`lineName` is optional provider-supplied line information. It is included when
TfL provides a named route option, such as `Jubilee`, and omitted when no
reliable line name is present. Station endpoints remain explicit in `from` and
`to`; the response does not claim platform-level instructions. A route leg may
also include optional provider-preserved `directions`, `instructions`,
`scheduledDepartureAt`, `scheduledArrivalAt` and `notices` fields. These are
descriptive Journey Planner fields only; they are not a live vehicle prediction.
`notices`, when present, contain only concise provider text from the leg's
disruption or planned-work data:

```json
"notices": [
  { "kind": "disruption", "text": "Minor delays are reported on this leg." },
  { "kind": "planned_work", "text": "Planned platform works may affect the interchange." }
]
```

The client presents these as advisory messages on the affected leg. They do not
change the deterministic viability status, create an alternative route, or
mean that a missing notice proves good service. A leg marked disrupted without
usable provider text receives a bounded generic disruption notice. Invalid or
empty notice entries are ignored by the adapter; raw provider payloads are not
forwarded. The
current live adapter does not yet corroborate them with the separate TfL
Arrivals endpoints. Invalid optional scheduled timestamps invalidate the
provider response rather than being silently displayed.

When TfL marks the selected candidate as an alternative, `alternativeRoute`
is `true`. The response may also include up to three compact `alternatives`
summaries for other candidates that were catchable at evaluation time and met
the requested walking constraints. When step-free access is requested, summaries
require explicit confirmation; unknown access is not presented as satisfying it.
The current normalizer does not confirm step-free access, so these summaries
are omitted for that request. These summaries include their
departure/arrival instants, elapsed duration, remaining margin after the
requested buffer and an ordered list of mode/line segments. They are offered
for comparison only; the deterministic status always belongs to the selected
route and the client does not silently switch routes.

When multiple catchable TfL candidates are available, the adapter ranks
viability first, then prefers routes using Tube and walking, then bus, and
finally rail or Overground. A viable rail route can still be selected when the
non-rail alternatives are not viable. When the selected route contains a
National Rail leg, `route.fareWarning` is included; LastLink does not verify
tickets, fares, Railcards or payment eligibility.

## Decision statuses

| Status             | Meaning                                                                                                                                         | Safe interpretation                          |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `viable`           | A TfL candidate reaches the station by the deadline with the requested buffer and sufficient evidence                                           | Supported now, not guaranteed                |
| `tight`            | A candidate reaches the station, but the remaining margin is positive and below the requested buffer or another reviewed fragility rule applies | Treat as fragile                             |
| `not_viable`       | No evaluated TfL candidate satisfies the station deadline, or a deterministic rule shows the deadline is missed                                 | Do not present it as a way to arrive on time |
| `unable_to_verify` | Required TfL evidence is missing, stale, contradictory, ambiguous or unavailable                                                                | Do not guess; explain the missing evidence   |

## Margin arithmetic

- `arrivalAt` is the evaluated arrival at the requested TfL destination.
- `transferMinutes` is only the station-access/entrance allowance not already
  included by Journey Planner. It must not be added twice.
- `availableMinutes = arriveBy - arrivalAt - transferMinutes`.
- `remainingAfterBufferMinutes = availableMinutes - safetyBufferMinutes`.
- Negative values remain negative when they explain a failed deadline.

The evaluator must check required evidence first, calculate the margin second,
and then apply this precedence:

1. Missing or contradictory critical evidence: `unable_to_verify`.
2. `availableMinutes <= 0`: `not_viable` with `DEADLINE_MISSED`.
3. Positive available margin with non-negative remaining buffer: `viable`.
4. Positive available margin with a negative remaining buffer: `tight` with
   `BUFFER_SHORTFALL`.

## TfL evidence sources

The normalised evidence source set is:

- `tfl_journey_planner`
- `tfl_timetable`
- `tfl_arrivals`
- `tfl_line_status`
- `tfl_stop_point_disruption`
- `tfl_stop_point_structure`
- `fixture`

There is deliberately no Darwin or National Rail source in v0.2. Raw response
bodies, credentials and secret-bearing URLs never cross the client response.

## Reason codes

The initial reviewed set is:

- `BUFFER_SATISFIED`
- `BUFFER_SHORTFALL`
- `DEADLINE_MISSED`
- `NO_MATCHING_ROUTE`
- `STATION_NOT_REACHED`
- `ARRIVALS_EMPTY_UNKNOWN`
- `EVIDENCE_STALE`
- `EVIDENCE_INCOMPLETE`
- `EVIDENCE_CONTRADICTORY`
- `PROVIDER_UNAVAILABLE`
- `PROVIDER_RATE_LIMITED`
- `TIME_AMBIGUOUS`
- `INPUT_AMBIGUOUS`

## Acceptance criteria for the next slice

- Request validation is input-driven and accepts direct `arriveBy`.
- The optional onward-departure form derives `arriveBy` locally and records the
  assumption without provider matching.
- The evaluator is independent of Express, HTTP and provider SDKs.
- Every status and reason code has fixture-driven tests, including stale/empty
  TfL evidence and after-midnight time cases.
- Postman covers direct deadline, derived deadline, tight, missed and
  unable-to-verify cases.
- The response always includes the station-only warning for this contract.
- No Darwin/RDM dependency, credential or live rail call is added.
