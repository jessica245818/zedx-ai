"use client";

import { ChangeEvent, useMemo, useState } from "react";
import {
  Activity, AlertTriangle, Check, ChevronDown, CircleCheck, FileUp,
  Filter, Mail, Play, Search, Send, ShieldCheck, Sparkles, X,
} from "lucide-react";

type Decision = "selected" | "review" | "blocked";
type Approval = "pending" | "approved" | "rejected";
type Contact = {
  id: string; email: string; domain: string; probability: number;
  decision: Decision; reason: string; approval: Approval;
  sendStatus: "not_sent" | "test_sent";
};

const initialContacts: Contact[] = [
  ["b0b3aa9700d8e612", "business.development@getg5.com", "getg5.com", 1, "selected"],
  ["b531483daa75c296", "business.development@nocomi.media", "nocomi.media", 1, "selected"],
  ["3085b4e6a4af2778", "business.development@spazio38.com", "spazio38.com", 1, "selected"],
  ["3302dffdb6ef1748", "business.development@eztable.com", "eztable.com", 1, "selected"],
  ["0bd9ae5503ab501d", "business.development@orau.org", "orau.org", 1, "selected"],
  ["52812f76ac7216d1", "dldwdworkforcedevelopment-labor@maryland.gov", "maryland.gov", .999995, "review"],
  ["ad0ea886bc8218ee", "securitiesgeneral.questions@com.state.oh.us", "com.state.oh.us", .999995, "review"],
  ["a5624c63c52a1c9a", "ndscs.businessaffairsoffice@ndscs.edu", "ndscs.edu", .999994, "review"],
].map(([id, email, domain, probability, decision]) => ({
  id: String(id), email: String(email), domain: String(domain),
  probability: Number(probability), decision: decision as Decision,
  reason: decision === "selected" ? "Model score passed the 0.80 threshold" : "High score, unusual mailbox — review required",
  approval: "pending", sendStatus: "not_sent",
}));

const totals = { scanned: 323030, selected: 41206, review: 273763, blocked: 8061 };

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
  const [contacts, setContacts] = useState(initialContacts);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | Decision>("all");
  const [selectedId, setSelectedId] = useState(initialContacts[0].id);
  const [subject, setSubject] = useState("A quick introduction");
  const [body, setBody] = useState("Hello,\n\nI’m reaching out because your role appears relevant to a potential partnership.\n\n[Add a truthful, specific value proposition here.]\n\nIf this is not relevant, reply “no” and we will not contact you again.\n\nBest,\n[Your name]");
  const [testAddress, setTestAddress] = useState("");
  const [toast, setToast] = useState("");
  const [uploading, setUploading] = useState(false);

  const visible = useMemo(() => contacts.filter((contact) => {
    const matchesQuery = contact.email.includes(query.toLowerCase()) || contact.domain.includes(query.toLowerCase());
    return matchesQuery && (filter === "all" || contact.decision === filter);
  }), [contacts, query, filter]);
  const active = contacts.find((contact) => contact.id === selectedId) ?? contacts[0];
  const approvedCount = contacts.filter((contact) => contact.approval === "approved").length;

  const notify = (message: string, duration = 2700) => {
    setToast(message); window.setTimeout(() => setToast(""), duration);
  };
  const updateApproval = (id: string, approval: Approval) => {
    setContacts((current) => current.map((contact) => contact.id === id ? { ...contact, approval } : contact));
    notify(approval === "approved" ? "Contact approved for drafting" : "Contact removed from this campaign");
  };
  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });
      const found = new Set<string>();
      rows.forEach((row) => Object.values(row).forEach((value) => {
        (String(value).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []).forEach((email) => found.add(email.toLowerCase()));
      }));
      const scored = [...found].map(scoreEmail).filter((item): item is Contact => Boolean(item));
      setContacts((current) => [...scored, ...current.filter((item) => !found.has(item.email))]);
      notify(`${scored.length} unique emails imported and scored`);
    } catch {
      notify("That file could not be read. Try CSV or XLSX.");
    } finally {
      setUploading(false); event.target.value = "";
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
        <div className="brand"><span className="brandmark"><Mail size={19} /></span><span>ReachPilot</span></div>
        <div className="top-actions">
          <span className="safe-badge"><ShieldCheck size={15} /> Safe test mode</span>
          <label className="upload-button"><FileUp size={17} /> {uploading ? "Reading…" : "Import CSV / Excel"}<input data-testid="file-upload" type="file" accept=".csv,.xlsx,.xls" onChange={handleUpload} /></label>
          <button className="avatar" aria-label="User menu">JG</button>
        </div>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow"><Sparkles size={14} /> AI outreach workspace</p>
          <h1>Decide who deserves<br />a thoughtful email.</h1>
          <p className="hero-copy">Review the selector’s recommendations, approve the right contacts, and test your message before anything goes out.</p>
        </div>
        <div className="pipeline-card">
          <div className="pipeline-head"><span>Pipeline health</span><strong><span className="live-dot" /> Ready</strong></div>
          <div className="pipeline-row"><span>Model</span><b>email-selector-v1</b></div>
          <div className="pipeline-row"><span>Selection threshold</span><b>0.80</b></div>
          <div className="pipeline-row"><span>Domain limit</span><b>1 contact</b></div>
          <div className="pipeline-note"><AlertTriangle size={16} /> Weak-label model — human approval required.</div>
        </div>
      </section>

      <section className="metrics" aria-label="Pipeline totals">
        <Metric label="Emails scanned" value={totals.scanned} note="validated contacts" tone="neutral" />
        <Metric label="AI selected" value={totals.selected} note="12.8% of total" tone="green" />
        <Metric label="Needs review" value={totals.review} note="human decision" tone="amber" />
        <Metric label="Safety blocked" value={totals.blocked} note="never eligible" tone="red" />
      </section>

      <section className="workspace">
        <div className="queue-panel">
          <div className="section-title"><div><p className="eyebrow">Current batch</p><h2>Contact queue</h2></div><span className="count-pill">{visible.length} shown</span></div>
          <div className="toolbar">
            <label className="search"><Search size={17} /><input aria-label="Search contacts" placeholder="Search email or domain" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
            <label className="filter"><Filter size={16} /><select aria-label="Filter decisions" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}><option value="all">All decisions</option><option value="selected">Selected</option><option value="review">Review</option><option value="blocked">Blocked</option></select><ChevronDown size={14} /></label>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Contact</th><th>Score</th><th>Decision</th><th>Approval</th><th /></tr></thead>
              <tbody>{visible.map((contact) => (
                <tr key={contact.id} className={contact.id === selectedId ? "active-row" : ""} onClick={() => setSelectedId(contact.id)}>
                  <td><strong>{contact.email}</strong><span>{contact.domain}</span></td>
                  <td><div className="score-cell"><span>{Math.round(contact.probability * 100)}%</span><i><em style={{ width: `${contact.probability * 100}%` }} /></i></div></td>
                  <td><DecisionBadge decision={contact.decision} /></td><td><ApprovalBadge approval={contact.approval} /></td>
                  <td className="row-actions">{contact.decision !== "blocked" && <><button aria-label={`Approve ${contact.email}`} onClick={(e) => { e.stopPropagation(); updateApproval(contact.id, "approved"); }}><Check size={16} /></button><button aria-label={`Reject ${contact.email}`} onClick={(e) => { e.stopPropagation(); updateApproval(contact.id, "rejected"); }}><X size={16} /></button></>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>

        <aside className="composer">
          <div className="composer-head"><div><p className="eyebrow">Message lab</p><h2>Compose & test</h2></div><span className="draft-badge">Draft</span></div>
          <div className="recipient"><span>Preview recipient</span><strong>{active?.email}</strong><small><DecisionBadge decision={active?.decision ?? "review"} /> {active?.reason}</small></div>
          <label className="field"><span>Subject</span><input aria-label="Email subject" value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
          <label className="field"><span>Message</span><textarea aria-label="Email message" value={body} onChange={(e) => setBody(e.target.value)} /></label>
          <div className="test-box">
            <div><Play size={17} /><span><strong>Safe test</strong><small>Sends nowhere. Records a simulation only.</small></span></div>
            <input aria-label="Test inbox" placeholder="your-test-inbox@example.com" value={testAddress} onChange={(e) => setTestAddress(e.target.value)} />
            <button data-testid="test-send" onClick={sendTest}><Send size={17} /> Run test send</button>
          </div>
          <div className="approval-summary"><CircleCheck size={17} /><span><strong>{approvedCount} approved</strong><small>Live delivery remains locked</small></span></div>
        </aside>
      </section>
      <footer><span><Activity size={15} /> Connected to the 323,030-contact pipeline snapshot</span><span>No external messages are sent in test mode.</span></footer>
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
function ApprovalBadge({ approval }: { approval: Approval }) {
  return <span className={`approval approval-${approval}`}>{approval}</span>;
}
