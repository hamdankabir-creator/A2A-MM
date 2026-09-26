import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppHeader } from "@/components/AppHeader";
import { fetchMyProfile } from "@/lib/profile";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Your profile — Hearth" },
      { name: "description", content: "Your Hearth matchmaking profile and status." },
      { property: "og:title", content: "Your profile — Hearth" },
      { property: "og:description", content: "Your matchmaking profile and status." },
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

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
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
                  <h2 className="font-display mt-3 text-3xl">
                    Your matchmaker is reviewing your story.
                  </h2>
                  <p className="mt-3 max-w-[50ch] text-sm opacity-70">
                    We'll reach out when we've found someone we believe is worth meeting.
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
                  to="/agent"
                  className="inline-flex rounded-full bg-gold px-6 py-3 text-sm font-medium text-wine"
                >
                  Talk to your matchmaker
                </Link>
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

            {p?.completed && (
              <dl className="mt-10 grid gap-6 sm:grid-cols-2">
                {[
                  ["Location", p.location],
                  ["Occupation", p.occupation],
                  ["Values", p.core_values?.join(", ")],
                  ["Children", p.wants_children],
                  ["Looking for", p.partner_description],
                  ["Dealbreakers", p.dealbreakers],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-2xl border bg-card p-5">
                    <dt className="eyebrow text-muted-foreground">{k}</dt>
                    <dd className="mt-2 text-sm">{v || "—"}</dd>
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
