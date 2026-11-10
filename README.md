# Setup poof for Azure Pipelines

An Azure DevOps extension equivalent to the [Setup poof GitHub Action](https://github.com/marketplace/actions/setup-poof).
It downloads an already-built [poof](https://github.com/pirafrank/poof) executable,
validates it, and runs `poof install` for the requested packages.
Package selection, downloads, archive handling, and installation belong to poof, not this extension.

This repository is prepared for private testing. Marketplace publication and installed-task
certification on all target platforms are still required before a public release.

## Usage

After installing the extension into your Azure DevOps organization:

```yaml
steps:
  - task: SetupPoof@1
    inputs:
      packages: |
        lsd-rs/lsd
        dandavison/delta@0.18.0
  - bash: |
      poof --version
      lsd --version
      delta --version
```

Omit `packages` to install poof only. Commas and newlines separate package entries.
Use `SetupPoofPreview@1` instead when testing the private preview extension.
No repository-resource checkout or GitHub service connection is needed to use the task.

## Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `version` | Exact poof release, with or without `v`. `latest` reuses a recognized installed poof; otherwise it downloads the latest release. | `latest` |
| `packages` | Comma/newline-separated `owner/repository` or `owner/repository@tag` entries. | Empty |
| `token` | Optional GitHub token supplied through a secret variable. `githubToken` is an alias. | Empty |

For reproducible builds, pin poof and package versions. The task's `@1` version is independent
of the poof release selected by `version`.

Azure Pipelines does not supply a built-in GitHub token. An optional secret reduces GitHub
API rate limiting and is forwarded to poof through `GITHUB_TOKEN`:

```yaml
- task: SetupPoof@1
  inputs:
    version: v0.5.2
    token: $(MY_GITHUB_PAT)
    packages: dandavison/delta@0.18.0
```

Store the token as a secret variable or in a variable group. Never put its literal value in
YAML. An explicitly mapped `GITHUB_TOKEN` environment variable is also accepted, with the input
taking precedence. An unresolved macro is an error. `System.AccessToken` is not a GitHub token.

## Binary validation

The bootstrap downloads public poof release assets from `pirafrank/poof` over HTTPS.
When release metadata advertises a SHA256 manifest, it must download successfully and its
checksum must match before the executable is run. Corrupt manifests or mismatches fail the task.
Only a regular root-level `poof` archive member is streamed into a temporary file; other
archive paths are not extracted. The executable must report the exact upstream release URL
for the requested version before replacing the installed file.

Older releases without a checksum manifest produce an explicit warning and use HTTPS plus
an executable/version check. Checksums obtained from the same GitHub release detect corruption;
they do not independently authenticate the publisher. Sigstore signature verification is not
implemented. Installed binaries are reused by identity/version, not rehashed against a release.
Only install packages from publishers you trust: downloaded executables run with agent permissions.

## Agent requirements

Target platforms are Linux with glibc and macOS, each on x64 or ARM64. Azure DevOps Services
agents must be version 4.278.0 or newer with the `Node24` task runner, Bash, curl, tar, and grep.
Windows, Azure DevOps Server, native musl agents, i686, and armv7 are outside the initial scope.
Target support is not a certification claim until the installed-extension acceptance matrix passes.

The poof executable is installed in `$HOME/.local/bin`. Tools managed by poof use
`$XDG_DATA_HOME/poof/bin` on Linux when XDG_DATA_HOME is absolute, otherwise
`$HOME/.local/share/poof/bin`; macOS uses `$HOME/Library/Application Support/poof/bin`.
Both directories are added to PATH for subsequent steps. No shell profile is modified.
Self-hosted agents reuse their installation across runs; concurrent jobs should use separate homes.

## Development

Use Node.js 24 and run from the repository root:

```sh
npm ci --ignore-scripts
npm run check
npm audit --omit=dev
npm run package
```

Tests mock downloads and use fixture executables; they do not install packages into your real home.
Packaging stages compiled wrapper code, shell scripts, and locked production dependencies.
The VSIX is checked for missing runtime files and development content, then its unpacked handler
is executed without repository dependencies. Agents do not need npm or a Rust toolchain.

`npm run package` creates a private preview VSIX in `dist/preview` with a separate task GUID
and the name `SetupPoofPreview`. `npm run package -- production` creates the production identity
in `dist/production`, still private by default. Local packaging never publishes anything.

## Privacy and support

The extension adds no telemetry. It contacts GitHub for release metadata and public poof assets;
poof makes its own requests for selected packages. The GitHub token is passed to the bootstrap
and poof process, registered for Azure log masking, and is not stored in the VSIX or shell profiles.
See [poof](https://github.com/pirafrank/poof) for the CLI's behavior and security documentation.
Report extension problems through [GitHub Issues](https://github.com/pirafrank/poof-azure-extension/issues).

## License

[MIT](LICENSE.md)
