# ADR 008 — Claim Status Upgrade Policy

**Status:** Accepted  
**Date:** 2026-08-16

## Context

The CCJ spec explicitly prohibits silently upgrading a `reported` claim to `verified`. This is a core integrity requirement for a research system — conflating "reported" with "verified" is the primary failure mode of AI-generated content.

## Decision

1. **Default status is always `unverified`** — every newly created claim starts here regardless of source confidence.

2. **Status `verified` requires human review** — no automated pipeline may set status to `verified`. The API will reject claims with `status: "verified"` and no `supporting_evidence_ids`.

3. **Allowed automatic statuses from agents:** `unverified`, `reported`, `inference`, `strongly_correlated`.

4. **Status `verified` and `disputed`** can only be set by a human user action in the UI, which triggers an audit log entry.

5. **The Pydantic model** (`ClaimRecord`) enforces this at the Python layer — `model_validator` raises `ValueError` if `status == "verified"` and `supporting_evidence_ids` is empty.

6. **The database** does not enforce this rule directly (SQL cannot know if evidence IDs are valid), so enforcement is at the application boundary.

7. **The claim status badge in the UI** uses colour coding:
   - `verified` → green (only shown after human review)
   - `strongly_correlated` → blue
   - `reported` → amber
   - `disputed` → red
   - `unverified`, `inference`, `opinion`, `outdated` → grey

## Consequences

- Research agents produce conservative statuses.
- Creators must actively review and upgrade claims.
- Audit log captures every status change.
- False positives (over-claiming) are far less likely than in a system that auto-verifies.
