import TokenUsage from "../models/TokenUsage.js";

/** Per-user token + estimated cost summary for a date range. */
export async function getUsageSummary(userId, { from, to } = {}) {
  const rate = Number(process.env.COST_PER_1K_TOKENS_USD || 0.003);
  const match = { userId: String(userId) };
  if (from || to) {
    match.createdAt = {};
    if (from) match.createdAt.$gte = new Date(from);
    if (to) match.createdAt.$lte = new Date(to);
  }
  const rows = await TokenUsage.find(match).sort({ createdAt: 1 });
  const totalTokens = rows.reduce((sum, r) => sum + r.totalTokens, 0);
  return {
    userId,
    period: { from: from || null, to: to || null },
    callCount: rows.length,
    totalTokens,
    estimatedCostUsd: Number(((totalTokens / 1000) * rate).toFixed(4)),
    rate: `$${rate} / 1K tokens`,
  };
}
