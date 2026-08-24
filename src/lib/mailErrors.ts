/**
 * Shared (client-safe) vocabulary for mailbox failures.
 *
 * The server encodes failures as `MAIL_ERROR:{json}` in the Error message so the
 * UI can render the right recovery affordance instead of a generic "something
 * went wrong".
 */

export type MailErrorKind =
  | "not_connected" // no stored connection for this user
  | "reauth" // consent expired / revoked / missing scope — needs reconnect
  | "rate_limited" // provider throttled us — retry later
  | "unavailable" // transient upstream failure — retry
  | "not_found" // message/folder gone
  | "unknown";

export interface MailError {
  kind: MailErrorKind;
  message: string;
  /** Seconds to wait before retrying, when the provider told us. */
  retryAfter?: number;
  /** Scopes that were missing, for reconnect prompts. */
  missingScopes?: string[];
}

const PREFIX = "MAIL_ERROR:";

export function encodeMailError(error: MailError): Error {
  return new Error(PREFIX + JSON.stringify(error));
}

export function parseMailError(error: unknown): MailError {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const index = raw.indexOf(PREFIX);
  if (index >= 0) {
    try {
      const parsed = JSON.parse(raw.slice(index + PREFIX.length)) as MailError;
      if (parsed && typeof parsed.kind === "string") return parsed;
    } catch {
      // fall through to the generic shape below
    }
  }
  return { kind: "unknown", message: raw || "Something went wrong reading your mail." };
}

/** Retryable kinds are safe to re-attempt; the others need user action. */
export function isRetryable(kind: MailErrorKind) {
  return kind === "rate_limited" || kind === "unavailable";
}

export function mailErrorTitle(kind: MailErrorKind) {
  switch (kind) {
    case "not_connected":
      return "Mailbox not connected";
    case "reauth":
      return "Your mailbox needs to be reconnected";
    case "rate_limited":
      return "Your mail provider is rate limiting us";
    case "unavailable":
      return "Your mail provider is temporarily unavailable";
    case "not_found":
      return "That message is no longer there";
    default:
      return "Couldn't load your mail";
  }
}
