# ADR 008 — Claim Status Policy & Verification Framework

**Status:** Accepted  
**Date:** 2026-08-17  
**Updated:** 2026-08-24

---

## Claim Status Definitions

| Status | Meaning | Can be set by |
|--------|---------|---------------|
| `unverified` | Default. Not checked against any source. | System (automatic) |
| `reported` | Appears in one or more sources but not cross-checked. | System / User |
| `strongly_correlated` | Multiple independent sources agree. | User after review |
| `opinion` | Subjective statement, not a factual claim. | User |
| `inference` | Logical conclusion, not directly stated in sources. | User |
| `disputed` | Contradicting evidence found. | User |
| `outdated` | Was accurate but superseded by newer evidence. | User |
| `verified` | Confirmed against primary source with supporting evidence IDs. | **User only — requires evidence** |

**Rule:** No automated process may set status to `verified`. Requires human review + at least one `supporting_evidence_id`.

---

## How to Verify a Claim

### Step 1 — Check the source link
Every claim in CCJ links to its source. Click **🔗 Open original source** to read the primary document.

### Step 2 — Cross-reference with fact-checkers

| Resource | URL | Good for |
|----------|-----|---------|
| Snopes | https://www.snopes.com | Viral claims, misinformation |
| FactCheck.org | https://www.factcheck.org | Political claims (US) |
| Boom Live | https://www.boomlive.in | Indian news fact-checks |
| Alt News | https://www.altnews.in | Indian misinformation |
| AFP Fact Check | https://factcheck.afp.com | Global news |
| Reuters Fact Check | https://www.reuters.com/fact-check | Wire news |
| PolitiFact | https://www.politifact.com | Political statements |
| Vishvas News | https://www.vishvasnews.com | Hindi/regional India |
| The Quint WebQoof | https://www.thequint.com/news/webqoof | Indian digital claims |

### Step 3 — Check primary sources

| Type | Where to verify |
|------|----------------|
| Indian court orders | https://ecourts.gov.in / https://sci.gov.in |
| Bar Council statements | https://www.barcouncilofindia.org |
| Parliament records | https://sansad.in / https://irs.nic.in |
| Government gazettes | https://egazette.gov.in |
| Company filings | https://www.mca.gov.in |
| RTI responses | https://rtionline.gov.in |
| Academic papers | https://scholar.google.com / https://openalex.org |

### Step 4 — Update the claim status in CCJ

1. Open the project → **Claims** tab
2. Find the claim
3. Click **Edit**
4. Select the new status
5. This is recorded in the **Audit History** with your user ID and timestamp

---

## Social Media Verification

CCJ searches social platforms automatically. Verify social content:

| Platform | Verification approach |
|----------|-----------------------|
| X/Twitter | Check account verification badge, join date, follower count |
| YouTube | Check official channel, subscriber count, video dates |
| Instagram | Check verified badge, account age, cross-reference |
| LinkedIn | Check employment history, connections, endorsements |
| Facebook | Check page creation date, like count, cross-reference |

**Warning:** Social media content is self-published and does not equal verified fact.  
Always cross-reference with independent news sources before upgrading to `strongly_correlated`.

---

## Claim Confidence Score

CCJ assigns an initial confidence score (0.0–1.0):

| Score | Meaning |
|-------|---------|
| 0.85+ | Wikipedia / peer-reviewed academic source |
| 0.70–0.84 | Major established news outlet (Guardian, BBC, Reuters) |
| 0.50–0.69 | News source, unverified credibility |
| 0.30–0.49 | Social media, Reddit, user-generated content |
| 0.0–0.29 | Speculative, insufficient source |

Confidence is **not verification**. A 0.85 confidence claim is still `unverified` until a human reviews it.

---

## Evidence Chain

Every claim links to:
- `supporting_evidence_ids[]` — evidence that supports it
- `contradicting_evidence_ids[]` — evidence that disputes it
- `source_id` → `url` — the original URL
- `retrieved_at` — when CCJ fetched it
- `published_at` — when the source published it

Click any evidence item to see the exact quote and the source URL.

---

## What This Protects Against

- **Hallucinated facts:** AI cannot mark anything `verified` — humans must
- **Source confusion:** Every claim traces to a specific URL and timestamp
- **Stale information:** `outdated` status flags superseded claims
- **Silent upgrades:** Pydantic + DB enforce that `verified` requires evidence IDs
