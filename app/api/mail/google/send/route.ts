import { clearGoogleCookie, GOOGLE_CLIENT_ID, getGoogleSession } from "../_shared";
type Payload = { to?: string; subject?: string; body?: string };
const clean = (value: string) => value.replace(/[\r\n]+/g, " ").trim();
const retryable = (status: number) => status === 429 || status >= 500;
const base64Url = (value: string) => {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 8192) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};

export async function POST(request: Request) {
  try {
    const session = await getGoogleSession<{ email: string; refreshToken: string }>(request);
    if (!session) return Response.json(
      { error: "Your Gmail connection has expired. Reconnect Gmail, then retry.", code: "RECONNECT_REQUIRED" },
      { status: 401, headers: { "Set-Cookie": clearGoogleCookie() } },
    );
    const payload = await request.json() as Payload;
    if (!payload.to || !payload.subject || !payload.body) return Response.json({ error: "Recipient, subject, and body are required." }, { status: 400 });
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
        refresh_token: session.refreshToken, grant_type: "refresh_token",
      }),
    });
    const token = await tokenResponse.json() as { access_token?: string; error?: string; error_description?: string };
    if (!tokenResponse.ok || !token.access_token) return Response.json(
      {
        error: token.error_description || (token.error === "invalid_grant"
          ? "Google expired this authorization. Reconnect Gmail once, then retry."
          : "Google authorization expired. Reconnect Gmail."),
        code: "RECONNECT_REQUIRED",
      },
      { status: 401, headers: { "Set-Cookie": clearGoogleCookie() } },
    );
    const mime = `To: ${clean(payload.to)}\r\nSubject: ${clean(payload.subject)}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${payload.body}`;
    const raw = base64Url(mime);
    let response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST", headers: { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ raw }),
    });
    if (retryable(response.status)) {
      await new Promise((resolve) => setTimeout(resolve, 900));
      response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST", headers: { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ raw }),
      });
    }
    const result = await response.json() as { id?: string; error?: { message?: string; status?: string; errors?: Array<{ reason?: string }> } };
    if (!response.ok) {
      const message = result.error?.message || "Gmail rejected the message.";
      console.error("Gmail send rejected", { status: response.status, message, reason: result.error?.errors?.[0]?.reason });
      const insufficientScope = response.status === 403 && /insufficient authentication scopes/i.test(message);
      return Response.json(
        {
          error: insufficientScope
            ? "Gmail sending permission was not granted. Reconnect Gmail and approve the sending permission."
            : message,
          code: insufficientScope ? "RECONNECT_REQUIRED" : undefined,
          providerStatus: result.error?.status,
          reason: result.error?.errors?.[0]?.reason,
        },
        {
          status: response.status,
          headers: insufficientScope ? { "Set-Cookie": clearGoogleCookie() } : undefined,
        },
      );
    }
    return Response.json({ id: result.id });
  } catch (error) {
    console.error("Gmail delivery service failed", error);
    return Response.json(
      { error: error instanceof Error ? `Delivery service error: ${error.message}` : "Delivery service error." },
      { status: 500 },
    );
  }
}
