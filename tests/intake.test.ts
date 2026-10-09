import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  buildPreferences,
  essentialFields,
  onboardingSchema,
  normalizePhone,
  interviewPatch,
  validateExtraction,
  type Extraction,
  type Onboarding,
} from "../supabase/functions/_shared/intake";
import { secretMatches } from "../supabase/functions/_shared/runtime";
import { agentPayload, voiceInstructions } from "../scripts/cartesia-intake";

export const sample: Onboarding = {
  full_name: "Test Customer",
  phone: "+1 (415) 555-0123",
  date_of_birth: "1990-01-01",
  location: "Seattle, Washington, United States",
  timezone: "America/Los_Angeles",
  open_ask: "No smokers",
  early_signs: "Blaming everyone else",
  essentials: Object.fromEntries(
    essentialFields.map(([k, , options]) => [k, options[0] ?? "woman"]),
  ),
  age_min: 25,
  age_max: 40,
  items: [
    {
      id: "12345678-1234-4234-8234-123456789012",
      topic: "substances",
      text: "No smokers",
      bucket: "dealbreaker",
      about: "partner",
    },
  ],
  confirmed: true,
};
const transcript = [
  { role: "assistant" as const, text: "Do you consent?" },
  { role: "user" as const, text: "Yes, I consent." },
  { role: "user" as const, text: "I apologized and we spoke calmly." },
  { role: "user" as const, text: "Yes, that summary is right." },
];
export const result: Extraction = {
  values: [],
  conflict_style: {
    raises_issues: "",
    first_response: "",
    repair: "",
    ownership: "",
    evidence: [],
  },
  conversation_hooks: [],
  consent: "confirmed",
  consent_evidence: [{ turn: 1, quote: "Yes, I consent." }],
  readback_confirmed: true,
  readback_evidence: [{ turn: 3, quote: "Yes, that summary is right." }],
  answers: ["breakup", "conflict", "values"].map((question) => ({
    question: question as "breakup" | "conflict" | "values",
    event_summary: "Apologized and spoke calmly",
    own_part: "Apologized",
    coverage: "partial",
    evidence: [{ turn: 2, quote: "I apologized and we spoke calmly." }],
  })),
  contradictions: [],
  unanswered_topics: [],
};

describe("deterministic onboarding", () => {
  test("normalizes only explicit international numbers", () => {
    expect(normalizePhone(sample.phone)).toBe("+14155550123");
    expect(() => normalizePhone("4155550123")).toThrow();
    expect(() => normalizePhone("+14155550123 ext 2")).toThrow();
  });
  test("requires adulthood, real dates, complete essentials and explicit confirmation", () => {
    expect(onboardingSchema.safeParse(sample).success).toBe(true);
    for (const patch of [
      { date_of_birth: "2020-01-01" },
      { date_of_birth: "1990-02-30" },
      { essentials: {} },
      { confirmed: false },
      { timezone: "Moon/Base" },
      { age_min: 50, age_max: 30 },
    ])
      expect(onboardingSchema.safeParse({ ...sample, ...patch }).success).toBe(false);
  });
  test("one private primary fact per confirmed preference, stable IDs on edit", () => {
    const a = buildPreferences(onboardingSchema.parse(sample));
    const b = buildPreferences(
      onboardingSchema.parse({
        ...sample,
        items: [{ ...sample.items[0]!, text: "No regular smokers" }],
      }),
      a,
    );
    expect(a.facts.length).toBe(a.preferences.items.length);
    expect(a.facts.every((f) => f.primary && f.share === "never_share")).toBe(true);
    expect(b.facts.at(-1)?.id).toBe(a.facts.at(-1)?.id);
    expect(b.facts.at(-1)?.statement).toContain("No regular smokers");
    expect(b.ready_for_matching).toBe(false);
  });
});
describe("extraction boundaries", () => {
  test("rejects invented evidence and assistant quotes", () => {
    expect(() =>
      validateExtraction(
        { ...result, consent_evidence: [{ turn: 1, quote: "something invented" }] },
        transcript,
      ),
    ).toThrow();
    expect(() =>
      validateExtraction(
        { ...result, consent_evidence: [{ turn: 0, quote: "Do you consent?" }] },
        transcript,
      ),
    ).toThrow();
    expect(() => validateExtraction({ ...result, readback_evidence: [] }, transcript)).toThrow();
  });
  test("preserves preference bytes and facts while deriving completeness", () => {
    const record = buildPreferences(onboardingSchema.parse(sample));
    const patch = interviewPatch(validateExtraction(result, transcript), record, "session");
    expect(patch.preferences).toEqual(record.preferences);
    expect(patch.facts.slice(0, record.facts.length)).toEqual(record.facts);
    expect(patch.ready_for_matching).toBe(true);
    expect(
      patch.facts
        .slice(record.facts.length)
        .every((f) => f.bucket === null && f.share === "never_share"),
    ).toBe(true);
  });
  test("incomplete core answers, unconfirmed readback or unresolved essentials block readiness", () => {
    const record = buildPreferences(onboardingSchema.parse(sample));
    expect(
      interviewPatch({ ...result, answers: result.answers.slice(1) }, record, "s")
        .ready_for_matching,
    ).toBe(false);
    expect(
      interviewPatch({ ...result, readback_confirmed: false }, record, "s").ready_for_matching,
    ).toBe(false);
    const uncertain = buildPreferences(
      onboardingSchema.parse({
        ...sample,
        essentials: { ...sample.essentials, children: "not_sure" },
      }),
    );
    expect(interviewPatch(result, uncertain, "s").ready_for_matching).toBe(false);
  });
  test("behavioral values get private primary facts with verified evidence", () => {
    const evidence = [{ turn: 2, quote: "I apologized and we spoke calmly." }];
    const extracted = validateExtraction(
      {
        ...result,
        values: [{ chose: "repair", over: "avoiding an apology", evidence }],
        conflict_style: { ...result.conflict_style, repair: "Apologized", evidence },
      },
      transcript,
    );
    const record = buildPreferences(onboardingSchema.parse(sample));
    const patch = interviewPatch(extracted, record, "s");
    const facts = patch.facts.filter((f) => f.source_ref === "interview.values[0]");
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ primary: true, share: "never_share", label: "self_event" });
    expect(patch.interview.conflict_style.repair).toBe("Apologized");
    expect(patch.fact_id_high_watermark).toBeGreaterThan(record.fact_id_high_watermark);
  });
  test("auth rejects missing, prefix and wrong secrets", async () => {
    expect(await secretMatches(null, "secret")).toBe(false);
    expect(await secretMatches("secret-extra", "secret")).toBe(false);
    expect(await secretMatches("wrong", "secret")).toBe(false);
    expect(await secretMatches("secret", "secret")).toBe(true);
  });
});
test("voice config is derived from canonical Session B and changes version with prompt", () => {
  const canonical = readFileSync(
    new URL("../src/lib/intake-agent-prompt.md", import.meta.url),
    "utf8",
  );
  const a = agentPayload(canonical, "tool", "voice", "model");
  expect(a.payload.config.instructions).toContain("What did you learn from your last breakup?");
  expect(a.payload.config.instructions).not.toContain("## Session A");
  expect(a.payload.config.instructions).not.toContain("## Output");
  expect(a.version).not.toBe(
    agentPayload(canonical.replace("last breakup", "last relationship"), "tool", "voice", "model")
      .version,
  );
  expect(() => voiceInstructions("changed format")).toThrow();
});
