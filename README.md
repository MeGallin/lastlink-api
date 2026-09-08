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

Configuration defaults to `PORT=3000` and `NODE_ENV=development`. Copy
`.env.example` to an ignored `.env` only when a local provider key is needed.
The Node process runs independently of Apache/XAMPP even when stored under
`htdocs`.

### Optional live validation

Keep `JOURNEY_DATA_MODE=fixture` for the existing Postman regression collection.
To run a separately supervised live check, set `JOURNEY_DATA_MODE=live` and
`TFL_APP_KEY` in your ignored local `.env`, then restart your VS Code process.
Never put the key in Postman, a request body, screenshots or Git. Live startup
fails if the key is missing or contains whitespace; fixture mode ignores it.

Each evaluation permits one Journey Planner request, with a five-second transport
timeout and no retries or fixture fallback. Budgets are per evaluation, not an
account-wide quota or spend cap. Do not expose this unauthenticated prototype
publicly. Provider failures produce a labelled live `unable_to_verify` response.
No extra transfer allowance is subtracted: a derived deadline already includes
the user's station-transfer allowance.

Only Journey Planner is connected. Timetable, arrivals and disruption
cross-checks remain deferred. Offset-free Journey Planner timestamps in years
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

## Layout

- `src/app.ts`: Express setup, health route and journey-check route.
- `src/journey/`: request validation, deterministic evaluation, fixture adapter
  and labelled fixture inputs.
- `src/providers/tfl/`: isolated TfL request, response and ranking seams.
- `src/providers/contracts.ts`: narrow provider adapter contract.
- `src/routes/journey-check.ts`: JSON HTTP boundary.
- `tests/`: automated unit, contract, provider and HTTP tests.
- `postman/`: safe local collection and environment template.

## Delivery workflow

Work directly on `main` for ordinary small increments. Implement one bounded
change, leave it unstaged for Product Owner inspection, run the full check,
obtain the independent read-only code review and only then commit or push when
explicitly approved. See [the mandatory review workflow](docs/code-review-workflow.md).
No live provider calls or credentials belong in tests.

Use port 3001 for container testing so the owner's VS Code server can remain on
port 3000. Render deployment remains deferred until provider validation.

## Project context

The separate planning workspace holds the canonical `outputs/memory.md`,
`outputs/00-project-register.md` and product/technical documents. These private
planning records are not copied to this public repository. Read `AGENTS.md`
before agent-assisted work.
