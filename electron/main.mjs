import { app, BrowserWindow, ipcMain, shell, session } from "electron";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ORIGIN = "https://zedx-ai.jessica-reachpilot.workers.dev";
const allowedServers = new Set(["smtp.hostinger.com", "smtp.titan.email"]);
const verifiedHosts = new Map();
let mainWindow;

async function acceptGmailDeepLink(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "zedx-ai:" || url.hostname !== "gmail-connected") return;
    const value = url.searchParams.get("session");
    if (!value) return;
    await session.defaultSession.cookies.set({
      url: APP_ORIGIN,
      name: "zedx_google_mailbox",
      value,
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "lax",
      expirationDate: Math.floor(Date.now() / 1000) + 31536000,
    });
    if (!mainWindow || mainWindow.isDestroyed()) createWindow();
    mainWindow.show();
    mainWindow.focus();
    await mainWindow.loadURL(`${APP_ORIGIN}/?desktop=1&gmail=connected`);
  } catch {
    // Ignore malformed or unrelated protocol URLs.
  }
}

function assertTrustedSender(event) {
  if (!event.senderFrame.url.startsWith(APP_ORIGIN)) {
    throw new Error("Blocked an untrusted mail request.");
  }
}

function transporterFor(payload, forcedHost) {
  const requestedHost = allowedServers.has(payload.server) ? payload.server : "smtp.hostinger.com";
  const email = String(payload.email || "").trim().toLowerCase();
  const host = forcedHost || verifiedHosts.get(email) || requestedHost;
  return nodemailer.createTransport({
    host,
    port: 465,
    secure: true,
    connectionTimeout: 20000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
    auth: {
      user: email,
      pass: String(payload.password || "").trim(),
    },
  });
}

function rawMessage(email, to, subject, body) {
  return [
    `From: ${email}`,
    `To: ${to}`,
    `Subject: ${String(subject || "").replace(/[\r\n]+/g, " ").trim()}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@zedx-ai.app>`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    String(body || ""),
  ].join("\r\n");
}

async function appendToSent(payload, email, message, smtpHost) {
  const client = new ImapFlow({
    host: smtpHost === "smtp.titan.email" ? "imap.titan.email" : "imap.hostinger.com",
    port: 993,
    secure: true,
    auth: { user: email, pass: String(payload.password || "").trim() },
    logger: false,
    connectionTimeout: 20000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  });
  try {
    await client.connect();
    const mailboxes = await client.list();
    const sentMailbox = mailboxes.find((mailbox) => mailbox.specialUse === "\\Sent")
      || mailboxes.find((mailbox) => /(^|\/)sent( messages| items| mail)?$/i.test(mailbox.path));
    if (!sentMailbox) throw new Error("The mailbox has no Sent folder.");
    const appended = await client.append(sentMailbox.path, Buffer.from(message, "utf8"), ["\\Seen"], new Date());
    if (!appended) throw new Error("The mail server did not confirm the Sent copy.");
  } finally {
    await client.logout().catch(() => undefined);
  }
}

ipcMain.handle("zedx:hostinger", async (event, payload = {}) => {
  assertTrustedSender(event);
  const email = String(payload.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !payload.password) {
    return { ok: false, error: "Enter the complete mailbox address and mailbox password." };
  }
  let transporter = transporterFor(payload);
  try {
    if (payload.action === "send") {
      const to = String(payload.to || "").trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { ok: false, error: "Enter a valid recipient address." };
      const message = rawMessage(email, to, payload.subject, payload.body);
      const result = await transporter.sendMail({ envelope: { from: email, to }, raw: message });
      const requestedHost = allowedServers.has(payload.server) ? payload.server : "smtp.hostinger.com";
      const smtpHost = verifiedHosts.get(email) || requestedHost;
      try {
        await appendToSent(payload, email, message, smtpHost);
        return { ok: true, provider: "Hostinger SMTP", email, id: result.messageId, sentFolderSaved: true };
      } catch (sentError) {
        return {
          ok: true,
          provider: "Hostinger SMTP",
          email,
          id: result.messageId,
          sentFolderSaved: false,
          warning: `Message sent, but the Sent copy could not be synchronized: ${sentError instanceof Error ? sentError.message : "IMAP error"}`,
        };
      }
    }
    try {
      await transporter.verify();
    } catch (firstError) {
      transporter.close();
      const requestedHost = allowedServers.has(payload.server) ? payload.server : "smtp.hostinger.com";
      const fallbackHost = requestedHost === "smtp.hostinger.com" ? "smtp.titan.email" : "smtp.hostinger.com";
      transporter = transporterFor(payload, fallbackHost);
      try {
        await transporter.verify();
      } catch {
        throw firstError;
      }
      verifiedHosts.set(email, fallbackHost);
      return { ok: true, provider: fallbackHost === "smtp.titan.email" ? "Hostinger Titan SMTP" : "Hostinger SMTP", email };
    }
    const requestedHost = allowedServers.has(payload.server) ? payload.server : "smtp.hostinger.com";
    verifiedHosts.set(email, requestedHost);
    return { ok: true, provider: requestedHost === "smtp.titan.email" ? "Hostinger Titan SMTP" : "Hostinger SMTP", email };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Hostinger SMTP connection failed.";
    return {
      ok: false,
      error: /535|authentication failed|invalid login/i.test(detail)
        ? "Hostinger rejected the mailbox login (535). Re-enter the mailbox password exactly; accidental spaces are removed automatically."
        : detail,
    };
  } finally {
    transporter.close();
  }
});

ipcMain.handle("zedx:open-external", async (event, url) => {
  assertTrustedSender(event);
  const target = new URL(String(url));
  if (target.origin !== APP_ORIGIN) throw new Error("Blocked an untrusted login URL.");
  await shell.openExternal(target.toString());
  return { ok: true };
});

function createWindow() {
  const window = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1040,
    minHeight: 720,
    title: "ZedX AI",
    backgroundColor: "#050505",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = window;

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(APP_ORIGIN)) return { action: "allow" };
    void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(APP_ORIGIN)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });
  void window.loadURL(`${APP_ORIGIN}/?desktop=1`);
}

app.setAsDefaultProtocolClient("zedx-ai");
app.on("open-url", (event, url) => {
  event.preventDefault();
  void acceptGmailDeepLink(url);
});

const instanceLock = app.requestSingleInstanceLock();
if (!instanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const deepLink = argv.find((value) => value.startsWith("zedx-ai://"));
    if (deepLink) void acceptGmailDeepLink(deepLink);
    else if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(() => {
  createWindow();
  const launchLink = process.argv.find((value) => value.startsWith("zedx-ai://"));
  if (launchLink) void acceptGmailDeepLink(launchLink);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
