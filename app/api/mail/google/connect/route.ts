import { GOOGLE_CLIENT_ID, googleStateCookie } from "../_shared";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = `${url.searchParams.get("desktop") === "1" ? "desktop." : "web."}${crypto.randomUUID()}`;
  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.searchParams.set("client_id", GOOGLE_CLIENT_ID);
  auth.searchParams.set("redirect_uri", `${url.origin}/api/mail/google/callback`);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("scope", "openid email https://www.googleapis.com/auth/gmail.send");
  auth.searchParams.set("access_type", "offline");
  auth.searchParams.set("prompt", "select_account consent");
  // Request the complete scope set again instead of reusing an older,
  // identity-only grant that cannot send Gmail messages.
  auth.searchParams.set("include_granted_scopes", "false");
  auth.searchParams.set("state", state);
  return new Response(null, { status: 302, headers: { Location: auth.toString(), "Set-Cookie": googleStateCookie(state) } });
}
