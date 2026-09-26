import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Brand } from "./Brand";

export function AppHeader() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }
  return (
    <header className="mx-auto flex max-w-4xl items-center justify-between px-6 py-6">
      <Brand />
      <button onClick={signOut} className="rounded-full border px-4 py-2 text-sm hover:bg-muted">
        Sign out
      </button>
    </header>
  );
}
