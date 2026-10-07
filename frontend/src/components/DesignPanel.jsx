import React from "react";

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Lightweight form theming (Phase 1 of design). Sets a primary/accent color, a
 * page background, and an optional header image. The full two-window Design
 * Studio (sections, layout, advanced backgrounds) is Phase 2.
 */
export default function DesignPanel({ theme, onChange }) {
  const t = theme || {};

  function set(patch) {
    onChange({ ...t, ...patch });
  }

  async function onHeaderFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return;
    const dataUrl = await fileToDataUrl(file);
    set({ headerImage: dataUrl });
  }

  return (
    <div className="design-panel">
      <div className="design-controls">
        <h2>Design</h2>
        <p className="hint">Style how this form looks to respondents.</p>

        <label className="color-field">
          Primary / accent color
          <span className="color-input-row">
            <input type="color" value={t.primaryColor || "#001549"} onChange={(e) => set({ primaryColor: e.target.value })} />
            <input className="color-hex" value={t.primaryColor || "#001549"} onChange={(e) => set({ primaryColor: e.target.value })} />
          </span>
        </label>

        <label className="color-field">
          Page background
          <span className="color-input-row">
            <input type="color" value={t.backgroundColor || "#f6f7fb"} onChange={(e) => set({ backgroundColor: e.target.value })} />
            <input className="color-hex" value={t.backgroundColor || "#f6f7fb"} onChange={(e) => set({ backgroundColor: e.target.value })} />
          </span>
        </label>

        <label className="header-image-field">
          Header image (optional)
          <input type="file" accept="image/*" onChange={onHeaderFile} hidden />
        </label>
        {t.headerImage && (
          <div className="header-image-preview">
            <img src={t.headerImage} alt="Header preview" />
            <button className="danger small" onClick={() => set({ headerImage: null })}>Remove</button>
          </div>
        )}
      </div>

      <div className="design-live-preview" style={{ background: t.backgroundColor || "#f6f7fb" }}>
        {t.headerImage && <img className="preview-header-img" src={t.headerImage} alt="" />}
        <div className="preview-card">
          <div className="preview-line long" />
          <div className="preview-line" />
          <div className="preview-field" />
          <div className="preview-field" />
          <button className="primary" style={{ background: t.primaryColor || "#001549", borderColor: t.primaryColor || "#001549" }}>
            Submit
          </button>
        </div>
      </div>
    </div>
  );
}
