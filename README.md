# LastLink API

LastLink is a late-night TfL journey-viability service. The active contract
answers one bounded question: can a user reach a named TfL station by a stated
deadline, with a requested safety margin?

The backend defaults to deterministic fixtures. Explicit live mode connects
TfL Journey Planner for internal validation only. It does not verify onward
trains, use Darwin/Rail Data Marketplace, a database or AI.
TfL feasibility is strongly supported, but late-service edge cases still need
empirical API validation before passenger use.

## Run locally

Use Node.js 22 (22.18.0 or newer within that major) and npm.

```sh
npm ci
npm run dev
```

Open http://localhost:3000/health. It returns process liveness only:

```json
{ "status": "ok", "service": "lastlink-api" }
```

The non-provider `/ready` endpoint reports that startup configuration has been
validated and identifies the selected data mode. It never calls TfL:

```json
{ "status": "ready", "service": "lastlink-api", "dataMode": "fixture" }
```

Use `/health` for Render's liveness probe and `/ready` for a lightweight
deployment/readiness check. Neither endpoint proves that TfL is reachable or
that a particular journey can be verified.

The server emits one redacted JSON `http_request` event per request to its
structured log. Each event contains a generated `requestId`, method,
allowlisted route label, HTTP status, duration and broad outcome; live journey
checks also record whether provider evidence was `ok` or `degraded`. The status
is `null` when a client aborts before response headers are sent. An
aborted client connection is recorded as `aborted`, and the middleware emits at
most one event even when a normal response close follows `finish`. Request
bodies, query values, credentials and passenger details are never logged. The
same request ID is returned in the `X-Request-Id` response header so a support
log entry can be correlated without exposing request data.

Configuration defaults to `PORT=3000` and `NODE_ENV=development`. Copy
`.env.example` to an ignored `.env` only when a local provider key is needed.
The Node process runs independently of Apache/XAMPP even when stored under
`htdocs`.

`CORS_ORIGINS` is a comma-separated allowlist of exact `http` or `https` origins
that may call the API from a browser. Local development defaults include the
Vite dev and preview origins. Render must set the production client origin
(`https://lastlink.livenotice.co.uk`) alongside any local origins needed for
testing; paths, wildcards and trailing slashes are rejected.

Journey checks also have a small per-process burst guard. The defaults allow 30
requests per observed client address in a 60-second window. Render can tune
`JOURNEY_RATE_LIMIT_WINDOW_MS` and `JOURNEY_RATE_LIMIT_MAX_REQUESTS` as positive
safe integers. A limited request returns HTTP 429 with `Retry-After` and a
`RATE_LIMITED` error. This guard is deliberately bounded and in-process; it
reduces accidental bursts on the single service instance but is not a substitute
for a distributed edge limit if the deployment scales out.

For the public Render deployment, the limiter can use the single-value
`CF-Connecting-IP` header by setting `RATE_LIMIT_CLIENT_IP_HEADER=CF-Connecting-IP`.
Render documents that its managed Cloudflare edge overwrites this header before
the request reaches the service, so the value cannot be chosen by a browser.
Leave the variable unset for local or other direct traffic; the limiter then
uses the connection address and ignores forwarded headers. `X-Forwarded-For` is
never used for bucket identity because callers can supply extra entries before
an upstream proxy appends its own value. A missing or invalid configured header
falls back to the connection address rather than trusting unvalidated input.

### Optional live validation

Keep `JOURNEY_DATA_MODE=fixture` for the existing Postman regression collection.
To run a separately supervised live check, set `JOURNEY_DATA_MODE=live` and
`TFL_APP_KEY` in your ignored local `.env`, then restart your VS Code process.
Never put the key in Postman, a request body, screenshots or Git. Live startup
fails if the key is missing or contains whitespace; fixture mode ignores it.

Each evaluation permits one Journey Planner request, with a five-second transport
timeout and no retries or fixture fallback. Live evaluations may also make at
most one optional arrivals, timetable and line-status request each when route
identity is available. These corroboration calls never decide viability: a
missing or failed feed is surfaced as a warning while the Journey Planner
station-arrival result remains authoritative. Budgets are per evaluation, not an
account-wide quota or spend cap. Do not expose this unauthenticated prototype
publicly. Provider failures produce a labelled live `unable_to_verify` response.
No extra transfer allowance is subtracted: a derived deadline already includes
the user's station-transfer allowance.

Offset-free Journey Planner timestamps in years
2000–2099 are interpreted as Europe/London time only when exactly one GMT/BST
instant matches the runtime's timezone rules. Missing spring hours and repeated
autumn hours are rejected, not guessed. Explicit offsets are preserved.
User deadlines still require offsets. Ambiguous query times and station-name
mismatches remain conservative validation limits. TfL's generic trailing
descriptors (`Station`, `Underground`, `Tube`, `National Rail`, and equivalent
station suffixes) are normalized for endpoint comparison; arbitrary substring
or fuzzy matching is not used.
See `postman/live-journey-check.postman_collection.json` for a single manual
smoke request; set its explicit-offset `arriveBy` variable to a future time.
Do not run the fixture collection in live mode.

## Journey-check contract

`POST /api/v1/journey-check` accepts a direct `arriveBy` timestamp or derives a
station deadline from `onwardDepartureAt` minus `stationTransferMinutes`. Both
forms require an explicit ISO-8601 offset or `Z`.

The endpoint returns HTTP 429 when the per-process journey-check burst limit is
exceeded. The JSON body is `{ "error": { "code": "RATE_LIMITED", "message":
"Too many journey checks. Please wait a moment and try again." } }`; clients
should honor the `Retry-After` response header. CORS and `Cache-Control:
no-store` headers remain present on this response; the rate-limit headers are
exposed to browser clients.

Example:

```json
{
  "origin": { "name": "Stratford", "tflStopPointId": "940GZZLUSTD" },
  "destination": { "name": "Waterloo", "tflStopPointId": "940GZZLUWLO" },
  "arriveBy": "2026-09-07T00:25:00+01:00",
  "safetyBufferMinutes": 5,
  "constraints": { "walkingMinutesLimit": 20, "stepFreeRequired": false }
}
```

Responses include `stationOnly: true`, the resolved deadline, route evidence,
calculated margin and a conservative status (`viable`, `tight`, `not_viable` or
`unable_to_verify`). They do not assert that an onward train is running or that
the user will board it. See [the active TfL-only contract](docs/journey-check-contract-v0.2-tfl-only.md).

### Tube-station locations

Both locations are selected Tube stations from the client’s captured TfL
StopPoint catalogue. The request includes the station display name and its TfL
StopPoint ID; the API rejects a missing ID rather than asking Journey Planner to
guess a place. The MVP does not search arbitrary places or use the retired TfL
`/Place/Search` endpoint. This keeps the
station-arrival promise explicit and prevents ambiguous provider resolution.

## Checks and Postman

```sh
npm run check
npm run build
npm start
```

Individual commands include `npm run typecheck`, `npm run lint`,
`npm run format:check`, `npm run format` and `npm test`.

Import `postman/journey-check.postman_collection.json` into Postman and run it
against `http://localhost:3000`. It covers viable, tight, derived-deadline,
constraint-failure, unknown-station and invalid-input cases. Keep private
environment exports out of Git.

The official Postman CLI can also execute these collection scripts locally:
`postman collection run postman/journey-check.postman_collection.json --env-var baseUrl=http://localhost:3000 --no-report-events`
(fixture-mode server only). Keep the separate live collection on a live-mode
server with a future explicit-offset `arriveBy` variable. Postman execution is
mandatory for HTTP changes; direct HTTP checks do not replace its assertions.

The foundation collection's readiness assertion defaults to fixture mode. When
running it against a live-mode deployment, override the expectation explicitly:
`--env-var expectedDataMode=live`. This keeps the check honest in both modes.

## Layout

- `src/app.ts`: Express setup, liveness/readiness routes and journey-check
  route.
- `src/journey/`: request validation, deterministic evaluation, fixture adapter
  and labelled fixture inputs.
- `src/providers/tfl/`: isolated TfL request, response and ranking seams.
- `src/providers/contracts.ts`: narrow provider adapter contract.
- `src/http/cors.ts`: exact-origin browser access policy and preflight handling.
- `src/routes/`: JSON HTTP boundary for journey checks.
- `tests/`: automated unit, contract, provider and HTTP tests.
- `postman/`: safe local collection and environment template.

## Delivery workflow

Work directly on `main` for ordinary small increments. Implement one bounded
change, leave it unstaged for Product Owner inspection, run the full check,
obtain the independent read-only code review and only then commit or push when
explicitly approved. See [the mandatory review workflow](docs/code-review-workflow.md).
No live provider calls or credentials belong in tests.

Use port 3001 for container testing so the owner's VS Code server can remain on
port 3000. The API is deployed at `https://lastlink-api.onrender.com`; its
current hosted configuration is live-provider mode for controlled internal
validation, not a guarantee of passenger advice. The static client is published
at `https://lastlink.livenotice.co.uk`. Keep the deployment's CORS allowlist and
provider secret configuration in Render; do not copy those values into this
repository or into the client build.

## Project context

The separate planning workspace holds the canonical `outputs/memory.md`,
`outputs/00-project-register.md` and product/technical documents. These private
planning records are not copied to this public repository. Read `AGENTS.md`
before agent-assisted work.
