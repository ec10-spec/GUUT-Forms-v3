import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { newField } from "./fields.js";
import AiSuggestions from "./AiSuggestions.jsx";

const TEMPLATES = [
  { name: "Contact Form", fields: ["text:Full Name", "text:Email", "textarea:Message"] },
  { name: "Event RSVP", fields: ["text:Name", "select:Attending?", "checkbox:Dietary restrictions"] },
  { name: "Feedback Survey", fields: ["text:Name", "rating:Overall rating", "textarea:Comments"] },
];

function fieldsFromTemplate(spec) {
  return spec.map((s, i) => {
    const [type, label] = s.split(":");
    const f = newField(type, i);
    f.label = label;
    if (type === "select") f.options = ["Yes", "No", "Maybe"];
    if (type === "checkbox") f.options = ["Vegetarian", "Vegan", "Gluten-free", "None"];
    return f;
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Single landing page: create something new (AI or template) and browse
 * existing forms, both visible together — no separate "new form" page to
 * navigate to and back from.
 */
export default function Home({ user, onOpenDraft, onOpenForm }) {
  // --- creation panel state ---
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [attachment, setAttachment] = useState(null);
  const [maxTokens, setMaxTokens] = useState(1000);
  const [budget, setBudget] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState(null);
  const [genNeedsKey, setGenNeedsKey] = useState(false);
  const [suggested, setSuggested] = useState(null);

  // --- forms list state ---
  const [forms, setForms] = useState([]);
  const [q, setQ] = useState("");
  const [loadingForms, setLoadingForms] = useState(true);
  const [formsError, setFormsError] = useState(null);

  useEffect(() => {
    api.getAiBudget().then(setBudget).catch(() => {});
    loadForms();
  }, []);

  async function loadForms(query = "") {
    setLoadingForms(true);
    try {
      setForms(await api.listForms(query));
      setFormsError(null);
    } catch (err) {
      // "No database yet" is already explained by the banner above.
      setFormsError(err.code === "NO_COMPANY_DB" ? null : err.message);
      if (err.code === "NO_COMPANY_DB") setForms([]);
    } finally {
      setLoadingForms(false);
    }
  }

  async function handleAttachmentChange(e) {
    const file = e.target.files?.[0];
    if (!file) return setAttachment(null);
    const ext = file.name.split(".").pop()?.toLowerCase();
    const kind = file.type === "application/pdf"
      ? "pdf"
      : file.type.startsWith("image/")
      ? "image"
      : ext === "xlsx" || ext === "xls" || file.type.includes("spreadsheet") || file.type === "application/vnd.ms-excel"
      ? "spreadsheet"
      : ext === "csv" || ext === "txt" || file.type === "text/csv" || file.type === "text/plain"
      ? "text"
      : null;
    if (!kind) {
      setGenError("Only images, PDFs, Excel (.xlsx/.xls), or CSV/text files can be attached.");
      return;
    }
    setGenError(null);
    setAttachment({ file, mediaType: file.type, kind });
  }

  async function handleGenerate() {
    if (!prompt.trim()) return;
    setGenerating(true);
    setGenError(null);
    try {
      let attachmentPayload = null;
      if (attachment) {
        const base64 = await fileToBase64(attachment.file);
        attachmentPayload = { base64, mediaType: attachment.mediaType, kind: attachment.kind, filename: attachment.file.name };
      }
      const { draft, tokenBudget } = await api.generateForm(prompt, { maxTokens, attachment: attachmentPayload });
      setBudget(tokenBudget);
      setSuggested({ ...draft, generationPrompt: prompt });
    } catch (err) {
      setGenError(err.message);
      setGenNeedsKey(err.code === "NO_API_KEY" || err.code === "BAD_API_KEY");
    } finally {
      setGenerating(false);
    }
  }

  function handleTemplate(t) {
    onOpenDraft({ title: t.name, description: "", fields: fieldsFromTemplate(t.fields), source: "manual", generationPrompt: null });
  }

  async function handleDelete(id, e) {
    e.stopPropagation();
    if (!confirm("Delete this form and its submissions?")) return;
    await api.deleteForm(id);
    loadForms(q);
  }

  if (suggested) {
    return (
      <AiSuggestions
        title={suggested.title}
        description={suggested.description}
        fields={suggested.fields}
        onDiscard={() => setSuggested(null)}
        onConfirm={(finalDraft) => onOpenDraft({ ...finalDraft, source: "ai_generated", generationPrompt: suggested.generationPrompt })}
      />
    );
  }

  return (
    <div className="home">
      {user && user.role !== "superadmin" && user.company?.dbMode !== "custom" && (
        <div className="db-banner">
          <strong>Connect your database to start building forms.</strong>{" "}
          {user.role === "admin" ? (
            <>Your forms and responses are stored in your own database. <button className="link-btn" onClick={() => { window.location.hash = "/settings"; }}>Open Settings → Database</button></>
          ) : (
            <>Ask your company admin to connect it (Settings → Database).</>
          )}
        </div>
      )}
      <section className="hero">
        <span className="hero-eyebrow">
          <span className="dot" /> New form
        </span>
        <h1>Describe it. We'll draft it. You finish it.</h1>

        <div className="hero-prompt-row">
          <textarea
            className="hero-textarea"
            placeholder="e.g. A price quote form with product selection and a summary"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={2}
          />
          <button className="primary hero-generate-btn" disabled={generating} onClick={handleGenerate}>
            {generating ? "Generating..." : "Generate"}
          </button>
        </div>

        <div className="hero-secondary-row">
          <button className="link-btn" onClick={() => setShowAdvanced((s) => !s)}>
            {showAdvanced ? "Hide options" : "Attach a file, set a token limit"}
          </button>
          {budget && <span className="budget-display">{budget.remaining.toLocaleString()} / {budget.limit.toLocaleString()} tokens left today</span>}
        </div>

        {showAdvanced && (
          <div className="ai-controls-row">
            <label className="attach-label">
              Attach reference (image, PDF, Excel, or CSV)
              <input
                type="file"
                accept="image/*,application/pdf,.xlsx,.xls,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv,text/plain"
                onChange={handleAttachmentChange}
                hidden
              />
            </label>
            {attachment && <span className="attach-name">{attachment.file.name}</span>}
            <label className="token-limit-label">
              Max tokens
              <input type="number" min={200} max={1500} step={100} value={maxTokens} onChange={(e) => setMaxTokens(Number(e.target.value))} />
            </label>
          </div>
        )}
        {genError && (
          <p className="error">
            {genError}{" "}
            {genNeedsKey && <button className="link-btn" onClick={() => { window.location.hash = "/settings"; }}>Open Settings</button>}
          </p>
        )}

        <div className="template-row">
          <span>Or start from:</span>
          {TEMPLATES.map((t) => (
            <button key={t.name} className="template-chip" onClick={() => handleTemplate(t)}>{t.name}</button>
          ))}
          <button
            className="template-chip"
            onClick={() => onOpenDraft({ title: "Untitled Form", description: "", fields: [], source: "manual", generationPrompt: null })}
          >
            Blank form
          </button>
        </div>
      </section>

      <section className="your-forms">
        <div className="your-forms-header">
          <h2>Your forms</h2>
          <input
            placeholder="Search forms..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && loadForms(q)}
          />
        </div>

        {formsError && <p className="error">{formsError}</p>}
        {loadingForms ? (
          <p className="empty-hint">Loading...</p>
        ) : forms.length === 0 ? (
          <p className="empty-hint">No forms yet — describe one above to get started.</p>
        ) : (
          <div className="forms-grid">
            {forms.map((f) => (
              <div key={f._id} className="form-card" onClick={() => onOpenForm(f)}>
                <h3>{f.title}</h3>
                <p className="form-meta">
                  {f.fields.length} field{f.fields.length === 1 ? "" : "s"}, {f.source === "manual" ? "built manually" : "AI-generated"}
                  {f.publishedAt ? ", published" : ", draft"}
                </p>
                <button className="danger small" onClick={(e) => handleDelete(f._id, e)}>Delete</button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
