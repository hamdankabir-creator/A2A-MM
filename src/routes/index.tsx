import { createFileRoute, Link } from "@tanstack/react-router";
import hero from "@/assets/hero-hands.jpg";
import { Brand } from "@/components/Brand";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Hearth — Your matchmaker works while you live your life" },
      {
        name: "description",
        content:
          "A personal AI matchmaking agent gets to know you, then quietly meets other members' agents to find someone who actually fits. For serious, long-term relationships.",
      },
      { property: "og:title", content: "Hearth — AI matchmaking for serious relationships" },
      {
        property: "og:description",
        content: "Fewer introductions, chosen with far more care. No swiping, no feed.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const steps = [
  {
    n: "01",
    t: "Get to know you",
    d: "A short questionnaire and a relaxed voice conversation (about 45 minutes, split across sessions) about your values, your past relationships, and what you want your life to look like.",
  },
  {
    n: "02",
    t: "Your agent does the searching",
    d: "Your agent privately compares notes with other members' agents: dealbreakers first, then values, life plans, and how you each handle real situations.",
  },
  {
    n: "03",
    t: "A thoughtful introduction",
    d: "When both agents agree, you both receive a short brief: three things you genuinely share and one honest difference worth talking about. Then you meet.",
  },
];

const pillars = [
  "Matches on what lasts: values, life plans, family goals, and how you handle conflict — not just photos.",
  "Dealbreakers are respected, always.",
  "No swiping, no feed, no pressure to be \u201con\u201d all the time.",
];

function WaitlistButton() {
  return (
    <Link
      to="/auth"
      search={{ mode: "signup" }}
      className="rounded-full bg-primary px-7 py-3.5 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/25 transition-shadow hover:shadow-xl"
    >
      Join the waitlist
    </Link>
  );
}

function Index() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0">
        <div className="animate-breathe absolute -left-24 -top-32 h-[520px] w-[520px] rounded-full bg-accent/15 blur-3xl" />
        <div className="animate-breathe absolute -right-32 top-24 h-[480px] w-[480px] rounded-full bg-primary/10 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-6xl px-6">
        <header className="flex items-center justify-between py-6">
          <Brand />
          <nav className="hidden items-center gap-8 text-sm text-muted-foreground md:flex">
            <a href="#how" className="hover:text-foreground">
              How it works
            </a>
            <a href="#privacy" className="hover:text-foreground">
              Privacy
            </a>
            <a href="#pricing" className="hover:text-foreground">
              Pricing
            </a>
          </nav>
          <Link
            to="/auth"
            className="rounded-full bg-wine px-4 py-2 text-sm font-medium text-wine-foreground hover:opacity-90"
          >
            Sign in
          </Link>
        </header>

        <section className="grid items-center gap-12 pb-20 pt-8 lg:grid-cols-12">
          <div className="animate-rise lg:col-span-7">
            <span className="eyebrow text-primary">(a) Matchmaking for serious relationships</span>
            <h1 className="font-display mt-6 text-balance text-5xl leading-[1.05] md:text-7xl">
              Your matchmaker works <span className="text-primary">while you live your life.</span>
            </h1>
            <p className="mt-6 max-w-[46ch] text-pretty text-lg text-muted-foreground">
              A personal AI agent gets to know you, then quietly meets other people's agents to find
              someone who actually fits. You only hear about it when it's worth your time.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-6">
              <WaitlistButton />
              <a
                href="#how"
                className="text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                How it works
              </a>
            </div>
            <div className="eyebrow mt-8 flex flex-wrap items-center gap-5 text-muted-foreground">
              <span>Long-term only</span>
              <span className="size-1 rounded-full bg-gold" />
              <span>Private by design</span>
              <span className="size-1 rounded-full bg-gold" />
              <span>No swiping</span>
            </div>
          </div>

          <div className="animate-rise lg:col-span-5" style={{ animationDelay: "120ms" }}>
            <div className="relative">
              <img
                src={hero}
                alt="A couple holding hands, her engagement ring catching the light"
                width={1024}
                height={1280}
                className="aspect-[4/5] w-full rounded-3xl object-cover ring-1 ring-border"
              />
              <div className="absolute -bottom-6 -left-6 -rotate-2 rounded-2xl bg-wine px-4 py-3 text-xs text-wine-foreground shadow-xl">
                <span className="font-medium">Fewer introductions, chosen with far more care.</span>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-8 pb-24 md:grid-cols-12">
          <span className="eyebrow text-primary md:col-span-3">(b) The problem</span>
          <div className="md:col-span-9">
            <p className="font-display text-balance text-3xl leading-snug md:text-4xl">
              Dating apps are built to keep you swiping. You get volume, not fit — and the work of
              filtering falls on you.
            </p>
            <p className="mt-6 max-w-[52ch] text-lg text-muted-foreground">
              Hearth flips that: fewer introductions, chosen with far more care.
            </p>
          </div>
        </section>

        <section id="how" className="pb-24">
          <div className="animate-rise rounded-3xl bg-wine p-8 text-wine-foreground md:p-12">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <span className="eyebrow text-gold">(c) How it works</span>
              <p className="max-w-[40ch] text-xs opacity-60">
                Three quiet steps. No feed, no browsing profiles.
              </p>
            </div>
            <div className="mt-10 grid gap-8 md:grid-cols-3">
              {steps.map((s) => (
                <div key={s.n}>
                  <div className="font-mono text-2xl text-gold">{s.n}</div>
                  <h3 className="font-display mt-3 text-2xl">{s.t}</h3>
                  <p className="mt-2 text-pretty text-sm leading-relaxed opacity-70">{s.d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="pb-24">
          <span className="eyebrow text-primary">(d) Built for serious relationships</span>
          <div className="mt-8 grid gap-6 md:grid-cols-3">
            {pillars.map((p) => (
              <div key={p} className="rounded-2xl border bg-card p-6">
                <span className="block h-px w-10 bg-gold" />
                <p className="mt-4 text-pretty leading-relaxed">{p}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="privacy" className="pb-24">
          <div className="rounded-3xl border-2 border-gold/40 bg-card p-8 md:p-12">
            <span className="eyebrow text-primary">(e) Privacy</span>
            <h2 className="font-display mt-4 text-balance text-4xl md:text-5xl">
              Your story stays with your agent.
            </h2>
            <div className="mt-6 grid gap-6 text-lg text-muted-foreground md:grid-cols-2">
              <p>
                Your conversations and data stay with your own agent. Other members never see your
                answers, your data, or anything your agent has learned about you — only the
                conclusion that you're a good fit.
              </p>
              <p>
                You can see and correct your profile at any time, and every data connection is
                optional.
              </p>
            </div>
          </div>
        </section>

        <section id="pricing" className="grid gap-8 pb-24 md:grid-cols-12">
          <span className="eyebrow text-primary md:col-span-3">(f) Pricing</span>
          <p className="text-pretty text-xl leading-relaxed md:col-span-9">
            Free to join and build your profile. You pay only when you're introduced to someone. If
            the match clearly misses, tell us and we'll credit it.
          </p>
        </section>

        <section className="pb-24">
          <div className="rounded-3xl bg-wine p-10 text-center text-wine-foreground md:p-16">
            <h2 className="font-display text-balance text-4xl md:text-6xl">
              Fewer matches. <span className="text-gold">Better ones.</span>
            </h2>
            <p className="mx-auto mt-4 max-w-[48ch] opacity-75">
              We're launching with a small founding group. Join the waitlist to be one of the first.
            </p>
            <div className="mt-8 flex justify-center">
              <WaitlistButton />
            </div>
          </div>
        </section>

        <footer className="flex flex-col items-center justify-between gap-4 border-t py-8 md:flex-row">
          <span className="font-display text-lg">Hearth</span>
          <span className="eyebrow text-muted-foreground">
            Serious about love. Careful with you.
          </span>
        </footer>
      </div>
    </div>
  );
}
