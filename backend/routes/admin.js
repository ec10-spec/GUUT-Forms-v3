import { Router } from "express";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import User from "../models/User.js";
import Company from "../models/Company.js";
import FormIndex from "../models/FormIndex.js";
import Log from "../models/Log.js";
import { requireSuperadmin } from "../middleware/auth.js";
import { dropTenant, openVerifiedConnection, platformStatus } from "../config/db.js";
import { linkDatabase, checkDatabase, normalizeUri } from "../utils/companyDb.js";
import { httpError, escapeRegex } from "../utils/http.js";
import { logger } from "../utils/logger.js";

const router = Router();
router.use(requireSuperadmin);

const oid = (id) => {
  if (!mongoose.isValidObjectId(id)) throw httpError(404, "Not found");
  return id;
};

// ------------------------------------------------------------------ overview
router.get("/overview", async (_req, res) => {
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const [users, companies, forms, errors24h, warns24h] = await Promise.all([
    User.countDocuments(), Company.countDocuments(), FormIndex.countDocuments(),
    Log.countDocuments({ level: "error", createdAt: { $gte: since } }),
    Log.countDocuments({ level: "warn", createdAt: { $gte: since } }),
  ]);
  res.json({
    platformDb: platformStatus(),
    counts: { users, companies, forms, errors24h, warns24h },
  });
});

// ----------------------------------------------------------------- companies
router.get("/companies", async (_req, res) => {
  const [companies, userCounts, formCounts] = await Promise.all([
    Company.find().sort({ createdAt: -1 }),
    User.aggregate([{ $group: { _id: "$companyId", n: { $sum: 1 } } }]),
    FormIndex.aggregate([{ $group: { _id: "$companyId", n: { $sum: 1 } } }]),
  ]);
  const u = new Map(userCounts.map((r) => [String(r._id), r.n]));
  const f = new Map(formCounts.map((r) => [String(r._id), r.n]));
  res.json(companies.map((c) => ({ ...c.toJSON(), userCount: u.get(String(c._id)) || 0, formCount: f.get(String(c._id)) || 0 })));
});

router.post("/companies", async (req, res) => {
  const name = String(req.body?.name || "").trim().slice(0, 80);
  if (!name) throw httpError(400, "Company name is required.");
  const company = await Company.create({ name });
  logger.info("admin", `Company created: ${name}`, { req, meta: { companyId: company._id } });
  res.status(201).json(company);
});

router.put("/companies/:id", async (req, res) => {
  const name = String(req.body?.name || "").trim().slice(0, 80);
  if (!name) throw httpError(400, "Company name is required.");
  const company = await Company.findByIdAndUpdate(oid(req.params.id), { name }, { new: true });
  if (!company) throw httpError(404, "Company not found");
  res.json(company);
});

// Test a connection string without saving anything.
router.post("/database/test", async (req, res) => {
  const { conn, host, dbName } = await openVerifiedConnection(normalizeUri(req.body?.uri));
  await conn.close();
  res.json({ ok: true, host, dbName });
});

// Link (or change) a company's own database.  { uri, migrate? }
router.put("/companies/:id/database", async (req, res) => {
  const company = await Company.findById(oid(req.params.id));
  if (!company) throw httpError(404, "Company not found");
  res.json(await linkDatabase({ company, rawUri: req.body?.uri, migrate: req.body?.migrate, req }));
});

// Unlink. The company can't create forms until a database is linked again;
// its data stays untouched in its own database.
router.delete("/companies/:id/database", async (req, res) => {
  const company = await Company.findById(oid(req.params.id));
  if (!company) throw httpError(404, "Company not found");
  if (!company.customUriEncrypted) throw httpError(400, "This company has no linked database.");
  company.customUriEncrypted = null;
  company.dbHost = company.dbName = null;
  await company.save();
  await dropTenant(company._id);
  logger.info("admin", `Database unlinked for ${company.name}`, { req, meta: { companyId: company._id } });
  res.json({ company });
});

// Re-check a linked database is still reachable and writable.
router.post("/companies/:id/database/check", async (req, res) => {
  const company = await Company.findById(oid(req.params.id));
  if (!company?.customUriEncrypted) throw httpError(400, "This company has no linked database.");
  res.json(await checkDatabase(company, req));
});

// --------------------------------------------------------------------- users
router.get("/users", async (_req, res) => {
  const [users, companies] = await Promise.all([User.find().sort({ createdAt: -1 }).limit(500), Company.find().select("name")]);
  const names = new Map(companies.map((c) => [String(c._id), c.name]));
  res.json(users.map((u) => ({ ...u.toJSON(), companyName: names.get(String(u.companyId)) || "" })));
});

router.post("/users", async (req, res) => {
  const { email, password, name, role, companyId } = req.body || {};
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || "")) throw httpError(400, "A valid email is required.");
  if (typeof password !== "string" || password.length < 8) throw httpError(400, "Password must be at least 8 characters.");
  if (await User.findOne({ email: email.toLowerCase() })) throw httpError(409, "An account with that email already exists.");
  let company = companyId ? await Company.findById(oid(companyId)) : null;
  if (companyId && !company) throw httpError(404, "Company not found");
  if (!company) company = await Company.create({ name: `${String(name || email.split("@")[0]).slice(0, 60)}'s workspace` });
  const user = await User.create({
    email: email.toLowerCase(), name: String(name || "").trim().slice(0, 80),
    role: ["superadmin", "admin"].includes(role) ? role : "user", companyId: company._id,
    passwordHash: await bcrypt.hash(password, 10),
  });
  logger.info("admin", `User created: ${user.email} (${user.role})`, { req, meta: { companyId: company._id } });
  res.status(201).json({ ...user.toJSON(), companyName: company.name });
});

router.put("/users/:id", async (req, res) => {
  const user = await User.findById(oid(req.params.id));
  if (!user) throw httpError(404, "User not found");
  const { name, role, companyId, active, newPassword } = req.body || {};
  const self = String(user._id) === req.userId;
  if (self && ((role && role !== "superadmin") || active === false)) throw httpError(400, "You can't demote or disable your own account.");
  if (name !== undefined) user.name = String(name).trim().slice(0, 80);
  if (role !== undefined) {
    if (!["user", "admin", "superadmin"].includes(role)) throw httpError(400, "Invalid role.");
    user.role = role;
  }
  if (active !== undefined) user.active = !!active;
  if (companyId !== undefined) {
    if (!(await Company.exists({ _id: oid(companyId) }))) throw httpError(404, "Company not found");
    user.companyId = companyId;
  }
  if (newPassword !== undefined) {
    if (typeof newPassword !== "string" || newPassword.length < 8) throw httpError(400, "Password must be at least 8 characters.");
    user.passwordHash = await bcrypt.hash(newPassword, 10);
  }
  await user.save();
  logger.info("admin", `User updated: ${user.email}`, { req, meta: { changed: Object.keys(req.body || {}).filter((k) => k !== "newPassword") } });
  const company = await Company.findById(user.companyId).select("name");
  res.json({ ...user.toJSON(), companyName: company?.name || "" });
});

// ---------------------------------------------------------------------- logs
// GET /api/admin/logs?level=&category=&q=&before=<ISO date>&limit=
router.get("/logs", async (req, res) => {
  const { level, category, q, before } = req.query;
  const limit = Math.min(Number(req.query.limit) || 100, 300);
  const filter = {};
  if (level) filter.level = level;
  if (category) filter.category = category;
  if (before) filter.createdAt = { $lt: new Date(before) };
  if (q) {
    const rx = { $regex: escapeRegex(q), $options: "i" };
    filter.$or = [{ message: rx }, { route: rx }, { email: rx }];
  }
  const rows = await Log.find(filter).sort({ createdAt: -1 }).limit(limit + 1);
  const hasMore = rows.length > limit;
  res.json({ logs: rows.slice(0, limit), hasMore });
});

// One log including its attachment (user reports).
router.get("/logs/:id", async (req, res) => {
  const row = await Log.findById(oid(req.params.id)).select("+attachment.base64");
  if (!row) throw httpError(404, "Log not found");
  res.json(row);
});

export default router;
