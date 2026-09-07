# LastLink API

Minimal backend foundation for LastLink, a late-night journey viability application.

**Current scope:** process health and two explicitly fictional demo routes, with locally tested Docker packaging. No live TfL/Darwin integration, passenger journey assessment, database, AI or deployed service exists yet.

## Run locally

Use Node.js 22 (22.18.0 or newer within that major) and npm.

```sh
npm ci
npm run dev
```

Open http://localhost:3000/health. It returns:

```json
{ "status": "ok", "service": "lastlink-api" }
```

This is process liveness, not transport service status or a journey guarantee.
Unknown paths and unsupported methods return a JSON 404.

Configuration defaults to PORT=3000 and NODE_ENV=development. Optionally copy
.env.example to .env and edit it locally. Invalid configuration stops startup.
The Node process runs independently of Apache/XAMPP even when stored under htdocs.

## Checks and production build

```sh
npm run check
npm run build
npm start
```

Individual commands: npm run typecheck, npm run lint, npm run format:check,
npm run format, npm test. Tests cover health, missing routes, unsupported methods,
configuration defaults, demo input validation, margin arithmetic and boundaries.

## Postman

For the second checkpoint, import postman/demo-routes.postman_collection.json
as a separate collection and reuse LastLink local. It contains eight requests
covering health, scenario discovery, two buffer values and input/error handling.
The original foundation collection remains unchanged.

Demo endpoints:

- GET /api/v1/demo/scenarios
- POST /api/v1/demo/journey-check

See [the demo contract](docs/demo-contract.md) for request examples, validation
and arithmetic rules. All results are synthetic and explicitly not travel advice.

The next provider-neutral endpoint is specified in the [journey-check contract](docs/journey-check-contract.md),
but is not implemented yet. Live TfL/Darwin calls remain deferred until that
contract and its deterministic fixtures are reviewed.

1. Start the API in one terminal.
2. Import postman/lastlink-api.postman_collection.json into Postman.
3. Import postman/local.postman_environment.json and select LastLink local.
4. Run the collection. Change baseUrl if using a different port.

The collection was verified using Newman 6.2.2 against localhost during setup
(3 requests, 7 passing assertions). Newman was then removed because its dependency
tree reported security advisories. It is not installed by npm ci. Use Postman's
collection runner for subsequent collection runs; selecting a maintained automated
Postman runner remains an open tooling item. Automated HTTP tests remain available
through npm test.
Keep private environment exports out of Git (use the ignored *.local.json suffix).

## Layout

- src/app.ts: Express setup, health, demo-router mounting and fallback.
- src/config.ts: environment validation.
- src/server.ts: process startup and graceful shutdown.
- src/demo/: fixture, pure margin calculation and HTTP routing/validation.
- tests/: automated HTTP and configuration tests.
- postman/: collection and safe local environment template.

## Delivery workflow

Use a small feature branch for each increment. Implement, test, obtain independent
agent review, fix findings and re-review BEFORE committing. Verify the committed
content matches the approved content BEFORE pushing. See
[the mandatory review workflow](docs/code-review-workflow.md).
Do not force-push shared history. GitHub Actions, branch protection and local Git
hooks are not configured; this is a mandatory agent workflow, not a Git-enforced
or guaranteed defect-free certification. Human review remains valuable.

The demo and local Docker runtime checks are complete. See
[Docker instructions](docs/docker.md) for build/run commands and verification.
Every commit/push still requires the independent review gate above.
Use port 3001 for container testing so the owner's VS Code server stays on 3000.
Render deployment and further application behaviour remain deferred.

## Project context

The separate planning workspace holds the canonical outputs/memory.md,
outputs/00-project-register.md and TECH-02 v0.5. These private planning records
are not copied to this public repository. Read AGENTS.md before agent-assisted work.

Dependency versions are locked in package-lock.json. Node patch upgrades and
dependency updates should be reviewed and tested before deployment.
