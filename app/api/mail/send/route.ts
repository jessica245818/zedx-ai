import { apiBase, mailboxFrom } from "../_shared";

type SendRequest = {
  recipients?: string[];
  subject?: string;
  body?: string;
  minDelaySeconds?: number;
  maxDelaySeconds?: number;
};

export async function POST(request: Request) {
  const mailbox = await mailboxFrom(request);
  if (!mailbox) return Response.json({ error: "Connect a sending account first." }, { status: 401 });
  const payload = await request.json() as SendRequest;
  const recipients = [...new Set(payload.recipients ?? [])].filter((email) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)).slice(0, 50);
  if (!recipients.length || !payload.subject?.trim() || !payload.body?.trim()) {
    return Response.json({ error: "Recipients, subject, and message are required." }, { status: 400 });
  }
  const minimum = Math.max(60, Math.min(3600, Number(payload.minDelaySeconds) || 90));
  const maximum = Math.max(minimum, Math.min(7200, Number(payload.maxDelaySeconds) || 180));
  let cursor = Math.floor(Date.now() / 1000) + 60;
  const results: Array<{ email: string; status: "queued" | "failed"; id?: string; sendAt?: number; error?: string }> = [];

  for (const email of recipients) {
    cursor += Math.floor(minimum + Math.random() * (maximum - minimum + 1));
    const idempotencyKey = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${mailbox.grantId}|${email}|${payload.subject}|${cursor}`),
    ).then((bytes) => [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join(""));
    const response = await fetch(`${apiBase()}/v3/grants/${encodeURIComponent(mailbox.grantId)}/messages/send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.NYLAS_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        to: [{ email }],
        subject: payload.subject.trim(),
        body: payload.body,
        is_plaintext: true,
        send_at: cursor,
      }),
    });
    const result = await response.json() as { data?: { id?: string }; message?: string; error?: { message?: string } };
    results.push(response.ok
      ? { email, status: "queued", id: result.data?.id, sendAt: cursor }
      : { email, status: "failed", error: result.error?.message || result.message || "Provider rejected the message" });
  }
  return Response.json({ sender: mailbox.email, results, limited: (payload.recipients?.length ?? 0) > 50 });
}
