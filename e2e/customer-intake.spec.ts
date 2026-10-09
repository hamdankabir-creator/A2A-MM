import { test, expect } from "@playwright/test";
import {
  essentialFields,
  CONSENT_TEXT,
  buildPreferences,
  onboardingSchema,
} from "../supabase/functions/_shared/intake";

test("customer confirms preferences, explicitly consents, calls once and withdraws", async ({
  page,
}) => {
  const user = {
    id: "11111111-1111-4111-8111-111111111111",
    email: "synthetic@example.test",
    phone: "14155550123",
    phone_confirmed_at: "2026-01-01T00:00:00Z",
    aud: "authenticated",
    role: "authenticated",
    app_metadata: { provider: "email" },
    user_metadata: {},
  };
  const token = [
    btoa(JSON.stringify({ alg: "HS256", typ: "JWT" })),
    btoa(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 })),
    "test",
  ].join(".");
  await page.addInitScript(
    ({ user, token }) =>
      localStorage.setItem(
        "sb-heimdall-test-auth-token",
        JSON.stringify({
          access_token: token,
          refresh_token: "synthetic",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          token_type: "bearer",
          user,
        }),
      ),
    { user, token },
  );
  let draft: Record<string, unknown> = {};
  let confirmed: Record<string, unknown> | null = null;
  let version = 1;
  let calls = 0;
  let session: { id: string; status: string; provider_deleted_at: null } | null = null;
  await page.route("https://heimdall-test.supabase.co/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/auth/v1/user") return route.fulfill({ json: user });
    if (path === "/rest/v1/profiles")
      return route.fulfill({
        json: {
          id: user.id,
          full_name: "Test Customer",
          completed: Boolean(confirmed),
          onboarding_step: confirmed ? 4 : 0,
          proxy_record: confirmed ? buildPreferences(onboardingSchema.parse(confirmed)) : {},
          core_values: [],
        },
      });
    if (path === "/functions/v1/customer-intake") {
      const body = route.request().postDataJSON();
      if (body.action === "status")
        return route.fulfill({
          json: {
            onboarding: {
              draft,
              confirmed_data: confirmed,
              confirmed_version: confirmed ? version : null,
            },
            version,
            session,
            enabled: true,
            verified_phone: user.phone,
          },
        });
      if (body.action === "draft") {
        draft = body.draft;
        return route.fulfill({ json: { saved: true } });
      }
      if (body.action === "confirm") {
        confirmed = body.data;
        version++;
        return route.fulfill({ json: { version } });
      }
      if (body.action === "call") {
        expect(body.consent).toBe(true);
        calls++;
        session = {
          id: "33333333-3333-4333-8333-333333333333",
          status: "dialing",
          provider_deleted_at: null,
        };
        return route.fulfill({ json: { sessionId: session.id, status: "dialing" } });
      }
      if (body.action === "withdraw") {
        session!.status = "consent_withdrawn";
        return route.fulfill({ json: { saved: true } });
      }
    }
    return route.fulfill({ status: 404, json: { error: "unmocked request" } });
  });
  await page.goto("/onboarding");
  await page
    .getByLabel("In your own words", { exact: false })
    .fill("I need a nonsmoker and someone who wants children.");
  await page.getByLabel("What early signs", { exact: false }).fill("Blaming every ex.");
  await page.getByRole("button", { name: "Save & continue" }).click();
  await page.getByLabel("Your name", { exact: true }).fill("Test Customer");
  await page.getByLabel("Mobile number", { exact: false }).fill("+14155550123");
  await page.getByLabel("Date of birth", { exact: false }).fill("1990-01-01");
  await page.getByLabel("City, state", { exact: false }).fill("Seattle, Washington, United States");
  for (const [key, , options] of essentialFields) {
    if (options.length) await page.locator(`#${key}`).selectOption(options[0]!);
    else await page.locator(`#${key}`).fill(key === "faith_tradition" ? "Christian" : "woman");
  }
  await page.getByRole("button", { name: "Save & continue" }).click();
  await page.getByRole("button", { name: "Add dealbreakers" }).click();
  await page.getByLabel("Dealbreakers requirement").fill("No smokers");
  await page.getByRole("button", { name: "Add red flags" }).click();
  await page.getByLabel("Red flags requirement").fill("Blaming every ex");
  await page.getByRole("button", { name: "Save & continue" }).click();
  await expect(page.getByRole("button", { name: "Confirm my profile" })).toBeDisabled();
  await expect(page.getByText("No smokers (partner)")).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Confirm my profile" }).click();
  await page.waitForURL("**/dashboard");
  await expect(page.locator("dd").filter({ hasText: "No smokers" })).toBeVisible();
  await expect(page.getByText("Blaming every ex", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Call me now" })).toBeDisabled();
  await page.getByLabel(CONSENT_TEXT).check();
  await page.getByRole("button", { name: "Call me now" }).click();
  await expect(page.getByRole("status")).toContainText("Calling your phone");
  expect(calls).toBe(1);
  await expect(page.getByRole("button", { name: "Call me now" })).toHaveCount(0);
  await page.getByRole("button", { name: "Withdraw consent and delete this call" }).click();
  await expect(page.getByRole("status")).toContainText("consent was withdrawn");
  expect(calls).toBe(1);
});
