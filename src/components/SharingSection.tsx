import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Json } from "@/integrations/supabase/types";
import { saveMyProfile } from "@/lib/profile";

type ShareTier = "shareable" | "abstract_only" | "never_share";

type Row = {
  key: string;
  section: "preferences" | "interview";
  list: "items" | "values";
  index: number;
  label: string;
  privateHint: string;
  share: ShareTier;
  shareAs: string;
};

type JsonObject = { [key: string]: Json | undefined };

function asObject(v: Json | undefined): JsonObject {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}

function asArray(v: Json | undefined): JsonObject[] {
  return Array.isArray(v) ? v.map((x) => asObject(x)) : [];
}

function str(v: Json | undefined): string {
  return typeof v === "string" ? v : "";
}

function tier(v: Json | undefined): ShareTier {
  return v === "shareable" || v === "abstract_only" ? v : "never_share";
}

const TOPIC_LABELS: Record<string, string> = {
  relationship_goal: "Relationship goal",
  children: "Children",
  partner_existing_children: "Partner's children",
  location: "Location",
  relocation: "Relocation",
  age_range: "Age range",
  faith: "Faith",
  substances: "Smoking and drinking",
  monogamy: "Monogamy",
  money: "Money",
  career: "Career",
  family: "Family",
  social: "Social life",
  politics: "Politics",
  pace: "Pace",
  other: "Other",
};

function readRows(record: Json | null | undefined): Row[] {
  const root = asObject(record ?? undefined);
  const items = asArray(asObject(root["preferences"])["items"]);
  const values = asArray(asObject(root["interview"])["values"]);

  const itemRows = items.map((it, index): Row => {
    const topic = str(it["topic"]);
    const base = TOPIC_LABELS[topic] ?? "Preference";
    return {
      key: `p-${index}`,
      section: "preferences",
      list: "items",
      index,
      label: it["bucket"] === "red_flag" ? `Red flag · ${base}` : base,
      privateHint: str(it["user_words"]) || str(it["value"]),
      share: tier(it["share"]),
      shareAs: str(it["share_as"]),
    };
  });

  const valueRows = values.map((v, index): Row => ({
    key: `v-${index}`,
    section: "interview",
    list: "values",
    index,
    label: "Values",
    privateHint: [str(v["chose"]), str(v["over"])].filter(Boolean).join(" over "),
    share: tier(v["share"]),
    shareAs: str(v["share_as"]),
  }));

  return [...itemRows, ...valueRows];
}

// The source item's path as the intake agent writes it in a fact's `source_ref`,
// e.g. "preferences.items[3]" or "interview.values[0]".
function sourceRef(r: Row): string {
  return `${r.section}.${r.list}[${r.index}]`;
}

function applyRows(record: Json | null | undefined, rows: Row[], original: Row[]): Json {
  const root = structuredClone(asObject(record ?? undefined));
  const facts = Array.isArray(root["facts"]) ? (root["facts"] as Json[]) : null;
  const changed = rows.filter((r, i) => {
    const o = original[i];
    return o && (o.share !== r.share || o.shareAs !== r.shareAs);
  });
  for (const r of changed) {
    const share = r.share;
    const shareAs = share === "never_share" ? "" : r.shareAs.trim();

    const section = asObject(root[r.section]);
    const list = Array.isArray(section[r.list]) ? (section[r.list] as Json[]) : [];
    const entry = asObject(list[r.index]);
    list[r.index] = { ...entry, share, share_as: shareAs, member_edited: true };
    section[r.list] = list;
    root[r.section] = section;

    // Keep the judge's fact list in step: the primary fact for this source
    // carries the member's sharing choice.
    if (facts) {
      const ref = sourceRef(r);
      for (let i = 0; i < facts.length; i++) {
        const fact = asObject(facts[i]);
        if (fact["source_ref"] === ref && fact["primary"] === true) {
          facts[i] = { ...fact, share, share_as: shareAs };
        }
      }
    }
  }
  if (facts) root["facts"] = facts;
  return root;
}

export function SharingSection({
  userId,
  proxyRecord,
}: {
  userId: string;
  proxyRecord: Json | null | undefined;
}) {
  const qc = useQueryClient();
  const original = useMemo(() => readRows(proxyRecord), [proxyRecord]);
  const [rows, setRows] = useState<Row[]>(original);
  const [saved, setSaved] = useState(false);

  useEffect(() => setRows(original), [original]);

  const dirty = rows.some(
    (r, i) => r.share !== original[i]?.share || r.shareAs !== original[i]?.shareAs,
  );
  const invalid = rows.some((r) => r.share !== "never_share" && !r.shareAs.trim());

  const save = useMutation({
    mutationFn: () =>
      saveMyProfile(userId, { proxy_record: applyRows(proxyRecord, rows, original) }),
    onSuccess: async () => {
      setSaved(true);
      await qc.invalidateQueries({ queryKey: ["profile", userId] });
    },
  });

  function update(key: string, patch: Partial<Row>) {
    setSaved(false);
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  const shown = rows.filter((r) => r.share !== "never_share");
  const hidden = rows.filter((r) => r.share === "never_share");

  return (
    <section className="mt-10 rounded-3xl border bg-card p-8">
      <span className="eyebrow text-muted-foreground">What matches see</span>
      <h2 className="font-display mt-3 text-3xl">How we describe you to matches</h2>
      <p className="mt-3 max-w-[60ch] text-sm text-muted-foreground">
        Potential matches only ever see the phrases below. Reword anything, or keep it private. Your
        matchmaker won't change what you edit here.
      </p>

      {rows.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">
          Once you've talked to your matchmaker, you'll see exactly how you're described here.
        </p>
      ) : (
        <>
          <ul className="mt-6 space-y-3">
            {shown.length === 0 && (
              <li className="text-sm text-muted-foreground">Nothing is shared right now.</li>
            )}
            {shown.map((r) => (
              <li key={r.key} className="flex flex-wrap items-center gap-3">
                <span className="w-40 shrink-0 text-xs text-muted-foreground">{r.label}</span>
                <input
                  aria-label={`${r.label}: how matches see it`}
                  value={r.shareAs}
                  onChange={(e) => update(r.key, { shareAs: e.target.value })}
                  placeholder="How should matches see this?"
                  className="min-w-0 flex-1 rounded-xl border bg-background px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={() => update(r.key, { share: "never_share" })}
                  className="rounded-full border px-4 py-2 text-xs hover:bg-muted"
                >
                  Keep private
                </button>
              </li>
            ))}
          </ul>

          {hidden.length > 0 && (
            <div className="mt-8">
              <span className="eyebrow text-muted-foreground">Kept private</span>
              <p className="mt-2 text-xs text-muted-foreground">
                Used only to find good matches. Never shown to anyone.
              </p>
              <ul className="mt-4 space-y-3">
                {hidden.map((r) => (
                  <li key={r.key} className="flex flex-wrap items-center gap-3">
                    <span className="w-40 shrink-0 text-xs text-muted-foreground">{r.label}</span>
                    <span className="min-w-0 flex-1 truncate text-sm">{r.privateHint || "—"}</span>
                    <button
                      type="button"
                      onClick={() =>
                        update(r.key, {
                          share: r.list === "values" ? "abstract_only" : "shareable",
                        })
                      }
                      className="rounded-full border px-4 py-2 text-xs hover:bg-muted"
                    >
                      Share
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-8 flex flex-wrap items-center gap-4">
            <button
              type="button"
              disabled={!dirty || invalid || save.isPending}
              onClick={() => save.mutate()}
              className="rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground disabled:opacity-40"
            >
              {save.isPending ? "Saving…" : "Save changes"}
            </button>
            {invalid && (
              <span className="text-xs text-muted-foreground">
                Add a short description for each shared item, or keep it private.
              </span>
            )}
            {saved && !dirty && <span className="text-xs text-muted-foreground">Saved.</span>}
            {save.isError && (
              <span className="text-xs text-destructive">Couldn't save. Please try again.</span>
            )}
          </div>
        </>
      )}
    </section>
  );
}
