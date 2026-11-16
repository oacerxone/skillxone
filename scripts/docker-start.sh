#!/bin/sh
# Container entry point for the web app: bring the schema up to date, load reference data,
# then serve. Migrations are idempotent, so restarting is safe.
set -eu
pnpm worker migrate
pnpm worker seed
exec pnpm --filter @skillxone/web exec next start -H 0.0.0.0 -p "${PORT:-3000}"
