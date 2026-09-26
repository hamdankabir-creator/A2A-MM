import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppHeader } from "@/components/AppHeader";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fetchMyProfile, saveMyProfile, VALUE_OPTIONS, type ProfileUpdate } from "@/lib/profile";

export const Route = createFileRoute("/_authenticated/onboarding")({
  head: () => ({
    meta: [
      { title: "Your story — Hearth" },
      {
        name: "description",
        content: "Tell your matchmaker about yourself in four short chapters.",
      },
      { property: "og:title", content: "Your story — Hearth" },
      { property: "og:description", content: "Four short chapters for your matchmaker." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Onboarding,
});

const CHAPTERS = ["About me", "Values", "Lifestyle", "Looking for"];

type Field = {
  key: keyof ProfileUpdate;
  label: string;
  type?: "text" | "date" | "number" | "textarea" | "select";
  options?: string[];
  hint?: string;
};

const FIELDS: Field[][] = [
  [
    { key: "full_name", label: "Full name" },
    { key: "date_of_birth", label: "Date of birth", type: "date" },
    { key: "gender", label: "I am a", type: "select", options: ["Woman", "Man", "Non-binary"] },
    {
      key: "seeking_gender",
      label: "Seeking a",
      type: "select",
      options: ["Woman", "Man", "Anyone"],
    },
    { key: "location", label: "City & country" },
    { key: "occupation", label: "Occupation" },
    { key: "education", label: "Education" },
    {
      key: "about_me",
      label: "Tell us about yourself",
      type: "textarea",
      hint: "Who you are, what fills your days, what people love about you.",
    },
  ],
  [
    { key: "faith", label: "Faith or spirituality" },
    {
      key: "wants_children",
      label: "Children",
      type: "select",
      options: [
        "Want children",
        "Have and want more",
        "Have, don't want more",
        "Don't want children",
        "Open",
      ],
    },
    {
      key: "relationship_view",
      label: "What does a good marriage look like to you?",
      type: "textarea",
    },
  ],
  [
    { key: "lifestyle", label: "Describe a typical week", type: "textarea" },
    { key: "hobbies", label: "Interests & passions", type: "textarea" },
    {
      key: "smoking",
      label: "Smoking",
      type: "select",
      options: ["Never", "Socially", "Regularly"],
    },
    {
      key: "drinking",
      label: "Drinking",
      type: "select",
      options: ["Never", "Socially", "Regularly"],
    },
  ],
  [
    {
      key: "partner_description",
      label: "Describe the partner you hope to marry",
      type: "textarea",
    },
    { key: "dealbreakers", label: "Dealbreakers", type: "textarea" },
    { key: "age_min", label: "Partner age from", type: "number" },
    { key: "age_max", label: "Partner age to", type: "number" },
  ],
];

function Onboarding() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: profile, isLoading } = useQuery({
    queryKey: ["profile", user.id],
    queryFn: () => fetchMyProfile(user.id),
  });
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<ProfileUpdate>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (profile) {
      setForm(profile);
      setStep(profile.completed ? 0 : Math.min(profile.onboarding_step, 3));
    }
  }, [profile]);

  const set = (k: keyof ProfileUpdate, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  async function next() {
    setSaving(true);
    try {
      const last = step === 3;
      const { id: _id, created_at: _c, updated_at: _u, ...rest } = form;
      await saveMyProfile(user.id, {
        ...rest,
        onboarding_step: Math.max(profile?.onboarding_step ?? 0, step + 1),
        completed: last ? true : (profile?.completed ?? false),
      });
      await qc.invalidateQueries({ queryKey: ["profile", user.id] });
      if (last) {
        toast.success("Your profile is complete");
        navigate({ to: "/dashboard" });
      } else setStep(step + 1);
    } catch (e) {
      toast.error((e as Error).message);
    }
    setSaving(false);
  }

  if (isLoading) return <div className="min-h-screen bg-background" />;

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-2xl px-6 pb-20">
        <div className="rounded-3xl border bg-card p-6 shadow-xl shadow-primary/5 sm:p-9">
          <div className="flex items-center justify-between">
            <span className="eyebrow text-muted-foreground">Step {step + 1} / 4</span>
            <span className="eyebrow text-primary">{CHAPTERS[step]}</span>
          </div>
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${((step + 1) / 4) * 100}%` }}
            />
          </div>
          <div className="mt-5 grid grid-cols-4 gap-2 text-center text-[11px]">
            {CHAPTERS.map((c, i) => (
              <button
                key={c}
                type="button"
                onClick={() => i <= (profile?.onboarding_step ?? 0) && setStep(i)}
                className={`rounded-xl py-2 font-medium ${i === step ? "bg-primary text-primary-foreground" : i < step ? "bg-secondary text-secondary-foreground" : "bg-muted text-muted-foreground"}`}
              >
                {c}
              </button>
            ))}
          </div>

          <h1 className="font-display mt-8 text-4xl">{CHAPTERS[step]}</h1>

          <div key={step} className="animate-rise mt-6 space-y-5">
            {step === 1 && (
              <div className="space-y-2">
                <Label>Your core values (pick up to 5)</Label>
                <div className="flex flex-wrap gap-2">
                  {VALUE_OPTIONS.map((v) => {
                    const sel = (form.core_values ?? []).includes(v);
                    return (
                      <button
                        key={v}
                        type="button"
                        onClick={() => {
                          const cur = form.core_values ?? [];
                          if (sel)
                            set(
                              "core_values",
                              cur.filter((x) => x !== v),
                            );
                          else if (cur.length < 5) set("core_values", [...cur, v]);
                        }}
                        className={`rounded-full border px-4 py-1.5 text-sm ${sel ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                      >
                        {v}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {(FIELDS[step] ?? []).map((f) => {
              const val = (form[f.key] as string | number | null | undefined) ?? "";
              return (
                <div key={f.key} className="space-y-1.5">
                  <Label htmlFor={f.key}>{f.label}</Label>
                  {f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
                  {f.type === "textarea" ? (
                    <Textarea
                      id={f.key}
                      rows={4}
                      maxLength={2000}
                      value={val}
                      onChange={(e) => set(f.key, e.target.value)}
                    />
                  ) : f.type === "select" ? (
                    <select
                      id={f.key}
                      value={val}
                      onChange={(e) => set(f.key, e.target.value)}
                      className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                    >
                      <option value="">Select…</option>
                      {f.options!.map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      id={f.key}
                      type={f.type ?? "text"}
                      maxLength={200}
                      value={val}
                      onChange={(e) =>
                        set(
                          f.key,
                          f.type === "number"
                            ? e.target.value
                              ? Number(e.target.value)
                              : null
                            : e.target.value || null,
                        )
                      }
                    />
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-8 flex items-center justify-between">
            <button
              type="button"
              disabled={step === 0}
              onClick={() => setStep(step - 1)}
              className="eyebrow text-muted-foreground hover:text-foreground disabled:opacity-30"
            >
              Back
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={next}
              className="rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {saving ? "Saving…" : step === 3 ? "Finish" : "Save & continue"}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
