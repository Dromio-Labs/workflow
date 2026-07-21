# Dromio Workflow

Build typed, durable workflows with one public package: `@dromio/workflow`.

## Install

```bash
bun add @dromio/workflow
```

Workflow execution currently targets Bun 1.3.14 or newer. Node remains useful
for TypeScript tooling, but it is not a supported Workflow runtime while the
control-plane package uses Bun's SQLite driver.

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

## Durable run writes

Control-plane stores persist each run with a monotonic revision. Callers that
replace a run snapshot must provide the revision they observed; a concurrent
winner makes a stale write fail with an explicit revision conflict. Retry that
operation from a fresh read instead of overwriting newer events. The bundled
SQLite store enforces the same compare-and-swap contract across restarts.

## Examples and guides

The Workflow SDK guide progresses from the first typed workflow through
composition, human input, models and evaluation, events and traces, application
surfaces, and current API status. Examples use the canonical package root first
and introduce subpath APIs only when they are needed. The guide will be linked
here when the production documentation deployment is public.

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
