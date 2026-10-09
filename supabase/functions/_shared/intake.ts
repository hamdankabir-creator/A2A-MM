import { z } from "zod";

export const CONSENT_VERSION = "heimdall-customer-call-v1";
export const CONSENT_TEXT =
  "I request a call now from Heimdall's AI interviewer at my verified number. The call will be recorded and transcribed from connection, including the opening consent question, to build my private screening profile. I can skip questions or end the call. Withdrawing consent ends the call and deletes its content. This does not consent to marketing or Frigg enrollment.";
export const buckets = ["dealbreaker", "must_have", "red_flag", "nice_to_have"] as const;
export const bucketLabels = {
  dealbreaker: "Dealbreakers",
  must_have: "Must-haves",
  red_flag: "Red flags",
  nice_to_have: "Nice-to-haves",
};
const text = z.string().trim().min(1).max(1000);
export const preferenceSchema = z
  .object({
    id: z.string().uuid(),
    text,
    topic: text.max(60),
    about: z.enum(["self", "partner"]),
    bucket: z.enum(buckets),
  })
  .strict();
export const essentialFields = [
  ["gender", "Your gender", []],
  ["seeking", "Who would you like to meet?", []],
  ["relationship_goal", "Your relationship goal", ["marriage", "long_term", "undecided"]],
  [
    "partner_relationship_goal",
    "Your partner's relationship goal",
    ["marriage", "long_term", "undecided"],
  ],
  [
    "children",
    "Your plans for children",
    ["want", "open", "not_sure", "dont_want", "have_want_more", "have_done"],
  ],
  [
    "partner_existing_children",
    "A partner who already has children",
    ["fine", "depends", "prefer_not", "no"],
  ],
  [
    "relocation",
    "Would you relocate?",
    ["anywhere", "within_region", "for_right_person", "staying_put"],
  ],
  ["faith", "Your faith practice", ["devout", "practicing", "cultural", "spiritual", "none"]],
  ["faith_tradition", "Your faith tradition, or none", []],
  ["partner_faith", "A partner's faith", ["must_share", "prefer_share", "doesnt_matter"]],
  ["smoking", "Your smoking habits", ["never", "sometimes", "regularly"]],
  ["alcohol", "Your drinking habits", ["never", "sometimes", "regularly"]],
  ["drugs", "Your recreational drug use", ["never", "sometimes", "regularly"]],
  ["monogamy", "Your relationship structure", ["monogamous", "non_monogamous", "not_sure"]],
  [
    "partner_monogamy",
    "Your partner's relationship structure",
    ["monogamous", "non_monogamous", "not_sure"],
  ],
] as const;
export function normalizePhone(value: string) {
  const phone = value.trim().replace(/[ ()-]/g, "");
  if (!/^\+[1-9]\d{7,14}$/.test(phone))
    throw new Error("Enter a phone number with its country code, such as +14155550123.");
  return phone;
}
export const onboardingSchema = z
  .object({
    full_name: text.max(150),
    phone: text.transform(normalizePhone),
    date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    location: text.max(200),
    timezone: text.refine((v) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: v });
        return true;
      } catch {
        return false;
      }
    }, "Choose a valid time zone"),
    open_ask: z.string().max(4000),
    early_signs: z.string().max(4000),
    essentials: z.record(z.string().max(200)),
    age_min: z.number().int().min(18).max(120),
    age_max: z.number().int().min(18).max(120),
    items: z.array(preferenceSchema).max(80),
    confirmed: z.literal(true),
  })
  .strict()
  .superRefine((v, ctx) => {
    const dob = new Date(v.date_of_birth + "T00:00:00Z");
    const today = new Date();
    const adult = new Date(today);
    adult.setUTCFullYear(today.getUTCFullYear() - 18);
    if (
      !Number.isFinite(dob.getTime()) ||
      dob.toISOString().slice(0, 10) !== v.date_of_birth ||
      dob > adult ||
      today.getUTCFullYear() - dob.getUTCFullYear() > 120
    )
      ctx.addIssue({
        code: "custom",
        message: "You must be at least 18. Check your date of birth.",
        path: ["date_of_birth"],
      });
    if (v.age_min > v.age_max)
      ctx.addIssue({ code: "custom", message: "Check the partner age range." });
    for (const [key, label, options] of essentialFields) {
      const answer = v.essentials[key];
      if (
        !answer?.trim() ||
        (options.length > 0 && !(options as readonly string[]).includes(answer))
      )
        ctx.addIssue({
          code: "custom",
          message: `Please answer: ${label}`,
          path: ["essentials", key],
        });
    }
    if (new Set(v.items.map((i) => i.id)).size !== v.items.length)
      ctx.addIssue({ code: "custom", message: "Duplicate preference IDs" });
  });
export type Onboarding = z.infer<typeof onboardingSchema>;
export type Preference = z.infer<typeof preferenceSchema>;
export type Fact = {
  id: string;
  statement: string;
  about: "self" | "partner";
  dimension: string;
  label: string;
  bucket: string | null;
  derived_from: string[];
  source_ref: string;
  primary: boolean;
  share: string;
  share_as: string;
};
export function buildPreferences(data: Onboarding, previous: Record<string, unknown> = {}) {
  const normalized = essentialFields.map(([key]) => ({
    id: `essential:${key}`,
    topic: ["partner_faith", "partner_relationship_goal", "partner_monogamy"].includes(key)
      ? key.replace("partner_", "")
      : ["smoking", "alcohol", "drugs"].includes(key)
        ? "substances"
        : key,
    about: (key.startsWith("partner_") ? "partner" : "self") as "self" | "partner",
    value: ["smoking", "alcohol", "drugs"].includes(key)
      ? `${key}:${data.essentials[key]}`
      : data.essentials[key]!,
    user_words: data.essentials[key]!,
    bucket:
      (key === "partner_faith" && data.essentials[key] === "must_share") ||
      (key === "partner_existing_children" && data.essentials[key] === "no")
        ? "dealbreaker"
        : key.startsWith("partner_") &&
            !["doesnt_matter", "fine", "depends", "not_sure", "undecided"].includes(
              data.essentials[key] ?? "",
            )
          ? "must_have"
          : "nice_to_have",
  }));
  const items = [
    ...normalized,
    {
      id: "essential:date_of_birth",
      topic: "date_of_birth",
      about: "self" as const,
      value: data.date_of_birth,
      user_words: data.date_of_birth,
      bucket: "nice_to_have",
    },
    {
      id: "essential:location",
      topic: "location",
      about: "self" as const,
      value: data.location,
      user_words: data.location,
      bucket: "nice_to_have",
    },
    {
      id: "essential:age_range",
      topic: "age_range",
      about: "partner" as const,
      value: { min: data.age_min, max: data.age_max },
      user_words: `${data.age_min}–${data.age_max}`,
      bucket: "must_have",
    },
    ...data.items.map((i) => ({ ...i, value: "other", user_words: i.text })),
  ].map((i) => ({
    ...i,
    confirmed: true,
    tag: "stated",
    share: "never_share",
    share_as: "",
    member_edited: true,
    source: "customer_onboarding",
  }));
  const priorFacts = (Array.isArray(previous["facts"]) ? previous["facts"] : []) as Fact[];
  const oldItems =
    (previous["preferences"] as { items?: { id?: string }[] } | undefined)?.items ?? [];
  let nextId = Math.max(
    Number(previous["fact_id_high_watermark"]) || 0,
    ...priorFacts.map((f) => Number(/^f(\d+)$/.exec(f.id)?.[1]) || 0),
  );
  const facts: Fact[] = items.map((i, index) => {
    const oldIndex = oldItems.findIndex((old) => old.id === i.id);
    const oldFact =
      oldIndex < 0
        ? undefined
        : priorFacts.find((f) => f.primary && f.source_ref === `preferences.items[${oldIndex}]`);
    return {
      id: oldFact?.id ?? `f${++nextId}`,
      statement: `${i.about === "self" ? "Customer" : "Partner requirement"}: ${i.topic}: ${i.user_words}`,
      about: i.about,
      dimension: i.bucket === "red_flag" ? "conflict" : "constraints",
      label: "self_description",
      bucket: i.bucket,
      derived_from: [],
      source_ref: `preferences.items[${index}]`,
      primary: true,
      share: "never_share",
      share_as: "",
    };
  });
  return {
    ...previous,
    preferences: {
      items,
      status: "confirmed",
      confirmed_at: new Date().toISOString(),
      essential_missing: [],
      declined: [],
    },
    facts,
    fact_id_high_watermark: nextId,
    interview: { status: "in_progress" },
    ready_for_matching: false,
  };
}
export const turnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string().max(20000),
  start_timestamp: z.number().optional(),
  end_timestamp: z.number().optional(),
});
export type Turn = z.infer<typeof turnSchema>;
const evidence = z.object({ turn: z.number().int().nonnegative(), quote: text });
export const extractionSchema = z
  .object({
    consent: z.enum(["confirmed", "withdrawn", "uncertain"]),
    consent_evidence: z.array(evidence).min(1),
    readback_confirmed: z.boolean(),
    readback_evidence: z.array(evidence),
    values: z
      .array(z.object({ chose: text, over: text, evidence: z.array(evidence).min(1) }))
      .max(10),
    conflict_style: z.object({
      raises_issues: z.string().max(1000),
      first_response: z.string().max(1000),
      repair: z.string().max(1000),
      ownership: z.string().max(1000),
      evidence: z.array(evidence),
    }),
    conversation_hooks: z
      .array(z.object({ description: text, evidence: z.array(evidence).min(1) }))
      .max(2),
    answers: z
      .array(
        z.object({
          question: z.enum(["breakup", "conflict", "values", "repair", "support"]),
          event_summary: z.string().max(1500),
          own_part: z.string().max(1000),
          coverage: z.enum(["full", "partial", "none", "declined"]),
          evidence: z.array(evidence),
        }),
      )
      .max(5),
    contradictions: z
      .array(
        z.object({
          stated_preference: text,
          interview_behaviour: text,
          evidence: z.array(evidence).min(1),
        }),
      )
      .max(15),
    unanswered_topics: z.array(text).max(20),
  })
  .strict();
export type Extraction = z.infer<typeof extractionSchema>;
export function validateExtraction(input: unknown, transcript: Turn[]) {
  const value = extractionSchema.parse(input);
  if (new Set(value.answers.map((a) => a.question)).size !== value.answers.length)
    throw new Error("Duplicate topics");
  const proofs = [
    ...value.consent_evidence,
    ...value.readback_evidence,
    ...value.values.flatMap((v) => v.evidence),
    ...value.conflict_style.evidence,
    ...value.conversation_hooks.flatMap((h) => h.evidence),
    ...value.answers.flatMap((a) => a.evidence),
    ...value.contradictions.flatMap((c) => c.evidence),
  ];
  if (
    proofs.some(
      (e) => transcript[e.turn]?.role !== "user" || !transcript[e.turn]?.text.includes(e.quote),
    )
  )
    throw new Error("Evidence is not a verbatim customer statement");
  if (value.readback_confirmed && !value.readback_evidence.length)
    throw new Error("Missing readback evidence");
  if (
    [
      value.conflict_style.raises_issues,
      value.conflict_style.first_response,
      value.conflict_style.repair,
      value.conflict_style.ownership,
    ].some(Boolean) &&
    !value.conflict_style.evidence.length
  )
    throw new Error("Missing conflict evidence");
  if (
    value.answers.some(
      (a) =>
        ["full", "partial"].includes(a.coverage) && (!a.evidence.length || !a.event_summary.trim()),
    )
  )
    throw new Error("Missing behavioral evidence");
  return value;
}
export function interviewPatch(
  result: Extraction,
  record: Record<string, unknown>,
  sessionId: string,
) {
  const facts = (record["facts"] ?? []) as Fact[];
  let next = Math.max(
    Number(record["fact_id_high_watermark"]) || 0,
    ...facts.map((f) => Number(/^f(\d+)$/.exec(f.id)?.[1]) || 0),
  );
  const complete =
    result.consent === "confirmed" &&
    result.readback_confirmed &&
    ["breakup", "conflict", "values"].every((q) =>
      result.answers.some((a) => a.question === q && ["partial", "full"].includes(a.coverage)),
    );
  const newFacts = result.answers.flatMap((a, i): Fact[] =>
    ["full", "partial"].includes(a.coverage)
      ? [
          {
            id: `f${++next}`,
            statement: a.event_summary,
            about: "self",
            dimension: a.question === "values" ? "values" : "conflict",
            label: "self_event",
            bucket: null,
            derived_from: [],
            source_ref: `interview.answers[${i}]`,
            primary: false,
            share: "never_share",
            share_as: "",
          },
        ]
      : [],
  );
  const essentials = record["preferences"] as
    | { status?: string; essential_missing?: string[]; declined?: string[]; items?: unknown[] }
    | undefined;
  const valueFacts: Fact[] = result.values.map((v, i) => ({
    id: `f${++next}`,
    statement: `Chose ${v.chose} over ${v.over}`,
    about: "self",
    dimension: "values",
    label: "self_event",
    bucket: null,
    derived_from: [],
    source_ref: `interview.values[${i}]`,
    primary: true,
    share: "never_share",
    share_as: "",
  }));
  const hasAmbiguity = (essentials?.items ?? []).some((i) => {
    const v = i as { topic?: string; value?: unknown };
    return (
      ["children", "monogamy", "relationship_goal", "partner_existing_children"].includes(
        v.topic ?? "",
      ) && ["not_sure", "undecided", "depends"].includes(String(v.value))
    );
  });
  return {
    ...record,
    fact_id_high_watermark: next,
    interview: {
      session_id: sessionId,
      answers: result.answers.map((a) => ({ ...a, key_quotes: a.evidence.map((e) => e.quote) })),
      values: result.values.map((v) => ({
        ...v,
        evidence: v.evidence.map((e) => e.quote).join("\n"),
        share: "never_share",
        share_as: "",
        member_edited: false,
      })),
      conflict_style: {
        ...result.conflict_style,
        evidence: result.conflict_style.evidence.map((e) => e.quote).join("\n"),
      },
      conversation_hooks: result.conversation_hooks.map((h) => ({
        ...h,
        share: "never_share",
        share_as: "",
        member_edited: false,
      })),
      contradictions: result.contradictions,
      unanswered_topics: result.unanswered_topics,
      status: complete ? "complete" : "in_progress",
      extraction_status: complete ? "validated" : "needs_review",
    },
    facts: [
      ...facts.filter((f) => !f.source_ref.startsWith("interview.")),
      ...newFacts,
      ...valueFacts,
    ],
    ready_for_matching:
      complete &&
      essentials?.status === "confirmed" &&
      essentials.essential_missing?.length === 0 &&
      essentials.declined?.length === 0 &&
      !hasAmbiguity,
  };
}
