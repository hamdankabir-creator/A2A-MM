import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { essentialFields, CONSENT_VERSION } from "../supabase/functions/_shared/intake";
type Handler = (req: Request) => Promise<Response>;
const handlers: Handler[] = [];
const settings: Record<string, string> = {
  SUPABASE_URL: "https://database.test",
  SUPABASE_SERVICE_ROLE_KEY: "test-service",
  APP_ORIGINS: "https://app.test",
  CUSTOMER_CALLS_ENABLED: "true",
  CARTESIA_AGENT_ID: "agent-test",
  CARTESIA_OUTBOUND_NUMBER_ID: "number-test",
  CARTESIA_PROMPT_VERSION: "prompt-test",
  CARTESIA_API_KEY: "test-provider",
  CARTESIA_WEBHOOK_SECRET: "event-secret",
  INTERVIEW_WORKER_SECRET: "worker-secret",
};
const originalFetch = globalThis.fetch;
const customer = "11111111-1111-4111-8111-111111111111",
  sessionId = "22222222-2222-4222-8222-222222222222";
let providerStatus = 200,
  providerBody: unknown,
  providerThrows = false,
  verified = true,
  created = true,
  dials = 0,
  ingested = 0,
  savedStatus = "",
  outbound: Record<string, unknown> | undefined;
let workerSession: Record<string, unknown>;
let workerJobStatus = "";
let providerRequests: string[] = [];
let sessionPatches: { url: URL; body: Record<string, unknown> }[] = [];
Object.assign(globalThis, {
  Deno: { env: { get: (name: string) => settings[name] }, serve: (h: Handler) => handlers.push(h) },
});
beforeAll(async () => {
  await import("../supabase/functions/customer-intake/index");
  await import("../supabase/functions/cartesia-webhook/index");
  await import("../supabase/functions/customer-interview-worker/index");
});
beforeEach(() => {
  providerStatus = 200;
  providerBody = { calls: [{ agent_call_id: "call-test" }] };
  providerThrows = false;
  verified = true;
  created = true;
  dials = 0;
  ingested = 0;
  savedStatus = "";
  outbound = undefined;
  workerSession = { id: sessionId, cartesia_call_id: "call-test" };
  workerJobStatus = "";
  providerRequests = [];
  sessionPatches = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    const text = req.method === "GET" ? "" : await req.text();
    const body = text ? JSON.parse(text) : null;
    if (url.hostname === "api.cartesia.ai") {
      dials++;
      providerRequests.push(`${req.method} ${url.pathname}`);
      outbound = body;
      if (providerThrows) throw new TypeError("network timeout");
      return Response.json(providerBody, { status: providerStatus });
    }
    if (url.pathname === "/auth/v1/user")
      return Response.json({
        id: customer,
        phone: "14155550123",
        phone_confirmed_at: verified ? "2026-01-01T00:00:00Z" : null,
      });
    if (url.pathname === "/rest/v1/profiles")
      return Response.json({ proxy_record: {}, screening_profile_version: 1 });
    if (url.pathname === "/rest/v1/customer_onboarding")
      return Response.json({
        confirmed_version: 1,
        confirmed_data: {
          full_name: "Test Customer",
          phone: "+14155550123",
          date_of_birth: "1990-01-01",
          location: "Seattle, Washington",
          timezone: "UTC",
          open_ask: "",
          early_signs: "",
          essentials: Object.fromEntries(
            essentialFields.map(([k, , opts]) => [k, opts[0] ?? "woman"]),
          ),
          age_min: 25,
          age_max: 40,
          items: [],
          confirmed: true,
        },
      });
    if (url.pathname === "/rest/v1/rpc/reserve_customer_interview")
      return Response.json({
        created,
        session: {
          id: sessionId,
          status: "dialing",
          screening_profile_version: 1,
          written_consented_at: "2026-01-01T00:00:00Z",
        },
      });
    if (url.pathname === "/rest/v1/customer_interview_sessions") {
      if (req.method === "PATCH") {
        sessionPatches.push({ url, body });
        if (body.status) savedStatus = body.status;
        return new Response(null, { status: 204 });
      }
      return Response.json(workerSession);
    }
    if (url.pathname === "/rest/v1/rpc/claim_customer_interview_job")
      return Response.json({
        session_id: sessionId,
        kind: "delete",
        lease_token: "lease",
        attempts: 1,
      });
    if (url.pathname === "/rest/v1/customer_interview_transcripts" && req.method === "DELETE")
      return new Response(null, { status: 204 });
    if (url.pathname === "/rest/v1/customer_interview_jobs" && req.method === "PATCH") {
      workerJobStatus = body.status;
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/rest/v1/rpc/ingest_customer_call") {
      ingested++;
      return Response.json(null);
    }
    throw new Error(`Unexpected mocked request: ${url.pathname}`);
  }) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = originalFetch;
});
const callRequest = (patch: Record<string, unknown> = {}) =>
  new Request("https://function.test", {
    method: "POST",
    headers: {
      authorization: "Bearer synthetic-user-token",
      origin: "https://app.test",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "call",
      request_key: crypto.randomUUID(),
      consent: true,
      consent_version: CONSENT_VERSION,
      ...patch,
    }),
  });
test("call uses verified destination and scalar context, never phone in prompt variables", async () => {
  const res = await handlers[0]!(callRequest());
  expect(res.status).toBe(200);
  expect(dials).toBe(1);
  expect(savedStatus).toBe("dialing");
  const calls = outbound!["outbound_calls"] as {
    to_number: string;
    dynamic_variables: Record<string, unknown>;
  }[];
  expect(calls[0]!.to_number).toBe("+14155550123");
  expect(Object.keys(calls[0]!.dynamic_variables).sort()).toEqual(
    [
      "customer_id",
      "first_name",
      "interview_session_id",
      "screening_profile_version",
      "consent_version",
      "consented_at",
      "timezone",
    ].sort(),
  );
});
test("unverified number and omitted consent cannot create a call", async () => {
  verified = false;
  expect((await handlers[0]!(callRequest())).status).toBe(400);
  expect(dials).toBe(0);
  verified = true;
  expect((await handlers[0]!(callRequest({ consent: false }))).status).toBe(400);
  expect(dials).toBe(0);
});
test("existing reservation never redials", async () => {
  created = false;
  await handlers[0]!(callRequest());
  expect(dials).toBe(0);
});
test("accepted call ID is bound independently of status so concurrent withdrawal can delete it", async () => {
  await handlers[0]!(callRequest());
  const binding = sessionPatches.find((p) => p.body.cartesia_call_id === "call-test");
  expect(binding).toBeDefined();
  expect(binding!.url.searchParams.has("status")).toBe(false);
  expect(binding!.url.searchParams.get("cartesia_call_id")).toBe("is.null");
});
test("HTTP 200 with per-call error is a rejection", async () => {
  providerBody = { calls: [{ error: "capacity" }] };
  const res = await handlers[0]!(callRequest());
  expect((await res.json()).status).toBe("rejected");
  expect(savedStatus).toBe("rejected");
});
test("network failure is held as dispatch_unknown without retry", async () => {
  providerThrows = true;
  const res = await handlers[0]!(callRequest());
  expect((await res.json()).status).toBe("dispatch_unknown");
  expect(dials).toBe(1);
});
test("provider 5xx is ambiguous; 4xx is rejected", async () => {
  providerStatus = 503;
  await handlers[0]!(callRequest());
  expect(savedStatus).toBe("dispatch_unknown");
  providerStatus = 400;
  await handlers[0]!(callRequest());
  expect(savedStatus).toBe("rejected");
});
test("webhook verifies secret, agent and call identity before ingestion", async () => {
  const payload = {
    type: "call_completed",
    call_id: "call-test",
    agent_id: "agent-test",
    webhook_request_id: "receipt",
    timestamp: new Date().toISOString(),
    call: { id: "call-test", transcript: [] },
  };
  const req = (secret: string, body: unknown = payload) =>
    new Request("https://function.test", {
      method: "POST",
      headers: { "x-webhook-secret": secret },
      body: JSON.stringify(body),
    });
  expect((await handlers[1]!(req("wrong"))).status).toBe(401);
  expect(ingested).toBe(0);
  expect(
    (await handlers[1]!(req("event-secret", { ...payload, agent_id: "another-agent" }))).status,
  ).toBe(403);
  expect(ingested).toBe(0);
  expect((await handlers[1]!(req("event-secret"))).status).toBe(200);
  expect(ingested).toBe(1);
});

const workerRequest = () =>
  new Request("https://function.test", {
    method: "POST",
    headers: { authorization: "Bearer worker-secret" },
  });
test("deletion treats an absent provider record as cleaned even when cancellation fails", async () => {
  providerStatus = 404;
  expect((await handlers[2]!(workerRequest())).status).toBe(200);
  expect(providerRequests).toEqual([
    "POST /agents/calls/call-test/cancel",
    "DELETE /agents/calls/call-test",
  ]);
  expect(workerJobStatus).toBe("done");
});
test("deletion cannot claim success when the provider rejects deletion", async () => {
  providerStatus = 500;
  expect((await handlers[2]!(workerRequest())).status).toBe(503);
  expect(workerJobStatus).toBe("queued");
});
test("known rejected dispatch cleanup does not wait for a call binding", async () => {
  workerSession = {
    id: sessionId,
    cartesia_call_id: null,
    provider_deleted_at: new Date().toISOString(),
  };
  expect((await handlers[2]!(workerRequest())).status).toBe(200);
  expect(providerRequests).toHaveLength(0);
  expect(workerJobStatus).toBe("done");
});
