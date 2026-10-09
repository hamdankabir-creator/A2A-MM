# Customer intake deployment

This branch implements customer onboarding and the Cartesia behavioral interview. Candidate calling, scoring, billing, and Frigg enrollment are outside this change.

## Code and prompt

- `src/routes/_authenticated/onboarding.tsx`: saved drafts, essential fields, four editable preference lists, and explicit readback.
- `src/components/CustomerInterview.tsx`: SMS verification, written consent, call status, retry and withdrawal.
- `supabase/functions/customer-intake`: authenticated application API.
- `supabase/functions/cartesia-webhook`: provider event authentication and atomic ingestion.
- `supabase/functions/cartesia-intake-tool`: live verbal consent and readback receipts.
- `supabase/functions/customer-interview-worker`: durable extraction and deletion jobs.
- `scripts/cartesia-intake.ts`: derives the voice configuration from Session B of `src/lib/intake-agent-prompt.md`. No second editable copy of the intake prompt exists.

The existing `proxy_record` and flat fact format are preserved. `share`, `share_as`, `source_ref`, `label`, and primary preference facts remain compatible with the future compatibility reader. Interview facts default to `never_share`. The saved spec's illustrative schema is mapped to this existing contract instead of replacing it.

## Prerequisites

Connect the deployment branch in Lovable. Use the existing Supabase project, not a second database. Configure Supabase phone change verification and its SMS provider. The signed-in user must verify ownership of the destination number before the backend will place a call. No credentials are present in this repository.

Set these **Supabase Edge Function secrets**, using the dashboard or the secrets CLI. Do not put them in frontend environment variables:

| Secret | Purpose |
| --- | --- |
| `CARTESIA_API_KEY` | Provider API access |
| `CARTESIA_AGENT_ID` | Dedicated managed customer agent |
| `CARTESIA_OUTBOUND_NUMBER_ID` | Existing outbound number on the account |
| `CARTESIA_PROMPT_VERSION` | Hash printed by the configuration script |
| `CARTESIA_WEBHOOK_SECRET` | Long random secret for lifecycle events |
| `CARTESIA_TOOL_SECRET` | Separate long random secret for consent tool calls |
| `INTERVIEW_WORKER_SECRET` | Separate long random secret for scheduled processing |
| `LOVABLE_API_KEY` | Existing AI gateway credential for extraction |
| `APP_ORIGINS` | Comma-separated exact app origins, including approved Lovable previews |
| `CUSTOMER_CALLS_ENABLED` | `false` until setup and verification are complete; `true` enables the CTA |
| `INTERVIEW_EXTRACTION_MODEL` | Optional; defaults to `google/gemini-2.5-flash` |

Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to its Edge runtime. The browser uses only the existing publishable key.

## Deploy the database and functions

Review and apply `supabase/migrations/20261009010000_customer_intake.sql` after the existing migrations. Use a staging project first. With the CLI linked to the intended project:

```sh
supabase db push
supabase functions deploy customer-intake
supabase functions deploy cartesia-webhook
supabase functions deploy cartesia-intake-tool
supabase functions deploy customer-interview-worker
```

The functions deliberately set `verify_jwt=false` in the gateway configuration. `customer-intake` verifies the user token with Supabase Auth; the three provider/worker endpoints verify separate server secrets. Do not deploy the functions without their application-level authentication.

## Configure a dedicated managed agent

`bun run cartesia:prepare` prints a reviewable configuration with placeholders and a prompt hash. It makes no network requests and prints no credentials.

To create dedicated Cartesia resources, set `CARTESIA_API_KEY`, `SUPABASE_URL`, `CARTESIA_VOICE_ID`, `CARTESIA_MODEL_ID`, `CARTESIA_TOOL_SECRET`, and `CARTESIA_WEBHOOK_SECRET` in the shell's secure environment, then run:

```sh
bun run cartesia:prepare --apply
```

The script creates a new consent tool, managed agent and webhook, then attaches the webhook. It does not edit the existing Sales Outreach agent, buy a number, or place a call. It prints resource IDs and `CARTESIA_PROMPT_VERSION`, never secrets. If interrupted, inspect the IDs already printed before retrying to avoid duplicate resources. Verify the published configuration in Cartesia, and copy its agent ID and prompt hash to Supabase secrets. Set the existing outbound number ID separately.

Cartesia authenticates lifecycle events with **`x-webhook-secret`**, not a timestamped HMAC signature. The handler checks the configured agent and call binding, caps request size, rejects future timestamps, and atomically deduplicates receipt IDs. Old authenticated events remain replayable for recovery. No unsupported signature algorithm has been invented.

The minimized payload supplies only customer ID, first name, session ID, profile version, consent version, consent timestamp, and timezone. This first implementation does not send preferences to the agent; the core behavioral questions do not require them. The transcript extractor never receives the full customer profile and cannot mutate preferences.

## Start durable processing

Enable Supabase `pg_cron`, `pg_net`, and Vault. Add Vault secrets named `heimdall_supabase_url` and `heimdall_worker_secret` (the latter must equal `INTERVIEW_WORKER_SECRET`). Run `supabase/operations/interview-worker-schedule.sql` once. It polls every ten seconds with two worker invocations per tick. A row lease prevents two workers from processing the same job. Extraction retries stop after five failed attempts; deletion retries continue with capped backoff. Expired worker leases can be reclaimed.

**The schedule is required.** Webhooks acknowledge only after the transcript and job are durably committed; they do not depend on best-effort background work in a terminated Edge Function. Verify the cron runs and successful worker responses before enabling calls.

Monitor `customer_interview_jobs` for failed extraction or repeated deletion attempts, and session rows for `dispatch_unknown`, `needs_review`, and stale active calls. Provision an operator alert for these conditions in the deployment's monitoring system. There is no operator UI in this change.

## Verify before enabling calls

```sh
bun install --frozen-lockfile
bun run test
bun run typecheck
bun run lint
bun run build
bunx playwright install chromium
bun run test:e2e
```

Unit/handler tests use synthetic data and mock network requests. Database tests execute all migrations against embedded PostgreSQL and exercise permissions, duplicate events, leases and version conflicts. Browser tests exercise the signed-in UI with a synthetic account and mocked backend; they do not place calls.

Run real calls to an explicitly consenting tester after deploying. Verify answering, declining, withdrawal, no answer, interruption, manual retry, repeated webhook delivery, malformed extraction and a profile edit during processing. Confirm provider deletion through the Cartesia API. The 10-second initiation, 30-second ingestion and two-minute extraction targets require measurement in the deployed environment; a passing build does not establish them.

The focused human launch review in the spec remains a release gate for SEO-acquired customer traffic. Set `CUSTOMER_CALLS_ENABLED=true` only after the deployed flow, job schedule, recording policy and review are ready.

## Recovery and rollback

- Set `CUSTOMER_CALLS_ENABLED=false` to stop new calls. Existing webhooks, extraction and deletion continue.
- A dispatch timeout is ambiguous. `dispatch_unknown` stays active and blocks redial. Reconcile it against Cartesia call history using the application session ID in dynamic variables. Bind the actual call ID or mark failed only after verifying that no live call exists. Never guess or automatically retry a POST that may have dialed.
- For a bound stale active call, fetch `/agents/calls/{call_id}` and replay the corresponding authenticated completion event with its transcript. This is an operator recovery step, not a second outbound call.
- A profile edit during an interview causes `needs_review`; extraction cannot overwrite newer preferences. Reconfirm the profile and explicitly request another interview if needed.
- Withdrawal removes local transcript/extraction content, removes that session's current interview findings, invalidates extraction work, and queues provider cancellation/deletion. An immutable minimal session receipt retains timestamps; no transcript is kept after withdrawal.
- Do not disable the worker while deletion jobs are pending. Do not delete tables to roll back application code.

## Verified provider references

Checked during implementation on 2026-10-08:

- [Outbound calls](https://docs.cartesia.ai/line/integrations/telephony/outbound-dialing)
- [Lifecycle events and recording retention](https://docs.cartesia.ai/line/infrastructure/observability)
- [Managed agent configuration](https://docs.cartesia.ai/agents/configuration)
- [Webhook tools](https://docs.cartesia.ai/agents/webhook-tools)
