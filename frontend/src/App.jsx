import React, { useEffect, useRef, useState } from "react";
import Home from "./components/Home.jsx";
import FormBuilder from "./components/FormBuilder.jsx";
import FormRenderer from "./components/FormRenderer.jsx";
import AboutPage from "./components/AboutPage.jsx";
import AuthPage from "./components/AuthPage.jsx";
import ExplorePage from "./components/ExplorePage.jsx";
import AdminPage from "./components/AdminPage.jsx";
import ReportWidget from "./components/ReportWidget.jsx";
import SettingsPage from "./components/SettingsPage.jsx";
import AccountMenu from "./components/AccountMenu.jsx";
import { api, getUser, getToken, saveUser, clearSession } from "./api.js";

/** Parses the hash into a route. Real routes so browser back/forward work. */
function parseHash(hash) {
  const h = hash.replace(/^#/, "") || "/";
  if (h === "/") return { name: "home" };
  if (h === "/about") return { name: "about" };
  if (h === "/explore") return { name: "explore" };
  if (h === "/admin" || h === "/reports") return { name: "admin" };
  if (h === "/settings") return { name: "settings" };
  if (h === "/new") return { name: "new" };
  const editMatch = h.match(/^\/edit\/([a-fA-F0-9]+)$/);
  if (editMatch) return { name: "edit", id: editMatch[1] };
  const publicMatch = h.match(/^\/f\/([a-fA-F0-9]+)$/);
  if (publicMatch) return { name: "public", id: publicMatch[1] };
  return { name: "home" };
}

function navigate(hash) {
  window.location.hash = hash;
}

/** Applies the effective (light/dark) theme to the document, resolving "system". */
function applyThemeToDocument(theme) {
  const effective =
    theme === "system" || !theme
      ? (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : theme;
  document.documentElement.dataset.theme = effective;
}

function PublicFormPage({ id, user, onSaveTemplate }) {
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.getForm(id).then(setForm).catch((e) => setError(e.message));
  }, [id]);

  async function handleSaveTemplate() {
    setSaving(true);
    setSaveError(null);
    try {
      const copy = await api.duplicateForm(id);
      setSaved(true);
      onSaveTemplate(copy);
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (error) return <div className="app-shell"><p className="error">{error}</p><ReportWidget /></div>;
  if (!form) return <div className="app-shell"><p>Loading...</p></div>;
  return (
    <div className="app-shell public-form-shell">
      {user && (
        <div className="save-template-bar">
          <button className="secondary small" disabled={saving || saved} onClick={handleSaveTemplate}>
            {saved ? "Saved to your forms ✓" : saving ? "Saving..." : "Save as template"}
          </button>
          {saveError && <span className="error">{saveError}</span>}
        </div>
      )}
      <FormRenderer form={form} />
      <ReportWidget />
    </div>
  );
}

export default function App() {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  const [user, setUser] = useState(() => getUser());
  const [activeForm, setActiveForm] = useState(null);
  const [loadingActiveForm, setLoadingActiveForm] = useState(false);
  const pendingDraft = useRef(null); // unsaved draft for the "/new" route, not URL-addressable

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // Validate/refresh the stored session on load.
  useEffect(() => {
    if (getToken()) {
      api.me().then(({ user }) => { saveUser(user); setUser(user); })
        .catch(() => { clearSession(); setUser(null); });
    }
  }, []);

  // A rejected token anywhere in the app ends the session cleanly.
  useEffect(() => {
    const onExpired = () => { clearSession(); setUser(null); };
    window.addEventListener("guut:session-expired", onExpired);
    return () => window.removeEventListener("guut:session-expired", onExpired);
  }, []);

  // Apply the account's theme preference (or the OS default pre-login).
  useEffect(() => {
    applyThemeToDocument(user?.settings?.theme || "system");
    if (!user?.settings?.theme || user.settings.theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const onChange = () => applyThemeToDocument("system");
      mq.addEventListener?.("change", onChange);
      return () => mq.removeEventListener?.("change", onChange);
    }
  }, [user?.settings?.theme]);

  useEffect(() => {
    if (route.name === "edit") {
      if (activeForm?._id === route.id) return;
      setLoadingActiveForm(true);
      api.getForm(route.id).then((f) => {
        setActiveForm(f);
        setLoadingActiveForm(false);
      }).catch(() => setLoadingActiveForm(false));
    }
  }, [route]);

  function logout() {
    clearSession();
    setUser(null);
    navigate("/explore");
  }

  // Public form fill opens standalone (no app chrome).
  if (route.name === "public") {
    return (
      <PublicFormPage
        id={route.id}
        user={user}
        onSaveTemplate={(copy) => { setActiveForm(copy); navigate(`/edit/${copy._id}`); }}
      />
    );
  }

  const inWorkspace = route.name === "new" || route.name === "edit";
  const isPublicRoute = route.name === "about" || route.name === "explore";
  const needsAuth = !isPublicRoute; // home / new / edit / settings require a login

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-left">
          <button className="brand" onClick={() => navigate(user ? "/" : "/explore")}>
            <img src="/guut-logo.png" alt="GUUT" />
            <span className="brand-name">Forms</span>
          </button>
          {inWorkspace && (
            <>
              <span className="header-sep">/</span>
              <button className="back-link" onClick={() => navigate("/")}>← Back to forms</button>
            </>
          )}
        </div>
        <nav className="header-right">
          <button className={`nav-link ${route.name === "explore" ? "active" : ""}`} onClick={() => navigate("/explore")}>Explore</button>
          <button className={`nav-link ${route.name === "about" ? "active" : ""}`} onClick={() => navigate("/about")}>About</button>
          {(user?.role === "superadmin" || user?.role === "admin") && (
            <button className={`nav-link ${route.name === "admin" ? "active" : ""}`} onClick={() => navigate("/admin")}>Admin</button>
          )}
          {user ? (
            <AccountMenu user={user} onOpenSettings={() => navigate("/settings")} onLogout={logout} />
          ) : (
            <button className="primary small" onClick={() => navigate("/")}>Sign in</button>
          )}
        </nav>
      </header>

      <main>
        {needsAuth && !user ? (
          <AuthPage onAuth={(u) => { setUser(u); navigate("/"); }} />
        ) : (
          <>
            {route.name === "home" && (
              <Home
                user={user}
                onOpenDraft={(draft) => { pendingDraft.current = draft; navigate("/new"); }}
                onOpenForm={(f) => navigate(`/edit/${f._id}`)}
              />
            )}

            {route.name === "explore" && (
              <ExplorePage
                onOpenPublic={(id) => navigate(`/f/${id}`)}
                user={user}
                onSaveTemplate={(copy) => { setActiveForm(copy); navigate(`/edit/${copy._id}`); }}
              />
            )}

            {route.name === "about" && <AboutPage />}

            {route.name === "admin" && (
              user?.role === "superadmin" || user?.role === "admin"
                ? <AdminPage currentUser={user} />
                : <div className="empty-hint"><p>This area is for admins only.</p></div>
            )}

            {route.name === "settings" && (
              <SettingsPage user={user} onUserUpdated={(u) => setUser(u)} />
            )}

            {route.name === "new" && (
              pendingDraft.current ? (
                <FormBuilder
                  draft={pendingDraft.current}
                  formId={null}
                  onSaved={(saved) => { setActiveForm(saved); navigate(`/edit/${saved._id}`); }}
                />
              ) : (
                <div className="empty-hint">
                  <p>Nothing to build yet.</p>
                  <button className="primary" onClick={() => navigate("/")}>Start a new form</button>
                </div>
              )
            )}

            {route.name === "edit" && (
              loadingActiveForm || !activeForm ? (
                <p>Loading...</p>
              ) : (
                <FormBuilder draft={activeForm} formId={activeForm._id} onSaved={(saved) => setActiveForm(saved)} />
              )
            )}
          </>
        )}
      </main>

      <ReportWidget />
    </div>
  );
}
