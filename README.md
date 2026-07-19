# Dromio Workflow

Build typed, durable workflows with one public package: `@dromio/workflow`.

## Install

```bash
bun add @dromio/workflow
```

## First step

```ts
import { step } from "@dromio/workflow";
import { z } from "zod";

export const greet = step({
  id: "greet",
  input: { name: z.string() },
  output: { message: z.string() },
  run: ({ input }) => ({ message: `Hello, ${input.name}!` }),
});
```

Common authoring primitives are exported from the package root. Advanced client,
React, rendering, and control-plane APIs use deliberate subpath exports such as
`@dromio/workflow/client` and `@dromio/workflow/react`.

The package gate compiles and executes a complete workflow built from this step
inside a clean consumer before a release can be promoted.

## Configuration

Basic steps and workflows do not require global configuration. Features that
reach models, storage, control planes, or user interfaces receive their adapters
at the application boundary, keeping workflow logic portable.

## Examples and guides

The [Workflow SDK guide](https://dromio.ai/docs/workflow-sdk) progresses from the
first typed workflow through composition, human input, models and evaluation,
events and traces, application surfaces, and current API status. Examples use the
canonical package root first and introduce subpath APIs only when they are needed.

## Develop

```bash
make setup
make check
make release-rehearse
```

`make check` builds the complete workflow-owned package closure, checks the
public API, packs all nine packages in the release closure, installs them into a
clean consumer, imports every supported public subpath, and compiles and runs a
representative workflow. `make release-rehearse` additionally validates the
dependency order and publication metadata without contacting npm.

## Repository boundary

This repository owns the Workflow authoring package and the tightly coupled
workflow-domain packages needed to build and release it. Applications,
providers, hosted services, and Dromio workspace orchestration remain in their
respective repositories.

Licensed under Apache-2.0.
