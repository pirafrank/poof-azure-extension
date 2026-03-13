#!/usr/bin/env bash
# Installs packages via poof.
# Expected environment variables:
#   POOF_PACKAGES  - newline or comma-separated list of user/repo[@tag] slugs
#   GITHUB_TOKEN   - GitHub PAT for authenticated API requests (avoids rate limiting)

set -euo pipefail

if ! command -v poof >/dev/null 2>&1; then
  echo "poof not found in PATH"
  exit 1
fi

if [ -z "${POOF_PACKAGES:-}" ]; then
  echo "No packages specified, skipping installation."
  exit 0
fi

# Split on newlines and commas, trim whitespace, skip empty lines.
# Supports optional tag: user/repo@v1.0.0 -> poof install user/repo --tag v1.0.0
while IFS= read -r pkg; do
  pkg="$(echo "$pkg" | xargs 2>/dev/null || echo "$pkg")"
  [ -z "$pkg" ] && continue
  if [[ "$pkg" == *@* ]]; then
    slug="${pkg%%@*}"
    tag="${pkg##*@}"
    echo "Installing ${slug}@${tag} with poof..."
    poof install "$slug" --tag "$tag"
  else
    echo "Installing ${pkg} with poof..."
    poof install "$pkg"
  fi
done < <(printf '%s' "${POOF_PACKAGES}" | tr ',' '\n')
