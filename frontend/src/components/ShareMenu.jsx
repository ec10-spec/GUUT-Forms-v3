import React, { useEffect, useRef, useState } from "react";
import { generateStandaloneHtml } from "../lib/standaloneExport.js";

/**
 * Persistent share control in the workspace header (same pattern as Google
 * Forms/Docs). Copy link and Open in new tab work once the form is published.
 * "List in public repository" toggles whether the form appears on /explore.
 * "Run on your own server" lets the client download a self-contained HTML
 * copy of the form to host wherever they like, instead of relying on our
 * hosted #/f/<id> page — it still posts submissions to a backend (this one
 * by default, or their own if they've deployed one, see SETUP.md).
 * "Share with people to edit" stays a Phase 2 placeholder.
 */
export default function ShareMenu({ shareUrl, published, isPublic, onTogglePublic, form }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selfHostOpen, setSelfHostOpen] = useState(false);
  const [apiBase, setApiBase] = useState(() => window.location.origin);
  const ref = useRef(null);

  useEffect(() => {
    function onClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setSelfHostOpen(false); }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function copy() {
    if (!published) return;
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function openInNewTab() {
    if (!published) return;
    window.open(shareUrl, "_blank", "noopener,noreferrer");
  }

  function downloadStandalone() {
    if (!published || !form) return;
    const html = generateStandaloneHtml(form, apiBase.trim());
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(form.title || "form").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="share-menu" ref={ref}>
      <button className="share-trigger" onClick={() => setOpen((o) => !o)} aria-label="Share">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
          <line x1="8.6" y1="10.6" x2="15.4" y2="6.4" /><line x1="8.6" y1="13.4" x2="15.4" y2="17.6" />
        </svg>
        Share
      </button>

      {open && (
        <div className="share-panel">
          <div className={`share-row ${published ? "" : "disabled"}`} onClick={copy} title={published ? "" : "Publish this form to get a shareable link"}>
            <div>
              <strong>Copy link</strong>
              <span>{published ? "Anyone with the link can fill this out" : "Publish the form first"}</span>
            </div>
            {published && <span className="share-row-action">{copied ? "Copied" : "Copy"}</span>}
          </div>

          <div className={`share-row ${published ? "" : "disabled"}`} onClick={openInNewTab} title={published ? "" : "Publish this form first"}>
            <div>
              <strong>Open in new tab</strong>
              <span>Preview the live form as a respondent</span>
            </div>
            {published && <span className="share-row-action">Open ↗</span>}
          </div>

          <div className={`share-row toggle-row ${published ? "" : "disabled"}`} title={published ? "" : "Publish this form first"}>
            <div>
              <strong>List in public repository</strong>
              <span>Show on the Explore page for anyone to find</span>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={!!isPublic}
                disabled={!published}
                onChange={(e) => onTogglePublic?.(e.target.checked)}
              />
              <span className="switch-slider" />
            </label>
          </div>

          <div
            className={`share-row ${published ? "" : "disabled"}`}
            onClick={() => published && setSelfHostOpen((o) => !o)}
            title={published ? "" : "Publish this form first"}
          >
            <div>
              <strong>Run on your own server</strong>
              <span>Download a standalone copy the client can self-host</span>
            </div>
            {published && <span className="share-row-action">{selfHostOpen ? "Hide" : "Set up"}</span>}
          </div>

          {selfHostOpen && published && (
            <div className="self-host-panel">
              <label className="self-host-label">
                API base URL (where submissions get sent)
                <input
                  value={apiBase}
                  onChange={(e) => setApiBase(e.target.value)}
                  placeholder="https://your-backend.example.com"
                />
              </label>
              <p className="self-host-hint">
                Leave this as-is to keep submissions flowing to this GUUT deployment, or point it at your
                own backend if you've deployed one (see SETUP.md). Either way the downloaded page is a
                single HTML file with no other dependencies — host it anywhere.
              </p>
              <button className="secondary small self-host-download" onClick={downloadStandalone}>
                Download standalone HTML
              </button>
            </div>
          )}

          <div className="share-row disabled" title="Coming in a later phase">
            <div>
              <strong>Share with people to edit</strong>
              <span>Invite teammates as editors</span>
            </div>
            <span className="coming-soon-tag">Coming soon</span>
          </div>
        </div>
      )}
    </div>
  );
}
