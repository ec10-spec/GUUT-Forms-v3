import React, { useEffect, useState } from "react";
import { api } from "../api.js";

export default function SubmissionsView({ form }) {
  const [submissions, setSubmissions] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState(null);

  const fields = [...form.fields].sort((a, b) => a.order - b.order);

  async function load(query = "") {
    setLoading(true);
    try {
      setSubmissions(await api.listSubmissions(form._id, query));
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function exportCsv() {
    setExporting(true);
    try {
      await api.downloadCsv(form._id, form.title);
    } catch (err) {
      setError(err.message);
    } finally {
      setExporting(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form._id]);

  return (
    <div className="submissions-view">
      <div className="submissions-header">
        <h2>Submissions for "{form.title}"</h2>
        <input
          placeholder="Search submissions..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load(q)}
        />
        <button onClick={() => load(q)}>Search</button>
        <button className="secondary" disabled={exporting} onClick={exportCsv}>
          {exporting ? "Exporting..." : "Export CSV"}
        </button>
      </div>

      {error && <p className="error">{error}</p>}
      {loading ? (
        <p>Loading...</p>
      ) : submissions.length === 0 ? (
        <p className="empty-hint">No submissions yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Submitted</th>
              {fields.map((f) => (
                <th key={f.id}>{f.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {submissions.map((s) => (
              <tr key={s._id}>
                <td>{new Date(s.createdAt).toLocaleString()}</td>
                {fields.map((f) => (
                  <td key={f.id}>{String(s.answers?.[f.id] ?? "")}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
