import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { intakeRequest, type IntakeStatus } from "@/lib/customer-intake";
import { CONSENT_TEXT, CONSENT_VERSION } from "../../supabase/functions/_shared/intake";
const active = ["requested", "dialing", "in_progress", "processing", "dispatch_unknown"];
const statusText: Record<string, string> = {
  requested: "Preparing your call…",
  dialing: "Calling your phone…",
  in_progress: "Your interview is in progress.",
  processing: "Your interview is being saved.",
  completed: "Your interview is saved.",
  failed: "The call failed. You can try again.",
  missed: "We couldn't complete the opening confirmation. You can try again.",
  rejected: "The call couldn't be placed. You can try again.",
  incomplete: "Your interview is incomplete. You can try again when you're ready.",
  needs_review: "Your interview needs review before your screening profile is ready.",
  consent_withdrawn: "Your consent was withdrawn. Call content is being deleted.",
  dispatch_unknown: "We're checking whether your call was placed. Please wait before trying again.",
};
export function CustomerInterview({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["customer-intake", userId],
    queryFn: () => intakeRequest<IntakeStatus>({ action: "status" }),
    retry: false,
    refetchInterval: (q) => {
      const session = q.state.data?.session;
      return active.includes(session?.status ?? "") ||
        (session?.status === "consent_withdrawn" && !session.provider_deleted_at)
        ? 3000
        : false;
    },
  });
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [requestKey, setRequestKey] = useState<string | null>(null);
  const data = query.data;
  const session = data?.session;
  useEffect(() => {
    if (session?.status) void qc.invalidateQueries({ queryKey: ["profile", userId] });
  }, [session?.status, qc, userId]);
  const confirmed = data?.onboarding?.confirmed_data;
  const verified = Boolean(
    confirmed &&
    data?.verified_phone &&
    confirmed.phone.replace(/^\+/, "") === data.verified_phone.replace(/^\+/, ""),
  );
  const current = Boolean(confirmed && data?.onboarding?.confirmed_version === data?.version);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await action();
      await query.refetch();
      await qc.invalidateQueries({ queryKey: ["profile", userId] });
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function call() {
    const key = requestKey ?? crypto.randomUUID();
    setRequestKey(key);
    const result = await intakeRequest<{ status: string }>({
      action: "call",
      request_key: key,
      consent: true,
      consent_version: CONSENT_VERSION,
    });
    setRequestKey(null);
    setConsent(false);
    setMessage(statusText[result.status] ?? "Request saved.");
  }
  return (
    <section className="mt-10 rounded-3xl border bg-card p-6 sm:p-8">
      <p className="eyebrow text-primary">Get to know you</p>
      <h2 className="font-display mt-3 text-3xl">Your private Heimdall interview</h2>
      <p className="mt-3 text-sm text-muted-foreground">
        About 15–20 minutes, focused on real experiences, values, and how you handle relationships.
        You can skip any question.
      </p>
      {query.isLoading ? (
        <p className="mt-4">Loading…</p>
      ) : query.isError ? (
        <p role="alert" className="mt-4">
          Couldn't load your interview.{" "}
          <button className="underline" onClick={() => query.refetch()}>
            Try again
          </button>
        </p>
      ) : (
        <div className="mt-5 space-y-4">
          {session && (
            <p role="status">
              {session.status === "consent_withdrawn" && session.provider_deleted_at
                ? "Your call content has been deleted."
                : (statusText[session.status] ?? "Your request is saved.")}
            </p>
          )}
          {!current && !data?.interview_complete && (
            <Link to="/onboarding" className="inline-block rounded-full border px-5 py-3">
              Review and confirm your profile
            </Link>
          )}
          {current && !verified && (
            <div className="space-y-3">
              <p className="text-sm">Verify {confirmed?.phone} so we know the call reaches you.</p>
              <button
                disabled={busy}
                className="rounded-full border px-4 py-2"
                onClick={() =>
                  run(async () => {
                    const { error } = await supabase.auth.updateUser({ phone: confirmed!.phone });
                    if (error)
                      throw new Error("Couldn't send the verification code. Please try again.");
                    setSent(true);
                  })
                }
              >
                Send verification code
              </button>
              {sent && (
                <>
                  <label className="block text-sm" htmlFor="phone-code">
                    SMS verification code
                  </label>
                  <input
                    id="phone-code"
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    className="rounded-xl border bg-background px-3 py-2"
                  />
                  <button
                    disabled={busy || !code}
                    className="rounded-full border px-4 py-2"
                    onClick={() =>
                      run(async () => {
                        const { error } = await supabase.auth.verifyOtp({
                          phone: confirmed!.phone,
                          token: code,
                          type: "phone_change",
                        });
                        if (error)
                          throw new Error(
                            "That code couldn't be verified. Please check it or request another.",
                          );
                        setSent(false);
                      })
                    }
                  >
                    Verify
                  </button>
                </>
              )}
            </div>
          )}
          {current &&
            verified &&
            !active.includes(session?.status ?? "") &&
            !(session?.status === "consent_withdrawn" && !session.provider_deleted_at) &&
            !data?.interview_complete && (
              <>
                <label className="flex items-start gap-3 text-sm">
                  <input
                    className="mt-1"
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                  />
                  {CONSENT_TEXT}
                </label>
                <button
                  disabled={busy || !consent || !data?.enabled}
                  className="rounded-full bg-primary px-6 py-3 text-primary-foreground disabled:opacity-40"
                  onClick={() => run(call)}
                >
                  {busy ? "Requesting…" : session ? "Try again" : "Call me now"}
                </button>
              </>
            )}
          {!data?.enabled && (
            <p className="text-sm text-muted-foreground">
              Calls aren't available yet. Your answers are saved.
            </p>
          )}
          {session && session.status !== "consent_withdrawn" && (
            <button
              disabled={busy}
              className="block text-sm underline"
              onClick={() =>
                run(async () => {
                  await intakeRequest({ action: "withdraw", session_id: session.id });
                  setConsent(false);
                })
              }
            >
              Withdraw consent and delete this call
            </button>
          )}
          {message && (
            <p role="alert" className="text-sm">
              {message}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
