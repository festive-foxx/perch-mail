import { callAsAppUser } from "@/integrations/lovable/appUserConnector";
import { encodeMailError, type MailErrorKind } from "@/lib/mailErrors";
import { getConnectionKeyForUser, MAIL_CONNECTOR_ID } from "./appUserConnections.server";

export const GATEWAY_BASE_URL = "https://connector-gateway.lovable.dev";

/** Read-only access: the app can never send, delete or modify anything. */
export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/gmail.readonly",
];

const MAX_ATTEMPTS = 3;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classify(status: number, body: string): { kind: MailErrorKind; message: string } {
  const lowered = body.toLowerCase();
  if (status === 401 || status === 403) {
    if (lowered.includes("insufficient authentication scopes")) {
      return {
        kind: "reauth",
        message:
          "Perch is missing the read permission for your mailbox. Reconnect to grant read-only access again.",
      };
    }
    return {
      kind: "reauth",
      message:
        "Your mail provider no longer accepts this connection — consent may have expired or been revoked. Reconnect to continue reading.",
    };
  }
  if (status === 404) {
    return { kind: "not_found", message: "This message was moved or deleted in your mailbox." };
  }
  if (status === 429) {
    return {
      kind: "rate_limited",
      message:
        "Your mail provider is limiting how fast we can read. Waiting a moment usually fixes it.",
    };
  }
  if (status >= 500) {
    return {
      kind: "unavailable",
      message: "Your mail provider didn't respond. This is usually brief — try again.",
    };
  }
  return {
    kind: "unknown",
    message: "Your mail provider rejected this request. Try again, or reconnect your mailbox.",
  };
}

async function gmailFetch(userId: string, path: string): Promise<any> {
  const connectionAPIKey = await getConnectionKeyForUser(userId, MAIL_CONNECTOR_ID);
  if (!connectionAPIKey) {
    throw encodeMailError({
      kind: "not_connected",
      message: "Connect your mailbox to start reading.",
    });
  }

  for (let attempt = 1; ; attempt += 1) {
    const res = await callAsAppUser({
      gatewayBaseUrl: GATEWAY_BASE_URL,
      connectionAPIKey,
      connectorId: MAIL_CONNECTOR_ID,
      path,
    });

    if (res.ok) return res.json();

    const body = await res.text();
    console.error(`Gmail request failed [${res.status}] ${path}: ${body.slice(0, 500)}`);
    const { kind, message } = classify(res.status, body);

    const retryAfterHeader = Number(res.headers.get("retry-after"));
    const retryAfter = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
      ? retryAfterHeader
      : undefined;

    const retryable = kind === "rate_limited" || kind === "unavailable";
    if (retryable && attempt < MAX_ATTEMPTS) {
      // Honour Retry-After when present, otherwise exponential backoff + jitter.
      const waitMs = retryAfter
        ? Math.min(retryAfter * 1000, 8000)
        : 400 * 2 ** (attempt - 1) + Math.random() * 250;
      await sleep(waitMs);
      continue;
    }

    throw encodeMailError({
      kind,
      message,
      ...(retryAfter ? { retryAfter } : {}),
    });
  }
}

/** Read message metadata in small waves so a big folder doesn't trip rate limits. */
async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    out.push(...(await Promise.all(items.slice(i, i + limit).map(fn))));
  }
  return out;
}

function header(headers: any[] | undefined, name: string): string {
  const found = (headers ?? []).find(
    (h) => String(h.name).toLowerCase() === name.toLowerCase(),
  );
  return found?.value ?? "";
}

function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function collectBody(payload: any, out: { html?: string; text?: string }) {
  if (!payload) return out;
  const mime = payload.mimeType ?? "";
  const data = payload.body?.data;
  if (data) {
    if (mime === "text/html" && !out.html) out.html = decodeBase64Url(data);
    if (mime === "text/plain" && !out.text) out.text = decodeBase64Url(data);
  }
  for (const part of payload.parts ?? []) collectBody(part, out);
  return out;
}

export interface MailSummary {
  id: string;
  threadId: string;
  from: string;
  fromName: string;
  subject: string;
  snippet: string;
  date: string;
  unread: boolean;
  starred: boolean;
  hasAttachment: boolean;
}

function displayName(from: string) {
  const match = from.match(/^\s*"?([^"<]*?)"?\s*</);
  const name = match?.[1]?.trim();
  if (name) return name;
  return from.replace(/[<>]/g, "").trim();
}

function hasAttachment(payload: any): boolean {
  if (!payload) return false;
  if (payload.filename) return true;
  return (payload.parts ?? []).some((p: any) => hasAttachment(p));
}

export async function getProfile(userId: string) {
  const data = await gmailFetch(userId, "/gmail/v1/users/me/profile");
  return {
    emailAddress: data.emailAddress as string,
    messagesTotal: data.messagesTotal as number,
  };
}

export async function listMessages(
  userId: string,
  opts: { labelId?: string; q?: string; pageToken?: string },
) {
  const params = new URLSearchParams({ maxResults: "25" });
  if (opts.labelId) params.set("labelIds", opts.labelId);
  if (opts.q) params.set("q", opts.q);
  if (opts.pageToken) params.set("pageToken", opts.pageToken);

  const list = await gmailFetch(userId, `/gmail/v1/users/me/messages?${params.toString()}`);
  const ids: string[] = (list.messages ?? []).map((m: any) => m.id);

  const messages = await mapLimited(ids, 5, async (id) => {
    {
      const m = await gmailFetch(
        userId,
        `/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
      );
      const from = header(m.payload?.headers, "From");
      const summary: MailSummary = {
        id: m.id,
        threadId: m.threadId,
        from,
        fromName: displayName(from),
        subject: header(m.payload?.headers, "Subject") || "(no subject)",
        snippet: m.snippet ?? "",
        date: header(m.payload?.headers, "Date"),
        unread: (m.labelIds ?? []).includes("UNREAD"),
        starred: (m.labelIds ?? []).includes("STARRED"),
        hasAttachment: false,
      };
      return summary;
    }
  });

  return { messages, nextPageToken: (list.nextPageToken as string | undefined) ?? null };
}

const GMAIL_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export async function getMessage(userId: string, id: string) {
  if (typeof id !== "string" || !GMAIL_ID_RE.test(id)) {
    throw encodeMailError({
      kind: "not_found",
      message: "This message reference isn't valid.",
    });
  }
  const m = await gmailFetch(
    userId,
    `/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`,
  );
  const body = collectBody(m.payload, {});
  const from = header(m.payload?.headers, "From");
  return {
    id: m.id as string,
    threadId: m.threadId as string,
    from,
    fromName: displayName(from),
    to: header(m.payload?.headers, "To"),
    cc: header(m.payload?.headers, "Cc"),
    subject: header(m.payload?.headers, "Subject") || "(no subject)",
    date: header(m.payload?.headers, "Date"),
    html: body.html ?? null,
    text: body.text ?? m.snippet ?? "",
    hasAttachment: hasAttachment(m.payload),
  };
}
