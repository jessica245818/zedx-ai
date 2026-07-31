import { connect } from "cloudflare:sockets";

type RequestBody = { action?: "test" | "send"; email?: string; password?: string; server?: string; to?: string; subject?: string; body?: string };
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const base64 = (value: string) => btoa(String.fromCharCode(...encoder.encode(value)));
const cleanHeader = (value: string) => value.replace(/[\r\n]+/g, " ").trim();
const allowedServers = new Set(["smtp.hostinger.com", "smtp.titan.email"]);
const withTimeout = async <T,>(promise: Promise<T>, label: string) => Promise.race([
  promise,
  new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out. Try the other Hostinger mail service option.`)), 15000)),
]);
type HostingerMe = { data?: { mailboxes?: Array<{ resourceId?: string; address?: string }> }; error?: string; code?: string };

async function useHostingerApi(input: RequestBody, email: string, token: string) {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const accountResponse = await fetch("https://api.mail.hostinger.com/api/v1/me", { headers });
  const account = await accountResponse.json() as HostingerMe;
  if (!accountResponse.ok) {
    throw new Error(account.error || "Hostinger rejected the API token.");
  }
  const mailbox = account.data?.mailboxes?.find((item) => item.address?.toLowerCase() === email.toLowerCase());
  if (!mailbox?.resourceId) {
    throw new Error(`The API token does not have access to ${email}. Allow this mailbox when creating the token in hPanel.`);
  }
  if (input.action === "send") {
    const to = String(input.to || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error("Invalid recipient address.");
    const sendResponse = await fetch(`https://api.mail.hostinger.com/api/v1/mailboxes/${encodeURIComponent(mailbox.resourceId)}/send`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        to: [to],
        subject: cleanHeader(String(input.subject || "")),
        text: String(input.body || ""),
        displayName: "ZedX",
      }),
    });
    if (!sendResponse.ok) {
      const failure = await sendResponse.json().catch(() => ({})) as { error?: string };
      throw new Error(failure.error || `Hostinger Mail API rejected the message (HTTP ${sendResponse.status}).`);
    }
  }
  return Response.json({ ok: true, provider: "Hostinger Mail API", email, server: "api.mail.hostinger.com" });
}

export async function POST(request: Request) {
  let socket: ReturnType<typeof connect> | undefined;
  let stage = "opening the SMTP connection";
  let server = "smtp.hostinger.com";
  try {
    const input = await request.json() as RequestBody;
    const email = String(input.email || "").trim();
    const password = String(input.password || "");
    server = allowedServers.has(String(input.server || "")) ? String(input.server) : "smtp.hostinger.com";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password) {
      return Response.json({ error: "Enter the complete Hostinger mailbox address and credential." }, { status: 400 });
    }
    if (server === "smtp.hostinger.com") {
      stage = "authenticating with the Hostinger Mail API";
      return await useHostingerApi(input, email, password);
    }
    socket = connect({ hostname: server, port: 465 }, { secureTransport: "on", allowHalfOpen: true });
    await withTimeout(socket.opened, "SMTP connection");
    const reader = socket.readable.getReader();
    const writer = socket.writable.getWriter();
    let buffer = "";
    const readReply = async () => {
      while (true) {
        const { value, done } = await reader.read();
        if (done) throw new Error("Hostinger closed the SMTP connection.");
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\r\n");
        buffer = lines.pop() || "";
        for (const line of lines) if (/^\d{3} /.test(line)) return line;
      }
    };
    const command = async (value: string, expected: number[]) => {
      await writer.write(encoder.encode(`${value}\r\n`));
      const reply = await withTimeout(readReply(), "SMTP response");
      const code = Number(reply.slice(0, 3));
      if (!expected.includes(code)) throw new Error(reply.slice(4) || `SMTP error ${code}`);
    };
    stage = "reading the server greeting";
    const greeting = await withTimeout(readReply(), "SMTP greeting");
    if (!greeting.startsWith("220")) throw new Error(greeting);
    stage = "starting the secure SMTP session";
    await command("EHLO zedx-ai.app", [250]);
    stage = "authenticating the mailbox";
    await command("AUTH LOGIN", [334]);
    await command(base64(email), [334]);
    await command(base64(password), [235]);
    if (input.action === "send") {
      const to = String(input.to || "").trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error("Invalid recipient address.");
      await command(`MAIL FROM:<${email}>`, [250]);
      await command(`RCPT TO:<${to}>`, [250, 251]);
      await command("DATA", [354]);
      const message = [
        `From: ${email}`, `To: ${cleanHeader(to)}`, `Subject: ${cleanHeader(String(input.subject || ""))}`,
        `Date: ${new Date().toUTCString()}`, `Message-ID: <${crypto.randomUUID()}@zedx-ai.app>`,
        "MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: 8bit", "",
        String(input.body || "").replace(/^\./gm, ".."),
      ].join("\r\n");
      await command(`${message}\r\n.`, [250]);
    }
    await command("QUIT", [221]).catch(() => undefined);
    return Response.json({ ok: true, provider: server === "smtp.titan.email" ? "Hostinger Titan" : "Hostinger", email, server });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Hostinger connection failed.";
    const authenticationHelp = stage === "authenticating the mailbox"
      ? " Use the mailbox password from Hostinger hPanel—not your Hostinger account password."
      : "";
    console.error("Hostinger SMTP failure", { server, stage, detail });
    return Response.json({ error: `Failed while ${stage}: ${detail}.${authenticationHelp}`, server, stage }, { status: 502 });
  } finally {
    socket?.close().catch(() => undefined);
  }
}
