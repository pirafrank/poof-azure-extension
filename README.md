# Poof Setup for Azure Pipelines

Install [poof](https://github.com/pirafrank/poof) and use it to add pre-built command-line tools to your Azure Pipelines jobs.

## Get started

Install **Poof Setup** from the [Azure DevOps Marketplace](https://marketplace.visualstudio.com/items?itemName=pirafrank.poof-setup), then add the task to your pipeline:

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

To install poof without any packages, omit the `packages` input. Package entries use `owner/repository` or `owner/repository@tag`; separate multiple entries with commas or newlines.

For reproducible builds, pin both the poof version and package release tags:

```yaml
- task: SetupPoof@1
  inputs:
    version: v0.6.2
    packages: dandavison/delta@0.18.0
```

## More information

See the [poof Azure DevOps extension guide](https://poof.fpira.com/docs/azure-devops-extension/) for task inputs, GitHub token configuration, agent requirements, installation behavior, and security details.

## Support

Report extension issues on [GitHub](https://github.com/pirafrank/poof-azure-extension/issues). For poof usage and package questions, see the [poof documentation](https://poof.fpira.com/docs/) or [poof repository](https://github.com/pirafrank/poof).

## License

[MIT](LICENSE.md)
