import { Router } from "express";
import FormIndex, { syncIndex } from "../models/FormIndex.js";
import { requireAuth, withTenant, tenantForCompanyId, isSuperadmin, isAdminOf } from "../middleware/auth.js";
import { httpError, escapeRegex } from "../utils/http.js";
import { logger } from "../utils/logger.js";

const router = Router();

// Only these keys can be set by a client. Everything else (ownerId,
// publishedAt, ...) is controlled by the server.
const EDITABLE = ["title", "description", "fields", "theme", "isPublic", "source", "generationPrompt"];
const pick = (body) => Object.fromEntries(EDITABLE.filter((k) => body?.[k] !== undefined).map((k) => [k, body[k]]));

// Finds a form's directory entry and the database it lives in.
async function locate(id, opts) {
  if (!/^[a-f\d]{24}$/i.test(id)) throw httpError(404, "Form not found");
  const idx = await FormIndex.findById(id);
  if (!idx) throw httpError(404, "Form not found");
  return { idx, tenant: await tenantForCompanyId(idx.companyId, opts) };
}

// The form's creator, or the admin of the company it belongs to, may manage it.
// Other companies (and other users) can never reach it.
function assertOwner(req, idx) {
  if (idx.ownerId === req.userId || isAdminOf(req, idx.companyId)) return;
  throw httpError(403, "You don't have access to this form.");
}

// Create a form in the caller's company database.
router.post("/", requireAuth, withTenant, async (req, res) => {
  const form = await req.tenant.Form.create({ ...pick(req.body), ownerId: req.userId, publishedAt: null });
  try {
    await syncIndex(form, req.user.companyId);
  } catch (err) {
    await req.tenant.Form.findByIdAndDelete(form._id).catch(() => {});
    throw err;
  }
  logger.info("form", `Form created: ${form.title}`, { req, meta: { formId: form._id, db: req.tenant.mode } });
  res.status(201).json(form);
});

// The caller's own forms (company admins see every form in their company).
router.get("/", requireAuth, withTenant, async (req, res) => {
  const filter = req.user.role === "admin" ? {} : { ownerId: req.userId };
  if (req.query.q) filter.title = { $regex: escapeRegex(req.query.q), $options: "i" };
  res.json(await req.tenant.Form.find(filter).sort({ updatedAt: -1 }));
});

// Public repository, served from the platform directory (no customer DB hit).
// Declared before "/:id".
router.get("/public", async (req, res) => {
  const filter = { isPublic: true, publishedAt: { $ne: null } };
  if (req.query.q) filter.title = { $regex: escapeRegex(req.query.q), $options: "i" };
  res.json(await FormIndex.find(filter).select("title description fieldCount publishedAt").sort({ publishedAt: -1 }).limit(100));
});

// Fetch one form. Published forms are public (that's what a share link opens);
// drafts are visible only to their owner (or a superadmin).
router.get("/:id", async (req, res) => {
  const peek = await FormIndex.findById(/^[a-f\d]{24}$/i.test(req.params.id) ? req.params.id : null);
  const mine = !!peek && req.userId && (peek.ownerId === req.userId || isAdminOf(req, peek.companyId));
  if (peek && !peek.publishedAt && !mine) throw httpError(404, "Form not found");
  req.logCompanyId = peek?.companyId;
  const { idx, tenant } = await locate(req.params.id, { publicFacing: !mine });
  const form = await tenant.Form.findById(req.params.id);
  if (!form) throw httpError(404, "Form not found");
  const out = form.toObject();
  if (!mine) delete out.ownerId;
  res.json(out);
});

router.put("/:id", requireAuth, async (req, res) => {
  const { idx, tenant } = await locate(req.params.id);
  assertOwner(req, idx);
  const updated = await tenant.Form.findByIdAndUpdate(req.params.id, pick(req.body), { new: true, runValidators: true });
  if (!updated) throw httpError(404, "Form not found");
  await syncIndex(updated, idx.companyId);
  res.json(updated);
});

router.post("/:id/publish", requireAuth, async (req, res) => {
  const { idx, tenant } = await locate(req.params.id);
  assertOwner(req, idx);
  const updated = await tenant.Form.findByIdAndUpdate(req.params.id, { publishedAt: new Date() }, { new: true });
  if (!updated) throw httpError(404, "Form not found");
  await syncIndex(updated, idx.companyId);
  logger.info("form", `Form published: ${updated.title}`, { req, meta: { formId: updated._id } });
  res.json(updated);
});

// "Save as template": copies a form into the caller's own company database.
// Allowed for forms the caller owns, or published forms their owner made public.
router.post("/:id/duplicate", requireAuth, withTenant, async (req, res) => {
  const { idx, tenant: sourceTenant } = await locate(req.params.id, { publicFacing: true });
  const mine = idx.ownerId === req.userId || isAdminOf(req, idx.companyId);
  if (!mine && !(idx.isPublic && idx.publishedAt)) throw httpError(403, "This form isn't public, so it can't be saved as a template.");
  const source = await sourceTenant.Form.findById(req.params.id);
  if (!source) throw httpError(404, "Form not found");
  const plain = source.toObject();
  const copy = await req.tenant.Form.create({
    title: `${plain.title} (copy)`, description: plain.description, ownerId: req.userId,
    fields: plain.fields, theme: plain.theme, source: "manual", generationPrompt: null, isPublic: false, publishedAt: null,
  });
  await syncIndex(copy, req.user.companyId);
  res.status(201).json(copy);
});

router.delete("/:id", requireAuth, async (req, res) => {
  const { idx, tenant } = await locate(req.params.id);
  assertOwner(req, idx);
  await tenant.Form.findByIdAndDelete(req.params.id);
  await tenant.Submission.deleteMany({ formId: req.params.id });
  await idx.deleteOne();
  logger.info("form", `Form deleted: ${idx.title}`, { req, meta: { formId: req.params.id } });
  res.status(204).end();
});

export default router;
