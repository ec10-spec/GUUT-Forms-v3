// API base. Same-origin by default (single-service deploy or local proxy).
// For a split deploy (e.g. frontend on Cloudflare Pages, backend on Render),
// set VITE_API_BASE to the backend URL at build time and everything retargets.
const ORIGIN = (import.meta.env?.VITE_API_BASE || "").replace(/\/$/, "");
const BASE = `${ORIGIN}/api`;

// --- session (token kept in localStorage) ---------------------------------
const TOKEN_KEY = "guut_token";
const USER_KEY = "guut_user";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function getUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || "null");
  } catch {
    return null;
  }
}
export function saveSession({ token, user }) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
}
export function saveUser(user) {
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
}
export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

async function request(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(BASE + path, { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    // A rejected token means the session is over (expired, or account disabled).
    if (res.status === 401 && token) window.dispatchEvent(new Event("guut:session-expired"));
    const err = new Error(body.error || `Request failed: ${res.status}`);
    err.status = res.status;
    err.code = body.code;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

const json = (method, body) => ({ method, body: JSON.stringify(body) });

export const api = {
  // auth
  signup: (email, password, name, companyName) => request("/auth/signup", json("POST", { email, password, name, companyName })),
  login: (email, password, as) => request("/auth/login", json("POST", { email, password, as })),
  me: () => request("/auth/me"),
  updateSettings: (payload) => request("/auth/settings", json("PUT", payload)),
  changePassword: (currentPassword, newPassword) => request("/auth/password", json("PUT", { currentPassword, newPassword })),

  // forms
  listForms: (q = "") => request(`/forms?q=${encodeURIComponent(q)}`),
  listPublicForms: (q = "") => request(`/forms/public?q=${encodeURIComponent(q)}`),
  getForm: (id) => request(`/forms/${id}`),
  createForm: (form) => request("/forms", json("POST", form)),
  updateForm: (id, form) => request(`/forms/${id}`, json("PUT", form)),
  publishForm: (id) => request(`/forms/${id}/publish`, { method: "POST" }),
  duplicateForm: (id) => request(`/forms/${id}/duplicate`, { method: "POST" }),
  deleteForm: (id) => request(`/forms/${id}`, { method: "DELETE" }),

  // submissions
  submit: (formId, answers) => request(`/submissions/${formId}`, json("POST", { answers })),
  listSubmissions: (formId, q = "") => request(`/submissions/${formId}?q=${encodeURIComponent(q)}`),
  // CSV needs the auth header, so it's fetched and saved as a file (a bare link can't send it).
  async downloadCsv(formId, title = "form") {
    const res = await fetch(`${BASE}/submissions/${formId}/export.csv`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Export failed");
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/[^\w-]+/g, "_")}_submissions.csv`;
    a.click();
    URL.revokeObjectURL(url);
  },

  // ai
  generateForm: (prompt, { maxTokens, attachment } = {}) =>
    request("/ai/generate-form", json("POST", { prompt, maxTokens, attachment })),
  testAi: () => request("/ai/test", { method: "POST" }),
  getAiBudget: () => request("/ai/budget"),

  // problem reports + automatic front-end error logging (stored by the backend)
  submitReport: (payload) => request("/reports", json("POST", payload)),
  logClientError: (payload) =>
    fetch(`${BASE}/reports/client`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), keepalive: true }).catch(() => {}),

  // company admin (always scoped to the caller's own company on the server)
  companyInfo: () => request("/company"),
  companyTestDb: (uri) => request("/company/database/test", json("POST", { uri })),
  companyLinkDb: (uri, migrate) => request("/company/database", json("PUT", { uri, migrate })),
  companyCheckDb: () => request("/company/database/check", { method: "POST" }),
  companyUsers: () => request("/company/users"),
  companyAddUser: (payload) => request("/company/users", json("POST", payload)),
  companyUpdateUser: (id, payload) => request(`/company/users/${id}`, json("PUT", payload)),
  companyProblems: (before = "") => request(`/company/problems${before ? `?before=${encodeURIComponent(before)}` : ""}`),

  // superadmin (the platform team)
  adminOverview: () => request("/admin/overview"),
  adminCompanies: () => request("/admin/companies"),
  adminCreateCompany: (name) => request("/admin/companies", json("POST", { name })),
  adminRenameCompany: (id, name) => request(`/admin/companies/${id}`, json("PUT", { name })),
  adminTestDb: (uri) => request("/admin/database/test", json("POST", { uri })),
  adminLinkDb: (id, uri, migrate) => request(`/admin/companies/${id}/database`, json("PUT", { uri, migrate })),
  adminUnlinkDb: (id, migrate) => request(`/admin/companies/${id}/database?migrate=${!!migrate}`, { method: "DELETE" }),
  adminCheckDb: (id) => request(`/admin/companies/${id}/database/check`, { method: "POST" }),
  adminUsers: () => request("/admin/users"),
  adminCreateUser: (payload) => request("/admin/users", json("POST", payload)),
  adminUpdateUser: (id, payload) => request(`/admin/users/${id}`, json("PUT", payload)),
  adminLogs: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    return request(`/admin/logs${qs ? `?${qs}` : ""}`);
  },
  adminLog: (id) => request(`/admin/logs/${id}`),

  shareUrl: (formId) => `${window.location.origin}${window.location.pathname}#/f/${formId}`,
};
