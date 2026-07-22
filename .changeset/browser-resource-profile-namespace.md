---
"@dromio/workflow": patch
---

Cut browser resource authoring over to the caller-owned `databasePath` and
`profileNamespace` settings. Runtime-owned application, tenant, user, and
derived profile resource identities are no longer accepted by the public
config contract.
