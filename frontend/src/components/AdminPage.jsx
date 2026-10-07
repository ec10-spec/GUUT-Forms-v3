import React, { useEffect, useState } from "react";
import { api } from "../api.js";

/**
 * Superadmin console: platform health, companies and their linked databases,
 * users, and the backend logs. Every endpoint behind this page is also
 * enforced server-side; hiding the link in the UI is only a convenience.
 */
export default function AdminPage({ currentUser }) {
  return currentUser.role === "superadmin" ? <PlatformAdmin currentUser={currentUser} /> : <CompanyAdmin currentUser={currentUser} />;
}

// The platform team (us): every company, every user, all logs.
function PlatformAdmin({ currentUser }) {
  const [tab, setTab] = useState("companies");
  return (
    <div className="admin-page">
      <span className="hero-eyebrow"><span className="dot" /> Platform team</span>
      <h1>Admin</h1>
      <div className="settings-tabs">
        {[["companies", "Companies & databases"], ["users", "Users"], ["logs", "Logs"], ["overview", "Platform"]].map(([id, label]) => (
          <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {tab === "companies" && <Companies />}
      {tab === "users" && <Users currentUser={currentUser} />}
      {tab === "logs" && <Logs />}
      {tab === "overview" && <Overview />}
    </div>
  );
}

// A customer's company admin: their team and the problems with their forms.
// (Their database link lives in Settings → Database.)
function CompanyAdmin({ currentUser }) {
  const [tab, setTab] = useState("problems");
  const [info, setInfo] = useState(null);
  useEffect(() => { api.companyInfo().then(setInfo).catch(() => {}); }, []);
  return (
    <div className="admin-page">
      <span className="hero-eyebrow"><span className="dot" /> {info?.name || "Your company"}</span>
      <h1>Admin</h1>
      {info && info.dbMode !== "custom" && (
        <div className="db-banner">
          <strong>No database connected.</strong> Your team can't create forms until you connect one.{" "}
          <button className="link-btn" onClick={() => { window.location.hash = "/settings"; }}>Open Settings → Database</button>
        </div>
      )}
      <div className="settings-tabs">
        <button className={tab === "problems" ? "active" : ""} onClick={() => setTab("problems")}>Form problems</button>
        <button className={tab === "team" ? "active" : ""} onClick={() => setTab("team")}>Team</button>
      </div>
      {tab === "problems" && <Problems />}
      {tab === "team" && <Team currentUser={currentUser} />}
    </div>
  );
}

const fmt = (d) => (d ? new Date(d).toLocaleString() : "-");

// ------------------------------------------------------------------ platform
function Overview() {
  const [o, setO] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { api.adminOverview().then(setO).catch((e) => setError(e.message)); }, []);
  if (error) return <p className="error">{error}</p>;
  if (!o) return <p className="empty-hint">Loading...</p>;
  return (
    <div className="settings-panel wide">
      <h2>Platform database (ours)</h2>
      <p className="settings-hint">
        Holds accounts, companies, logs and the form directory. It is set with the <code>MONGO_URI</code> environment
        variable on your host (Render), so it is changed there, not here. Customer form data lives in each company's own database.
      </p>
      <p className="key-status">
        <span className={`key-dot ${o.platformDb.connected ? "key-dot-on" : ""}`} />
        {o.platformDb.connected ? `Connected to ${o.platformDb.host} / ${o.platformDb.name}` : "Not connected"}
      </p>
      <div className="stat-row">
        {[["Users", o.counts.users], ["Companies", o.counts.companies], ["Forms", o.counts.forms], ["Errors (24h)", o.counts.errors24h], ["Warnings (24h)", o.counts.warns24h]].map(([k, v]) => (
          <div key={k} className="stat"><strong>{v}</strong><span>{k}</span></div>
        ))}
      </div>
      <p className="settings-hint">
        Customer forms and responses are never stored here. A company can't create forms until its admin links a database.
      </p>
    </div>
  );
}

// ------------------------------------------------------- companies + databases
function Companies() {
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  const [name, setName] = useState("");
  const [open, setOpen] = useState(null); // company id with the link-database form open

  async function load() {
    try { setList(await api.adminCompanies()); setError(null); } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function create(e) {
    e.preventDefault();
    try { await api.adminCreateCompany(name); setName(""); load(); } catch (err) { setError(err.message); }
  }

  return (
    <div>
      {error && <p className="error">{error}</p>}
      <form className="inline-form" onSubmit={create}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New company name" required />
        <button className="primary" type="submit">Add company</button>
      </form>
      {!list ? <p className="empty-hint">Loading...</p> : (
        <div className="admin-cards">
          {list.map((c) => (
            <CompanyCard key={c._id} c={c} open={open === c._id} onToggle={() => setOpen(open === c._id ? null : c._id)} onChanged={load} />
          ))}
        </div>
      )}
    </div>
  );
}

function CompanyCard({ c, open, onToggle, onChanged }) {
  const [uri, setUri] = useState("");
  const [migrate, setMigrate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function run(fn, okText) {
    setBusy(true); setMsg(null);
    try { const r = await fn(); setMsg({ ok: true, text: typeof okText === "function" ? okText(r) : okText }); onChanged(); return r; }
    catch (err) { setMsg({ ok: false, text: err.message }); }
    finally { setBusy(false); }
  }
  const copied = (r) => (r.migrated ? ` Copied ${r.migrated.forms} form(s) and ${r.migrated.submissions} response(s).` : "");

  return (
    <div className="admin-card">
      <div className="admin-card-head">
        <div>
          <h3>{c.name}</h3>
          <span className="admin-meta">{c.userCount} user(s) · {c.formCount} form(s)</span>
        </div>
        <span className={`db-pill ${c.dbMode}`}>{c.dbMode === "custom" ? "Database linked" : "No database yet"}</span>
      </div>
      {c.dbMode === "custom" && (
        <p className="admin-meta">{c.dbHost} / {c.dbName} · last verified {fmt(c.dbCheckedAt)}</p>
      )}
      <div className="admin-actions">
        <button className="secondary small" onClick={onToggle}>{c.dbMode === "custom" ? "Change database" : "Link database"}</button>
        {c.dbMode === "custom" && (
          <>
            <button className="secondary small" disabled={busy} onClick={() => run(async () => { const r = await api.adminCheckDb(c._id); if (!r.ok) throw new Error(r.error); return r; }, "Database is reachable and writable.")}>Check</button>
            <button className="danger small" disabled={busy} onClick={() => {
              if (confirm(`Unlink ${c.name}'s database?\n\nTheir data stays untouched in their own database, but they can't create or open forms until a database is linked again.`)) {
                run(() => api.adminUnlinkDb(c._id), "Unlinked.");
              }
            }}>Unlink</button>
          </>
        )}
      </div>
      {open && (
        <div className="admin-form">
          <label>
            MongoDB connection string for {c.name}
            <input value={uri} onChange={(e) => setUri(e.target.value)} placeholder="mongodb+srv://user:password@cluster.mongodb.net/acme_forms" autoComplete="off" />
          </label>
          <p className="settings-hint small">
            Must include a database name and a user with read/write access. It's encrypted at rest and never shown again.
          </p>
          <label className="check-row">
            <input type="checkbox" checked={migrate} onChange={(e) => setMigrate(e.target.checked)} />
            Copy this company's existing forms and responses into the new database (originals are left in place)
          </label>
          <div className="admin-actions">
            <button className="secondary small" disabled={busy || !uri.trim()} onClick={() => run(() => api.adminTestDb(uri.trim()), (r) => `Connection works (${r.host} / ${r.dbName}).`)}>Test</button>
            <button className="primary small" disabled={busy || !uri.trim()} onClick={async () => {
              const r = await run(() => api.adminLinkDb(c._id, uri.trim(), migrate), (r) => `Linked.${copied(r)}`);
              if (r) { setUri(""); onToggle(); }
            }}>{busy ? "Working..." : "Save & link"}</button>
          </div>
        </div>
      )}
      {msg && <p className={msg.ok ? "key-saved-msg" : "error"}>{msg.text}</p>}
    </div>
  );
}

// --------------------------------------------------------------------- users
function Users({ currentUser }) {
  const [users, setUsers] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ email: "", name: "", password: "", role: "user", companyId: "" });

  async function load() {
    try {
      const [u, c] = await Promise.all([api.adminUsers(), api.adminCompanies()]);
      setUsers(u); setCompanies(c); setError(null);
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function create(e) {
    e.preventDefault();
    try { await api.adminCreateUser({ ...form, companyId: form.companyId || undefined }); setForm({ email: "", name: "", password: "", role: "user", companyId: "" }); load(); }
    catch (err) { setError(err.message); }
  }
  async function patch(id, payload) {
    try { await api.adminUpdateUser(id, payload); load(); } catch (err) { setError(err.message); }
  }

  return (
    <div>
      {error && <p className="error">{error}</p>}
      <form className="inline-form wrap" onSubmit={create}>
        <input type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input type="password" placeholder="Temporary password (8+)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} minLength={8} required />
        <select value={form.companyId} onChange={(e) => setForm({ ...form, companyId: e.target.value })}>
          <option value="">New workspace</option>
          {companies.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
        </select>
        <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
          <option value="user">Regular user</option>
          <option value="admin">Company admin</option>
          <option value="superadmin">Platform team</option>
        </select>
        <button className="primary" type="submit">Add user</button>
      </form>
      {!users ? <p className="empty-hint">Loading...</p> : (
        <div className="table-scroll">
          <table>
            <thead><tr><th>User</th><th>Company</th><th>Type</th><th>Last login</th><th>Status</th><th /></tr></thead>
            <tbody>
              {users.map((u) => {
                const self = u._id === currentUser._id;
                return (
                  <tr key={u._id} className={u.active ? "" : "row-muted"}>
                    <td><strong>{u.name || u.email}</strong>{u.name && <div className="admin-meta">{u.email}</div>}</td>
                    <td>
                      <select value={u.companyId || ""} onChange={(e) => confirm("Moving a user does not move the forms they already created. Continue?") && patch(u._id, { companyId: e.target.value })}>
                        {companies.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                      </select>
                    </td>
                    <td>
                      <select value={u.role} disabled={self} onChange={(e) => patch(u._id, { role: e.target.value })}>
                        <option value="user">Regular user</option>
                        <option value="admin">Company admin</option>
                        <option value="superadmin">Platform team</option>
                      </select>
                    </td>
                    <td>{fmt(u.lastLoginAt)}</td>
                    <td>{u.active ? "Active" : "Disabled"}</td>
                    <td className="admin-actions">
                      <button className="secondary small" disabled={self} onClick={() => patch(u._id, { active: !u.active })}>{u.active ? "Disable" : "Enable"}</button>
                      <button className="secondary small" onClick={() => { const p = prompt(`New password for ${u.email} (8+ characters):`); if (p) patch(u._id, { newPassword: p }); }}>Reset password</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------- logs
const CATEGORIES = ["auth", "form", "ai", "admin", "db", "http", "server_error", "client_error", "user_report", "system"];

function Logs() {
  const [filters, setFilters] = useState({ level: "", category: "", q: "" });
  const [rows, setRows] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [attach, setAttach] = useState({}); // log id -> base64 data URL

  async function load(append = false) {
    setLoading(true);
    try {
      const before = append && rows.length ? rows[rows.length - 1].createdAt : "";
      const { logs, hasMore } = await api.adminLogs({ ...filters, before });
      setRows(append ? [...rows, ...logs] : logs);
      setHasMore(hasMore); setError(null);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filters.level, filters.category]);

  async function showAttachment(l) {
    const full = await api.adminLog(l._id);
    setAttach((a) => ({ ...a, [l._id]: `data:${full.attachment.mediaType || "application/octet-stream"};base64,${full.attachment.base64}` }));
  }

  return (
    <div>
      <p className="settings-hint">
        Written by the backend into the platform database: sign-ins, failures, form and admin actions, AI calls (no prompts or keys),
        server errors, browser errors, and user problem reports. Entries expire automatically.
      </p>
      <div className="inline-form wrap">
        <select value={filters.level} onChange={(e) => setFilters({ ...filters, level: e.target.value })}>
          <option value="">All levels</option><option value="error">Errors</option><option value="warn">Warnings</option><option value="info">Info</option>
        </select>
        <select value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })}>
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input placeholder="Search message, route, email..." value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} onKeyDown={(e) => e.key === "Enter" && load()} />
        <button className="secondary" onClick={() => load()}>Search / refresh</button>
      </div>
      {error && <p className="error">{error}</p>}
      {!loading && rows.length === 0 ? <p className="empty-hint">No log entries match.</p> : (
        <div className="table-scroll">
          <table>
            <thead><tr><th>Time</th><th>Level</th><th>Category</th><th>Message</th></tr></thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l._id}>
                  <td className="nowrap">{fmt(l.createdAt)}</td>
                  <td><span className={`log-level ${l.level}`}>{l.level}</span></td>
                  <td>{l.category}</td>
                  <td className="report-detail">
                    {l.message}
                    <div className="admin-meta">
                      {[l.route, l.statusCode, l.durationMs != null && `${l.durationMs}ms`, [l.name, l.email].filter(Boolean).join(" · "), l.userId && `user ${l.userId.slice(-6)}`].filter(Boolean).join(" · ")}
                    </div>
                    {l.attachment?.name && (
                      attach[l._id]
                        ? <a href={attach[l._id]} download={l.attachment.name}>Download {l.attachment.name}</a>
                        : <button className="link-btn" onClick={() => showAttachment(l)}>📎 Load {l.attachment.name}</button>
                    )}
                    {(l.stack || l.meta || l.url) && (
                      <details>
                        <summary>details</summary>
                        {l.url && <div className="admin-meta">Page: {l.url}</div>}
                        {l.meta && <pre>{JSON.stringify(l.meta, null, 2)}</pre>}
                        {l.stack && <pre>{l.stack}</pre>}
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {loading && <p className="empty-hint">Loading...</p>}
      {hasMore && !loading && <button className="secondary" onClick={() => load(true)}>Load older</button>}
    </div>
  );
}

// ------------------------------------------------------- company admin: team
function Team({ currentUser }) {
  const [users, setUsers] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ email: "", name: "", password: "", role: "user" });

  async function load() { try { setUsers(await api.companyUsers()); setError(null); } catch (e) { setError(e.message); } }
  useEffect(() => { load(); }, []);

  async function create(e) {
    e.preventDefault();
    try { await api.companyAddUser(form); setForm({ email: "", name: "", password: "", role: "user" }); load(); } catch (err) { setError(err.message); }
  }
  async function patch(id, payload) { try { await api.companyUpdateUser(id, payload); load(); } catch (err) { setError(err.message); } }

  return (
    <div>
      <p className="settings-hint">Add the people who will build forms. They sign in with the <strong>User login</strong> tab using the email and temporary password you set here.</p>
      {error && <p className="error">{error}</p>}
      <form className="inline-form wrap" onSubmit={create}>
        <input type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input type="password" placeholder="Temporary password (8+)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} minLength={8} required />
        <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
          <option value="user">Regular user</option>
          <option value="admin">Admin</option>
        </select>
        <button className="primary" type="submit">Add person</button>
      </form>
      {!users ? <p className="empty-hint">Loading...</p> : (
        <div className="table-scroll">
          <table>
            <thead><tr><th>Person</th><th>Type</th><th>Last login</th><th>Status</th><th /></tr></thead>
            <tbody>
              {users.map((u) => {
                const self = u._id === currentUser._id;
                return (
                  <tr key={u._id} className={u.active ? "" : "row-muted"}>
                    <td><strong>{u.name || u.email}</strong>{u.name && <div className="admin-meta">{u.email}</div>}</td>
                    <td>
                      <select value={u.role} disabled={self} onChange={(e) => patch(u._id, { role: e.target.value })}>
                        <option value="user">Regular user</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td>{fmt(u.lastLoginAt)}</td>
                    <td>{u.active ? "Active" : "Disabled"}</td>
                    <td className="admin-actions">
                      <button className="secondary small" disabled={self} onClick={() => patch(u._id, { active: !u.active })}>{u.active ? "Disable" : "Enable"}</button>
                      <button className="secondary small" onClick={() => { const p = prompt(`New password for ${u.email} (8+ characters):`); if (p) patch(u._id, { newPassword: p }); }}>Reset password</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// -------------------------------------------- company admin: form problems
function Problems() {
  const [rows, setRows] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function load(append = false) {
    setLoading(true);
    try {
      const { problems, hasMore } = await api.companyProblems(append && rows.length ? rows[rows.length - 1].createdAt : "");
      setRows(append ? [...rows, ...problems] : problems); setHasMore(hasMore); setError(null);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  return (
    <div>
      <p className="settings-hint">
        Problems with <strong>your company's forms</strong>: reports from people filling them in or using them, database connection trouble,
        and form errors. Problems with the application itself go to the platform team, not here.
      </p>
      {error && <p className="error">{error}</p>}
      {!loading && rows.length === 0 ? <p className="empty-hint">No problems reported. All good.</p> : (
        <div className="table-scroll">
          <table>
            <thead><tr><th>Time</th><th>Type</th><th>What happened</th></tr></thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l._id}>
                  <td className="nowrap">{fmt(l.createdAt)}</td>
                  <td><span className={`log-level ${l.category === "user_report" ? "warn" : l.level}`}>{l.category === "user_report" ? "reported" : l.category === "db" ? "database" : "error"}</span></td>
                  <td className="report-detail">
                    {l.message}
                    {(l.name || l.email) && <div className="admin-meta">From: {[l.name, l.email].filter(Boolean).join(" · ")}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {loading && <p className="empty-hint">Loading...</p>}
      {hasMore && !loading && <button className="secondary" onClick={() => load(true)}>Load older</button>}
      <button className="secondary" onClick={() => load()} style={{ marginLeft: hasMore ? 8 : 0 }}>Refresh</button>
    </div>
  );
}
