import TokenUsage from "../models/TokenUsage.js";

const DAILY_LIMIT = () => Number(process.env.DAILY_TOKEN_LIMIT || 20000);
// Hard ceiling on any single call's max_tokens, whatever the UI slider asks for.
const CEILING = () => Number(process.env.MAX_TOKENS_PER_CALL || 1500);

async function usedToday(userId) {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const rows = await TokenUsage.aggregate([
    { $match: { userId: String(userId), createdAt: { $gte: since } } },
    { $group: { _id: null, total: { $sum: "$totalTokens" } } },
  ]);
  return rows[0]?.total || 0;
}

/** Requires requireAuth first. Superadmins are exempt from the daily cap. */
export async function tokenLimiter(req, res, next) {
  const used = await usedToday(req.userId);
  const limit = DAILY_LIMIT();
  const exempt = req.user.role === "superadmin";
  const remaining = exempt ? CEILING() : limit - used;
  if (remaining <= 0) {
    return res.status(429).json({ error: "Daily AI token limit reached for this user.", limit, used });
  }
  const requested = Number(req.body?.maxTokens) || 1000;
  req.effectiveMaxTokens = Math.max(200, Math.min(requested, CEILING(), remaining));
  next();
}

export async function recordTokenUsage({ userId, provider, model, promptTokens, completionTokens, endpoint }) {
  await TokenUsage.create({
    userId: String(userId), provider, model, endpoint,
    promptTokens, completionTokens, totalTokens: promptTokens + completionTokens,
  });
}

export async function getBudget(userId) {
  const used = await usedToday(userId);
  return { used, limit: DAILY_LIMIT(), remaining: Math.max(0, DAILY_LIMIT() - used), maxPerCallCeiling: CEILING() };
}
