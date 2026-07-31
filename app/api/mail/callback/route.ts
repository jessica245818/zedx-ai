import {
  apiBase, clearStateCookie, oauthStateFrom, seal, unseal, mailboxCookie,
} from "../_shared";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!code) {
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>Returning to ZedX AI</title><script>location.replace("/"+location.hash)</script>',
      { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
    );
  }
  const state = url.searchParams.get("state");
  const expected = await unseal<{ nonce: string; createdAt: number }>(oauthStateFrom(request));
  if (!code || !state || !expected || expected.nonce !== state || Date.now() - expected.createdAt > 600_000) {
    return new Response("The mailbox connection expired. Return to ZedX AI and try again.", { status: 400 });
  }
  const response = await fetch(`${apiBase()}/v3/connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.NYLAS_CLIENT_ID,
      client_secret: process.env.NYLAS_API_KEY,
      grant_type: "authorization_code",
      code,
      redirect_uri: `${url.origin}/api/mail/callback`,
    }),
  });
  const result = await response.json() as { grant_id?: string; email?: string; provider?: string; error?: string };
  if (!response.ok || !result.grant_id || !result.email) {
    return new Response(`Mailbox connection failed: ${result.error || "the provider rejected the connection"}`, { status: 502 });
  }
  const mailbox = await seal({ grantId: result.grant_id, email: result.email, provider: result.provider || "mailbox" });
  const headers = new Headers({ Location: `${url.origin}/?mailbox=connected` });
  headers.append("Set-Cookie", mailboxCookie(mailbox));
  headers.append("Set-Cookie", clearStateCookie());
  return new Response(null, { status: 302, headers });
}
