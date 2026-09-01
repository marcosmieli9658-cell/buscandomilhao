# Architecture

The application is a local modular monolith. Next.js renders the operator dashboard, a separate local worker claims durable SQLite jobs, and both processes use the same database as the source of truth.

## Core invariants

- A lead is unique by funnel and normalized Instagram handle.
- An inbound Meta identifier is unique across leads.
- Every message and job has an idempotency key.
- Pipeline state and channel state are independent.
- A conversation has exactly one channel owner: browser, official API, human, or none.
- Browser ownership ends when a verified inbound webhook makes the recipient API-eligible.
- `do_not_contact` is terminal and clears all scheduled actions.
- Commercial output may reference only indexed verified claims from `config/business.json`.
- Unknown model pricing, expired API windows, missing credentials, and integration divergence fail closed.

## Runtime flow

1. A discovery job searches Instagram in an isolated CDP tab or the operator registers a public profile.
2. The lead service normalizes and deduplicates the handle.
3. A qualification job scores ICP fit and advances valid leads.
4. OpenAI produces a structured first-contact decision under verified-claim constraints.
5. The browser worker enforces warmup, daily limits, operating hours, spacing, ownership, and deduplication.
6. A signed Meta webhook stores the inbound event idempotently and transfers ownership to the official API.
7. The conversation engine selects a structured intention and action.
8. The API adapter rechecks opt-out, ownership, recipient eligibility, and the 24-hour window before every send.
9. Events, audit logs, messages, token usage, cost, jobs, and exceptions remain queryable from the CRM.

## Recovery

Jobs use compare-and-set claiming inside a SQLite transaction. A startup recovery step moves stale running jobs back to retry. Exponential retry is bounded; exhausted jobs become dead letters and create operator exceptions. WAL, foreign keys, a busy timeout, versioned migrations, and the SQLite online backup API protect local state.

## Security

Secrets are loaded from `.env`, real business facts from ignored `config/business.json`, and logs redact credential-shaped fields. Webhooks require HMAC SHA-256 verification. The Chrome endpoint stays on loopback, uses a dedicated OS-protected profile, and never exports browser state. The browser adapter rejects navigation outside Instagram.
