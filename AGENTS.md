# Workflow repository

- Use `make setup` for deterministic dependency installation.
- Use `make check` as the complete package gate.
- Keep `@dromio/workflow` as the canonical public authoring package.
- Keep applications, providers, hosted services, and workspace orchestration out of this repository.
- Do not commit secrets, plaintext environment files, generated tarballs, or build output.
