"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import {
  Activity, AlertTriangle, Check, ChevronDown, CircleCheck, Download, FileUp,
  Filter, Link2, Mail, Search, Send, ShieldCheck, Sparkles, Unplug,
} from "lucide-react";

declare global {
  interface Window {
    zedxDesktop?: {
      platform: string;
      hostinger: (payload: Record<string, unknown>) => Promise<{ ok?: boolean; error?: string; id?: string }>;
      openExternal: (url: string) => Promise<{ ok?: boolean }>;
    };
  }
}

type Decision = "selected" | "review" | "blocked";
type Approval = "pending" | "approved" | "rejected";
type Contact = {
  id: string; email: string; domain: string; probability: number;
  decision: Decision; reason: string; approval: Approval;
  sendStatus: "not_sent" | "ready" | "queued" | "sent" | "failed";
  gmailMessageId?: string;
  deliveryError?: string;
};
type Mailbox = { configured: boolean; connected: boolean; email?: string; provider?: string };

const GOOGLE_CLIENT_ID = "276798839321-d2qtoru8eal9kna4m048ohbu8srcg9te.apps.googleusercontent.com";

const initialContacts: Contact[] = [];

function titleCase(value: string) {
  return value
    .replace(/[-_.]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();
}

function personalizeMessage(email: string, message: string) {
  const [localPart, domain = ""] = email.toLowerCase().split("@");
  const parts = localPart.split(/[._-]+/).filter(Boolean);
  const businessMailboxes = new Set([
    "admin", "business", "contact", "enquiries", "hello", "info", "inquiries",
    "marketing", "office", "sales", "support", "team",
  ]);
  const isBusinessMailbox = parts.length === 0 || parts.some((part) => businessMailboxes.has(part));
  const company = titleCase(domain.split(".")[0] || "Company");
  const recipientName = isBusinessMailbox ? `${company} Team` : titleCase(parts[0] || localPart);
  const greeting = `Dear ${recipientName},`;
  if (/^(hello|hi|dear)\b[^\n]*,?\s*/i.test(message)) {
    return message.replace(/^(hello|hi|dear)\b[^\n]*,?\s*/i, `${greeting}\n\n`);
  }
  return `${greeting}\n\n${message}`;
}

function scoreEmail(email: string): Contact | null {
  const clean = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(clean)) return null;
  const [username, domain] = clean.split("@");
  const normalized = username.replace(/[^a-z0-9]/g, "");
  const blockedWords = ["support", "help", "legal", "privacy", "abuse", "jobs", "careers", "billing"];
  const desiredWords = ["founder", "ceo", "owner", "director", "partner", "marketing", "growth", "brand", "media", "press", "communications", "businessdevelopment"];
  const personal = ["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com"].includes(domain);
  const blocked = personal || blockedWords.some((word) => normalized.includes(word));
  const selected = desiredWords.some((word) => normalized.includes(word));
  const decision: Decision = blocked ? "blocked" : selected ? "selected" : "review";
  return {
    id: crypto.randomUUID(), email: clean, domain,
    probability: blocked ? .12 : selected ? .94 : .58, decision,
    reason: blocked ? (personal ? "Personal email provider" : "Do-not-contact mailbox role") : selected ? "Relevant outreach role detected" : "No confident role match",
    approval: "pending", sendStatus: "not_sent",
  };
}

export default function Home() {
  const desktopMode = typeof window !== "undefined" && Boolean(window.zedxDesktop);
  const PAGE_SIZE = 50;
  const [contacts, setContacts] = useState(initialContacts);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | Decision>("selected");
  const [autoSend, setAutoSend] = useState(true);
  const [selectionThreshold, setSelectionThreshold] = useState(0.8);
  const [selectedId, setSelectedId] = useState("");
  const [subject, setSubject] = useState("A quick introduction");
  const [body, setBody] = useState("Hello,\n\nI’m reaching out from ZedX, a digital marketing company specializing in digital advertising and CGI and VFX content.\n\nWe help brands create visually distinctive campaigns and content designed to capture attention across digital platforms. I thought our work could be relevant to your team and would be glad to explore how ZedX could support an upcoming campaign or creative project.\n\nYou can learn more about our work at https://zedfilmx.com.\n\nIf this is not relevant, simply reply “no” and we will not contact you again.\n\nBest,\nThe ZedX Team");
  const [testAddress, setTestAddress] = useState("");
  const [toast, setToast] = useState("");
  const [uploading, setUploading] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importStage, setImportStage] = useState("");
  const [page, setPage] = useState(1);
  const [mailbox, setMailbox] = useState<Mailbox>({ configured: false, connected: false });
  const [connecting, setConnecting] = useState(false);
  const [minDelay, setMinDelay] = useState(90);
  const [maxDelay, setMaxDelay] = useState(180);
  const [sending, setSending] = useState(false);
  const [accessToken, setAccessToken] = useState("");
  const [hostingerEmail, setHostingerEmail] = useState("");
  const [hostingerPassword, setHostingerPassword] = useState("");
  const [hostingerServer, setHostingerServer] = useState("smtp.hostinger.com");
  const [hostingerError, setHostingerError] = useState("");
  const [showHostinger, setShowHostinger] = useState(false);

  useEffect(() => {
    setMailbox({ configured: true, connected: false });
    fetch("/api/mail/google/account").then((result) => result.json()).then((profile: { connected?: boolean; email?: string }) => {
      if (profile.connected) setMailbox({ configured: true, connected: true, email: profile.email || "Connected Gmail", provider: "Google" });
    }).catch(() => undefined);
  }, []);

  const visible = useMemo(() => {
    if (!query && filter === "all") return contacts;
    return contacts.filter((contact) => {
    const matchesQuery = contact.email.includes(query.toLowerCase()) || contact.domain.includes(query.toLowerCase());
    return matchesQuery && (filter === "all" || contact.decision === filter);
    });
  }, [contacts, query, filter]);
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const displayed = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const active = contacts.find((contact) => contact.id === selectedId) ?? contacts[0];
  const totals = useMemo(() => ({
    scanned: contacts.length,
    selected: contacts.filter((contact) => contact.decision === "selected").length,
    review: contacts.filter((contact) => contact.decision === "review").length,
    blocked: contacts.filter((contact) => contact.decision === "blocked").length,
  }), [contacts]);
  const approvedCount = contacts.filter((contact) => contact.approval === "approved").length;
  const deliveryTotals = useMemo(() => ({
    sent: contacts.filter((contact) => contact.sendStatus === "sent").length,
    queued: contacts.filter((contact) => contact.sendStatus === "queued").length,
    failed: contacts.filter((contact) => contact.sendStatus === "failed").length,
    skipped: contacts.filter((contact) => contact.decision !== "selected" && contact.sendStatus === "not_sent").length,
  }), [contacts]);
  const processedCount = deliveryTotals.sent + deliveryTotals.failed + deliveryTotals.skipped;

  const notify = (message: string, duration = 2700) => {
    setToast(message); window.setTimeout(() => setToast(""), duration);
  };
  const updateSelectionThreshold = (nextValue: number) => {
    const next = Math.max(0.05, Math.min(0.99, nextValue));
    setSelectionThreshold(next);
    setContacts((current) => current.map((contact) => {
      if (contact.decision === "blocked" || ["queued", "sent"].includes(contact.sendStatus)) return contact;
      const selected = contact.probability >= next;
      return {
        ...contact,
        decision: selected ? "selected" : "review",
        reason: selected ? `Score meets the ${(next * 100).toFixed(0)}% selection threshold` : `Score is below the ${(next * 100).toFixed(0)}% selection threshold`,
        sendStatus: autoSend && selected ? "ready" : "not_sent",
      };
    }));
  };
  const connectMailbox = async (provider: "google" | "microsoft" | "icloud" | "imap") => {
    if (provider !== "google") return notify("This free build currently connects Gmail directly.", 5000);
    if (desktopMode) {
      setConnecting(false);
      await window.zedxDesktop!.openExternal(`${window.location.origin}/api/mail/google/connect?desktop=1`);
      return notify("Google login opened in your browser. After approval, ZedX AI will reopen here as connected.", 9000);
    }
    setConnecting(true);
    window.location.assign("/api/mail/google/connect");
  };
  const disconnectMailbox = async () => {
    const wasGoogle = mailbox.provider === "Google";
    setConnecting(false);
    setMailbox({ configured: true, connected: false });
    setHostingerPassword("");
    setHostingerError("");
    setShowHostinger(!wasGoogle);
    if (wasGoogle) await fetch("/api/mail/google/disconnect", { method: "POST" }).catch(() => undefined);
    window.sessionStorage.removeItem("zedx_gmail_token");
    setAccessToken("");
    notify("Sending account disconnected");
  };
  const connectHostinger = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(hostingerEmail) || !hostingerPassword) return notify(`Enter the Hostinger business email and ${desktopMode ? "mailbox password" : hostingerServer === "smtp.hostinger.com" ? "Mail API token" : "mailbox password"}`, 5000);
    setConnecting(true);
    setHostingerError("");
    try {
      const payload = { action: "test", email: hostingerEmail, password: hostingerPassword, server: hostingerServer };
      const result = desktopMode
        ? await window.zedxDesktop!.hostinger(payload)
        : await fetch("/api/mail/hostinger", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
          }).then(async (response) => ({ response, result: await response.json() as { error?: string } }))
            .then(({ response, result }) => response.ok ? { ok: true } : { ok: false, error: result.error });
      if (!result.ok) throw new Error(result.error || "Hostinger rejected the connection.");
      setMailbox({ configured: true, connected: true, email: hostingerEmail, provider: "Hostinger" });
      setShowHostinger(false);
      notify(`Hostinger connected as ${hostingerEmail}`, 5000);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Hostinger connection failed";
      setHostingerError(message);
      notify(message, 10000);
    } finally { setConnecting(false); }
  };
  const encodeMessage = (to: string) => {
    const localMessageId = `<${crypto.randomUUID()}@zedx-ai.local>`;
    const mime = `From: ${mailbox.email || "me"}\r\nTo: ${to}\r\nSubject: ${subject}\r\nDate: ${new Date().toUTCString()}\r\nMessage-ID: ${localMessageId}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${personalizeMessage(to, body)}`;
    const bytes = new TextEncoder().encode(mime);
    let binary = "";
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  };
  const queueMessages = async (source = contacts, immediate = false) => {
    const recipients = source.filter((contact) =>
      (autoSend ? contact.decision === "selected" : contact.approval === "approved")
      && !["queued", "sent"].includes(contact.sendStatus)
    ).map((contact) => contact.email);
    if (!mailbox.connected || (mailbox.provider === "Hostinger" && !hostingerPassword)) return notify("Connect a sending account first", 5000);
    if (!recipients.length) return notify("There are no unsent selected recipients");
    setSending(true);
    const limited = recipients.slice(0, 50);
    setContacts((current) => current.map((contact) => limited.includes(contact.email) ? { ...contact, sendStatus: "queued" } : contact));
    const normalizedMinDelay = Math.max(1, Math.round(minDelay));
    const normalizedMaxDelay = Math.max(normalizedMinDelay, Math.round(maxDelay));
    let elapsed = 0;
    limited.forEach((email, index) => {
      if (index > 0) elapsed += autoSend
        ? Math.round((normalizedMinDelay + Math.random() * (normalizedMaxDelay - normalizedMinDelay)) * 1000)
        : 350;
      window.setTimeout(async () => {
        try {
          const hostingerPayload = { action: "send", email: mailbox.email, password: hostingerPassword, server: hostingerServer, to: email, subject, body: personalizeMessage(email, body) };
          const desktopResult = mailbox.provider === "Hostinger" && desktopMode ? await window.zedxDesktop!.hostinger(hostingerPayload) : null;
          const response = mailbox.provider === "Hostinger" && desktopMode ? new Response(JSON.stringify(desktopResult), {
            status: desktopResult?.ok ? 200 : 502, headers: { "Content-Type": "application/json" },
          }) : mailbox.provider === "Hostinger" ? await fetch("/api/mail/hostinger", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(hostingerPayload),
          }) : await fetch("/api/mail/google/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ to: email, subject, body: personalizeMessage(email, body) }),
          });
          if (!response.ok) {
            setContacts((current) => current.map((contact) => contact.email === email
              ? { ...contact, sendStatus: "failed" }
              : contact));
            const failure = await response.json().catch(() => null) as { error?: string | { message?: string }; code?: string } | null;
            const failureMessage = typeof failure?.error === "string" ? failure.error : failure?.error?.message;
            if (failure?.code === "RECONNECT_REQUIRED" || response.status === 401) {
              setMailbox({ configured: true, connected: false });
              setContacts((current) => current.map((contact) => contact.email === email
                ? { ...contact, sendStatus: autoSend ? "ready" : "not_sent" }
                : contact));
              document.getElementById("mailbox-connection")?.scrollIntoView({ behavior: "smooth", block: "center" });
              notify(failureMessage || "Your Gmail session expired. Reconnect Gmail and retry.", 12000);
              return;
            }
            setContacts((current) => current.map((contact) => contact.email === email
              ? { ...contact, deliveryError: failureMessage || `Gmail HTTP ${response.status}` }
              : contact));
            notify(`Gmail rejected ${email}: ${failureMessage || `HTTP ${response.status}`}`, 10000);
          } else {
            const sent = await response.json() as { id?: string; ok?: boolean };
            if (mailbox.provider === "Google" && !sent.id) throw new Error("Gmail accepted the request without returning a message reference.");
            setContacts((current) => current.map((contact) => contact.email === email
              ? { ...contact, sendStatus: "sent", gmailMessageId: sent.id }
              : contact));
            notify(mailbox.provider === "Hostinger" ? `Accepted by Hostinger for ${email}.` : `Accepted by Gmail for ${email} · reference ${sent.id}. Check the sender's Sent folder and the recipient's Spam folder.`, 10000);
          }
        } catch (error) {
          const failureMessage = error instanceof Error ? error.message : "Network error";
          setContacts((current) => current.map((contact) => contact.email === email ? { ...contact, sendStatus: "failed", deliveryError: failureMessage } : contact));
          notify(`Send failed for ${email}: ${failureMessage}`, 10000);
        }
      }, elapsed);
    });
    setSending(false);
    notify(autoSend
      ? `${limited.length} real messages queued with campaign pacing${recipients.length > 50 ? " · first 50 processed" : ""}. Keep this tab open.`
      : `${limited.length} approved messages are sending now${recipients.length > 50 ? " · first 50 processed" : ""}.`, 6000);
  };
  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setImportProgress(0);
    setImportStage(file.name.toLowerCase().endsWith(".csv") ? "Preparing fast CSV reader…" : "Opening Excel workbook — this is usually the slowest step…");
    try {
      const updateReadProgress = (loaded: number, total: number, label: string) => {
        const progress = total ? Math.max(1, Math.min(90, Math.round((loaded / total) * 90))) : 1;
        setImportProgress(progress);
        setImportStage(`${label}… ${progress}%`);
      };
      const readAsText = (source: File) => new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onprogress = (event) => updateReadProgress(event.loaded, event.total || source.size, "Reading file bytes");
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(reader.error ?? new Error("The browser could not read this file."));
        reader.readAsText(source);
      });
      const readAsArrayBuffer = (source: File) => new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onprogress = (event) => updateReadProgress(event.loaded, event.total || source.size, "Reading Excel bytes");
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error ?? new Error("The browser could not read this workbook."));
        reader.readAsArrayBuffer(source);
      });
      const directContacts: Contact[] = [];
      const extractedEmails = new Set<string>();
      const addRows = (rows: Record<string, unknown>[]) => {
        for (const row of rows) {
          const rawEmail = row.email ?? row.contact_value;
          if (rawEmail) {
            const email = String(rawEmail).trim().toLowerCase();
            if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) continue;
            const rawDecision = String(row.decision ?? "").toLowerCase();
            const rawProbability = Number(row.selection_probability);
            const isPreScoredQueue = ["selected", "review", "blocked"].includes(rawDecision)
              && Number.isFinite(rawProbability);
            if (isPreScoredQueue) {
              directContacts.push({
                id: String(row.email_id || email),
                email,
                domain: String(row.domain || email.split("@")[1]),
                probability: rawProbability,
                decision: rawDecision as Decision,
                reason: String(row.decision_reason || "Imported model decision"),
                approval: ["pending", "approved", "rejected"].includes(String(row.approval_status).toLowerCase())
                  ? String(row.approval_status).toLowerCase() as Approval : "pending",
                sendStatus: String(row.send_status).toLowerCase() === "queued" ? "queued" : "not_sent",
              });
              continue;
            }
            const base = scoreEmail(email);
            if (!base) continue;
            const decision: Decision = ["selected", "review", "blocked"].includes(rawDecision)
              ? rawDecision as Decision : base.decision;
            directContacts.push({
              ...base,
              id: String(row.email_id || base.id),
              probability: Number.isFinite(rawProbability) ? rawProbability : base.probability,
              decision,
              reason: String(row.decision_reason || base.reason),
              approval: ["pending", "approved", "rejected"].includes(String(row.approval_status).toLowerCase())
                ? String(row.approval_status).toLowerCase() as Approval : "pending",
            });
            continue;
          }
          for (const value of Object.values(row)) {
            const matches = String(value).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
            for (const email of matches) extractedEmails.add(email.toLowerCase());
          }
        }
      };

      if (file.name.toLowerCase().endsWith(".csv")) {
        const header = await file.slice(0, 600).text();
        const isPipelineQueue = header.startsWith("email,")
          && header.includes("email_id,selection_probability,selection_threshold,model_version,decision,decision_reason,domain_rank,approval_status,send_status");
        if (isPipelineQueue) {
          setImportStage("Using instant pipeline-queue reader…");
          setImportProgress(1);
          const text = await readAsText(file);
          const lines = text.split(/\r?\n/);
          for (let start = 1; start < lines.length; start += 50000) {
            const finish = Math.min(lines.length, start + 50000);
            for (let index = start; index < finish; index++) {
              const line = lines[index];
              if (!line) continue;
              const firstComma = line.indexOf(",");
              if (firstComma < 1) continue;
              const email = line.slice(0, firstComma).trim().toLowerCase();
              const tail = new Array<string>(9);
              let end = line.length;
              let valid = true;
              for (let field = 8; field >= 0; field--) {
                const comma = line.lastIndexOf(",", end - 1);
                if (comma < 0) { valid = false; break; }
                tail[field] = line.slice(comma + 1, end);
                end = comma;
              }
              if (!valid) continue;
              const probability = Number(tail[1]);
              const decision = tail[4] as Decision;
              if (!Number.isFinite(probability) || !["selected", "review", "blocked"].includes(decision)) continue;
              directContacts.push({
                id: tail[0] || email,
                email,
                domain: email.split("@")[1] || "",
                probability,
                decision,
                reason: tail[5] || "Imported model decision",
                approval: ["pending", "approved", "rejected"].includes(tail[7]) ? tail[7] as Approval : "pending",
                sendStatus: tail[8] === "queued" ? "queued" : "not_sent",
              });
            }
            const progress = Math.min(99, Math.round((finish / lines.length) * 100));
            setImportProgress(progress);
            setImportStage(`Loading pre-scored queue… ${progress}%`);
            await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
          }
        } else {
          setImportStage("Reading CSV chunks in the background…");
          const Papa = (await import("papaparse")).default;
          await new Promise<void>((resolve, reject) => {
            let lastReported = 0;
            Papa.parse<Record<string, unknown>>(file, {
              header: true,
            worker: false,
              skipEmptyLines: true,
              chunkSize: 8 * 1024 * 1024,
              chunk: (result) => {
                addRows(result.data);
                const progress = Math.min(99, Math.round(((result.meta.cursor ?? 0) / file.size) * 100));
                if (progress - lastReported >= 5) {
                  lastReported = progress;
                  setImportProgress(progress);
                  setImportStage(`Reading CSV rows… ${progress}%`);
                }
              },
              complete: () => resolve(),
              error: reject,
            });
          });
        }
      } else {
        const XLSX = await import("xlsx");
        const workbook = XLSX.read(await readAsArrayBuffer(file), { type: "array" });
        setImportStage("Extracting email rows from the first worksheet…");
        addRows(XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[workbook.SheetNames[0]], { defval: "" }));
      }
      setImportStage("Building the contact queue…");
      const scored = directContacts.length
        ? directContacts
        : [...extractedEmails].map(scoreEmail).filter((item): item is Contact => Boolean(item));
      const deliveryQueue = scored.map((contact) => {
        if (contact.decision === "blocked") return contact;
        const selected = contact.probability >= selectionThreshold;
        return {
          ...contact,
          decision: selected ? "selected" as const : "review" as const,
          reason: selected ? `Score meets the ${(selectionThreshold * 100).toFixed(0)}% selection threshold` : `Score is below the ${(selectionThreshold * 100).toFixed(0)}% selection threshold`,
          sendStatus: autoSend && selected ? "ready" as const : "not_sent" as const,
        };
      });
      setImportProgress(100);
      setContacts(deliveryQueue);
      setSelectedId(deliveryQueue.find((contact) => contact.decision === "selected")?.id ?? deliveryQueue[0]?.id ?? "");
      setFilter("all");
      setPage(1);
      setImportStage("Rendering the first 50 contacts…");
      notify(`${deliveryQueue.filter((contact) => contact.decision === "selected").length} recipients selected automatically`);
      if (autoSend && mailbox.connected && deliveryQueue.some((contact) => contact.decision === "selected")) {
        window.setTimeout(() => void queueMessages(deliveryQueue), 250);
      }
    } catch (error) {
      notify(`Import failed: ${error instanceof Error ? error.message : "The file could not be read."}`, 6000);
    } finally {
      setUploading(false); setImportProgress(0); setImportStage(""); event.target.value = "";
    }
  };
  const sendTest = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(testAddress)) return notify("Enter a valid test inbox first");
    await queueMessages([{ ...(active ?? scoreEmail(testAddress)!), email: testAddress, decision: "selected", sendStatus: "ready" }], true);
  };

  return (
    <main>
      <header className="topbar">
        <div className="brand"><span className="brandmark"><Mail size={19} /></span><span>ZedX AI</span></div>
        <div className="top-actions">
          <button className={`account-chip ${mailbox.connected ? "connected" : ""}`} onClick={() => document.getElementById("mailbox-connection")?.scrollIntoView({ behavior: "smooth" })}>
            <Link2 size={15} /> {mailbox.connected ? mailbox.email : "Connect email"}
          </button>
          <label className="auto-toggle"><input type="checkbox" checked={autoSend} onChange={(event) => {
            const enabled = event.target.checked;
            setAutoSend(enabled);
            setFilter(enabled ? "selected" : "all");
            setPage(1);
          }} /><span /><b>Automatic sending</b></label>
          <a className="test-download" href="/test-emails.csv" download><Download size={16} /> Test CSV</a>
          <label className="upload-button"><FileUp size={17} /> {uploading ? `Reading ${importProgress}%` : "Import CSV / Excel"}<input data-testid="file-upload" type="file" accept=".csv,.xlsx,.xls" onChange={handleUpload} /></label>
          <button className="avatar" aria-label="User menu">JG</button>
        </div>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow"><Sparkles size={14} /> Your local outreach workspace</p>
          <h1>Upload. Decide.<br />Send automatically.</h1>
          <p className="hero-copy">ZedX AI extracts every email, scores it, chooses send or skip, and builds the recipient list without per-contact approval.</p>
        </div>
        <section
          className="cursor-stage"
          aria-label="Interactive ZedX motion artwork"
          onMouseMove={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            const x = (event.clientX - bounds.left) / bounds.width - 0.5;
            const y = (event.clientY - bounds.top) / bounds.height - 0.5;
            event.currentTarget.style.setProperty("--cursor-x", `${x * 78}px`);
            event.currentTarget.style.setProperty("--cursor-y", `${y * 54}px`);
            event.currentTarget.style.setProperty("--tilt-x", `${y * -18}deg`);
            event.currentTarget.style.setProperty("--tilt-y", `${x * 24}deg`);
            event.currentTarget.style.setProperty("--glow-x", `${(x + 0.5) * 100}%`);
            event.currentTarget.style.setProperty("--glow-y", `${(y + 0.5) * 100}%`);
          }}
          onMouseLeave={(event) => {
            for (const property of ["--cursor-x", "--cursor-y", "--tilt-x", "--tilt-y"]) event.currentTarget.style.removeProperty(property);
          }}
        >
          <div className="orbital-system" aria-hidden="true">
            <i className="orbit orbit-one" /><i className="orbit orbit-two" /><i className="orbit orbit-three" />
            <div className="cursor-orb"><img src="/zedx-orb.gif" alt="" /></div>
          </div>
        </section>
      </section>

      <section className="metrics" aria-label="Pipeline totals">
        <Metric label="Emails loaded" value={totals.scanned} note="from your file" tone="neutral" />
        <Metric label="Model selected" value={totals.selected} note={totals.scanned ? `${((totals.selected / totals.scanned) * 100).toFixed(1)}% of file` : "waiting for import"} tone="green" />
        <Metric label="Skipped" value={totals.review + totals.blocked} note="not selected to send" tone="amber" />
        <Metric label="Safety blocked" value={totals.blocked} note="never eligible" tone="red" />
      </section>
      {!!contacts.length && <section className="campaign-progress" aria-label="Campaign progress">
        <div className="campaign-progress-head">
          <span><Activity size={16} /><strong>Campaign progress</strong></span>
          <b>{processedCount.toLocaleString()} of {contacts.length.toLocaleString()} processed</b>
        </div>
        <div className="campaign-progress-bar"><i style={{ width: `${Math.round((processedCount / contacts.length) * 100)}%` }} /></div>
        <div className="campaign-progress-stats">
          <span><b>{deliveryTotals.sent}</b> Sent</span>
          <span><b>{deliveryTotals.queued}</b> Queued</span>
          <span><b>{deliveryTotals.skipped}</b> Skipped</span>
          <span><b>{deliveryTotals.failed}</b> Failed</span>
        </div>
        <small>“Sent” means the connected email provider accepted the message. Final inbox delivery is controlled by the recipient’s provider.</small>
      </section>}

      <section className="workspace">
        <div className="queue-panel">
          <div className="section-title"><div><p className="eyebrow">Current batch</p><h2>Delivery recipients</h2></div><span className="count-pill">{visible.length.toLocaleString()} matches</span></div>
          <div className="toolbar">
            <label className="search"><Search size={17} /><input aria-label="Search contacts" placeholder="Search email or domain" value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} /></label>
            <label className="filter"><Filter size={16} /><select aria-label="Filter decisions" value={filter} onChange={(e) => { setFilter(e.target.value as typeof filter); setPage(1); }}><option value="all">All decisions</option><option value="selected">Selected</option><option value="review">Review</option><option value="blocked">Blocked</option></select><ChevronDown size={14} /></label>
          </div>
          {uploading && <div className="import-status" role="status"><span><Activity size={15} /> {importStage}</span><strong>{importProgress}%</strong><i><em style={{ width: `${importProgress}%` }} /></i></div>}
          <div className="table-wrap">
            <table>
              <thead><tr><th>Contact</th><th>Score</th><th>Decision</th><th>Reason</th><th>Delivery</th>{!autoSend && <th>Approval</th>}</tr></thead>
              <tbody>{displayed.map((contact) => (
                <tr key={contact.id} className={contact.id === selectedId ? "active-row" : ""} onClick={() => setSelectedId(contact.id)}>
                  <td><strong>{contact.email}</strong><span>{contact.domain}</span></td>
                  <td><div className="score-cell"><span>{Math.round(contact.probability * 100)}%</span><i><em style={{ width: `${contact.probability * 100}%` }} /></i></div></td>
                  <td><DecisionBadge decision={contact.decision} /></td>
                  <td><span className="reason-cell">{contact.reason}</span></td>
                  <td><span className={`delivery delivery-${contact.sendStatus}`} title={contact.gmailMessageId ? `Gmail reference: ${contact.gmailMessageId}` : contact.deliveryError}>{contact.sendStatus === "ready" ? (autoSend ? "Ready" : "Approved") : contact.sendStatus === "queued" ? "Queued with delay" : contact.sendStatus === "sent" ? "Sent" : contact.sendStatus === "failed" ? "Failed" : contact.decision === "selected" ? "Waiting" : "Skipped"}</span>{contact.deliveryError && <small className="delivery-error">{contact.deliveryError}</small>}</td>
                  {!autoSend && <td><div className="row-actions">
                    <button aria-label={`Approve ${contact.email}`} title="Approve" disabled={contact.sendStatus === "sent"} onClick={(event) => { event.stopPropagation(); setContacts((current) => current.map((item) => item.id === contact.id ? { ...item, approval: "approved", sendStatus: "ready" } : item)); }}><Check size={14} /></button>
                    <button aria-label={`Deny ${contact.email}`} title="Deny" disabled={contact.sendStatus === "sent"} onClick={(event) => { event.stopPropagation(); setContacts((current) => current.map((item) => item.id === contact.id ? { ...item, approval: "rejected", sendStatus: "not_sent" } : item)); }}><AlertTriangle size={14} /></button>
                  </div></td>}
                </tr>
              ))}{!visible.length && <tr><td colSpan={autoSend ? 5 : 6} className="empty-row"><FileUp size={22} /><strong>Import your CSV or Excel file to begin</strong><span>No contacts are built into this app.</span></td></tr>}</tbody>
            </table>
          </div>
          {visible.length > PAGE_SIZE && <div className="pagination"><span>{((page - 1) * PAGE_SIZE + 1).toLocaleString()}–{Math.min(page * PAGE_SIZE, visible.length).toLocaleString()} of {visible.length.toLocaleString()}</span><div><button disabled={page === 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button><button disabled={page === pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>Next</button></div></div>}
          <div className="pipeline-card pipeline-card-inline">
            <div className="pipeline-head"><span>Pipeline health</span><strong><span className="live-dot" /> Ready</strong></div>
            <div className="pipeline-inline-grid">
              <div className="pipeline-row"><span>Model</span><b>local email-selector-v1</b></div>
              <div className="pipeline-row"><span>Domain limit</span><b>1 contact</b></div>
              <div>
                <div className="pipeline-row threshold-row"><span>Selection threshold</span><b>{selectionThreshold.toFixed(2)}</b></div>
                <label className="threshold-control">
                  <input aria-label="Selection threshold" type="range" min="5" max="99" step="1" value={Math.round(selectionThreshold * 100)} onChange={(event) => updateSelectionThreshold(Number(event.target.value) / 100)} />
                  <input aria-label="Selection threshold percent" type="number" min="5" max="99" value={Math.round(selectionThreshold * 100)} onChange={(event) => updateSelectionThreshold(Number(event.target.value) / 100)} />
                  <small>%</small>
                </label>
              </div>
            </div>
          </div>
        </div>

        <aside className="composer">
          <div className="composer-head"><div><p className="eyebrow">Message lab</p><h2>Compose & test</h2></div><span className="draft-badge">Draft</span></div>
          <section className="mailbox-card" id="mailbox-connection">
            <div className="mailbox-title">
              <span><Link2 size={17} /><b>Sending account</b></span>
              {mailbox.connected && <button type="button" className="disconnect-button" aria-label="Disconnect sending account" onClick={(event) => { event.preventDefault(); event.stopPropagation(); void disconnectMailbox(); }}><Unplug size={14} /> Disconnect</button>}
            </div>
            {mailbox.connected ? (
              <div className="connected-mailbox"><CircleCheck size={19} /><span><strong>{mailbox.email}</strong><small>{mailbox.provider} · mail sends from this account</small></span></div>
            ) : (
              <>
                <p>Choose the mailbox that will send the real messages.</p>
                <div className="provider-grid">
                  <button disabled={!mailbox.configured} onClick={() => connectMailbox("google")}><b>G</b> Connect Gmail</button>
                  <button onClick={() => { setConnecting(false); setHostingerError(""); setShowHostinger((current) => !current); }}><b>H</b> Hostinger Email</button>
                </div>
                {showHostinger && <div className="hostinger-form">
                  <select aria-label="Hostinger email service" value={hostingerServer} onChange={(event) => { setHostingerServer(event.target.value); setHostingerError(""); }}>
                    <option value="smtp.hostinger.com">Hostinger Email</option>
                    <option value="smtp.titan.email">Hostinger Titan Email</option>
                  </select>
                  <input type="email" aria-label="Hostinger business email" placeholder="outreach@your-domain.com" value={hostingerEmail} onChange={(event) => setHostingerEmail(event.target.value)} />
                  <input type="password" aria-label={desktopMode ? "Hostinger mailbox password" : hostingerServer === "smtp.hostinger.com" ? "Hostinger Mail API token" : "Hostinger Titan mailbox password"} placeholder={desktopMode ? "Mailbox password" : hostingerServer === "smtp.hostinger.com" ? "Hostinger Mail API token" : "Mailbox password"} value={hostingerPassword} onChange={(event) => setHostingerPassword(event.target.value)} />
                  <button disabled={connecting} onClick={connectHostinger}>{connecting ? "Testing connection…" : "Connect securely"}</button>
                  {hostingerError && <strong className="hostinger-error">{hostingerError}</strong>}
                  {desktopMode
                    ? <small>Desktop direct SMTP connection. The mailbox password stays in this app session and is cleared when disconnected.</small>
                    : hostingerServer === "smtp.hostinger.com"
                    ? <small>Create a mailbox-scoped API token in the Hostinger email provisioning area, then paste it here. <a href="https://hpanel.hostinger.com/" target="_blank" rel="noreferrer">Open Hostinger hPanel</a>. The token stays in this browser tab.</small>
                    : <small>Use the password for this specific Titan mailbox. It stays in this browser tab and is cleared when disconnected.</small>}
                </div>}
                <small className="configuration-note"><ShieldCheck size={13} /> Free direct connection. Your Google password is never shared with ZedX AI.</small>
              </>
            )}
          </section>
          <div className="recipient"><span>Preview recipient</span><strong>{active?.email ?? "Import a file to choose a recipient"}</strong>{active && <small><DecisionBadge decision={active.decision} /> {active.reason}</small>}</div>
          <label className="field"><span>Subject</span><input aria-label="Email subject" value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
          <label className="field"><span>Message</span><textarea aria-label="Email message" value={body} onChange={(e) => setBody(e.target.value)} /></label>
          <div className="test-box">
            <div><Send size={17} /><span><strong>Real test send</strong><small>Queues one real message through the connected account.</small></span></div>
            <input aria-label="Test inbox" placeholder="your-test-inbox@example.com" value={testAddress} onChange={(e) => setTestAddress(e.target.value)} />
            <button data-testid="test-send" disabled={sending || !mailbox.connected} onClick={sendTest}><Send size={17} /> {sending ? "Queuing…" : "Send real test"}</button>
          </div>
          <div className="delay-box">
            <div><span>{autoSend ? "Automatic pacing" : "Manual sending"}</span><strong>{autoSend ? `First email immediately, then ${Math.max(1, minDelay)}–${Math.max(Math.max(1, minDelay), maxDelay)} seconds between emails` : "Approved emails send immediately"}</strong></div>
            <label><span>Minimum</span><input disabled={!autoSend} type="number" min="1" max="3600" value={minDelay} onChange={(event) => setMinDelay(Number(event.target.value))} /><small>seconds</small></label>
            <label><span>Maximum</span><input disabled={!autoSend} type="number" min={minDelay} max="7200" value={maxDelay} onChange={(event) => setMaxDelay(Number(event.target.value))} /><small>seconds</small></label>
          </div>
          <button className="queue-button" disabled={sending || !mailbox.connected || !(autoSend ? totals.selected : approvedCount)} onClick={() => void queueMessages()}>
            <Send size={17} /> {sending ? "Queuing real emails…" : autoSend ? `Queue ${totals.selected.toLocaleString()} selected emails` : `Send ${approvedCount.toLocaleString()} approved emails`}
          </button>
          <div className="approval-summary"><CircleCheck size={17} /><span><strong>{autoSend ? "Automatic decisions enabled" : "Manual approval enabled"}</strong><small>{autoSend ? "Up to 50 messages are paced per batch. Keep this tab open while they send." : "Approve or deny every address, then send only the approved list."}</small></span></div>
        </aside>
      </section>
      <footer><span><Activity size={15} /> ZedX AI outreach workflow</span><span>{mailbox.connected ? `Real delivery connected as ${mailbox.email}` : "Connect a mailbox to enable real delivery."}</span></footer>
      {toast && <div className="toast" role="status"><CircleCheck size={18} /> {toast}</div>}
    </main>
  );
}

function Metric({ label, value, note, tone }: { label: string; value: number; note: string; tone: string }) {
  return <article className={`metric ${tone}`}><span>{label}</span><strong>{value.toLocaleString()}</strong><small>{note}</small></article>;
}
function DecisionBadge({ decision }: { decision: Decision }) {
  return <span className={`badge decision-${decision}`}>{decision === "selected" ? <Check size={13} /> : decision === "blocked" ? <ShieldCheck size={13} /> : <AlertTriangle size={13} />}{decision}</span>;
}
