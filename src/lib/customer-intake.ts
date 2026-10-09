import { supabase } from "@/integrations/supabase/client";
import type { Onboarding } from "../../supabase/functions/_shared/intake";
export type IntakeStatus = {
  onboarding: {
    draft: Partial<Onboarding>;
    confirmed_data: Onboarding | null;
    confirmed_version: number | null;
  } | null;
  version: number;
  session: {
    id: string;
    status: string;
    failure_code: string | null;
    provider_deleted_at: string | null;
  } | null;
  enabled: boolean;
  interview_complete: boolean;
  verified_phone: string | null;
};
export async function intakeRequest<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("customer-intake", { body });
  if (error) {
    const context = error.context as Response | undefined;
    const payload = await context?.json().catch(() => null);
    const code = payload?.error;
    const messages: Record<string, string> = {
      profile_changed: "Your profile changed in another tab. Reload and review your answers.",
      rate_limited:
        "Please wait before requesting another call. There is a limit of three attempts per day.",
      phone_not_verified: "Verify this phone number before requesting a call.",
      onboarding_required: "Review and confirm your current answers before requesting a call.",
      calls_disabled: "Calls are not available yet. Your answers are saved.",
      configuration_missing: "Calls are not available yet. Your answers are saved.",
    };
    throw new Error(messages[code] ?? "We couldn't save that request. Please try again.");
  }
  return data as T;
}
