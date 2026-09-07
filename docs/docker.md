# Local Docker checkpoint

This packages the existing health and fictional demo routes. It does not deploy
anything, connect providers or make the demo safe for passenger use.

## Build and run

Start Docker Desktop with its Linux engine. From the API repository:

```sh
docker build -t lastlink-api:local .
docker run --name lastlink-api-local --rm -d -p 127.0.0.1:3001:3000 lastlink-api:local
docker logs lastlink-api-local
docker inspect --format "{{.State.Health.Status}}" lastlink-api-local
```

Your VS Code process can continue on port 3000. The Docker endpoint is
http://localhost:3001/health. The port is bound to loopback, not your LAN.
Do not start a second container with the same name or overwrite an existing one.

Import postman/docker.postman_environment.json into Postman and select
LastLink Docker. Run both existing collections unchanged. Select LastLink local
again when returning to VS Code development.

To stop this named disposable container:

```sh
docker stop --timeout 15 lastlink-api-local
```

The --rm option removes the stopped container, not the image. No volume or
database is used. Code changes need a rebuild; there is no source bind mount.

## Packaging boundaries

- Official Node 22 Debian slim base pinned by digest; review and refresh the
  digest for updates rather than assuming a pinned image stays secure forever.
- Build stage installs locked dependencies and runs formatting, lint, types,
  tests and compilation. Run npm run check locally as well for the full repo.
- Runtime contains compiled code and production dependencies only.
- Non-root node user; Node is the main process so it receives stop signals.
- .dockerignore allowlists build inputs. .env, Git history, node_modules,
  Postman exports and private planning records are excluded from build context.
  Never place credentials in source/tests or build arguments.
- Health check uses the actual PORT value. This is process liveness only.
- Runtime PORT can be overridden with an environment variable; EXPOSE documents
  the default and does not override the application's listening port.

## Local verification — 6 September 2026

The Linux image built successfully, including all 37 automated tests, lint,
formatting, type checking and compilation. The full local check also passed.
Runtime Node was v22.23.2, running as UID 1000. The application directory contained
only dist, node_modules and package.json; TypeScript was absent at runtime.

Both unchanged desktop Postman collections passed against localhost:3001 using
LastLink Docker: foundation 7 assertions, demo 19 assertions, zero failures.
Docker health checks passed with the default port and with PORT=10000. The
alternative-port container returned HTTP 200 from /health. Both test containers
stopped with exit 0; the owner's VS Code server remained healthy on port 3000.
These are local fixture/liveness checks, not transport reliability evidence.

## Render boundary

Docker on Render remains the agreed direction, but no Render service, deployment,
account changes or paid plan are created here. The application already reads
PORT and listens without restricting the interface to localhost inside the
container. Configure Render's health-check path as /health when deployment is
separately authorised; do not rely on Docker HEALTHCHECK as hosted configuration.
Verify current Render settings/free-tier limitations at that checkpoint.

Review image vulnerability findings separately from npm advisories before any
external deployment. Local container tests are not a production-security audit.
