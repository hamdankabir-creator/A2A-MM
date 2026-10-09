import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database, Json } from "@/integrations/supabase/types";
import systemPrompt from "./intake-agent-prompt.md?raw";

type ChatMessage = { role: "user" | "assistant"; content: string };

export const AGENT_OPENING =
  "Hi, I'm your matchmaker. Before we begin: are you 18 or older, and is it okay if I use our conversations to build your private profile? Nothing you tell me is ever shared with other members — only conclusions, never your words.";

const RECORD_START = "```json";
const RECORD_END = "```";

function extractProxyRecord(text: string): {
  reply: string;
  record: Record<string, Json> | null;
} {
  const start = text.lastIndexOf(RECORD_START);
  if (start === -1) return { reply: text.trim(), record: null };
  const end = text.indexOf(RECORD_END, start + RECORD_START.length);
  if (end === -1) return { reply: text.trim(), record: null };
  const jsonText = text.slice(start + RECORD_START.length, end).trim();
  const reply = text.slice(0, start).trim();
  try {
    return { reply: reply || text.trim(), record: JSON.parse(jsonText) as Record<string, Json> };
  } catch {
    return { reply: text.trim(), record: null };
  }
}

// Session A (preferences) runs until the member confirms their preferences;
// after that the agent runs Session B (the interview) in the same chat.
function pickSessionType(proxyRecord: unknown): "preferences" | "interview" {
  const preferences =
    proxyRecord && typeof proxyRecord === "object"
      ? (proxyRecord as { preferences?: { status?: unknown } }).preferences
      : undefined;
  return preferences?.status === "confirmed" ? "interview" : "preferences";
}

export const sendAgentMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ message: z.string().trim().min(1).max(4000) }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as {
      supabase: SupabaseClient<Database>;
      userId: string;
    };

    const [{ data: profile }, { data: history, error: histErr }] = await Promise.all([
      supabase
        .from("profiles")
        .select(
          "full_name, proxy_record, gender, seeking_gender, date_of_birth, location, updated_at",
        )
        .eq("id", userId)
        .maybeSingle(),
      supabase
        .from("agent_messages")
        .select("role, content")
        .eq("user_id", userId)
        .order("created_at", { ascending: true })
        .limit(60),
    ]);
    if (histErr) throw new Error(histErr.message);

    // The legacy text agent must not replace a customer-confirmed Heimdall record.
    const preferences = (
      profile?.proxy_record as { preferences?: { items?: { source?: string }[] } } | null
    )?.preferences;
    if (preferences?.items?.some((item) => item.source === "customer_onboarding")) {
      throw new Error(
        "Use your screening profile to edit requirements and the dashboard to request your interview.",
      );
    }

    const firstName = (profile?.full_name ?? "").split(" ")[0] || "there";
    const proxyRecord = profile?.proxy_record ?? {};
    const profileBasics = Object.fromEntries(
      Object.entries({
        gender: profile?.gender,
        seeking_gender: profile?.seeking_gender,
        date_of_birth: profile?.date_of_birth,
        location: profile?.location,
      }).filter(([, v]) => v != null && v !== ""),
    );

    const runtimeInputs = [
      `session_type: ${pickSessionType(proxyRecord)}`,
      `user_first_name: ${firstName}`,
      `proxy_record: ${JSON.stringify(proxyRecord)}`,
      `profile_basics: ${JSON.stringify(profileBasics)}`,
      `connected_sources: []`,
      `channel: text`,
    ].join("\n");

    // On a brand-new conversation, persist the on-screen opening greeting as the
    // first assistant message so the agent knows consent was already asked.
    let historyMessages = (history ?? []) as ChatMessage[];
    if (historyMessages.length === 0) {
      const { error: openErr } = await supabase
        .from("agent_messages")
        .insert([{ user_id: userId, role: "assistant", content: AGENT_OPENING }]);
      if (openErr) console.error("opening insert failed:", openErr.message);
      historyMessages = [{ role: "assistant", content: AGENT_OPENING }];
    }

    const messages = [
      {
        role: "system" as const,
        content: `${systemPrompt}\n\n---\nRuntime inputs for this session:\n${runtimeInputs}\n\nIn this text channel, end EVERY reply with the full updated proxy record in a single \`\`\`json code block. The block is parsed by the application and never shown to the person.`,
      },
      ...historyMessages.map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: data.message },
    ];

    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("AI gateway key is not configured");

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/gemini-2.5-flash", messages }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`AI gateway failed [${res.status}]: ${body}`);
      throw new Error(`AI request failed [${res.status}]`);
    }
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = json.choices?.[0]?.message?.content ?? "";
    if (!raw) throw new Error("The agent returned an empty reply");

    const { reply, record } = extractProxyRecord(raw);

    const { error: insertErr } = await supabase.from("agent_messages").insert([
      { user_id: userId, role: "user", content: data.message },
      { user_id: userId, role: "assistant", content: reply },
    ]);
    if (insertErr) throw new Error(insertErr.message);

    if (record) {
      const { error: upErr } = await supabase
        .from("profiles")
        .update({ proxy_record: record })
        .eq("id", userId)
        .eq("updated_at", profile!.updated_at);
      if (upErr) console.error("proxy_record update failed:", upErr.message);
    }

    return { reply };
  });

export const fetchAgentHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as {
      supabase: SupabaseClient<Database>;
      userId: string;
    };
    const { data, error } = await supabase
      .from("agent_messages")
      .select("role, content, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) throw new Error(error.message);
    return (data ?? []) as (ChatMessage & { created_at: string })[];
  });
