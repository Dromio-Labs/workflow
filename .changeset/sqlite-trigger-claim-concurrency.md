---
"@dromio/workflow": patch
---

Reserve the SQLite writer before read-then-write trigger claims, signal deliveries, and dataset upserts so independent processes can share the runtime store without `SQLITE_BUSY_SNAPSHOT` failures.
