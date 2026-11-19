# Extension development

This document covers building and publishing the Azure DevOps extension itself. End-user setup and task behavior are documented in the [poof Azure DevOps extension guide](https://poof.fpira.com/docs/azure-devops-extension/).

## Prerequisites

Use Node.js 24 from the repository root.

## Build and validate

```sh
npm ci --ignore-scripts
npm run check
npm audit --omit=dev
npm run package
```

Tests mock downloads and use fixture executables; they do not install packages into your real home. Packaging stages compiled wrapper code, shell scripts, and locked production dependencies. The VSIX is checked for missing runtime files and development content, then its unpacked handler is executed without repository dependencies. Azure Pipelines agents do not need npm or a Rust toolchain.

The bootstrap requires a valid SHA256 digest in GitHub release metadata before downloading an archive, then checks the archive against that digest. A missing, null, or malformed digest fails installation. Reusing a recognized installed executable still skips release metadata and download verification. When a release also has a checksum manifest and Sigstore bundle, it verifies the manifest signature against the poof release workflow identity and checks the archive against that manifest. Releases without a signature bundle produce a warning; an advertised bundle that cannot be downloaded, a missing manifest required for signature verification, an invalid signature, or a checksum mismatch fails installation. Executable version checks are forcibly terminated after 10 seconds if they stall.

## Versioning

Before each Marketplace upload, bump the extension and task version together:

```sh
just bump-version 1.0.2
```

Replace `1.0.2` with the next `MAJOR.MINOR.PATCH` version. This updates the package manifests, task manifest, extension manifest, and npm lockfile. Commit the changes before publishing.

Preview (`pirafrank.poof-setup-preview`) and production (`pirafrank.poof-setup`) use separate extension identities, so the same version can be published to preview first and then production when promoting the same code. Their task references are `SetupPoofPreview@1` and `SetupPoof@1`. Bump the version for the next upload to an identity that has already successfully published that version; do not retry a successful publication with the same version.

## Packaging and publishing

Manage publisher details and extensions in the
[Visual Studio Marketplace management portal](https://marketplace.visualstudio.com/manage).

`npm run package` creates a private preview VSIX in `dist/preview` with a separate task GUID and the name `SetupPoofPreview`. `npm run package -- production` creates a public production VSIX in `dist/production`. Local packaging never publishes anything.

The GitHub Actions workflow publishes a production build when a `vMAJOR.MINOR.PATCH` tag is pushed. It runs checks, packages the tagged source, and uploads the VSIX. Production packaging always sets the Marketplace public flag. Configure `MARKETPLACE_PUBLISHER=pirafrank`, the `MARKETPLACE_PAT` secret, and the `marketplace-production` environment as required by the workflow.

For a preview publication, manually run **Publish Extension** from GitHub Actions. The workflow shares the preview extension with the configured Azure DevOps test organization. Configure `AZURE_DEVOPS_TEST_ORG` and the preview publishing environment and credentials.

Each Marketplace upload needs a new extension version. After publishing, check the workflow and Marketplace validation status before promoting the same source to another extension identity.
