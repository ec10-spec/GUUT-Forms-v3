import { Router } from "express";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import User from "../models/User.js";
import Company from "../models/Company.js";
import FormIndex from "../models/FormIndex.js";
import Log from "../models/Log.js";
import { requireAuth, requireCompanyAdmin } from "../middleware/auth.js";
import { openVerifiedConnection } from "../config/db.js";
import { linkDatabase, checkDatabase, normalizeUri } from "../utils/companyDb.js";
import { httpError } from "../utils/http.js";
import { logger } from "../utils/logger.js";

// Everything a COMPANY ADMIN can do, always scoped to their OWN company id taken
// from their session, never from the request, so one company can't touch another.
const router = Router();
router.use(requireAuth, requireCompanyAdmin);

async function myCompany(req) {
  const company = await Company.findById(req.user.companyId);
  if (!company) throw httpError(404, "Company not found");
  return company;
}

router.get("/", async (req, res) => {
  const company = await myCompany(req);
  const [users, forms] = await Promise.all([User.countDocuments({ companyId: company._id }), FormIndex.countDocuments({ companyId: company._id })]);
  res.json({ ...company.toJSON(), userCount: users, formCount: forms });
});

// --- database: paste a link, test it, save it
router.post("/database/test", async (req, res) => {
  const { conn, host, dbName } = await openVerifiedConnection(normalizeUri(req.body?.uri));
  await conn.close();
  res.json({ ok: true, host, dbName });
});

router.put("/database", async (req, res) => {
  res.json(await linkDatabase({ company: await myCompany(req), rawUri: req.body?.uri, migrate: req.body?.migrate, req }));
});

router.post("/database/check", async (req, res) => {
  const company = await myCompany(req);
  if (!company.customUriEncrypted) throw httpError(400, "No database linked yet.");
  res.json(await checkDatabase(company, req));
});

// --- team
router.get("/users", async (req, res) => {
  res.json(await User.find({ companyId: req.user.companyId }).sort({ createdAt: -1 }).limit(500));
});

router.post("/users", async (req, res) => {
  const { email, name, password, role } = req.body || {};
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || "")) throw httpError(400, "A valid email is required.");
  if (typeof password !== "string" || password.length < 8) throw httpError(400, "Temporary password must be at least 8 characters.");
  if (await User.findOne({ email: email.toLowerCase() })) throw httpError(409, "An account with that email already exists.");
  const user = await User.create({
    email: email.toLowerCase(), name: String(name || "").trim().slice(0, 80),
    role: role === "admin" ? "admin" : "user", companyId: req.user.companyId,
    passwordHash: await bcrypt.hash(password, 10),
  });
  logger.info("admin", `Team member added: ${user.email} (${user.role})`, { req });
  res.status(201).json(user);
});

router.put("/users/:id", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw httpError(404, "User not found");
  // Looked up by company too, so another company's users simply don't exist here.
  const user = await User.findOne({ _id: req.params.id, companyId: req.user.companyId });
  if (!user || user.role === "superadmin") throw httpError(404, "User not found");
  const { name, role, active, newPassword } = req.body || {};
  const self = String(user._id) === req.userId;
  if (self && ((role && role !== "admin") || active === false)) throw httpError(400, "You can't demote or disable your own account.");
  if (name !== undefined) user.name = String(name).trim().slice(0, 80);
  if (role !== undefined) {
    if (!["user", "admin"].includes(role)) throw httpError(400, "Invalid role.");
    user.role = role;
  }
  if (active !== undefined) user.active = !!active;
  if (newPassword !== undefined) {
    if (typeof newPassword !== "string" || newPassword.length < 8) throw httpError(400, "Password must be at least 8 characters.");
    user.passwordHash = await bcrypt.hash(newPassword, 10);
  }
  await user.save();
  logger.info("admin", `Team member updated: ${user.email}`, { req });
  res.json(user);
});

// --- problems with THIS company's forms (platform-wide issues go to us, not here)
router.get("/problems", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const filter = {
    companyId: String(req.user.companyId),
    $or: [
      { category: { $in: ["form", "db"] }, level: { $in: ["warn", "error"] } },
      { category: "user_report", "meta.topic": "form" },
      { category: "server_error" },
    ],
  };
  if (req.query.before) filter.createdAt = { $lt: new Date(req.query.before) };
  const rows = await Log.find(filter).sort({ createdAt: -1 }).limit(limit + 1)
    .select("level category message route statusCode name email createdAt");
  const problems = rows.slice(0, limit).map((l) => {
    const o = l.toJSON();
    // Internal error text stays with the platform team; the admin gets a plain summary.
    if (o.category === "server_error") o.message = "A technical error happened while handling a request for your forms. The platform team has been notified.";
    return o;
  });
  res.json({ problems, hasMore: rows.length > limit });
});

export default router;
