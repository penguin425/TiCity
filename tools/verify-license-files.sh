#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

test -f LICENSE
test -f NOTICE
test -f public/THIRD_PARTY_NOTICES.txt
grep -q "Apache License" LICENSE
grep -q "5d2d3458fdf06b47d9a7a6b5ffebed99c210d554" NOTICE
grep -q '"license": "Apache-2.0"' package.json
grep -q '"name": "ticity"' package.json
grep -q 'https://github.com/penguin425/TiCity.git' package.json
grep -q '<h1>Ti<span>City</span></h1>' index.html
grep -q 'Copyright © 2010-2026 three.js authors' public/THIRD_PARTY_NOTICES.txt
grep -q "legalFileNames = \['LICENSE', 'NOTICE'\]" vite.config.ts
grep -q "href: './LICENSE'" src/tidb/ui/legal.ts
grep -q "href: './NOTICE'" src/tidb/ui/legal.ts

if rg --hidden -n \
  --glob '!.git/**' \
  --glob '!node_modules/**' \
  --glob '!dist/**' \
  --glob '!CHANGELOG.md' \
  --glob '!tools/verify-license-files.sh' \
  'TiDB City|TiDB-City|tidb-city|TIDBCITY|TiDBCity|TIDB_CITY' \
  .
then
  echo "A legacy product identifier is still referenced." >&2
  exit 1
fi

if rg -n \
  '@electric-sql/pglite|plausible\.io|window\.plausible' \
  package.json package-lock.json index.html machine diagnose src/tidb
then
  echo "Removed runtime or analytics dependency is still referenced." >&2
  exit 1
fi

if rg -n \
  '<script[^>]+src=["'\'']https?://|navigator\.sendBeacon|XMLHttpRequest|fetch\(' \
  index.html machine/index.html diagnose/index.html src/tidb
then
  echo "Unexpected runtime network path found in a static surface." >&2
  exit 1
fi

echo "License, attribution, dependency, and offline-runtime checks passed."
