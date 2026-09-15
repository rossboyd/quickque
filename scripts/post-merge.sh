#!/bin/bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "Installing locked workspace dependencies..."
CI=true pnpm install --frozen-lockfile

# Database changes use reviewed SQL migrations in lib/db/migrations.
# The Drizzle schema is a scaffold, not the source of truth for existing tables.
# Never run `db push` here: syncing that empty schema proposes table deletion.
echo "Post-merge dependencies ready; database left unchanged."
