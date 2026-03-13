# poof Azure DevOps Extension

An [Azure DevOps Marketplace](https://marketplace.visualstudio.com/azuredevops) extension that
installs [poof](https://github.com/pirafrank/poof) and optionally installs pre-built binaries
of your choice from GitHub Releases into your pipeline.

## What it does

1. Bootstraps `poof` (a binary installer for GitHub Releases) at the requested version.
2. Optionally installs any number of GitHub Release packages in one step.
3. Prepends `poof` and the packages bin directory to `PATH` so installed tools are available
   in all subsequent steps.

## Usage

After installing the extension from the Marketplace, use the `Poof@1` task:

### Minimal — install poof only

```yaml
steps:
  - task: Poof@1

  - bash: poof --version
    displayName: "Verify poof"
```

### Full — install poof and tools

```yaml
variables:
  - group: my-variable-group   # must contain GITHUB_TOKEN as a secret

steps:
  - task: Poof@1
    inputs:
      version: "latest"
      packages: |
        pirafrank/vault-conductor@v0.3.0
        ms-jpq/sad
      githubToken: "$(GITHUB_TOKEN)"

  - bash: |
      vault-conductor --version
      sad --version
    displayName: "Use installed tools"
```

## Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `version` | Version of poof to bootstrap (e.g. `v0.6.0`). Use `latest` for the most recent release. | `latest` |
| `packages` | Newline or comma-separated list of `USER/REPO` (or `USER/REPO@TAG`) entries to install. Leave empty to skip. | `""` |
| `githubToken` | GitHub personal access token for authenticated API requests. Pass a pipeline secret using macro syntax (e.g. `$(MY_GITHUB_PAT)`). Avoids rate limiting. | `$(GITHUB_TOKEN)` |

## Package format

```
pirafrank/vault-conductor         # latest release
pirafrank/vault-conductor@v0.3.0  # specific tag
ms-jpq/sad
```

Multiple packages can be separated by newlines or commas.

## Rate limiting

poof makes GitHub API calls to resolve releases. Without a token these are unauthenticated and
subject to GitHub's [rate limit](https://docs.github.com/en/rest/overview/rate-limits-for-the-rest-api)
(60 requests/hour per IP). Provide a GitHub personal access token to raise this to 5,000/hour.

Store the token as a **secret pipeline variable** or in a **variable group**, then pass it:

```yaml
- task: Poof@1
  inputs:
    githubToken: "$(MY_GITHUB_PAT)"
```

## Supported platforms

| OS | Architecture |
|----|-------------|
| Linux (glibc) | x86_64, aarch64, armv7, i686 |
| Linux (musl) | x86_64, aarch64, armv7, i686 |
| macOS | x86_64 (Intel), aarch64 (Apple Silicon) |

## Development

### Prerequisites

- Node.js 20+
- `bash` available on the agent (standard on Linux/macOS agents)

### Build

```bash
# Install root dev dependencies (tfx-cli)
npm install

# Install task dependencies and compile TypeScript
npm run build
```

### Package

```bash
# Produces a .vsix file in dist/
npm run package
```

> **Note**: A `128×128` PNG named `images/icon.png` is required before packaging.
> See [`images/ICON_REQUIRED.md`](images/ICON_REQUIRED.md) for details.

### Publish

**1. Create a publisher account**

Go to [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage) and
create a publisher. Update the `publisher` field in [`vss-extension.json`](vss-extension.json)
to match.

**2. Make the extension public (optional)**

By default `galleryFlags` in `vss-extension.json` is empty, so the extension publishes as
**private** (only visible to your publisher account and organizations you explicitly share it
with). To list it publicly on the Marketplace, change the field before publishing:

```json
"galleryFlags": ["Public"]
```

A public listing requires Marketplace review and a valid icon, description, and README.

**3. Create a Marketplace PAT**

In Azure DevOps, create a Personal Access Token with **Marketplace → Manage** scope.

**4. Publish**

```bash
# Publish directly (prompts for PAT)
npm run publish

# Or set the token as an env var
MARKETPLACE_PAT=<token> npx tfx extension publish --manifest-globs vss-extension.json --token "$MARKETPLACE_PAT"
```

### Automated publishing via GitHub Actions

Push a semver tag (e.g. `v1.0.0`) to trigger the
[publish workflow](.github/workflows/publish.yml). The workflow requires a
`MARKETPLACE_PAT` secret set in the GitHub repository settings.

### Task UUID

The `id` in [`tasks/PoofInstall/task.json`](tasks/PoofInstall/task.json) is a UUID that
**must not change** after the first publish — Azure DevOps uses it to identify the task
across versions. Generate a new one before first publishing:

```bash
node -e "const {randomUUID}=require('crypto'); console.log(randomUUID())"
```

## Repository structure

```
tasks/
  PoofInstall/
    task.json           ← task manifest (id, inputs, execution handler)
    index.ts            ← Node.js task entry point
    install_poof.sh     ← poof bootstrap script
    install_packages.sh ← package installation script
    package.json        ← task dependencies (azure-pipelines-task-lib)
    tsconfig.json
images/
  icon.png              ← 128×128 PNG required for Marketplace (add before packaging)
vss-extension.json      ← extension manifest
package.json            ← root: tfx-cli, build/package/publish scripts
.github/workflows/
  publish.yml           ← GitHub Actions: auto-publish on semver tag
```

## License

[MIT](LICENSE.md)
