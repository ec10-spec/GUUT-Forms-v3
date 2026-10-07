import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import User from "../models/User.js";
import Company from "../models/Company.js";
import { signToken, requireAuth } from "../middleware/auth.js";
import { encrypt } from "../utils/crypto.js";
import { httpError } from "../utils/http.js";
import { logger } from "../utils/logger.js";
import { flag } from "../config/env.js";
import { PROVIDERS } from "../utils/aiProviders.js";

const router = Router();

const isEmail = (v) => typeof v === "string" && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const MIN_PW = 8;

// Brute-force protection: only failed attempts count toward the limit.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: "Too many attempts. Try again in a few minutes." },
});

// What the client gets about the user, plus a safe summary of their company.
async function sessionUser(user) {
  const company = user.companyId ? await Company.findById(user.companyId) : null;
  return {
    ...user.toJSON(),
    company: company ? { _id: company._id, name: company.name, dbMode: company.customUriEncrypted ? "custom" : "none" } : null,
  };
}

// POST /api/auth/signup: "Create a company account". The person becomes the ADMIN
// of a brand-new company. Regular users are added later by their company admin,
// so nobody can join another company by themselves.
router.post("/signup", authLimiter, async (req, res) => {
  if (!flag("ALLOW_SIGNUP", true)) throw httpError(403, "Sign-ups are closed. Ask your administrator for an account.");
  const { email, password, name, companyName } = req.body || {};
  if (!isEmail(email)) throw httpError(400, "A valid email is required.");
  if (typeof password !== "string" || password.length < MIN_PW) throw httpError(400, `Password must be at least ${MIN_PW} characters.`);
  if (await User.findOne({ email: email.toLowerCase() })) throw httpError(409, "An account with that email already exists.");

  const cleanName = String(name || "").trim().slice(0, 80);
  const company = await Company.create({ name: String(companyName || "").trim().slice(0, 80) || `${cleanName || email.split("@")[0]}'s company` });
  const user = await User.create({
    email: email.toLowerCase(), name: cleanName, role: "admin", companyId: company._id,
    passwordHash: await bcrypt.hash(password, 10), lastLoginAt: new Date(),
  });
  req.userId = String(user._id);
  logger.info("auth", `Signup: ${user.email}`, { req, meta: { companyId: company._id } });
  res.status(201).json({ token: signToken(user), user: await sessionUser(user) });
});

// POST /api/auth/login   { email, password, as: "admin" | "user" }
// The login page has two doors. "admin" admits company admins and superadmins;
// "user" admits regular users. A correct password at the wrong door gets a
// helpful pointer instead of a session.
router.post("/login", authLimiter, async (req, res) => {
  const { email, password, as } = req.body || {};
  if (!isEmail(email) || typeof password !== "string" || !password) throw httpError(400, "Email and password are required.");
  const user = await User.findOne({ email: email.toLowerCase() });
  const ok = user && user.active && (await bcrypt.compare(password, user.passwordHash));
  if (!ok) {
    logger.warn("auth", `Failed login: ${email.toLowerCase()}`, { req, statusCode: 401, meta: { reason: !user ? "unknown email" : !user.active ? "disabled" : "bad password" } });
    throw httpError(401, "Incorrect email or password.");
  }
  const isAdminAccount = user.role === "admin" || user.role === "superadmin";
  if (as === "admin" && !isAdminAccount) throw httpError(403, "This is a regular user account. Use the User login tab.", { code: "WRONG_DOOR" });
  if (as === "user" && isAdminAccount) throw httpError(403, "This is an admin account. Use the Admin login tab.", { code: "WRONG_DOOR" });
  user.lastLoginAt = new Date();
  await user.save();
  req.userId = String(user._id);
  logger.info("auth", `Login: ${user.email}`, { req });
  res.json({ token: signToken(user), user: await sessionUser(user) });
});

// GET /api/auth/me
router.get("/me", requireAuth, async (req, res) => {
  res.json({ user: await sessionUser(req.user) });
});

// PUT /api/auth/settings
// { theme?, ai?: { provider?, anthropicKey?, openaiKey?, anthropicModel?, openaiModel? } }
// Keys are encrypted before storage and never returned. Send "" to remove a key.
router.put("/settings", requireAuth, async (req, res) => {
  const { theme, ai } = req.body || {};
  const user = req.user;

  if (theme !== undefined) {
    if (!["light", "dark", "system"].includes(theme)) throw httpError(400, "theme must be light, dark, or system.");
    user.settings.theme = theme;
  }

  if (ai && typeof ai === "object") {
    if (ai.provider !== undefined) {
      if (!PROVIDERS[ai.provider]) throw httpError(400, "provider must be anthropic or openai.");
      user.ai.provider = ai.provider;
    }
    for (const [field, path] of [["anthropicKey", "anthropicKeyEncrypted"], ["openaiKey", "openaiKeyEncrypted"]]) {
      if (typeof ai[field] !== "string") continue;
      const key = ai[field].trim();
      if (key && (key.length > 400 || /\s/.test(key))) throw httpError(400, "That doesn't look like a valid API key.");
      user.ai[path] = key ? encrypt(key) : null;
      if (field === "anthropicKey" && !key) user.settings.aiApiKeyEncrypted = null; // clear legacy copy too
      logger.info("auth", `AI key ${key ? "saved" : "removed"} (${field.replace("Key", "")})`, { req });
    }
    for (const field of ["anthropicModel", "openaiModel"]) {
      if (typeof ai[field] !== "string") continue;
      const model = ai[field].trim();
      if (model && !/^[\w.:/-]{1,80}$/.test(model)) throw httpError(400, "Model names can only contain letters, numbers and . : / _ -");
      user.ai[field] = model;
    }
  }

  await user.save();
  res.json({ user: await sessionUser(user) });
});

// PUT /api/auth/password { currentPassword, newPassword }
router.put("/password", requireAuth, authLimiter, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (typeof newPassword !== "string" || newPassword.length < MIN_PW) throw httpError(400, `New password must be at least ${MIN_PW} characters.`);
  if (!(await bcrypt.compare(String(currentPassword || ""), req.user.passwordHash))) throw httpError(400, "Current password is incorrect.");
  req.user.passwordHash = await bcrypt.hash(newPassword, 10);
  await req.user.save();
  logger.info("auth", "Password changed", { req });
  res.json({ ok: true });
});

export default router;
