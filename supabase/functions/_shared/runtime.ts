import { createClient } from "@supabase/supabase-js";
export function env(name: string) {
  const v = Deno.env.get(name);
  if (!v) throw new Error("configuration_missing");
  return v;
}
export function db() {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export async function rpc(name: string, args: Record<string, unknown> = {}) {
  const { data, error } = await db().rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}
export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
export async function readBody(req: Request) {
  if (Number(req.headers.get("content-length")) > 1_000_000) throw new Error("body_too_large");
  const reader = req.body?.getReader();
  if (!reader) throw new Error("missing_body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 1_000_000) {
      await reader.cancel();
      throw new Error("body_too_large");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(body);
}
export async function secretMatches(provided: string | null, expected: string) {
  if (!provided || !expected) return false;
  const digest = async (s: string) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  const [a, b] = await Promise.all([digest(provided), digest(expected)]);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i]! ^ b[i]!;
  return difference === 0;
}
export async function hash(value: string) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export async function cartesia(path: string, method: string, body?: unknown, timeout = 8000) {
  return fetch(`https://api.cartesia.ai${path}`, {
    method,
    headers: {
      "X-API-Key": env("CARTESIA_API_KEY"),
      "Cartesia-Version": "2026-08-14",
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(timeout),
  });
}
export async function authenticate(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer /i, "");
  if (!token) throw new Error("unauthorized");
  const { data, error } = await db().auth.getUser(token);
  if (error || !data.user) throw new Error("unauthorized");
  return data.user;
}
export function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return [
    "unauthorized",
    "profile_changed",
    "rate_limited",
    "configuration_missing",
    "phone_not_verified",
    "onboarding_required",
    "calls_disabled",
    "receipt_conflict",
    "unknown_call",
    "body_too_large",
  ].includes(message)
    ? message
    : "request_failed";
}
export function withCors(handler: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    const origin = req.headers.get("origin");
    const allowed = (Deno.env.get("APP_ORIGINS") ?? "").split(",");
    if (origin && !allowed.includes(origin)) return json({ error: "origin_not_allowed" }, 403);
    let response: Response;
    if (req.method === "OPTIONS") response = new Response(null, { status: 204 });
    else if (req.method !== "POST") response = json({ error: "method_not_allowed" }, 405);
    else {
      try {
        response = await handler(req);
      } catch (e) {
        const code = safeError(e);
        response = json(
          { error: code },
          code === "unauthorized"
            ? 401
            : code === "rate_limited"
              ? 429
              : code === "profile_changed"
                ? 409
                : 400,
        );
      }
    }
    if (origin) response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Vary", "Origin");
    response.headers.set(
      "Access-Control-Allow-Headers",
      "authorization, apikey, content-type, x-client-info",
    );
    response.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    return response;
  };
}
