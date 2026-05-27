# Billing plans + Stripe integration

Three pricing tiers, each gated by a flag on the `tenants` table in the
control-plane Postgres. Self-hosted Shinobi is always free and unrestricted;
plan enforcement runs entirely in the hosted runtime.

## Tiers

| Tier | Price | Users | Projects | SaaS sync | Plugin marketplace | Support |
|---|---|---|---|---|---|---|
| **Free** | $0 | 1 | 1 | local-only (git sync still works) | install OK | community (issues only) |
| **Team** | $19/mo | up to 5 | unlimited | full hosted sync + dashboard | install OK | email, 5 business days |
| **Pro** | $79/mo | unlimited | unlimited | full hosted sync + dashboard | install OK + private plugins | email, 1 business day + SLA on availability |

Prices are placeholders; tune after the first 10 paying customers based on
LTV/churn vs hosted infrastructure cost.

## Plan enforcement matrix

Where each constraint is checked (with example error response):

| Constraint | Where checked | Failure |
|---|---|---|
| `users <= plan_user_cap` | POST /api/auth/users | `402 plan_limit_users` |
| `projects <= plan_project_cap` | POST /api/projects | `402 plan_limit_projects` |
| `hosted_sync` | dashboard runtime boot | reject login, redirect to billing |
| `tenant.status in {trialing, active}` | every authenticated request | `402 subscription_inactive` |

Self-hosted dashboards skip the matrix entirely (no `tenants` table; the
code path that checks `plan` only runs when the runtime is configured for
hosted mode via env).

## Stripe data model

```
Postgres `subscriptions` table  (shadow of Stripe state)
├─ tenant_id      INTEGER REFERENCES tenants(id)
├─ stripe_customer_id   TEXT  (cus_XXX)
├─ stripe_subscription_id TEXT (sub_XXX)
├─ stripe_price_id      TEXT  (price_XXX → maps to a tier)
├─ status         TEXT  (trialing | active | past_due | canceled | unpaid)
├─ current_period_start  TIMESTAMPTZ
├─ current_period_end    TIMESTAMPTZ
├─ cancel_at_period_end  BOOLEAN
├─ trial_end             TIMESTAMPTZ
└─ updated_at            TIMESTAMPTZ
```

A single tenant has zero-or-one row. Free tier = no row (default plan flag
on tenants table is 'free').

## Stripe webhook contract

`POST /api/billing/webhook` (HMAC verified via `STRIPE_WEBHOOK_SECRET`)
reacts to these event types:

| Stripe event | Action |
|---|---|
| `checkout.session.completed` | Create subscription row, set `tenants.plan` to mapped tier |
| `customer.subscription.updated` | Sync status + period + price_id (handle upgrade/downgrade mid-cycle) |
| `customer.subscription.deleted` | Set status='canceled', downgrade `tenants.plan` to 'free' |
| `invoice.payment_failed` | Set status='past_due', email tenant master (no immediate degrade — wait for grace period) |
| `invoice.payment_succeeded` | Reset status='active' if was past_due |
| `customer.subscription.trial_will_end` | Email tenant master 3 days before trial end |

The webhook handler MUST be idempotent (Stripe retries on non-2xx) and
MUST verify the signature before any DB write. Reuse the HMAC helper
pattern from `src/services/github/webhook.ts`.

## Stripe Checkout integration

Tenant master clicks "Upgrade" → backend calls `stripe.checkout.sessions.create`
with the tenant's `stripe_customer_id` (lazily created on first request),
the chosen `price_id`, and a `success_url` that lands back on
`/billing?session_id={CHECKOUT_SESSION_ID}` to surface confirmation while
the webhook independently updates the DB.

## Customer Portal

Tenant master clicks "Manage subscription" → backend calls
`stripe.billingPortal.sessions.create` with the customer ID, returns a
one-time portal URL. Stripe handles plan changes, cancellation, invoice
history, payment-method updates. The webhook then echoes the resulting
subscription state back into Postgres.

## Reusing prior Stripe code

The shinobiapps codebase already has working Stripe integration for the
fiskalizacija + sonar SaaS products. The relevant patterns to port:
- Webhook signature verification (same `Stripe.webhooks.constructEvent` call)
- Idempotency via `stripe_event_id` table (insert-or-skip)
- Lazy customer creation on first checkout
- Customer portal flow

The two products use different price catalogs, so this is a fresh Stripe
account configuration but a familiar code shape.

## Scope of this commit

This commit documents the plan/contract only. Code lives in the private
`shinobi-hosted` repo (same reasoning as
[hosted-saas-architecture.md](hosted-saas-architecture.md)).

Open-source side ships:
- The architectural decision
- The plan limits encoded as constants so self-hosted users can see what
  the hosted tiers will offer (and so a future feature can read the same
  table)
- An issue template referencing this doc for community plan suggestions

## Plan caps as code

```ts
// src/services/billing/plans.ts (lands when SaaS runtime ships)
export const PLAN_CAPS = {
  free:  { users: 1, projects: 1, hosted_sync: false, support_tier: 'community' },
  team:  { users: 5, projects: Infinity, hosted_sync: true, support_tier: 'standard' },
  pro:   { users: Infinity, projects: Infinity, hosted_sync: true, support_tier: 'sla' },
} as const;
```
