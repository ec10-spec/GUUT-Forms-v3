import { Router } from "express";
import rateLimit from "express-rate-limit";
import { Parser as CsvParser } from "../utils/csv.js";
import FormIndex from "../models/FormIndex.js";
import { requireAuth, tenantForCompanyId, isAdminOf } from "../middleware/auth.js";
import { httpError } from "../utils/http.js";
import { logger } from "../utils/logger.js";

const router = Router();

const submitLimiter = rateLimit({
  windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: "Too many submissions from this connection. Please wait a minute." },
});

async function locate(req, formId, opts) {
  if (!/^[a-f\d]{24}$/i.test(formId)) throw httpError(404, "Form not found");
  const idx = await FormIndex.findById(formId);
  if (!idx) throw httpError(404, "Form not found");
  req.logCompanyId = idx.companyId; // so any problem lands in THIS company's problem list
  return { idx, tenant: await tenantForCompanyId(idx.companyId, opts) };
}

// Responses: the form's creator or their company admin only.
function assertOwner(req, idx) {
  if (idx.ownerId !== req.userId && !isAdminOf(req, idx.companyId)) throw httpError(403, "You don't have access to this form's responses.");
}

const isEmpty = (v) => v == null || v === "" || (Array.isArray(v) && v.length === 0);

function isVisible(field, answers) {
  if (!field.showIf?.fieldId) return true;
  const val = answers[field.showIf.fieldId];
  return Array.isArray(val) ? val.includes(field.showIf.equals) : String(val) === String(field.showIf.equals);
}

// Keeps only answers for real fields, caps sizes, and enforces required fields.
function cleanAnswers(form, raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw httpError(400, "answers must be an object.");
  const answers = {};
  for (const f of form.fields) {
    let v = raw[f.id];
    if (Array.isArray(v)) v = v.slice(0, 100).map((x) => String(x).slice(0, 1000));
    else if (v != null && typeof v !== "number" && typeof v !== "boolean") v = String(v).slice(0, 10000);
    answers[f.id] = v ?? "";
  }
  for (const f of form.fields) {
    if (f.required && isVisible(f, answers) && isEmpty(answers[f.id])) throw httpError(400, `"${f.label}" is required.`);
  }
  return answers;
}

// Public: anyone with the link can respond, but only to a published form.
// The response is written to the form's company database.
router.post("/:formId", submitLimiter, async (req, res) => {
  const { idx, tenant } = await locate(req, req.params.formId, { publicFacing: true });
  if (!idx.publishedAt) throw httpError(403, "This form isn't accepting responses.");
  const form = await tenant.Form.findById(req.params.formId);
  if (!form) throw httpError(404, "Form not found");
  const submission = await tenant.Submission.create({ formId: form._id, answers: cleanAnswers(form, req.body?.answers) });
  res.status(201).json({ _id: submission._id, createdAt: submission.createdAt });
});

// Owner only: list + substring search over answers.
router.get("/:formId", requireAuth, async (req, res) => {
  const { idx, tenant } = await locate(req, req.params.formId);
  assertOwner(req, idx);
  let rows = await tenant.Submission.find({ formId: idx._id }).sort({ createdAt: -1 }).limit(5000);
  const q = String(req.query.q || "").trim().toLowerCase();
  if (q) rows = rows.filter((s) => Object.values(s.answers || {}).some((v) => String(v).toLowerCase().includes(q)));
  res.json(rows);
});

// Owner only: CSV (fetched with the auth header by the UI, not a bare link).
router.get("/:formId/export.csv", requireAuth, async (req, res) => {
  const { idx, tenant } = await locate(req, req.params.formId);
  assertOwner(req, idx);
  const form = await tenant.Form.findById(idx._id);
  if (!form) throw httpError(404, "Form not found");
  const rows = await tenant.Submission.find({ formId: idx._id }).sort({ createdAt: 1 });
  const csv = new CsvParser(form.fields.map((f) => ({ id: f.id, label: f.label }))).toCsv(rows);
  logger.info("form", `CSV export: ${form.title}`, { req, meta: { formId: idx._id, rows: rows.length } });
  res.header("Content-Type", "text/csv");
  res.attachment(`${form.title.replace(/[^\w-]+/g, "_")}_submissions.csv`);
  res.send(csv);
});

export default router;
