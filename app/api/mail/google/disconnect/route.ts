import { clearGoogleCookie, getGoogleSession } from "../_shared";
export async function POST(request: Request) {
  const session = await getGoogleSession<{ refreshToken: string }>(request);
  if (session?.refreshToken) await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(session.refreshToken)}`, { method: "POST" }).catch(() => undefined);
  return Response.json({ ok: true }, { headers: { "Set-Cookie": clearGoogleCookie() } });
}
