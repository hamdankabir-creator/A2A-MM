import { z } from "zod";
import {
  buildPreferences,
  CONSENT_VERSION,
  normalizePhone,
  onboardingSchema,
} from "../_shared/intake.ts";
import {
  authenticate,
  cartesia,
  db,
  env,
  json,
  readBody,
  rpc,
  withCors,
} from "../_shared/runtime.ts";

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status") }),
  z.object({ action: z.literal("draft"), draft: z.record(z.unknown()) }),
  z.object({ action: z.literal("confirm"), data: onboardingSchema, version: z.number().int() }),
  z.object({
    action: z.literal("call"),
    request_key: z.string().uuid(),
    consent_version: z.literal(CONSENT_VERSION),
    consent: z.literal(true),
  }),
  z.object({ action: z.literal("withdraw"), session_id: z.string().uuid() }),
]);
Deno.serve(
  withCors(async (req) => {
    const user = await authenticate(req);
    const input = requestSchema.parse(JSON.parse(await readBody(req)));
    const client = db();
    if (input.action === "draft") {
      const { error } = await client
        .from("customer_onboarding")
        .upsert(
          { customer_id: user.id, draft: input.draft, updated_at: new Date().toISOString() },
          { onConflict: "customer_id" },
        );
      if (error) throw error;
      return json({ saved: true });
    }
    const { data: profile, error: profileError } = await client
      .from("profiles")
      .select("proxy_record,screening_profile_version")
      .eq("id", user.id)
      .single();
    if (profileError) throw profileError;
    const { data: onboarding, error: onboardingError } = await client
      .from("customer_onboarding")
      .select("*")
      .eq("customer_id", user.id)
      .maybeSingle();
    if (onboardingError) throw onboardingError;
    if (input.action === "status") {
      const { data: session, error } = await client
        .from("customer_interview_sessions")
        .select("id,status,failure_code,created_at,completed_at,provider_deleted_at")
        .eq("customer_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return json({
        onboarding,
        version: profile.screening_profile_version,
        session,
        enabled: Deno.env.get("CUSTOMER_CALLS_ENABLED") === "true",
        interview_complete: profile.proxy_record?.interview?.status === "complete",
        verified_phone: user.phone_confirmed_at ? user.phone : null,
      });
    }
    if (input.action === "confirm") {
      const version = await rpc("save_customer_onboarding", {
        p_customer: user.id,
        p_data: input.data,
        p_record: buildPreferences(input.data, profile.proxy_record),
        p_version: input.version,
      });
      return json({ version });
    }
    if (input.action === "withdraw") {
      const { data: session, error } = await client
        .from("customer_interview_sessions")
        .select("id")
        .eq("id", input.session_id)
        .eq("customer_id", user.id)
        .single();
      if (error || !session) throw new Error("unauthorized");
      await rpc("record_customer_call_decision", {
        p_session: session.id,
        p_decision: "withdrawn",
      });
      return json({ saved: true });
    }
    if (Deno.env.get("CUSTOMER_CALLS_ENABLED") !== "true") throw new Error("calls_disabled");
    const confirmed = onboardingSchema.safeParse(onboarding?.confirmed_data);
    if (!confirmed.success || onboarding.confirmed_version !== profile.screening_profile_version)
      throw new Error("onboarding_required");
    // An authenticated account may only call its SMS-verified number.
    if (
      !user.phone_confirmed_at ||
      normalizePhone("+" + (user.phone ?? "").replace(/^\+/, "")) !== confirmed.data.phone
    )
      throw new Error("phone_not_verified");
    const agent = env("CARTESIA_AGENT_ID"),
      number = env("CARTESIA_OUTBOUND_NUMBER_ID"),
      prompt = env("CARTESIA_PROMPT_VERSION");
    env("CARTESIA_API_KEY");
    const { session, created } = await rpc("reserve_customer_interview", {
      p_customer: user.id,
      p_key: input.request_key,
      p_prompt: prompt,
      p_consent: CONSENT_VERSION,
      p_version: profile.screening_profile_version,
    });
    if (!created) return json({ sessionId: session.id, status: session.status });
    async function rejectDispatch() {
      const { error } = await client
        .from("customer_interview_sessions")
        .update({ status: "rejected", failure_code: "provider_rejected" })
        .eq("id", session.id)
        .eq("status", "requested");
      if (error) throw error;
      // A concurrent withdrawal has nothing to delete after definitive rejection.
      const { error: cleanupError } = await client
        .from("customer_interview_sessions")
        .update({
          provider_deleted_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        })
        .eq("id", session.id)
        .eq("status", "consent_withdrawn")
        .is("cartesia_call_id", null);
      if (cleanupError) throw cleanupError;
      return json({ sessionId: session.id, status: "rejected" });
    }
    let callId: string | undefined;
    try {
      const response = await cartesia("/agents/calls", "POST", {
        agent_id: agent,
        from_number_id: number,
        ringing_timeout_seconds: 30,
        outbound_calls: [
          {
            to_number: confirmed.data.phone,
            dynamic_variables: {
              customer_id: user.id,
              first_name: confirmed.data.full_name.split(" ")[0],
              interview_session_id: session.id,
              screening_profile_version: session.screening_profile_version,
              consent_version: CONSENT_VERSION,
              consented_at: session.written_consented_at,
              timezone: confirmed.data.timezone,
            },
          },
        ],
      });
      // 5xx and transport errors are ambiguous: never automatically dial again.
      if (response.status >= 500) throw new Error("dispatch_unknown");
      if (!response.ok) return await rejectDispatch();
      const body = await response.json();
      const call = body.calls?.[0];
      if (call?.error) return await rejectDispatch();
      if (typeof call?.agent_call_id !== "string") throw new Error("dispatch_unknown");
      callId = call.agent_call_id;
      // Withdrawal can race the provider response. Bind the ID even after the
      // status changes so the deletion worker can cancel the accepted call.
      const { error: bindError } = await client
        .from("customer_interview_sessions")
        .update({ cartesia_call_id: callId })
        .eq("id", session.id)
        .is("cartesia_call_id", null);
      if (bindError) throw bindError;
      const { error } = await client
        .from("customer_interview_sessions")
        .update({ status: "dialing" })
        .eq("id", session.id)
        .eq("status", "requested");
      if (error) throw error;
      return json({ sessionId: session.id, status: "dialing" });
    } catch {
      const { error } = await client
        .from("customer_interview_sessions")
        .update({
          status: "dispatch_unknown",
          failure_code: "dispatch_unknown",
          ...(callId ? { cartesia_call_id: callId } : {}),
        })
        .eq("id", session.id)
        .eq("status", "requested");
      if (error) throw new Error("request_failed");
      return json({ sessionId: session.id, status: "dispatch_unknown" });
    }
  }),
);
