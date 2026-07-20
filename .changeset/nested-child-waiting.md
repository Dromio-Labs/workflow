---
"@dromio/workflow": minor
---

Nested child workflows can now wait for human input at any depth. Child
questions surface through the parent session namespaced by the wait site
(`<stepId>.<questionId>`), child approval hooks surface as mirrored parent
hooks whose tokens derive from the child token, and answering or resuming at
the top routes the value back to the workflow that asked. All composition
paths participate — `step.workflow`, `step.router`, fork branches, and
for-each iterations — and a paused nested run survives snapshot/rehydrate:
waiting children embed their snapshots into the parent's durable state
recursively. Adds the `wait` step result and read-only `hookAnswers` on the
step context; `UnsupportedChildWorkflowWaitingError` now only fires for
callers that do not opt into waiting.
