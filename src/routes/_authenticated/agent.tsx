import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AppHeader } from "@/components/AppHeader";
import { AGENT_OPENING, fetchAgentHistory, sendAgentMessage } from "@/lib/agent.functions";

export const Route = createFileRoute("/_authenticated/agent")({
  head: () => ({
    meta: [
      { title: "Your matchmaker — Hearth" },
      { name: "description", content: "Talk with your personal matchmaking agent." },
      { property: "og:title", content: "Your matchmaker — Hearth" },
      { property: "og:description", content: "Talk with your personal matchmaking agent." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AgentPage,
});

type Msg = { role: "user" | "assistant"; content: string };

const OPENING = AGENT_OPENING;

function AgentPage() {
  const send = useServerFn(sendAgentMessage);
  const loadHistory = useServerFn(fetchAgentHistory);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadHistory()
      .then((h) =>
        setMessages(
          h.length
            ? h.map(({ role, content }) => ({ role, content }))
            : [{ role: "assistant", content: OPENING }],
        ),
      )
      .catch(() => setMessages([{ role: "assistant", content: OPENING }]))
      .finally(() => setLoaded(true));
  }, [loadHistory]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: text }]);
    setBusy(true);
    try {
      const { reply } = await send({ data: { message: text } });
      setMessages((m) => [...m, { role: "assistant", content: reply }]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong — try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <AppHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 pb-6">
        <div className="py-6">
          <span className="eyebrow text-primary">Your matchmaker</span>
          <p className="mt-2 text-sm text-muted-foreground">
            A short conversation to start — about ten minutes. Your answers stay private to your
            agent.
          </p>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto rounded-3xl border bg-card p-5">
          {!loaded && <p className="text-sm text-muted-foreground">Loading your conversation…</p>}
          {messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div
                className={
                  m.role === "user"
                    ? "max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-wine px-4 py-3 text-sm text-wine-foreground"
                    : "max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-muted px-4 py-3 text-sm"
                }
              >
                {m.content}
              </div>
            </div>
          ))}
          {busy && (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-sm bg-muted px-4 py-3 text-sm text-muted-foreground">
                Thinking…
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <form onSubmit={submit} className="mt-4 flex gap-3">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Write your answer…"
            className="flex-1 rounded-full border bg-background px-5 py-3 text-sm outline-none focus:ring-2 focus:ring-primary/40"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            Send
          </button>
        </form>
      </main>
    </div>
  );
}
