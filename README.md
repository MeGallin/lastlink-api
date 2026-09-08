# LastLink API

LastLink is a late-night TfL journey-viability service. The active contract
answers one bounded question: can a user reach a named TfL station by a stated
deadline, with a requested safety margin?

The current implementation is a deterministic, fixture-backed backend slice.
It intentionally does not call live providers, make onward-train claims, use
Darwin/Rail Data Marketplace data, store credentials, use a database or use AI.
TfL feasibility is strongly supported, but late-service edge cases still need
empirical API validation before a live adapter is enabled.

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

## Journey-check contract

`POST /api/v1/journey-check` accepts a direct `arriveBy` timestamp or derives a
station deadline from `onwardDepartureAt` minus `stationTransferMinutes`. Both
forms require an explicit ISO-8601 offset or `Z`.

Example:

```json
{
  "origin": { "name": "Stratford", "tflStopPointId": "940GZZLUSFD" },
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
port 3000. Render deployment and live TfL adapter work remain deferred until
the provider-validation checkpoint is completed.

## Project context

The separate planning workspace holds the canonical `outputs/memory.md`,
`outputs/00-project-register.md` and product/technical documents. These private
planning records are not copied to this public repository. Read `AGENTS.md`
before agent-assisted work.
