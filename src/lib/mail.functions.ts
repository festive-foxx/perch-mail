import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const startMailConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { beginConnect } = await import("@/server/mailConnect.server");
    return beginConnect(context.userId);
  });

export const completeMailConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { code: string }) => input)
  .handler(async ({ data, context }) => {
    const { finishConnect } = await import("@/server/mailConnect.server");
    return finishConnect(context.userId, data.code);
  });

export const getMailConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { connectionStatus } = await import("@/server/mailConnect.server");
    return connectionStatus(context.userId);
  });

export const disconnectMail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { revokeConnect } = await import("@/server/mailConnect.server");
    return revokeConnect(context.userId);
  });

export const listMail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { labelId?: string; q?: string; pageToken?: string }) => input)
  .handler(async ({ data, context }) => {
    const { listMessages } = await import("@/server/gmail.server");
    return listMessages(context.userId, data);
  });

export const readMail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { getMessage } = await import("@/server/gmail.server");
    return getMessage(context.userId, data.id);
  });
