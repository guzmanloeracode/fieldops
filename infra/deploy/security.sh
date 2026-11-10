#!/usr/bin/env bash
# Secret scan of the whole git history and a production dependency audit. Run before making a release public.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
docker run --rm -v "$ROOT:/repo:ro" zricethezav/gitleaks:v8.30.1 git /repo --no-banner --redact
cd "$ROOT" && pnpm audit --prod --audit-level high
