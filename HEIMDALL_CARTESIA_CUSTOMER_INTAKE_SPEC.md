# Heimdall Customer Onboarding and Cartesia Interview Specification

**Status:** Approved for MVP implementation  
**Date:** 2026-10-08  
**Product:** Heimdall  
**Target stack:** Lovable, GitHub, Supabase, Cartesia  
**Initial audience:** Real early customers  
**Related requirements:** `HEIMDALL_REQUIREMENTS.md`, especially HMD-020 through HMD-029, HMD-040 through HMD-050, and HMD-080 through HMD-090

## 1. Objective

Enable a customer to:

1. Complete deterministic Heimdall onboarding.
2. Explicitly define and confirm her dating requirements.
3. Give written consent for a recorded AI interview.
4. Tap **Call me now**.
5. Receive an immediate outbound call from a dedicated Cartesia managed voice agent.
6. Complete the behavioral portion of the latest Heimdall Intake Agent interview.
7. Have the transcript and a validated structured interview record added to her private screening profile.

The result is a reusable, customer-controlled screening profile. This feature does not call candidates, assess a particular candidate, or make compatibility decisions.

## 2. Product decisions

- The initial voice call is for the customer. Candidate calls come later.
- The app handles deterministic onboarding and preference confirmation.
- The voice agent conducts only the behavioral interview.
- The app exposes an explicit **Call me now** action after onboarding.
- There is no automatic call retry. The customer initiates another attempt.
- The MVP supports real early customers, not only founder-controlled test numbers.
- Both written consent before the call and verbal consent at the start of the call are required in v1.
- The Cartesia payload contains only the minimum operational context.
- The completed call transcript is stored and converted into a validated structured interview record server-side.
- Cartesia webhook ingestion must be idempotent because deliveries can repeat.
- The interview must preserve evidence and uncertainty. It must not invent facts or change customer-confirmed requirements.
- `ready_for_matching` indicates data completeness only. It is not a compatibility or safety determination.

## 3. Canonical Intake Agent prompt

The canonical prompt for this implementation is:

- Repository: `hamdankabir-creator/A2A-MM`
- Branch: `intake-prompt-gaps`
- Commit: `1dff9cddd7b360181decc2ee3204cda719d6abfa`
- Repository path: `src/lib/intake-agent-prompt.md`
- Verified shape: 351 lines, approximately 25.1 KB
- Local working copy: `eval_runs/frigg_intake_eval_B01_run002/intake-agent-prompt.updated.md`

The older prompt on the default branch and `intake-agent-prompt.md` in the evaluation directory are not implementation sources.

For the Cartesia customer call, configure this prompt with:

```text
session_type = interview
channel = voice
```

The voice configuration must disable or omit Session A preference collection. It must retain the behavioral-interview instructions, evidence discipline, contradiction handling, readback behavior, and readiness safeguards from the canonical prompt.

## 4. Data ownership

| Information | Captured by | Stored in |
|---|---|---|
| Name, phone, date of birth, location and timezone | Deterministic app onboarding | Customer profile |
| Relationship goal and other essential matching fields | Deterministic app onboarding | `proxy_record` confirmed facts |
| Dealbreakers | Deterministic app onboarding | `proxy_record.preferences` |
| Must-haves | Deterministic app onboarding | `proxy_record.preferences` |
| Customer-defined red flags | Deterministic app onboarding | `proxy_record.preferences` |
| Nice-to-haves | Deterministic app onboarding | `proxy_record.preferences` |
| Written and verbal consent | App and call opening | Versioned consent/session records |
| Behavioral examples and relationship history | Cartesia interview | Transcript and structured interview record |
| Contradictions and unresolved uncertainty | Post-call extraction | Structured interview record |
| Compatibility decisions | Future Compatibility Agent only | Out of scope for this feature |

The voice interview may ask why a confirmed requirement matters or request a behavioral example. It must not silently create, delete, reclassify, or rewrite a confirmed preference.

## 5. Epic structure

### Child issue 1: Deterministic onboarding and preference contract

Build the required Lovable and Supabase onboarding flow before exposing **Call me now**.

#### Preference structure

```ts
type PreferenceBucket =
  | "dealbreaker"
  | "must_have"
  | "red_flag"
  | "nice_to_have";

type PreferenceItem = {
  id: string;
  bucket: PreferenceBucket;
  text: string;
  topic: string;
  about: "self" | "partner";
  status: "draft" | "confirmed";
  source: "customer_onboarding";
  created_at: string;
  updated_at: string;
};
```

Store the collection under:

```ts
proxy_record.preferences = {
  status: "in_progress" | "confirmed";
  confirmed_at?: string;
  items: PreferenceItem[];
};
```

#### Required onboarding flow

1. Collect name, phone number, date of birth, location and timezone with deterministic controls.
2. Ask one open-ended question about what the customer requires, prefers and rejects.
3. Ask about early behavioral signs that make the customer pull back.
4. Sort the answers into four editable lists: dealbreakers, must-haves, red flags and nice-to-haves.
5. Collect any missing essential topics using deterministic controls:
   - relationship goal
   - children
   - location and relocation
   - partner age range
   - faith where relevant
   - smoking, drinking and drugs
   - monogamy or relationship structure
6. Show a readback of all consequential requirements.
7. Allow the customer to move, add, edit or remove items.
8. Require explicit confirmation before setting `preferences.status = "confirmed"`.
9. Display the recording, transcription and profile-update disclosure.
10. Record written consent with a policy version and timestamp.
11. Enable **Call me now** only when the required fields, confirmed preferences and written consent are present.

The UI must explain that these lists are customer-stated requirements. They are not safety findings, diagnoses or compatibility conclusions.

#### Child issue 1 acceptance criteria

- Every preference has a stable ID, bucket, topic, subject, source and confirmation status.
- A self-reported fact that can be stated directly, such as smoking or having children, is stored as a dealbreaker or hard constraint rather than a red flag when the customer's language makes it consequential.
- Red flags are customer-defined behavioral patterns that may require observation over time.
- The customer can edit or remove an item before confirmation.
- Confirmed preferences remain editable later through an explicit profile-editing action.
- A correction confirms the unchanged items in the same readback.
- A newly added or materially changed consequential item receives a new readback before confirmation.
- The voice interview cannot overwrite confirmed preferences.
- A customer cannot initiate the call with missing required information.
- `onboarding_completed_at`, `screening_profile_version`, `consent_version` and `consented_at` are persisted.
- Phone numbers are normalized to E.164 server-side.

### Child issue 2: Cartesia agent and outbound-call orchestration

Create a dedicated Heimdall customer-interview agent. Do not overwrite the existing Cartesia `Sales Outreach` agent.

#### Agent behavior

- Use the canonical Intake Agent prompt's behavioral-interview session.
- Do not repeat deterministic onboarding questions already answered in the app.
- Prefer specific past examples, the customer's own role and the outcome.
- Preserve distinctions among customer statements, reported events, observations and interpretations.
- Do not infer character, compatibility, sincerity, honesty, risk or personality from voice tone, accent, fluency, pauses or speaking style.
- Do not perform candidate interviewing, compatibility scoring or recommendations.
- Do not change confirmed preference buckets.
- Allow the customer to pause, skip, withdraw consent or end the call.

#### Opening script

> Hi {{first_name}}, I'm Heimdall's AI interviewer. Thanks for sharing your name, contact information, and what you're looking for. This call is to get to know you better so Heimdall can later assess compatibility with people you meet across different dating platforms. This call is recorded and transcribed to update your private screening profile. Is now a good time, and do you consent to continue?

The behavioral interview starts only after an affirmative response.

#### Minimal Cartesia variables

```ts
{
  customer_id,
  first_name,
  interview_session_id,
  screening_profile_version,
  consent_version,
  consented_at,
  timezone
}
```

The phone number is used only as the outbound call destination. It is not included as a prompt variable.

Confirmed preference data must not be copied into scalar dynamic variables. If limited preference context is needed during the behavioral interview, the server must render an escaped, narrowly scoped context section or expose it through a controlled server-side tool.

#### Call interface

```ts
requestCustomerInterview(customerId): {
  sessionId: string;
  status: "requested" | "dialing" | "failed";
}
```

The server-side implementation must:

- authenticate the current customer;
- verify onboarding, age and consent prerequisites;
- prevent concurrent active interviews for the same customer;
- create an interview session before contacting Cartesia;
- call Cartesia using the stable application session ID;
- pass the destination phone number in E.164 format;
- inspect both the HTTP result and the individual Cartesia call result for errors;
- store the provider call ID on the session;
- keep Cartesia credentials out of the client and Git repository.

#### Retry behavior

There is no automatic redial. A failed, rejected or missed call moves the session to a retryable terminal state and exposes a customer-initiated **Try again** action. A retry creates a new interview session.

#### Child issue 2 acceptance criteria

- The **Call me now** request is accepted or rejected within 10 seconds.
- The feature supports real customer phone numbers, not only allow-listed test numbers.
- A second click cannot create a concurrent duplicate call.
- The call identifies the agent as AI, states the purpose, discloses recording and transcription, and requests verbal consent.
- Declining or withdrawing consent ends the interview without updating the screening profile.
- No automatic retry occurs.
- Customers can explicitly retry after a failed, rejected or missed call.

### Child issue 3: Transcript ingestion and structured profile update

Implement this server-side pipeline:

```text
Cartesia call
    -> signed webhook
    -> idempotent webhook receipt
    -> immutable transcript storage
    -> server-side structured extraction
    -> schema validation
    -> versioned interview update to proxy_record
```

Cartesia's completed-call webhook supplies the transcript. Cartesia's native post-call analysis currently supplies only a short summary and is not the Heimdall structured record.

#### Proposed database changes

Add or confirm:

```text
profiles.screening_profile_version
profiles.onboarding_completed_at
```

Create:

```text
customer_interview_sessions
customer_interview_transcripts
cartesia_webhook_receipts
```

Minimum session fields:

```text
id
customer_id
cartesia_call_id
prompt_version
screening_profile_version
consent_version
written_consented_at
verbal_consented_at
status
failure_code
created_at
started_at
completed_at
```

Minimum transcript fields:

```text
id
session_id
provider
provider_call_id
transcript
provider_metadata
completed_at
created_at
```

Minimum webhook receipt fields:

```text
webhook_request_id UNIQUE
event_type
provider_call_id
payload_hash
processing_status
received_at
processed_at
```

#### Structured interview output

```ts
type InterviewRecord = {
  session_id: string;
  prompt_version: string;
  completed_at: string;
  facts: Array<{
    id: string;
    dimension: "constraints" | "values" | "conflict" | "trajectory" | "lifestyle";
    statement: string;
    original_wording?: string;
    source_type: "customer_statement" | "customer_event" | "interpreted";
    evidence: string;
    confidence: "low" | "medium" | "high";
    confirmation_state: "confirmed" | "unconfirmed";
    sharing_tier: "shareable" | "abstract_only" | "never_share";
  }>;
  behavioral_examples: Array<{
    topic: string;
    situation: string;
    behavior: string;
    outcome?: string;
  }>;
  contradictions: Array<{
    topic: string;
    statements: string[];
    status: "unresolved";
  }>;
  unanswered_topics: string[];
  extraction_status: "validated" | "needs_review";
};
```

The extractor receives the transcript, prompt version, interview session ID and expected screening-profile version. It must not receive compatibility scores, predictions, sealed evaluation data or candidate records.

#### Idempotency contract

- `webhook_request_id` is unique.
- A repeated delivery returns success without creating another transcript or profile mutation.
- Transcript persistence is unique by interview session and provider call ID.
- Profile mutation is keyed to the interview session and expected profile version.
- Reprocessing a completed session returns the existing structured result.
- A new customer-initiated retry creates a new session and never reuses the prior session ID.
- Database transactions or equivalent atomic constraints protect against concurrent deliveries.

#### Consent withdrawal

If the customer declines or withdraws verbal consent:

- the agent ends the interview politely;
- the session is marked `consent_withdrawn`;
- no structured profile update occurs;
- the Cartesia call record is deleted after completion unless account-wide zero-data-retention is enabled;
- only the minimum audit record required to prove the withdrawal and deletion is retained.

#### Readiness rule

```text
ready_for_matching =
  preferences.status == "confirmed"
  AND behavioral interview completed
  AND structured extraction validated
  AND no required essential topic is missing or unresolved
```

`ready_for_matching` indicates that the record is complete enough for a future Compatibility Agent. It does not mean a person or pairing is compatible, safe or recommended.

#### Child issue 3 acceptance criteria

- Webhook authenticity is verified before processing.
- The completed transcript is ingested within 30 seconds of call completion.
- The validated structured record is available within 2 minutes of call completion.
- Duplicate and concurrent webhook deliveries cause zero duplicate calls, transcripts, records or profile mutations.
- Transcript-derived claims retain supporting evidence and uncertainty.
- Unanswered or ambiguous critical topics are recorded as missing or unresolved, never silently inferred.
- Confirmed dealbreakers, must-haves, red flags and nice-to-haves remain unchanged.
- Logs exclude full phone numbers, secrets, raw consent text and unnecessary transcript content.
- Row Level Security prevents customers from reading another customer's sessions, transcripts or screening profile.

## 6. Server-side interfaces

```ts
requestCustomerInterview(customerId): Promise<CallRequestResult>

getCustomerInterviewStatus(sessionId): Promise<{
  status:
    | "requested"
    | "dialing"
    | "in_progress"
    | "completed"
    | "failed"
    | "missed"
    | "rejected"
    | "consent_withdrawn";
  retryAllowed: boolean;
}>

POST /functions/v1/cartesia-webhook
```

The webhook endpoint must respond quickly after authenticating and recording the receipt. Long-running extraction may continue in a separate invocation, background job or database-driven work queue.

## 7. Secrets and security

Store server-side secrets in Supabase's secret store:

```text
CARTESIA_API_KEY
CARTESIA_AGENT_ID
CARTESIA_OUTBOUND_NUMBER_ID
CARTESIA_WEBHOOK_SECRET
```

Requirements:

- Never expose provider secrets through `VITE_` variables or browser code.
- Never commit secrets to Git.
- Apply RLS to every customer-owned table.
- Validate authenticated ownership for call creation and status reads.
- Apply request throttling to call initiation.
- Reject stale, malformed or unauthenticated webhook requests.
- Treat transcripts and dating preferences as sensitive customer data.
- Retain prompt, consent and profile versions for every completed interview.

## 8. Failure handling

| Failure | Required behavior |
|---|---|
| Missing onboarding field | Do not call; return the customer to the relevant field |
| Preferences not confirmed | Do not call; show the readback step |
| Written consent missing | Do not call; show the disclosure and consent control |
| Cartesia rejects the call | Mark the session failed and show **Try again** |
| Customer does not answer | Mark the session missed; do not redial automatically |
| Customer declines verbal consent | End the call and mark `consent_withdrawn` |
| Call disconnects before usable completion | Mark incomplete and allow customer retry |
| Duplicate webhook | Acknowledge without another mutation |
| Extraction fails schema validation | Preserve transcript, mark `needs_review`, do not set ready |
| Profile version changed during call | Do not overwrite; reconcile or re-extract against the new version |
| Provider deletion fails after consent withdrawal | Retry deletion operationally and alert an operator |

## 9. Test plan

### Automated tests

- Preference-bucket creation, editing, confirmation and readback.
- Required-field and consent gates for **Call me now**.
- E.164 phone normalization.
- Call-session uniqueness and double-click protection.
- Cartesia success and per-call error responses.
- Webhook signature verification.
- Repeated and concurrent webhook delivery.
- Transcript uniqueness.
- Structured-output schema validation.
- Profile-version conflict handling.
- RLS ownership checks.
- Consent-withdrawal behavior.
- Log redaction.

### Live-call scenarios

- Customer answers and completes the interview.
- Customer answers and declines consent.
- Customer withdraws consent mid-call.
- Customer does not answer.
- Customer rejects the call.
- Call disconnects during the interview.
- Customer retries after a terminal failure.
- Cartesia sends the same completion webhook more than once.
- Interview contains a contradiction or unanswered critical topic.
- The profile changes while a call is active.

## 10. Build and launch ownership

Lovable is the primary MVP builder. It may create the UI, Supabase migrations, RLS policies, Edge Functions, provider calls and tests.

GitHub must be connected from the start and treated as the source of truth. Lovable and Cursor may work against the same repository using Lovable's two-way Git sync. Feature work should use branches and reviewed pull requests once more than one tool or person is changing the code.

Before real SEO-acquired customers can use the feature, a qualified human engineer must review and sign off on:

- webhook authentication and idempotency;
- RLS and customer-data isolation;
- secret handling and log redaction;
- consent withdrawal and provider-record deletion;
- concurrency and profile-version conflicts;
- end-to-end live call behavior;
- monitoring and operational recovery.

This is a focused launch review, not a requirement for a human to rebuild the feature.

Jurisdiction-specific recording, consent, retention and outbound-call policies must also be approved before enabling a jurisdiction. This specification does not provide legal advice.

## 11. Performance targets

- Call request accepted or rejected within 10 seconds.
- Completed transcript ingested within 30 seconds of call completion.
- Validated structured interview record available within 2 minutes.
- Duplicate webhook deliveries produce zero duplicate mutations.

## 12. Rollback

- Hide or disable **Call me now** with a server-controlled feature flag.
- Stop new call creation without deleting existing sessions or transcripts.
- Preserve immutable consent, session and transcript records required for audit or customer deletion requests.
- Roll back application code through Git while applying database rollback only through reviewed forward migrations.
- Disable the Cartesia webhook only after new calls are disabled and pending events are reconciled.

## 13. Out of scope

- Candidate calls and candidate scheduling.
- Candidate consent invitations.
- Compatibility scoring, matching or recommendations.
- Customer-candidate reports.
- Billing.
- Automated call retries.
- Scheduled customer calls.
- Notification reminders for incomplete interviews.
- Frigg enrollment or reuse of Heimdall data by Frigg.
- Voice-based personality, honesty, safety or compatibility inference.

## 14. Delivery estimate

- Deterministic onboarding and preference contract: 2 to 3 human days.
- Cartesia agent and outbound orchestration: 2 to 3 human days.
- Webhook, extraction and profile pipeline: 2 to 3 human days.
- End-to-end verification and launch review: 1 to 2 human days.

Expected total: approximately 7 to 10 implementation days plus focused human launch review, depending on the state of the Lovable UI, Supabase connection and Cartesia account configuration.
