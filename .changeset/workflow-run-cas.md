---
"@dromio/workflow": minor
---

Add compare-and-swap run persistence across the workflow control plane and
SQLite runtime store. Stale writers now fail with explicit revision conflicts,
while retry and restart paths preserve monotonic run history without duplicate
effects.
