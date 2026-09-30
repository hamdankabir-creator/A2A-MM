// Builds one member's fact list for the compatibility judge
// (src/lib/compatibility-judge-prompt.md).
//
// The intake agent stores date of birth, not age, and the judge has no way to
// know today's date. So at match time the app:
// - adds a fact with the member's current age, computed here,
// - drops the date-of-birth facts, so the judge never does date arithmetic,
// - prefixes every fact id, and every id in `derived_from`, with `a:` or `b:`.

export type JudgeFact = {
  id: string;
  statement: string;
  about: "self" | "partner";
  dimension: "constraints" | "values" | "conflict" | "trajectory" | "lifestyle";
  label: "self_event" | "self_description" | "observed" | "interpreted";
  bucket: "dealbreaker" | "must_have" | "nice_to_have" | "red_flag" | null;
  derived_from: string[];
  source_ref: string;
  primary: boolean;
  share: "shareable" | "abstract_only" | "never_share";
  share_as: string;
};

type PreferenceItem = { topic?: unknown; about?: unknown; value?: unknown };
type ProxyRecord = {
  preferences?: { items?: PreferenceItem[] };
  facts?: JudgeFact[];
};

export const AGE_FACT_ID = "age";
export const AGE_SOURCE_REF = "profile.date_of_birth";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whole years between an ISO date of birth (YYYY-MM-DD) and `today`, in UTC. */
export function ageOn(dateOfBirth: string, today: Date): number | null {
  const m = ISO_DATE.exec(dateOfBirth.trim());
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dob = new Date(Date.UTC(year, month - 1, day));
  if (dob.getUTCMonth() !== month - 1 || dob.getUTCDate() !== day) return null;
  let age = today.getUTCFullYear() - year;
  const beforeBirthday =
    today.getUTCMonth() < month - 1 ||
    (today.getUTCMonth() === month - 1 && today.getUTCDate() < day);
  if (beforeBirthday) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

function dateOfBirthItemIndexes(record: ProxyRecord): Set<number> {
  const indexes = new Set<number>();
  (record.preferences?.items ?? []).forEach((item, i) => {
    if (item?.topic === "date_of_birth") indexes.add(i);
  });
  return indexes;
}

/**
 * The member's date of birth: the profile form's column first, then the
 * intake agent's `date_of_birth` preference item.
 */
export function resolveDateOfBirth(
  profileDateOfBirth: string | null | undefined,
  record: ProxyRecord,
): string | null {
  if (profileDateOfBirth && ISO_DATE.test(profileDateOfBirth.trim()))
    return profileDateOfBirth.trim();
  const item = (record.preferences?.items ?? []).find((i) => i?.topic === "date_of_birth");
  return typeof item?.value === "string" && ISO_DATE.test(item.value.trim())
    ? item.value.trim()
    : null;
}

export function buildJudgeFacts(
  record: ProxyRecord,
  dateOfBirth: string | null,
  side: "a" | "b",
  today: Date = new Date(),
): JudgeFact[] {
  const dobRefs = new Set(
    [...dateOfBirthItemIndexes(record)].map((i) => `preferences.items[${i}]`),
  );
  const prefix = (id: string) => `${side}:${id}`;

  const facts: JudgeFact[] = (record.facts ?? [])
    .filter((f) => !dobRefs.has(f.source_ref))
    .map((f) => ({
      ...f,
      id: prefix(f.id),
      derived_from: (f.derived_from ?? []).map(prefix),
    }));

  const age = dateOfBirth ? ageOn(dateOfBirth, today) : null;
  if (age !== null) {
    facts.push({
      id: prefix(AGE_FACT_ID),
      statement: `Is ${age} years old`,
      about: "self",
      dimension: "constraints",
      label: "self_event",
      bucket: null,
      derived_from: [],
      source_ref: AGE_SOURCE_REF,
      primary: false,
      share: "shareable",
      share_as: `${age}`,
    });
  }
  // With no valid date of birth there is no age fact; the judge then lists a
  // partner's age-range dealbreaker as an open question instead of passing it.
  return facts;
}
