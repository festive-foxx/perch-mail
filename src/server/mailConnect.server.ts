import { getRequest } from "@tanstack/react-start/server";
import {
  authorizeAppUserOAuth,
  disconnectAppUser,
  exchangeAppUserOAuthCode,
} from "@/integrations/lovable/appUserConnector";
import {
  MAIL_CONNECTOR_ID,
  deleteConnectionForUser,
  getConnectionKeyForUser,
  getConnectionRowForUser,
  saveConnectionKeyForUser,
  setAccountEmail,
} from "./appUserConnections.server";
import { GATEWAY_BASE_URL, GMAIL_SCOPES, getProfile } from "./gmail.server";

export async function beginConnect(userId: string) {
  const clientApiKey = process.env['GOOGLE_MAIL_APP_USER_CONNECTOR_CLIENT_API_KEY'];
  if (!clientApiKey) {
    throw new Error("GOOGLE_MAIL_APP_USER_CONNECTOR_CLIENT_API_KEY is not set");
  }
  const request = getRequest();
  if (!request) throw new Error("OAuth must start from an app request.");
  const url = new URL(request.url);
  const sandboxHost =
    url.hostname === "localhost" ? request.headers.get("x-forwarded-host") : null;
  const returnUrl = new URL(
    "/oauth/mail/return",
    sandboxHost ? `https://${sandboxHost}` : url.origin,
  ).toString();

  const existingKey = await getConnectionKeyForUser(userId, MAIL_CONNECTOR_ID);

  const { authorizationUrl } = await authorizeAppUserOAuth({
    gatewayBaseUrl: GATEWAY_BASE_URL,
    connectorId: MAIL_CONNECTOR_ID,
    appUserId: userId,
    clientAPIKey: clientApiKey,
    returnUrl,
    ...(existingKey ? { connectionAPIKey: existingKey } : {}),
    credentialsConfiguration: { scopes: GMAIL_SCOPES },
  });
  return { authorizationUrl };
}

export async function finishConnect(userId: string, code: string) {
  const { connectionAPIKey, connectorId } = await exchangeAppUserOAuthCode(
    GATEWAY_BASE_URL,
    code,
  );
  if (connectorId !== MAIL_CONNECTOR_ID) {
    throw new Error("OAuth completion returned the wrong connector");
  }
  await saveConnectionKeyForUser(userId, connectorId, connectionAPIKey);
  try {
    const profile = await getProfile(userId);
    if (profile.emailAddress) await setAccountEmail(userId, connectorId, profile.emailAddress);
  } catch (error) {
    console.error("Could not read mailbox profile after connect", error);
  }
  return { ok: true };
}

export async function connectionStatus(userId: string) {
  const row = await getConnectionRowForUser(userId, MAIL_CONNECTOR_ID);
  if (!row) return { connected: false as const, accountEmail: null };
  return { connected: true as const, accountEmail: row.account_email ?? null };
}

export async function revokeConnect(userId: string) {
  const connectionAPIKey = await getConnectionKeyForUser(userId, MAIL_CONNECTOR_ID);
  if (connectionAPIKey) {
    try {
      await disconnectAppUser({
        gatewayBaseUrl: GATEWAY_BASE_URL,
        connectionAPIKey,
        connectorId: MAIL_CONNECTOR_ID,
      });
    } catch (error) {
      console.error("Gateway disconnect failed", error);
    }
  }
  await deleteConnectionForUser(userId, MAIL_CONNECTOR_ID);
  return { ok: true };
}
