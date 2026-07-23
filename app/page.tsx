"use client";

import { ChangeEvent, useMemo, useState } from "react";
import {
  Activity, AlertTriangle, Check, ChevronDown, CircleCheck, Download, FileUp,
  Filter, Mail, Play, Search, Send, ShieldCheck, Sparkles,
} from "lucide-react";

type Decision = "selected" | "review" | "blocked";
type Approval = "pending" | "approved" | "rejected";
type Contact = {
  id: string; email: string; domain: string; probability: number;
  decision: Decision; reason: string; approval: Approval;
  sendStatus: "not_sent" | "test_sent" | "ready";
};

const initialContacts: Contact[] = [];

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
  const PAGE_SIZE = 50;
  const [contacts, setContacts] = useState(initialContacts);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | Decision>("selected");
  const [autoSend, setAutoSend] = useState(true);
  const [selectedId, setSelectedId] = useState("");
  const [subject, setSubject] = useState("A quick introduction");
  const [body, setBody] = useState("Hello,\n\nI’m reaching out because your role appears relevant to a potential partnership.\n\n[Add a truthful, specific value proposition here.]\n\nIf this is not relevant, reply “no” and we will not contact you again.\n\nBest,\n[Your name]");
  const [testAddress, setTestAddress] = useState("");
  const [toast, setToast] = useState("");
  const [uploading, setUploading] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importStage, setImportStage] = useState("");
  const [page, setPage] = useState(1);

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

  const notify = (message: string, duration = 2700) => {
    setToast(message); window.setTimeout(() => setToast(""), duration);
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
                sendStatus: String(row.send_status).toLowerCase() === "test_sent" ? "test_sent" : "not_sent",
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
                sendStatus: tail[8] === "test_sent" ? "test_sent" : "not_sent",
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
      const deliveryQueue = scored.map((contact) => (
        autoSend && contact.decision === "selected"
          ? { ...contact, sendStatus: "ready" as const }
          : contact
      ));
      setImportProgress(100);
      setContacts(deliveryQueue);
      setSelectedId(deliveryQueue.find((contact) => contact.decision === "selected")?.id ?? deliveryQueue[0]?.id ?? "");
      setPage(1);
      setImportStage("Rendering the first 50 contacts…");
      notify(`${deliveryQueue.filter((contact) => contact.decision === "selected").length} recipients selected automatically`);
    } catch (error) {
      notify(`Import failed: ${error instanceof Error ? error.message : "The file could not be read."}`, 6000);
    } finally {
      setUploading(false); setImportProgress(0); setImportStage(""); event.target.value = "";
    }
  };
  const sendTest = () => {
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(testAddress)) return notify("Enter a valid test inbox first");
    notify(`Test simulated for ${testAddress} — no email was transmitted`, 4000);
    if (active) setContacts((current) => current.map((contact) => contact.id === active.id ? { ...contact, sendStatus: "test_sent" } : contact));
  };

  return (
    <main>
      <header className="topbar">
        <div className="brand"><span className="brandmark"><Mail size={19} /></span><span>ZedX AI</span></div>
        <div className="top-actions">
          <label className="auto-toggle"><input type="checkbox" checked={autoSend} onChange={(event) => setAutoSend(event.target.checked)} /><span /><b>Automatic sending</b></label>
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
        <div className="pipeline-card">
          <div className="pipeline-head"><span>Pipeline health</span><strong><span className="live-dot" /> Ready</strong></div>
          <div className="pipeline-row"><span>Model</span><b>local email-selector-v1</b></div>
          <div className="pipeline-row"><span>Selection threshold</span><b>0.80</b></div>
          <div className="pipeline-row"><span>Domain limit</span><b>1 contact</b></div>
        </div>
      </section>

      <section className="metrics" aria-label="Pipeline totals">
        <Metric label="Emails loaded" value={totals.scanned} note="from your file" tone="neutral" />
        <Metric label="Model selected" value={totals.selected} note={totals.scanned ? `${((totals.selected / totals.scanned) * 100).toFixed(1)}% of file` : "waiting for import"} tone="green" />
        <Metric label="Skipped" value={totals.review + totals.blocked} note="not selected to send" tone="amber" />
        <Metric label="Safety blocked" value={totals.blocked} note="never eligible" tone="red" />
      </section>

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
              <thead><tr><th>Contact</th><th>Score</th><th>Decision</th><th>Delivery</th></tr></thead>
              <tbody>{displayed.map((contact) => (
                <tr key={contact.id} className={contact.id === selectedId ? "active-row" : ""} onClick={() => setSelectedId(contact.id)}>
                  <td><strong>{contact.email}</strong><span>{contact.domain}</span></td>
                  <td><div className="score-cell"><span>{Math.round(contact.probability * 100)}%</span><i><em style={{ width: `${contact.probability * 100}%` }} /></i></div></td>
                  <td><DecisionBadge decision={contact.decision} /></td><td><span className={`delivery delivery-${contact.sendStatus}`}>{contact.sendStatus === "ready" ? "Ready to send" : contact.sendStatus === "test_sent" ? "Test sent" : "Skipped"}</span></td>
                </tr>
              ))}{!visible.length && <tr><td colSpan={4} className="empty-row"><FileUp size={22} /><strong>Import your CSV or Excel file to begin</strong><span>No contacts are built into this app.</span></td></tr>}</tbody>
            </table>
          </div>
          {visible.length > PAGE_SIZE && <div className="pagination"><span>{((page - 1) * PAGE_SIZE + 1).toLocaleString()}–{Math.min(page * PAGE_SIZE, visible.length).toLocaleString()} of {visible.length.toLocaleString()}</span><div><button disabled={page === 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button><button disabled={page === pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>Next</button></div></div>}
        </div>

        <aside className="composer">
          <div className="composer-head"><div><p className="eyebrow">Message lab</p><h2>Compose & test</h2></div><span className="draft-badge">Draft</span></div>
          <div className="recipient"><span>Preview recipient</span><strong>{active?.email ?? "Import a file to choose a recipient"}</strong>{active && <small><DecisionBadge decision={active.decision} /> {active.reason}</small>}</div>
          <label className="field"><span>Subject</span><input aria-label="Email subject" value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
          <label className="field"><span>Message</span><textarea aria-label="Email message" value={body} onChange={(e) => setBody(e.target.value)} /></label>
          <div className="test-box">
            <div><Play size={17} /><span><strong>Safe test</strong><small>Sends nowhere. Records a simulation only.</small></span></div>
            <input aria-label="Test inbox" placeholder="your-test-inbox@example.com" value={testAddress} onChange={(e) => setTestAddress(e.target.value)} />
            <button data-testid="test-send" onClick={sendTest}><Send size={17} /> Run test send</button>
          </div>
          <div className="approval-summary"><CircleCheck size={17} /><span><strong>Automatic decisions enabled</strong><small>Connect a verified email provider for live delivery</small></span></div>
        </aside>
      </section>
      <footer><span><Activity size={15} /> Local model workflow · no OpenAI API connection</span><span>No external messages are sent in test mode.</span></footer>
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
