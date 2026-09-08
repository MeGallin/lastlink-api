# Local Docker checkpoint

This packages the health route and the deterministic TfL-only journey-check
fixture boundary. It does not connect providers, use credentials or provide
passenger travel advice.

## Build and run

Start Docker Desktop with its Linux engine. From the API repository:

```sh
docker build -t lastlink-api:local .
docker run --name lastlink-api-local --rm -d -p 127.0.0.1:3001:3000 lastlink-api:local
docker logs lastlink-api-local
docker inspect --format "{{.State.Health.Status}}" lastlink-api-local
```

The Docker endpoint is http://localhost:3001/health. Keep the owner's VS Code
process on port 3000. The loopback binding does not expose the container to the
LAN.

To stop the disposable container:

```sh
docker stop --timeout 15 lastlink-api-local
```

The `--rm` option removes the stopped container, not the image. No volume or
database is used; code changes require a rebuild.

## Packaging boundaries

- Node 22 Debian slim base is pinned by digest; review the digest before use.
- The build stage installs locked dependencies and runs the repository checks.
- The runtime contains compiled code and production dependencies only.
- The process runs as the non-root `node` user.
- `.dockerignore` excludes `.env`, Git history, `node_modules`, Postman exports
  and private planning records. Never place credentials in source or build args.
- `/health` is process liveness, not transport reliability.

## Render boundary

Docker on Render remains the agreed direction, but no Render service, deployment,
account change or paid plan is created by this repository. Configure Render's
health-check path as `/health` only when deployment is separately authorised.
Verify current Render settings and free-tier limits at that checkpoint.
