import { z } from "zod";
import { env, json, readBody, rpc, secretMatches } from "../_shared/runtime.ts";
const schema = z
  .object({
    session_id: z.string().uuid(),
    decision: z.enum(["confirmed", "withdrawn", "readback_confirmed"]),
  })
  .strict();
Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    if (
      !(await secretMatches(
        req.headers.get("authorization"),
        `Bearer ${env("CARTESIA_TOOL_SECRET")}`,
      ))
    )
      return json({ error: "unauthorized" }, 401);
    const body = schema.parse(JSON.parse(await readBody(req)));
    await rpc("record_customer_call_decision", {
      p_session: body.session_id,
      p_decision: body.decision,
    });
    return json({
      saved: true,
      instruction: body.decision === "withdrawn" ? "End the call now." : "Continue.",
    });
  } catch {
    return json(
      { error: "decision_not_saved", instruction: "Do not continue the interview; end the call." },
      503,
    );
  }
});
