import { z } from "zod";
import { turnSchema } from "../_shared/intake.ts";
import { db, env, hash, json, readBody, rpc, secretMatches } from "../_shared/runtime.ts";
const eventSchema = z.object({
  type: z.enum([
    "call_started",
    "call_completed",
    "call_failed",
    "call_turn",
    "post_call_analysis",
  ]),
  call_id: z.string().min(1).max(200),
  agent_id: z.string(),
  webhook_request_id: z.string().min(1).max(200),
  timestamp: z.string().datetime({ offset: true }),
  call: z
    .object({
      id: z.string(),
      end_time: z.string().optional(),
      dynamic_variables: z.record(z.unknown()).optional(),
      transcript: z.array(turnSchema).max(2000).optional(),
    })
    .optional(),
});
Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    if (!(await secretMatches(req.headers.get("x-webhook-secret"), env("CARTESIA_WEBHOOK_SECRET"))))
      return json({ error: "unauthorized" }, 401);
    const raw = await readBody(req);
    const parsed = eventSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return json({ error: "invalid_event" }, 400);
    const event = parsed.data;
    if (event.agent_id !== env("CARTESIA_AGENT_ID")) return json({ error: "wrong_agent" }, 403);
    if (["call_turn", "post_call_analysis"].includes(event.type)) return json({ received: true });
    if (event.call?.id !== event.call_id) return json({ error: "invalid_call" }, 400);
    // Old events are allowed for replay recovery; immutable receipts and call binding prevent reapplication.
    if (Date.parse(event.timestamp) > Date.now() + 300_000)
      return json({ error: "invalid_time" }, 400);
    const { data: bound, error } = await db()
      .from("customer_interview_sessions")
      .select("id")
      .eq("cartesia_call_id", event.call_id)
      .maybeSingle();
    if (error) throw error;
    const session =
      bound?.id ?? z.string().uuid().parse(event.call?.dynamic_variables?.["interview_session_id"]);
    await rpc("ingest_customer_call", {
      p_session: session,
      p_call: event.call_id,
      p_receipt: event.webhook_request_id,
      p_type: event.type,
      p_hash: await hash(raw),
      p_transcript: event.call?.transcript ?? [],
      p_ended: event.call?.end_time ?? event.timestamp,
    });
    return json({ received: true });
  } catch {
    return json({ error: "webhook_processing_failed" }, 503);
  }
});
