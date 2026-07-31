import { configurationReady, mailboxFrom } from "../_shared";

export async function GET(request: Request) {
  const mailbox = await mailboxFrom(request);
  return Response.json({
    configured: configurationReady(),
    connected: Boolean(mailbox),
    email: mailbox?.email,
    provider: mailbox?.provider,
  });
}
