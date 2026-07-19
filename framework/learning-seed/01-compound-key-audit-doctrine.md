# Compound-Key Audit Doctrine

## Lesson: When you extend an isolation key from K1 to (K1, K2), every string in the codebase whose value identifies a unit of work or a record MUST include K2 - and a static-analysis sweep is the cheapest enforcement.

**Context:** A multi-tenant engine adding a second isolation dimension: every isolation site (graph node properties, vector-store payloads, queue job data, database columns) gained a `subTenantId` alongside the existing `tenantId`. The plan was code-grounded and heavily audited; 80 test suites and a live verifier all reported green. Then the end-to-end ran.

**What happened:** **Sixteen** code sites were missed by the read-through audit, discovered one at a time across roughly 14 hours of live testing, then in bulk by a 100-line static-analysis script. All sixteen shared one bug-shape family: *a string whose value identifies a unit of work or a record, that omits part of the new compound key.* The shape fired across four distinct surfaces:

| Surface | Example bug |
|---|---|
| Writes + id derivation (MERGE keys, uuid derivation) | caught by the original audit |
| Read-side guards (WHERE filters using a SUBSET of the key) | an "is it ingested?" check matched by item id alone, causing cross-tenant pollution |
| DELETE/CREATE statements | a DELETE scoped by K1 only wiped other tenants' data |
| Queue dedup keys + cache/lock keys | a job id built from K1 alone silently no-op'd the second tenant's enqueue |

The unifying insight: *anywhere a value-typed string is treated as identity by some downstream system (graph MATCH, queue dedup, cache SETNX, aggregation match), it is a key* - and all keys must include every part of the compound isolation key. The script found 6 more instances of the shape on its first 5-minute run; per-bug cost near zero, versus hours of paid end-to-end discovery each. Roughly a 6x immediate payoff.

**Transferable rule:** Whenever you extend an isolation key from K1 to (K1, K2), write a static-analysis sweep BEFORE declaring the stage done, with at least five rule families: (1) MATCH/MERGE property bags using K1 but not K2; (2) DELETE/DROP statements scoped by partial key; (3) queue dedup keys; (4) cache/lock keys; (5) bare casts on third-party SDK calls (`as any` disables the only check that catches signature drift). The sweep's exit code becomes a **promote gate**; no stage closes until it is 0. The sweep is infrastructure, not a one-off audit - every future key change inherits it for free.

Process rules that ride along: mocks must validate **call shape**, not just return value (a mock returning hardcoded results without checking inputs is a compile-passing comment); verifiers that call production methods beat verifiers that mirror "production-shaped" queries by hand; and every `NOTE: deferred` comment is open work that blocks stage closure until closed or registered.

**Confidence:** high (sixteen consecutive cases in one project across two days; the doctrine is mechanical)   ·   **Promote?** yes
