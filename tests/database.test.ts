import { beforeAll, afterAll, test, expect } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
const db = new PGlite();
const customer = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
async function query(sql: string, args: unknown[] = []) {
  return db.query(sql, args);
}
beforeAll(async () => {
  await db.exec(
    `create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}'); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`,
  );
  for (const file of readdirSync(new URL("../supabase/migrations/", import.meta.url)).sort())
    await db.exec(readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));
  await query("insert into auth.users(id) values($1),($2)", [customer, other]);
}, 30000);
afterAll(() => db.close());
async function reserve(key = crypto.randomUUID()) {
  return (
    await query(
      "select reserve_customer_interview($1,$2,'prompt','consent',(select screening_profile_version from profiles where id=$1)) as r",
      [customer, key],
    )
  ).rows[0]!.r as { created: boolean; session: { id: string } };
}
async function event(id: string, receipt: string, type = "call_completed", call = "call-1") {
  return query(
    'select ingest_customer_call($1,$2,$3,$4,\'hash\',\'[{"role":"user","text":"hello"}]\',now())',
    [id, call, receipt, type],
  );
}
let session: string;
test("atomic reservation reuses idempotency keys and forbids concurrent calls", async () => {
  const key = crypto.randomUUID();
  const a = await reserve(key);
  session = a.session.id;
  expect(a.created).toBe(true);
  expect((await reserve(key)).session.id).toBe(session);
  const attempts = await Promise.all([reserve(), reserve()]);
  expect(attempts.every((x) => !x.created && x.session.id === session)).toBe(true);
});
test("receipts and terminal state are idempotent across repeats and reordered events", async () => {
  await query("select record_customer_call_decision($1,'confirmed')", [session]);
  await query("select record_customer_call_decision($1,'readback_confirmed')", [session]);
  await event(session, "receipt-1");
  await event(session, "receipt-1");
  await event(session, "receipt-2");
  await event(session, "receipt-start", "call_started");
  expect(
    (await query("select count(*)::int as n from customer_interview_transcripts")).rows[0]!.n,
  ).toBe(1);
  expect(
    (await query("select status from customer_interview_sessions where id=$1", [session])).rows[0]!
      .status,
  ).toBe("processing");
  expect((await query("select count(*)::int as n from customer_interview_jobs")).rows[0]!.n).toBe(
    1,
  );
});
test("RLS isolates customer data and denies direct backend writes and RPCs", async () => {
  await db.exec(`set role authenticated; set request.jwt.claim.sub='${other}'`);
  expect((await query("select * from customer_interview_sessions")).rows.length).toBe(0);
  expect((await query("select * from customer_interview_transcripts")).rows.length).toBe(0);
  await expect(
    query("select reserve_customer_interview($1,$2,'p','c',1)", [other, crypto.randomUUID()]),
  ).rejects.toThrow("permission denied");
  await expect(query("update customer_interview_sessions set status='completed'")).rejects.toThrow(
    "permission denied",
  );
  await db.exec("reset role");
});
test("lease claims are exclusive and profile changes prevent extraction overwrite", async () => {
  const job = (await query("select claim_customer_interview_job() as j")).rows[0]!.j as {
    lease_token: string;
  };
  expect((await query("select claim_customer_interview_job() as j")).rows[0]!.j).toBeNull();
  await query(
    'update profiles set proxy_record=\'{"preferences":{"status":"confirmed"}}\' where id=$1',
    [customer],
  );
  await query("select finish_customer_interview($1,$2,'{}','{}')", [session, job.lease_token]);
  expect(
    (await query("select status from customer_interview_sessions where id=$1", [session])).rows[0]!
      .status,
  ).toBe("needs_review");
  expect(
    (await query("select proxy_record from profiles where id=$1", [customer])).rows[0]!
      .proxy_record,
  ).toEqual({ preferences: { status: "confirmed" } });
});
test("withdrawal deletes transcript and invalidates extraction lease", async () => {
  await query("select record_customer_call_decision($1,'withdrawn')", [session]);
  expect(
    (await query("select * from customer_interview_transcripts where session_id=$1", [session]))
      .rows.length,
  ).toBe(0);
  expect(
    (await query("select kind from customer_interview_jobs where session_id=$1", [session]))
      .rows[0]!.kind,
  ).toBe("delete");
  expect(
    (
      await query("select finish_customer_interview($1,$2,'{}','{}') as r", [
        session,
        crypto.randomUUID(),
      ])
    ).rows[0]!.r,
  ).toBe("withdrawn");
});

test("successful extraction commits once, preserves preferences, and advances confirmation version", async () => {
  await query("update customer_interview_jobs set status='done'");
  const record = {
    preferences: { status: "confirmed", items: [], essential_missing: [], declined: [] },
    facts: [],
    ready_for_matching: false,
  };
  await query("select save_customer_onboarding($1,$2,$3,1)", [
    other,
    JSON.stringify({
      full_name: "Other",
      date_of_birth: "1990-01-01",
      location: "City",
      essentials: { gender: "woman", seeking: "man" },
    }),
    JSON.stringify(record),
  ]);
  const r = (
    await query("select reserve_customer_interview($1,$2,'p','c',2) as r", [
      other,
      crypto.randomUUID(),
    ])
  ).rows[0]!.r as { session: { id: string } };
  const id = r.session.id;
  await query("select record_customer_call_decision($1,'confirmed')", [id]);
  await event(id, "receipt-success", "call_completed", "call-success");
  const job = (await query("select claim_customer_interview_job() as j")).rows[0]!.j as {
    lease_token: string;
  };
  await expect(
    query("select finish_customer_interview($1,$2,$3,'{}')", [
      id,
      job.lease_token,
      JSON.stringify({ ...record, preferences: { status: "changed" } }),
    ]),
  ).rejects.toThrow("preferences_changed");
  const updated = {
    ...record,
    interview: { session_id: id, status: "complete" },
    ready_for_matching: true,
  };
  await query("select finish_customer_interview($1,$2,$3,'{}')", [
    id,
    job.lease_token,
    JSON.stringify(updated),
  ]);
  expect(
    (
      await query("select finish_customer_interview($1,$2,$3,'{}') as r", [
        id,
        job.lease_token,
        JSON.stringify(updated),
      ])
    ).rows[0]!.r,
  ).toBe("lease_lost");
  expect(
    (await query("select screening_profile_version as v from profiles where id=$1", [other]))
      .rows[0]!.v,
  ).toBe(3);
  expect(
    (
      await query("select confirmed_version as v from customer_onboarding where customer_id=$1", [
        other,
      ])
    ).rows[0]!.v,
  ).toBe(3);
  await query("select record_customer_call_decision($1,'withdrawn')", [id]);
  const cleared = (await query("select proxy_record as r from profiles where id=$1", [other]))
    .rows[0]!.r as Record<string, unknown>;
  expect(cleared.interview).toBeUndefined();
  expect(cleared.ready_for_matching).toBe(false);
  expect(cleared.preferences).toEqual(record.preferences);
});

test("no verbal consent discards content and queues provider deletion", async () => {
  await query(
    "update customer_interview_sessions set created_at=now()-interval '2 minutes' where customer_id=$1",
    [other],
  );
  const r = (
    await query(
      "select reserve_customer_interview($1,$2,'p','c',(select screening_profile_version from profiles where id=$1)) as r",
      [other, crypto.randomUUID()],
    )
  ).rows[0]!.r as { session: { id: string } };
  await event(r.session.id, "receipt-no-consent", "call_completed", "call-no-consent");
  expect(
    (
      await query("select * from customer_interview_transcripts where session_id=$1", [
        r.session.id,
      ])
    ).rows.length,
  ).toBe(0);
  expect(
    (await query("select kind from customer_interview_jobs where session_id=$1", [r.session.id]))
      .rows[0]!.kind,
  ).toBe("delete");
});

test("withdrawing an unresolved dispatch does not permit another live call", async () => {
  const id = "33333333-3333-4333-8333-333333333333";
  await query("insert into auth.users(id) values($1)", [id]);
  const reserved = (
    await query("select reserve_customer_interview($1,$2,'p','c',1) as r", [
      id,
      crypto.randomUUID(),
    ])
  ).rows[0]!.r as { session: { id: string } };
  await query("select record_customer_call_decision($1,'withdrawn')", [reserved.session.id]);
  const retry = (
    await query("select reserve_customer_interview($1,$2,'p','c',1) as r", [
      id,
      crypto.randomUUID(),
    ])
  ).rows[0]!.r as { created: boolean; session: { id: string } };
  expect(retry.created).toBe(false);
  expect(retry.session.id).toBe(reserved.session.id);
});

test("withdrawing a rejected dispatch completes deletion without waiting for a nonexistent call", async () => {
  const id = "44444444-4444-4444-8444-444444444444";
  await query("insert into auth.users(id) values($1)", [id]);
  const reserved = (
    await query("select reserve_customer_interview($1,$2,'p','c',1) as r", [
      id,
      crypto.randomUUID(),
    ])
  ).rows[0]!.r as { session: { id: string } };
  await query("update customer_interview_sessions set status='rejected' where id=$1", [
    reserved.session.id,
  ]);
  await query("select record_customer_call_decision($1,'withdrawn')", [reserved.session.id]);
  expect(
    (
      await query("select provider_deleted_at from customer_interview_sessions where id=$1", [
        reserved.session.id,
      ])
    ).rows[0]!.provider_deleted_at,
  ).not.toBeNull();
  expect(
    (
      await query("select status from customer_interview_jobs where session_id=$1", [
        reserved.session.id,
      ])
    ).rows[0]!.status,
  ).toBe("done");
});
