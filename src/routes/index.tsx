import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getMailConnection,
  startMailConnect,
  completeMailConnect,
  disconnectMail,
  listMail,
  readMail,
} from "@/lib/mail.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Perch Mail — a calm, read-only inbox for your mail" },
      {
        name: "description",
        content:
          "Perch Mail is a lightweight webmail reader for people who can't use Gmail's interface. Connect your mailbox with explicit consent and read it — nothing is ever sent or deleted.",
      },
      { property: "og:title", content: "Perch Mail — a calm, read-only inbox" },
      {
        property: "og:description",
        content:
          "Read your mailbox in a fast, distraction-free client. Read-only by design, connected only with your consent.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const FOLDERS = [
  { id: "INBOX", label: "Inbox", q: "" },
  { id: "", label: "Unread", q: "is:unread" },
  { id: "STARRED", label: "Starred", q: "" },
  { id: "SENT", label: "Sent", q: "" },
  { id: "", label: "All mail", q: "" },
];

function waitForOAuthCompletion(popup: Window) {
  return new Promise<string | null>((resolve, reject) => {
    let poll: number | undefined;
    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      if (poll !== undefined) window.clearInterval(poll);
    };
    const onMessage = (event: MessageEvent) => {
      const type = event.data?.type;
      if (
        event.origin !== window.location.origin ||
        event.source !== popup ||
        event.data?.connectorId !== "google_mail" ||
        (type !== "appUserConnectorOAuthComplete" && type !== "appUserConnectorOAuthFailed")
      )
        return;
      cleanup();
      if (type === "appUserConnectorOAuthComplete") {
        resolve(typeof event.data?.code === "string" ? event.data.code : null);
        return;
      }
      popup.close();
      reject(new Error("Consent was not granted."));
    };
    window.addEventListener("message", onMessage);
    poll = window.setInterval(() => {
      if (!popup.closed) return;
      cleanup();
      reject(new Error("The consent window closed before finishing."));
    }, 500);
  });
}

function Index() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [loading, user, navigate]);

  if (loading || !user) {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{ background: "var(--gradient-canvas)" }}
      >
        <p className="text-sm text-muted-foreground">Loading Perch Mail…</p>
      </div>
    );
  }

  return <Mailbox email={user.email ?? ""} />;
}

function Mailbox({ email }: { email: string }) {
  const queryClient = useQueryClient();
  const connectionFn = useServerFn(getMailConnection);
  const startFn = useServerFn(startMailConnect);
  const completeFn = useServerFn(completeMailConnect);
  const disconnectFn = useServerFn(disconnectMail);
  const listFn = useServerFn(listMail);
  const readFn = useServerFn(readMail);

  const [folder, setFolder] = useState(0);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const connection = useQuery({
    queryKey: ["mail-connection"],
    queryFn: () => connectionFn(),
  });

  const connected = connection.data?.connected === true;
  const active = FOLDERS[folder]!;
  const effectiveQuery = [active.q, query].filter(Boolean).join(" ");

  const messages = useQuery({
    queryKey: ["mail-list", active.label, effectiveQuery],
    enabled: connected,
    queryFn: () =>
      listFn({
        data: {
          ...(active.id ? { labelId: active.id } : {}),
          ...(effectiveQuery ? { q: effectiveQuery } : {}),
        },
      }),
  });

  const message = useQuery({
    queryKey: ["mail-message", selectedId],
    enabled: Boolean(selectedId),
    queryFn: () => readFn({ data: { id: selectedId! } }),
  });

  const connect = useMutation({
    mutationFn: async () => {
      const popup = window.open("", "perch-mail-oauth", "width=600,height=720");
      if (!popup) throw new Error("Popup blocked. Allow popups and try again.");
      let code: string | null;
      try {
        const { authorizationUrl } = await startFn();
        const completion = waitForOAuthCompletion(popup);
        popup.location.href = authorizationUrl;
        code = await completion;
      } catch (error) {
        popup.close();
        throw error;
      }
      if (code) await completeFn({ data: { code } });
    },
    onSuccess: () => {
      toast.success("Mailbox connected — read-only access granted.");
      queryClient.invalidateQueries();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const disconnect = useMutation({
    mutationFn: () => disconnectFn(),
    onSuccess: () => {
      setSelectedId(null);
      toast.success("Access revoked. Perch can no longer read your mail.");
      queryClient.invalidateQueries();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="min-h-screen" style={{ background: "var(--gradient-canvas)" }}>
      <header className="border-b border-border/70 bg-card/70 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-accent" />
            <span className="font-display text-2xl tracking-tight">Perch Mail</span>
            <span className="ml-2 rounded-full border border-border px-2 py-0.5 text-[11px] uppercase tracking-widest text-muted-foreground">
              read-only
            </span>
          </div>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span className="hidden sm:inline">{email}</span>
            {connected && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => disconnect.mutate()}
                disabled={disconnect.isPending}
              >
                Revoke mailbox access
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => supabase.auth.signOut()}>
              Sign out
            </Button>
          </div>
        </div>
      </header>

      {connection.isLoading ? (
        <div className="mx-auto max-w-7xl px-5 py-12">
          <Skeleton className="h-40 w-full rounded-2xl" />
        </div>
      ) : !connected ? (
        <ConsentPanel onConnect={() => connect.mutate()} busy={connect.isPending} />
      ) : (
        <main className="mx-auto grid max-w-7xl gap-5 px-5 py-6 lg:grid-cols-[190px_360px_1fr]">
          <nav className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
            {FOLDERS.map((f, i) => (
              <button
                key={f.label}
                onClick={() => {
                  setFolder(i);
                  setSelectedId(null);
                }}
                className={`whitespace-nowrap rounded-xl px-4 py-2 text-left text-sm transition-colors ${
                  i === folder
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-secondary"
                }`}
              >
                {f.label}
              </button>
            ))}
            <p className="hidden pt-4 text-xs leading-relaxed text-muted-foreground lg:block">
              Connected as {connection.data?.accountEmail ?? "your mailbox"}. Perch can read, never
              send, delete or edit.
            </p>
          </nav>

          <section
            className="overflow-hidden rounded-2xl border border-border bg-card"
            style={{ boxShadow: "var(--shadow-panel)" }}
          >
            <form
              className="flex gap-2 border-b border-border p-3"
              onSubmit={(e) => {
                e.preventDefault();
                setQuery(search.trim());
                setSelectedId(null);
              }}
            >
              <Input
                placeholder="Search your mail…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <Button type="submit" size="sm" variant="secondary">
                Search
              </Button>
            </form>

            <div className="max-h-[70vh] divide-y divide-border overflow-y-auto">
              {messages.isLoading &&
                Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="space-y-2 p-4">
                    <Skeleton className="h-3 w-1/3" />
                    <Skeleton className="h-3 w-2/3" />
                  </div>
                ))}
              {messages.isError && (
                <p className="p-6 text-sm text-destructive">
                  Couldn't load this folder. Try reconnecting your mailbox.
                </p>
              )}
              {messages.data?.messages.length === 0 && (
                <p className="p-6 text-sm text-muted-foreground">Nothing here.</p>
              )}
              {messages.data?.messages.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setSelectedId(m.id)}
                  className={`block w-full px-4 py-3 text-left transition-colors ${
                    selectedId === m.id ? "bg-secondary" : "hover:bg-muted"
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span
                      className={`truncate text-sm ${m.unread ? "font-semibold text-foreground" : "text-muted-foreground"}`}
                    >
                      {m.fromName}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {formatDate(m.date)}
                    </span>
                  </div>
                  <p
                    className={`truncate text-sm ${m.unread ? "font-medium text-foreground" : "text-foreground/80"}`}
                  >
                    {m.subject}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{m.snippet}</p>
                </button>
              ))}
            </div>
          </section>

          <section
            className="min-h-[50vh] rounded-2xl border border-border bg-card p-6"
            style={{ boxShadow: "var(--shadow-panel)" }}
          >
            {!selectedId ? (
              <p className="text-sm text-muted-foreground">Select a message to read it.</p>
            ) : message.isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-40 w-full" />
              </div>
            ) : message.isError ? (
              <p className="text-sm text-destructive">Couldn't open this message.</p>
            ) : message.data ? (
              <article>
                <h1 className="font-display text-3xl leading-snug">{message.data.subject}</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  {message.data.from} · {formatDate(message.data.date)}
                </p>
                <p className="text-xs text-muted-foreground">To: {message.data.to}</p>
                <div className="mt-6 border-t border-border pt-6">
                  {message.data.html ? (
                    <iframe
                      title={message.data.subject}
                      sandbox=""
                      srcDoc={message.data.html}
                      className="h-[60vh] w-full rounded-xl border border-border bg-background"
                    />
                  ) : (
                    <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground">
                      {message.data.text}
                    </pre>
                  )}
                </div>
              </article>
            ) : null}
          </section>
        </main>
      )}
    </div>
  );
}

function ConsentPanel({ onConnect, busy }: { onConnect: () => void; busy: boolean }) {
  return (
    <main className="mx-auto max-w-3xl px-5 py-16">
      <div
        className="rounded-2xl border border-border bg-card p-10"
        style={{ boxShadow: "var(--shadow-panel)" }}
      >
        <h1 className="font-display text-4xl leading-tight">Read your mail, on your terms</h1>
        <p className="mt-4 text-base leading-relaxed text-muted-foreground">
          Perch Mail is a lightweight reader for people whose usual mail app is blocked, slow, or
          impossible to sync. Nothing happens until you grant consent — and the access you grant is
          strictly read-only.
        </p>
        <ul className="mt-8 space-y-3 text-sm text-foreground">
          <li className="flex gap-3">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
            Perch requests read-only permission. It cannot send, reply, delete, or label anything.
          </li>
          <li className="flex gap-3">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
            Your mail is fetched on demand and never copied into our database.
          </li>
          <li className="flex gap-3">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
            You can revoke access at any moment, from the header, in one click.
          </li>
        </ul>
        <Button className="mt-9" size="lg" onClick={onConnect} disabled={busy}>
          {busy ? "Waiting for your consent…" : "Grant read-only access"}
        </Button>
      </div>
    </main>
  );
}

function formatDate(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
