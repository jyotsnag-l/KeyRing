# KeyRing — Product Requirements Document
### Scoped, Time-Boxed Delegation for Aging-Parent Financial & Account Oversight

**Version:** 1.0 (Draft for hackathon/MVP scoping)
**Owner:** Jo
**Status:** Draft

---

## 1. Problem Statement

When a parent starts declining — cognitively or physically — someone in the family needs to step in and help manage bank accounts, bill pay, medical portals, and insurance. Today, families have exactly two tools, and both are bad fits:

1. **Power of Attorney (POA)** — legally binding, but all-or-nothing and effectively permanent. There's no way to say "let my sister see mom's checking account balance, but not move money, and let's reassess in 3 months."
2. **Informal access** (shared passwords, added-as-authorized-user, sibling "just handles it") — flexible, but has no scope, no expiry, and no record. This is also the exact pattern behind most documented elder financial abuse, which is disproportionately committed by family members who were given broad, unreviewed access "temporarily."

The result: families either grant too much access too early (the parent loses autonomy and dignity before it's needed) or too little too late (bills lapse, fraud goes unnoticed, siblings fight over who did what).

**KeyRing's bet:** the fix isn't a smarter monitoring tool (EverSafe, True Link already do fraud monitoring and spend restriction). The fix is a **delegation layer** — scoped, incremental, expiring, multi-party, and audited — that sits between "full access" and "no access," and that produces a record which protects everyone, including the delegate who didn't do anything wrong.

---

## 2. Goals

### Product goals
- Let a parent (or a family, once the parent can't initiate it themselves) grant **narrow, named, time-boxed** access to specific account categories.
- Let access **escalate incrementally** as a condition progresses, with consent at each step rather than a single cutover.
- Let **multiple delegates hold non-overlapping scopes** simultaneously (one handles medical, one handles the house) without needing to trust a shared login.
- Produce a **tamper-evident audit trail** of every grant, every action taken under a grant, and every escalation — usable as evidence, not just a log file.

### Explicit non-goals (v1)
- KeyRing is **not** a bank, a payments processor, or a legal instrument. It does not replace POA, guardianship, or conservatorship — it's the coordination and audit layer that operates *underneath* whatever legal authority already exists, or *before* legal authority is needed (early-stage, low-stakes access).
- KeyRing does not itself move money. It brokers **permission and visibility**; actual transactions happen through existing bank/bill-pay rails via read APIs or supervised action, not by KeyRing holding funds.
- v1 does not attempt to detect fraud or anomalous spending (that's True Link/EverSafe's job) — though the audit trail is designed to make that a natural v2 extension.

### Success metrics (for a real product, not just hackathon demo)
- **Time-to-first-grant**: how quickly a family can set up their first scoped grant (target: under 10 minutes, no lawyer needed for view-only/pay-bills tiers).
- **Escalation-without-conflict rate**: % of scope escalations that complete via in-app consent vs. requiring the family to fall back to offline argument/lawyer.
- **Audit trail usage**: % of families who report reviewing the audit log at least monthly (proxy for the "safeguard" value actually getting used, not just existing).
- **Zero silent scope creep**: 100% of actions taken under a grant are attributable to a specific grant + specific scope + specific actor. No exceptions — this is the core trust guarantee.

---

## 3. Personas

| Persona | Description | Core need |
|---|---|---|
| **The Parent** | Aging, may have early cognitive decline. Still legally competent at grant-creation time in the common case. | Retain dignity and control for as long as possible; be able to see who has access to what, and revoke it. |
| **The Primary Delegate** | Usually the adult child who lives nearest or is most involved. | Needs enough access to actually get things done (pay bills, talk to insurance) without taking on legal/financial risk they don't want. |
| **The Secondary Delegate(s)** | Other siblings/relatives with narrower, non-overlapping responsibility (e.g., "handles the house," "handles medical"). | Needs their own clearly bounded lane, and protection from being blamed for things outside it. |
| **The Skeptical Sibling** | Not a delegate, but wants oversight/veto power because trust is already strained. | Needs visibility and a say in escalations, without needing operational access. |
| **Elder-law attorney / financial advisor (secondary user)** | Sometimes brought in once things get complicated. | Needs to be able to export the audit trail as a coherent record. |

---

## 4. Core Concepts & Data Model

### 4.1 Grant
The fundamental unit of the system. A **Grant** is:

```
Grant {
  id
  parent_id                 // whose accounts/domain this covers
  delegate_id                // who receives access
  scope: enum                // view_only | pay_bills | full_manage
  domain: enum                // financial | medical | household | insurance | all
  reason: string              // required, human-readable justification
  created_by                  // parent, or co-signers if parent can't initiate
  start_at, expires_at        // every grant is time-boxed; no permanent grants in v1
  status: enum                // pending | active | expired | revoked | escalation_pending
  co_signers: [user_id]       // for grants created without parent-initiation
  parent_ack: bool            // did the parent see/acknowledge this while able to
}
```

Design rule: **a Grant without an expiry date is not a valid state.** Renewal is a deliberate re-confirmation, not a default. This is the single most important behavioral commitment in the product — it's the difference between KeyRing and "just giving someone your password."

### 4.2 Scope tiers
Scopes are ordered and each is a strict superset of the one below it, so escalation is legible:

1. **view_only** — see balances, statements, upcoming bills, portal messages. No action possible.
2. **pay_bills** — view_only, plus: pay recognized recurring bills (utilities, insurance premiums, subscriptions) up to a per-transaction and monthly cap. Cannot initiate new payees.
3. **full_manage** — pay_bills, plus: add new payees, respond to institutions, make one-off payments above cap (with co-sign, see 4.4).

Scopes are always paired with a **domain** (financial / medical / household / insurance), so two delegates can each hold `pay_bills` in different domains without overlapping.

### 4.3 Escalation Request
```
EscalationRequest {
  id
  grant_id                    // the grant being escalated
  requested_by                // the delegate
  requested_scope             // target tier
  justification                // required free text
  approvers_required: [user_id]  // parent (if able) and/or co-signer siblings
  approvals: [{user_id, decision, timestamp, note}]
  status: pending | approved | denied | expired
}
```
Escalation is never unilateral. It requires either the parent's explicit approval (preferred, while they're able) or a defined quorum of co-signers (e.g., "any 2 of 3 siblings") set up at onboarding. This is the multi-party-consent moment that's core to the product's trust story.

### 4.4 Action & Audit Log
Every read or write action taken under a grant is logged as an immutable, hash-chained event:
```
AuditEvent {
  id
  grant_id
  actor_id
  action_type                 // viewed_balance, paid_bill, added_payee, escalation_requested, escalation_approved, grant_revoked...
  target                       // account/bill/payee reference
  amount (if applicable)
  timestamp
  prev_event_hash              // chain for tamper-evidence
  event_hash
}
```
The chain (even a simple hash-linked log, not full blockchain) lets the family or an attorney later verify the log hasn't been edited after the fact — which is the actual safeguard against the "I never gave him access to do that" dispute.

### 4.5 Revocation
Any grant can be revoked at any time by: the parent (while able), or the quorum of co-signers, or automatically at `expires_at`. Revocation is immediate and logged with a reason. No grace period for pending actions — in-flight actions above a de minimis threshold require re-authorization.

---

## 5. System Architecture

Reuses the existing five-agent / MCP tool / Guardian-gate architecture from the underlying delegation engine, remapped to this domain:

| Agent | Role in KeyRing |
|---|---|
| **Intake Agent** | Walks the family through onboarding: parent identity, delegates, domains, initial scopes, co-signer quorum rules. |
| **Grant Agent** | Creates/modifies Grant objects; enforces the "no permanent grant" and "domain+scope must be explicit" invariants. |
| **Escalation Agent** | Manages EscalationRequest lifecycle; notifies approvers; enforces quorum logic. |
| **Execution Agent** | The only agent allowed to call out to connected account/bill-pay MCP tools, and only within the bounds of an *active, non-expired* grant scope. |
| **Guardian Agent (policy gate)** | Sits in front of the Execution Agent. Every action request is checked against: is there an active grant, is the scope sufficient, is it within the per-transaction/monthly cap, is the grant unexpired. Denies and logs anything that doesn't pass — this is the non-bypassable enforcement point, not just a UI restriction. |

**Key architectural principle:** the Guardian Agent is the only path to actual account actions. The UI can suggest or request an action, but cannot execute one directly — everything routes through the Guardian's scope check. This means the audit log is complete by construction, not by convention (nothing can act and skip logging).

### MCP Tool Layer
- Read-only account/bill aggregation (e.g., Plaid-style connections) for `view_only`.
- Bill-pay initiation APIs for `pay_bills` / `full_manage`, scoped per payee/cap.
- Notification tools (SMS/email/push) for escalation requests and revocation alerts.
- Export tool for generating a signed PDF/CSV of the audit trail for legal/advisor use.

---

## 6. Functional Requirements (MVP scope)

**Must have (v1 / hackathon-scale MVP):**
1. Onboarding flow: define parent, delegates, domains, co-signer quorum.
2. Create a Grant with explicit scope, domain, reason, and expiry (default suggested expiry, e.g. 90 days, always editable, never optional).
3. View-only dashboard per delegate, scoped to their domain(s) only — no visibility into other delegates' domains unless explicitly also granted.
4. Escalation request + approval flow with at least "parent approves" and "N-of-M co-signers approve" as options.
5. Immutable audit log, filterable by delegate/domain/date, exportable.
6. Revocation by parent or co-signer quorum, with immediate effect and log entry.
7. Automatic expiry with a renewal prompt (not silent renewal).

**Should have (v1.1):**
8. Per-transaction and monthly spend caps enforced at the Guardian layer for `pay_bills`.
9. Notification digest (weekly) to parent and non-delegate siblings summarizing activity — this is what makes the audit trail an active safeguard rather than a passive record nobody checks.
10. "Reason" prompts required before any escalation-affecting action, stored alongside the event.

**Nice to have (v2+):**
11. Anomaly flags (unusually large payment, new payee added) surfaced to non-acting family members — adjacent to, not competing with, True Link/EverSafe.
12. Attorney/advisor read-only export role.
13. Graceful transition path to formal POA/guardianship once/if legal authority becomes necessary — KeyRing's audit trail becomes supporting documentation for that transition rather than being thrown away.

---

## 7. Non-Functional Requirements

- **Security & privacy**: financial and medical account data — this is regulated-adjacent territory. Encryption at rest and in transit, least-privilege access even internally, no delegate ever sees data outside their granted domain. Plan for SOC 2 posture even pre-scale.
- **Auditability**: log integrity (hash chaining) must survive a compromised admin account — i.e., even KeyRing's own operators shouldn't be able to silently edit history.
- **Availability**: this sits in a "bills must get paid" critical path — target high availability for the Execution Agent path; degrade gracefully to view-only if action rails are down, rather than failing silently.
- **Scalability**: architecture should support family-unit tenancy (one parent + N delegates as a natural shard) — this scales horizontally by family, which keeps the hardest state (grants, audit chains) naturally partitioned.
- **Compliance**: not itself a bank or POA — but adjacent to elder-law and financial-services regulation. Needs legal review before real launch on: data retention requirements, whether audit exports could be treated as evidence, state-by-state differences in what "informal delegation" can and can't legally authorize.
- **Accessibility**: primary parent-facing UI must work for a population that may have low tech fluency and/or early cognitive decline — large text, minimal steps, no dark patterns, ability for a trusted person to walk them through it without taking over the account itself.

---

## 8. UX Notes / Tone

This is explicitly called out because it's a real product risk: **this is not a "problem solved!" consumer app.** The tone throughout — onboarding copy, notification language, the audit log itself — needs to protect the parent's dignity and agency. Concretely:
- Language defaults to the parent as the actor ("You're giving Priya access to view bills") not the delegate as the actor ("Priya wants access to your bills").
- No urgency/dark-pattern language anywhere in the escalation flow.
- The parent's ability to see and revoke grants should be at least as prominent in the UI as the delegate's ability to act.

---

## 9. Risks & Open Questions

| Risk | Notes |
|---|---|
| Legal ambiguity | Does a KeyRing "grant" have any standing if a bank or institution disputes an action taken under `pay_bills`? Needs legal review — likely v1 works only with institutions/rails that support delegated access natively (e.g., authorized-user or read-API models), not with unauthorized credential-sharing. |
| Parent lacks capacity at signup | v1 assumes the parent can initiate the first grant. Need a defined (and honestly, uncomfortable) fallback for families starting *after* capacity is already in question — likely: co-signer-only creation, clearly flagged as such in the audit trail, with a strong onboarding disclaimer that this is not a POA substitute. |
| Family conflict weaponizing the audit log | The log should not become a tool one sibling uses to publicly shame another. Access to full cross-domain logs is deliberately limited to what's necessary for oversight, not effectively public within the family. |
| Institution/API coverage | Bill-pay and account APIs vary wildly by bank/insurer. MVP likely needs a manual/semi-manual fallback path (delegate marks a bill "paid outside the app," logged as a self-reported action, clearly distinguished from Execution-Agent-verified actions). |
| Scope creep of "reason" fields | Reasons are free text in v1; consider structured/templated reasons later to make the audit log more consistently useful for legal export. |

---

## 10. Phased Rollout

**Phase 0 (hackathon/demo):** Grant creation, scope tiers, single-family onboarding, escalation with parent approval, audit log with export. Simulated/read-only account data — no real bank connections.

**Phase 1 (MVP, real users):** Real read-only account aggregation (Plaid or similar), co-signer quorum escalation, revocation, weekly digest notifications.

**Phase 2:** Real bill-pay execution with caps, anomaly flagging, attorney export role.

**Phase 3:** Multi-institution coverage expansion, formal legal-partnership pathway (elder-law firms, POA transition tooling).

---

## 11. Summary

KeyRing's differentiation isn't the tech — it's correctly identifying that the actual unmet need is a **legal/social middle ground between "full POA" and "shared password,"** and that the audit trail is the product, not a feature bolted onto one. The five-agent/Guardian architecture already models exactly this (scoped, incremental, time-boxed, policy-gated delegation) — this PRD is mostly a domain remap plus the addition of multi-party escalation consent and dignity-preserving UX constraints.