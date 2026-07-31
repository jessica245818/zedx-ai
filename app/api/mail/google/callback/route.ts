import { GOOGLE_CLIENT_ID, clearGoogleStateCookie, encrypt, getGoogleState, googleCookie } from "../_shared";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || state !== getGoogleState(request)) return new Response("Google connection expired. Return to ZedX AI and reconnect.", { status: 400 });
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
      code, grant_type: "authorization_code", redirect_uri: `${url.origin}/api/mail/google/callback`,
    }),
  });
  const tokens = await tokenResponse.json() as { access_token?: string; refresh_token?: string; scope?: string; error_description?: string };
  if (!tokenResponse.ok || !tokens.access_token || !tokens.refresh_token) return new Response(`Google connection failed: ${tokens.error_description || "no renewable authorization was returned"}`, { status: 502 });
  const grantedScopes = new Set((tokens.scope || "").split(/\s+/).filter(Boolean));
  if (!grantedScopes.has("https://www.googleapis.com/auth/gmail.send")) {
    return new Response("Google did not grant permission to send email. Return to ZedX AI, reconnect Gmail, and approve the Gmail sending permission.", { status: 403 });
  }
  const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${tokens.access_token}` } });
  const profile = await profileResponse.json() as { email?: string };
  if (!profile.email) return new Response("Google did not return the mailbox email.", { status: 502 });
  const session = await encrypt({ email: profile.email, refreshToken: tokens.refresh_token });
  if (state.startsWith("desktop.")) {
    const destination = new URL("zedx-ai://gmail-connected");
    destination.searchParams.set("session", session);
    destination.searchParams.set("email", profile.email);
    const headers = new Headers({ Location: destination.toString() });
    headers.append("Set-Cookie", clearGoogleStateCookie());
    return new Response(null, { status: 302, headers });
  }
  const headers = new Headers({ Location: `${url.origin}/?gmail=connected` });
  headers.append("Set-Cookie", googleCookie(session));
  headers.append("Set-Cookie", clearGoogleStateCookie());
  return new Response(null, { status: 302, headers });
}
