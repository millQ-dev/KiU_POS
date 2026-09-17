# Preview deploy adapter boundary

The repository owns application artifacts, migrations, the deterministic
preview reset command, and the environment contract. A hosting provider
adapter owns branch compute, ingress rendering, database provisioning, secret
injection, and TTL cleanup.

The adapter must run these commands in order against the SHA checked out from
Cursor Origin:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
# one dedicated database job for a fresh preview; it includes migrations
PREVIEW_RESET_CONFIRM=1 PREVIEW_DB_ISOLATED=1 APP_ENV=preview pnpm preview:reset
# for a non-reset redeploy, run the migration job once instead:
# pnpm --filter @millq/api run migrate
```

It must expose one external origin and route `/api/*` and `/health` to the API.
It must delete the database and compute together when the branch is deleted or
its TTL expires.
