# PREVIEW-1 implementation contract

This directory defines the provider-neutral contract for a branch preview. It
does not select a hosting, database, or paid deployment provider.

The deploy controller receives a commit SHA from Cursor Origin and creates one
isolated preview application and one isolated PostgreSQL database for the
branch. The external preview origin has one routing surface:

- `/` and static assets → `apps/web`
- `/api/*` → `apps/api`
- `/health` → `apps/api`

The web app uses relative `/api` requests. No public API base URL is required.
The ingress example is in [`ingress.conf.template`](./ingress.conf.template).

## Deployment sequence

1. Resolve the branch head SHA from Cursor Origin. GitHub is only a backup or
   optional CI mirror and is never the deploy authority.
2. Build the web and API artifacts from that exact SHA with Node `22.13.0`.
3. Provision or reuse the branch preview compute and an isolated empty
   PostgreSQL database.
4. Run one dedicated database job. For a new or intentionally reset preview,
   use `PREVIEW_RESET_CONFIRM=1 PREVIEW_DB_ISOLATED=1 APP_ENV=preview pnpm
   preview:reset`; it performs empty database → migrations → synthetic fixture
   exactly once. For a non-reset redeploy, run
   `pnpm --filter @millq/api run migrate` once and do not seed again. The API
   process never runs migrations at startup.
5. Start the API with `APP_ENV=preview` and
   `ALLOW_DEV_CASHIER_BOOTSTRAP=1`. Start the web build with
   `VITE_ENABLE_DESIGN_LAB=true` for staff-test previews.
7. Run the preview smoke checks against the single external origin.
8. On branch deletion or TTL expiry, destroy both preview compute and its
   database. Never clone production data into this environment.

## Environment contract

### API runtime

- `APP_ENV=preview`
- `NODE_ENV=production`
- `DATABASE_URL=<isolated preview PostgreSQL URL>`
- `PORT=3000`
- `LOG_LEVEL=info`
- `ALLOW_DEV_CASHIER_BOOTSTRAP=1` for the staff-test preview only
- `RELEASE_SHA=<deployed Cursor Origin SHA>`

### Preview reset job

- `APP_ENV=preview`
- `DATABASE_URL=<isolated preview PostgreSQL URL>`
- `PREVIEW_DB_ISOLATED=1`
- `PREVIEW_RESET_CONFIRM=1`

The reset guard intentionally refuses staging and production values. Database
credentials are job/runtime secrets and are never committed.

### Web build

- `VITE_ENABLE_DESIGN_LAB=true` only for local and staff-test preview builds
- unset or `false` for staging and production builds

The design-lab route and dev cashier bootstrap are not part of the staging or
production runtime contract.

## Rollback and cleanup

Rollback redeploys the previous Origin SHA to the same preview resources, then
runs the normal health and smoke checks. If the preview is deleted, its
compute and database are deleted together. `preview:reset` is destructive and
is limited to a database explicitly marked as isolated.

Physical printer bridges, KDS hardware bridges, and offline runtime remain
outside PREVIEW-1.
