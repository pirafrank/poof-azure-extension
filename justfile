set dotenv-load := false

# Set the extension and task version in all manifests and the npm lockfile.
bump-version version:
    node scripts/bump-version.mjs {{version}}
