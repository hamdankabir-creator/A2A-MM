import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppHeader } from "@/components/AppHeader";
import { CustomerInterview } from "@/components/CustomerInterview";
import { fetchMyProfile } from "@/lib/profile";
import { buckets, bucketLabels } from "../../../supabase/functions/_shared/intake";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Your profile — Heimdall" },
      { name: "description", content: "Your private screening profile and interview status." },
      { property: "og:title", content: "Your profile — Heimdall" },
      { property: "og:description", content: "Your screening profile and interview status." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { user } = Route.useRouteContext();
  const { data: p, isLoading } = useQuery({
    queryKey: ["profile", user.id],
    queryFn: () => fetchMyProfile(user.id),
  });
  const step = p?.onboarding_step ?? 0;
  const record = p?.proxy_record as {
    preferences?: {
      items?: {
        id: string;
        about: string;
        bucket: string;
        topic: string;
        user_words: string;
        text?: string;
      }[];
    };
    interview?: { status?: string };
  } | null;
  const preferences = Array.isArray(record?.preferences?.items) ? record.preferences.items : [];

  return (
    <div className="min-h-screen bg-background">
      <AppHeader product="Heimdall" />
      <main className="mx-auto max-w-4xl px-6 pb-20">
        {isLoading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : (
          <div className="animate-rise">
            <span className="eyebrow text-primary">Your profile</span>
            <h1 className="font-display mt-3 text-5xl">
              {p?.full_name ? `Welcome, ${p.full_name.split(" ")[0]}.` : "Welcome."}
            </h1>

            <div className="mt-10 rounded-3xl bg-wine p-8 text-wine-foreground">
              {p?.completed ? (
                <>
                  <span className="eyebrow text-gold">Status</span>
                  <h2 className="font-display mt-3 text-3xl">Your screening profile is saved.</h2>
                  <p className="mt-3 max-w-[50ch] text-sm opacity-70">
                    {record?.interview?.status === "complete"
                      ? "Your private interview is saved. You can review and edit your requirements below."
                      : "Complete your private interview below so Heimdall can get to know you better."}
                  </p>
                </>
              ) : (
                <>
                  <span className="eyebrow text-gold">Step {Math.min(step + 1, 4)} of 4</span>
                  <h2 className="font-display mt-3 text-3xl">
                    Finish your profile so we can begin.
                  </h2>
                  <div className="mt-5 h-1 overflow-hidden rounded-full bg-wine-foreground/15">
                    <div
                      className="h-full rounded-full bg-gold"
                      style={{ width: `${(step / 4) * 100}%` }}
                    />
                  </div>
                </>
              )}
              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  to="/onboarding"
                  className="inline-flex rounded-full border border-wine-foreground/30 px-6 py-3 text-sm font-medium"
                >
                  {p?.completed
                    ? "Edit my answers"
                    : step > 0
                      ? "Continue the questionnaire"
                      : "Begin the questionnaire"}
                </Link>
              </div>
            </div>

            <CustomerInterview userId={user.id} />

            {p?.completed && (
              <dl className="mt-10 grid gap-6 sm:grid-cols-2">
                {[
                  ["Location", p.location],
                  ...buckets.map((bucket) => [
                    bucketLabels[bucket],
                    preferences
                      .filter((i) => i.bucket === bucket && i.about === "partner")
                      .map((i) => i.text ?? `${i.topic.replaceAll("_", " ")}: ${i.user_words}`)
                      .join("\n"),
                  ]),
                ].map(([k, v]) => (
                  <div key={k} className="rounded-2xl border bg-card p-5">
                    <dt className="eyebrow text-muted-foreground">{k}</dt>
                    <dd className="mt-2 whitespace-pre-line text-sm">{v || "None added"}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
