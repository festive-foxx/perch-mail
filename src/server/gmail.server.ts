import { callAsAppUser } from "@/integrations/lovable/appUserConnector";
import { getConnectionKeyForUser, MAIL_CONNECTOR_ID } from "./appUserConnections.server";

export const GATEWAY_BASE_URL = "https://connector-gateway.lovable.dev";

/** Read-only access: the app can never send, delete or modify anything. */
export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/gmail.readonly",
];

async function gmailFetch(userId: string, path: string) {
  const connectionAPIKey = await getConnectionKeyForUser(userId, MAIL_CONNECTOR_ID);
  if (!connectionAPIKey) throw new Error("NOT_CONNECTED");
  const res = await callAsAppUser({
    gatewayBaseUrl: GATEWAY_BASE_URL,
    connectionAPIKey,
    connectorId: MAIL_CONNECTOR_ID,
    path,
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`Gmail request failed [${res.status}] ${path}: ${body}`);
    throw new Error(`Mail request failed [${res.status}]: ${body.slice(0, 300)}`);
  }
  return res.json() as Promise<any>;
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

  const messages = await Promise.all(
    ids.map(async (id) => {
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
    }),
  );

  return { messages, nextPageToken: (list.nextPageToken as string | undefined) ?? null };
}

export async function getMessage(userId: string, id: string) {
  const m = await gmailFetch(userId, `/gmail/v1/users/me/messages/${id}?format=full`);
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
