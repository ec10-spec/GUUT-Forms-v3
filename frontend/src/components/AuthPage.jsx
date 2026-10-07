import React, { useState } from "react";
import { api, saveSession } from "../api.js";

/**
 * Two doors: "User login" for regular team members, "Admin login" for company
 * admins (and the platform team). Company admins can also create a brand-new
 * company account from the Admin door; regular users are added by their admin.
 */
export default function AuthPage({ onAuth }) {
  const [door, setDoor] = useState("user"); // "user" | "admin"
  const [mode, setMode] = useState("login"); // "login" | "signup" (admin door only)
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const signup = door === "admin" && mode === "signup";

  function pickDoor(d) {
    setDoor(d); setMode("login"); setError(null);
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = signup
        ? await api.signup(email, password, name, companyName)
        : await api.login(email, password, door);
      saveSession(res);
      onAuth?.(res.user);
    } catch (err) {
      setError(err.message);
      // Right password, wrong door: flip to the right tab so the next try just works.
      if (err.code === "WRONG_DOOR") setDoor(door === "admin" ? "user" : "admin");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <span className="hero-eyebrow"><span className="dot" /> GUUT Forms</span>

        <div className="settings-tabs auth-doors">
          <button type="button" className={door === "user" ? "active" : ""} onClick={() => pickDoor("user")}>User login</button>
          <button type="button" className={door === "admin" ? "active" : ""} onClick={() => pickDoor("admin")}>Admin login</button>
        </div>

        <h1>{signup ? "Create a company account" : door === "admin" ? "Admin sign in" : "Welcome back"}</h1>
        <p className="auth-sub">
          {signup
            ? "You'll be the admin of your company. You can add your team and connect your own database after signing in."
            : door === "admin"
              ? "For company admins: connect your database, manage your team, and see problems with your forms."
              : "Sign in to build and manage your forms."}
        </p>

        <form onSubmit={submit} className="auth-form">
          {signup && (
            <>
              <label>
                Your name
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
              </label>
              <label>
                Company name
                <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Acme Inc." required />
              </label>
            </>
          )}
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required />
          </label>
          <label>
            Password
            <input
              type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder={signup ? "At least 8 characters" : "Your password"} required
            />
          </label>

          {error && <p className="error">{error}</p>}

          <button className="primary" type="submit" disabled={busy}>
            {busy ? "Please wait..." : signup ? "Create company account" : door === "admin" ? "Sign in as admin" : "Sign in"}
          </button>
        </form>

        <p className="auth-switch">
          {door === "user" ? (
            <>No account? Your company admin creates user accounts. <button className="link-btn" onClick={() => pickDoor("admin")}>Admin? Sign in here</button></>
          ) : (
            <>
              {signup ? "Already have a company account?" : "New company?"}{" "}
              <button className="link-btn" onClick={() => { setMode(signup ? "login" : "signup"); setError(null); }}>
                {signup ? "Sign in" : "Create a company account"}
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
