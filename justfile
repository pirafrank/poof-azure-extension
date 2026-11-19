set dotenv-load := false

# Set the extension and task version in all manifests and the npm lockfile.
bump-version version:
    node scripts/bump-version.mjs {{version}}

ci:
    npm ci --ignore-scripts
    npm run check
    npm audit --omit=dev

release-preview: ci
    npm run package

release-production: ci
    npm run package -- production
