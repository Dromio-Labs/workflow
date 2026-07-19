# Dromio Workflow

Build typed, durable workflows with one public package: `@dromio/workflow`.

## Install

```bash
bun add @dromio/workflow
```

## First workflow

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

## Develop

```bash
make setup
make check
```

`make check` builds the complete workflow-owned package closure, checks the
public API, packs the packages, installs them into a clean consumer, and imports
every supported public subpath.

## Repository boundary

This repository owns the Workflow authoring package and the tightly coupled
workflow-domain packages needed to build and release it. Applications,
providers, hosted services, and Dromio workspace orchestration remain in their
respective repositories.

Licensed under Apache-2.0.
