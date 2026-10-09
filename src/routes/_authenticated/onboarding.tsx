import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { intakeRequest, type IntakeStatus } from "@/lib/customer-intake";
import {
  buckets,
  bucketLabels,
  essentialFields,
  onboardingSchema,
  type Onboarding,
  type Preference,
} from "../../../supabase/functions/_shared/intake";

export const Route = createFileRoute("/_authenticated/onboarding")({
  head: () => ({ meta: [{ title: "Your screening profile — Heimdall" }] }),
  component: OnboardingPage,
});
const chapters = ["In your words", "About you", "Your requirements", "Review"];
const label = (s: string) => s.replaceAll("_", " ");
const control = "w-full rounded-xl border bg-background px-3 py-2 text-sm";
function OnboardingPage() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["intake-onboarding", user.id],
    queryFn: () => intakeRequest<IntakeStatus>({ action: "status" }),
    retry: false,
  });
  const initialized = useRef(false);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<Onboarding>({
    full_name: "",
    phone: "",
    date_of_birth: "",
    location: "",
    timezone: "UTC",
    open_ask: "",
    early_signs: "",
    essentials: {},
    age_min: 18,
    age_max: 99,
    items: [],
    confirmed: true,
  });
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (query.data && !initialized.current) {
      initialized.current = true;
      setForm((f) => ({
        ...f,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        ...query.data.onboarding?.draft,
      }));
    }
  }, [query.data]);
  function update(patch: Partial<Onboarding>) {
    setForm((f) => ({ ...f, ...patch }));
    setConfirmed(false);
    setMessage("");
  }
  function itemUpdate(id: string, patch: Partial<Preference>) {
    update({ items: form.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) });
  }
  async function save(advance: boolean) {
    setBusy(true);
    setMessage("");
    try {
      if (step === 3 && advance) {
        const result = onboardingSchema.safeParse(form);
        if (!result.success)
          throw new Error(result.error.issues[0]?.message ?? "Check your answers.");
        if (!confirmed) throw new Error("Please confirm the readback first.");
        await intakeRequest({ action: "confirm", data: result.data, version: query.data?.version });
        await qc.invalidateQueries({ queryKey: ["profile", user.id] });
        await qc.invalidateQueries({ queryKey: ["customer-intake", user.id] });
        navigate({ to: "/dashboard" });
      } else {
        await intakeRequest({ action: "draft", draft: form });
        if (advance) setStep((s) => s + 1);
        else setMessage("Saved. You can come back to finish later.");
      }
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="min-h-screen bg-background">
      <AppHeader product="Heimdall" />
      <main className="mx-auto max-w-2xl px-6 pb-20">
        <div className="rounded-3xl border bg-card p-6 sm:p-9">
          <p className="eyebrow text-primary">Heimdall · Step {step + 1} of 4</p>
          <h1 className="font-display mt-3 text-4xl">{chapters[step]}</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            A private profile for assessing people you meet. You can edit it at any time.
          </p>
          {query.isLoading ? (
            <p className="mt-6">Loading your answers…</p>
          ) : query.isError ? (
            <p role="alert" className="mt-6">
              Couldn't load your answers.{" "}
              <button className="underline" onClick={() => query.refetch()}>
                Try again
              </button>
            </p>
          ) : (
            <div className="mt-6 space-y-5">
              {step === 0 && (
                <>
                  <Label htmlFor="open-ask">
                    In your own words, what must a partner have, what would be nice, and what is a
                    dealbreaker?
                  </Label>
                  <Textarea
                    id="open-ask"
                    value={form.open_ask}
                    maxLength={4000}
                    rows={5}
                    onChange={(e) => update({ open_ask: e.target.value })}
                  />
                  <Label htmlFor="early-signs">
                    What early signs make you pull back from someone?
                  </Label>
                  <Textarea
                    id="early-signs"
                    value={form.early_signs}
                    maxLength={4000}
                    rows={4}
                    onChange={(e) => update({ early_signs: e.target.value })}
                  />
                  <p className="text-sm text-muted-foreground">
                    Next, you'll put the requirements you want us to use into four editable lists.
                    These are your preferences, not safety judgments about someone.
                  </p>
                </>
              )}
              {step === 1 && (
                <>
                  {(
                    [
                      ["full_name", "Your name", "text"],
                      ["phone", "Mobile number with country code", "tel"],
                      ["date_of_birth", "Date of birth (18 or older)", "date"],
                      ["location", "City, state or region, and country", "text"],
                      ["timezone", "Time zone, such as America/Los_Angeles", "text"],
                    ] as const
                  ).map(([key, title, type]) => (
                    <div key={key}>
                      <Label htmlFor={key}>{title}</Label>
                      <Input
                        id={key}
                        type={type}
                        value={form[key]}
                        onChange={(e) => update({ [key]: e.target.value })}
                      />
                    </div>
                  ))}
                  {essentialFields.map(([key, title, options]) => (
                    <div key={key}>
                      <Label htmlFor={key}>{title}</Label>
                      {options.length ? (
                        <select
                          id={key}
                          className={control}
                          value={form.essentials[key] ?? ""}
                          onChange={(e) =>
                            update({ essentials: { ...form.essentials, [key]: e.target.value } })
                          }
                        >
                          <option value="">Choose an answer</option>
                          {options.map((o) => (
                            <option key={o} value={o}>
                              {label(o)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <Input
                          id={key}
                          value={form.essentials[key] ?? ""}
                          onChange={(e) =>
                            update({ essentials: { ...form.essentials, [key]: e.target.value } })
                          }
                        />
                      )}
                    </div>
                  ))}
                  <div className="grid grid-cols-2 gap-4">
                    {(["age_min", "age_max"] as const).map((key) => (
                      <div key={key}>
                        <Label htmlFor={key}>
                          {key === "age_min" ? "Partner minimum age" : "Partner maximum age"}
                        </Label>
                        <Input
                          id={key}
                          type="number"
                          min={18}
                          max={120}
                          value={form[key]}
                          onChange={(e) => update({ [key]: Number(e.target.value) })}
                        />
                      </div>
                    ))}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    An uncertain answer stays uncertain. Add any nuance or partner limits to your
                    requirements on the next screen.
                  </p>
                </>
              )}
              {step === 2 && (
                <>
                  <p className="text-sm">
                    Turn the points you want us to use from your opening answers into individual
                    requirements below. You choose their importance; we won't infer it.
                  </p>
                  <blockquote className="whitespace-pre-wrap rounded-xl bg-muted p-4 text-sm">
                    {form.open_ask || "No opening answer"}
                    {"\n"}
                    {form.early_signs}
                  </blockquote>
                  <p className="text-sm text-muted-foreground">
                    Dealbreakers are facts someone could state, such as smoking. Red flags are
                    behaviors you would watch for over time.
                  </p>
                  {buckets.map((bucket) => (
                    <section key={bucket} className="space-y-3 rounded-2xl border p-4">
                      <h2 className="text-lg font-medium">{bucketLabels[bucket]}</h2>
                      {form.items
                        .filter((i) => i.bucket === bucket)
                        .map((i) => (
                          <div key={i.id} className="space-y-2 rounded-xl bg-muted p-3">
                            <Textarea
                              aria-label={`${bucketLabels[bucket]} requirement`}
                              value={i.text}
                              maxLength={1000}
                              onChange={(e) => itemUpdate(i.id, { text: e.target.value })}
                            />
                            <div className="flex flex-wrap gap-2">
                              <select
                                aria-label="Importance"
                                className={control}
                                value={i.bucket}
                                onChange={(e) =>
                                  itemUpdate(i.id, {
                                    bucket: e.target.value as Preference["bucket"],
                                  })
                                }
                              >
                                {buckets.map((b) => (
                                  <option key={b} value={b}>
                                    {bucketLabels[b]}
                                  </option>
                                ))}
                              </select>
                              <select
                                aria-label="Who this describes"
                                className={control}
                                value={i.about}
                                onChange={(e) =>
                                  itemUpdate(i.id, { about: e.target.value as "self" | "partner" })
                                }
                              >
                                <option value="partner">What I want in a partner</option>
                                <option value="self">About me</option>
                              </select>
                              <button
                                type="button"
                                className="text-sm underline"
                                onClick={() =>
                                  update({ items: form.items.filter((x) => x.id !== i.id) })
                                }
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        ))}
                      <button
                        type="button"
                        className="text-sm underline"
                        onClick={() =>
                          update({
                            items: [
                              ...form.items,
                              {
                                id: crypto.randomUUID(),
                                text: "",
                                topic: "other",
                                about: "partner",
                                bucket,
                              },
                            ],
                          })
                        }
                      >
                        Add {bucketLabels[bucket].toLowerCase()}
                      </button>
                    </section>
                  ))}
                </>
              )}
              {step === 3 && (
                <>
                  <p className="text-sm">
                    Check every answer below. Use Back to correct anything. Your information stays
                    private.
                  </p>
                  <dl className="grid gap-3 rounded-2xl bg-muted p-4 text-sm">
                    {[
                      ["Name", form.full_name],
                      ["Phone", form.phone],
                      ["Date of birth", form.date_of_birth],
                      ["Location", form.location],
                      ["Time zone", form.timezone],
                      ["Partner age range", `${form.age_min}–${form.age_max}`],
                      ...essentialFields.map(([k, title]) => [
                        title,
                        label(form.essentials[k] ?? "Not answered"),
                      ]),
                    ].map(([title, value]) => (
                      <div key={title}>
                        <dt className="font-medium">{title}</dt>
                        <dd>{value || "Not answered"}</dd>
                      </div>
                    ))}
                  </dl>
                  {buckets.map((b) => (
                    <section key={b}>
                      <h2 className="font-medium">{bucketLabels[b]}</h2>
                      <ul className="mt-2 list-disc pl-5 text-sm">
                        {form.items
                          .filter((i) => i.bucket === b)
                          .map((i) => (
                            <li key={i.id}>
                              {i.text} ({i.about})
                            </li>
                          ))}
                        {!form.items.some((i) => i.bucket === b) && <li>None added</li>}
                      </ul>
                    </section>
                  ))}
                  <label className="flex items-start gap-3 text-sm">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />
                    I have reviewed these answers and requirements, including the empty lists. They
                    reflect what I want Heimdall to use.
                  </label>
                </>
              )}
              {message && (
                <p role="alert" className="text-sm">
                  {message}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <button
                  disabled={busy || step === 0}
                  onClick={() => setStep((s) => s - 1)}
                  className="rounded-full border px-4 py-2 disabled:opacity-40"
                >
                  Back
                </button>
                <button
                  disabled={busy}
                  onClick={() => save(false)}
                  className="rounded-full border px-4 py-2"
                >
                  Save for later
                </button>
                <button
                  disabled={busy || (step === 3 && !confirmed)}
                  onClick={() => save(true)}
                  className="rounded-full bg-primary px-5 py-2 text-primary-foreground disabled:opacity-40"
                >
                  {busy ? "Saving…" : step === 3 ? "Confirm my profile" : "Save & continue"}
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
