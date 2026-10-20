# MPUR — My Polling Unit Result

A responsive citizen election-result platform built with Node.js, Express and Neon Postgres. All application source is in this folder.

Admin approval and live totals are now included. See [ADMIN-DEPLOYMENT.md](ADMIN-DEPLOYMENT.md) for Render environment settings, the database upgrade, and the review workflow. Existing submissions await review before appearing publicly.

## Run locally

Requires Node.js 22 or newer.

1. Run `npm install`.
2. Copy `.env.example` to `.env`. Set `DATABASE_URL` to a Neon Postgres connection string from your Neon dashboard, including `sslmode=require`. Never place this secret in browser files.
3. Run `npm run db:setup` to create the database tables, indexes and immutable-submission trigger.
4. Run `npm start`, then open http://localhost:3000.

Without a connection string the directory and interface work, but saving submissions and adding locations are disabled. No fabricated results are shown.

Run `npm test` for validation, authentication, isolated PostgreSQL approval constraints, immutable records, and geographic aggregation. Tests do not touch Neon.

## Rules and storage

- Three submissions per polling unit **per election type and election date**. Different elections get separate slots. This interpretation prevents a unit being permanently closed after one election.
- A transaction-level advisory lock serializes concurrent submissions for the same unit and election. A database unique constraint and slot constraint also enforce the cap.
- Submissions cannot be updated, deleted or truncated: a database trigger rejects those operations. There are no edit/delete API routes.
- All attachment bytes are stored in Neon with their submission, avoiding local-upload loss. Maximum attachment size is 5 MB. JPG/PNG/PDF signatures are checked; uploads are publicly accessible alongside their report. Do not upload private voter information.
- Voter totals must be non-negative integers. Accredited voters cannot exceed registered voters. Party votes plus rejected ballots cannot exceed accreditation. Duplicate party rows are rejected. Parties not entered are not inferred to have received zero votes.
- Ward and polling-unit names are normalized for duplicate detection within their parent location. Known numeric codes are also checked. Spelling variations without an official code may require human review; no name-based system can guarantee they refer to the same physical unit.
- User-created locations are community additions, not official INEC verification.
- Submissions start pending. Only one admin-approved report per polling unit, election type and date contributes to live totals at unit, ward, LGA, state and national levels. Pending/rejected reports and duplicate reports never inflate totals. Ties are explicit.
- Rate limits reduce accidental/automated repeated requests. Submissions are anonymous: the three slots are not proof of three distinct people. Add identity verification and abuse review before a large public launch.

## Data sources

The bundled `nigeria-inec-geo` dependency supplies 37 states/FCT, 774 LGAs, 8,809 wards and 176,846 polling units from an August 10, 2026 INEC portal snapshot. [Dataset and provenance](https://github.com/saidiadegoke/nigeria-inec-geo). These records are served directly from the installed dataset, while community additions are stored in Neon. Existing names/codes are checked against both sources.

The 22 party acronyms were checked against [INEC's party register](https://inecnigeria.org/parties/) on October 19, 2026. Update `domain.js` when the official register changes.

## Deployment

### Docker Compose with Neon

Install Docker Engine with Compose v2, or Docker Desktop using Linux containers. From this folder:

1. If `.env` does not already exist, copy `.env.example` to `.env`. Preserve an existing `.env` and its settings.
2. Set `DATABASE_URL` in `.env` to your Neon connection string with `sslmode=require`.
3. Run:

```sh
docker compose up --build -d
docker compose ps -a
docker compose logs --tail=100 app setup
```

Open http://localhost:3000. Compose first runs the schema setup as a one-off container. The app starts only after setup succeeds; a missing database URL or failed migration blocks startup. The setup container exiting with code 0 is expected. The app image also runs the repeatable schema setup before startup, including on Render. No local Postgres container is needed: results, location additions and attachment bytes persist in Neon, including when the app container is replaced.

The image uses Node 24, a lockfile-based production dependency install, a non-root user, and an HTTP health check at `/healthz`. Compose runs with a read-only filesystem, dropped Linux capabilities, restart-on-failure/host-reboot behavior, and graceful termination. `/healthz` checks the web process; it does not assert that Neon is reachable. Use the application logs to investigate database failures.

The `.env` file is excluded from the build context; credentials are supplied at container runtime. Never commit `.env` or publish the output of `docker compose config`, which can include its resolved secrets. Container administrators can inspect runtime environment variables.

By default the published port is bound to `127.0.0.1`. For a public host, route HTTPS through a reverse proxy to this port. If a remote proxy needs direct access, set `BIND_ADDRESS` to the appropriate host interface (or `0.0.0.0`) and restrict access with the host firewall. Change `APP_PORT` to use a different host port; the container always listens on port 3000. The local non-Docker server remains bound to loopback unless `HOST` is set.

Stop the deployment:

```sh
docker compose down
```

Rebuild after updating the source:

```sh
docker compose up --build -d
```

If the schema setup needs to run again against an existing deployment:

```sh
docker compose run --rm setup
```

The current schema setup is repeatable for fresh or existing MPUR tables; future schema changes should use versioned migrations. Database-owner credentials can alter schema or disable triggers, so restrict production database access and keep backups. No Neon database or public hosting is provisioned by these files.
