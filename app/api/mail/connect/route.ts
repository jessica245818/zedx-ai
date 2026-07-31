import { apiBase, configurationReady, seal, stateCookie } from "../_shared";

const supported = new Set(["google", "microsoft", "icloud", "imap"]);

export async function GET(request: Request) {
  if (!configurationReady()) {
    return Response.json({ error: "Mailbox connection is awaiting its private server credentials." }, { status: 503 });
  }
  const url = new URL(request.url);
  const provider = url.searchParams.get("provider") || "";
  if (!supported.has(provider)) return Response.json({ error: "Unsupported mailbox provider." }, { status: 400 });
  const nonce = crypto.randomUUID();
  const state = await seal({ nonce, createdAt: Date.now() });
  const callback = `${url.origin}/api/mail/callback`;
  const auth = new URL(`${apiBase()}/v3/connect/auth`);
  auth.searchParams.set("client_id", process.env.NYLAS_CLIENT_ID!);
  auth.searchParams.set("redirect_uri", callback);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("access_type", "offline");
  auth.searchParams.set("provider", provider === "imap" ? "imap" : provider);
  auth.searchParams.set("state", nonce);
  if (provider === "imap" || provider === "icloud") auth.searchParams.set("options", "smtp_required");
  return new Response(null, { status: 302, headers: { Location: auth.toString(), "Set-Cookie": stateCookie(state) } });
}
