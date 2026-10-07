import XLSX from "xlsx";
import { decrypt } from "./crypto.js";
import { httpError } from "./http.js";

// Bring-your-own-key AI. Each user picks Claude (Anthropic) or ChatGPT (OpenAI)
// and stores their own key in Settings. Models can be overridden per user so a
// new model name never needs a code change.
export const PROVIDERS = {
  anthropic: { label: "Claude (Anthropic)", defaultModel: () => process.env.DEFAULT_ANTHROPIC_MODEL || "claude-sonnet-4-6" },
  openai: { label: "ChatGPT (OpenAI)", defaultModel: () => process.env.DEFAULT_OPENAI_MODEL || "gpt-4o" },
};

/** The calling user's active provider, decrypted key and model, or null if none saved. */
export function resolveAiConfig(user) {
  const provider = PROVIDERS[user?.ai?.provider] ? user.ai.provider : "anthropic";
  const enc =
    provider === "anthropic"
      ? user.ai?.anthropicKeyEncrypted || user.settings?.aiApiKeyEncrypted
      : user.ai?.openaiKeyEncrypted;
  if (!enc) return null;
  let apiKey;
  try {
    apiKey = decrypt(enc);
  } catch {
    return null; // e.g. ENCRYPTION_KEY changed: treat as "no key", never fall back to another
  }
  const model = (provider === "anthropic" ? user.ai?.anthropicModel : user.ai?.openaiModel) || PROVIDERS[provider].defaultModel();
  return { provider, apiKey, model };
}

function attachmentText(att) {
  if (att.kind === "spreadsheet") {
    let wb;
    try {
      wb = XLSX.read(Buffer.from(att.base64, "base64"), { type: "buffer" });
    } catch {
      throw httpError(400, "Couldn't read that spreadsheet. Make sure it's a valid .xlsx or .xls file.");
    }
    const sheets = wb.SheetNames.map((n) => `Sheet "${n}":\n${XLSX.utils.sheet_to_csv(wb.Sheets[n])}`);
    return `Attached spreadsheet ("${att.filename || "spreadsheet"}"):\n\n${sheets.join("\n\n")}`;
  }
  const text = Buffer.from(att.base64, "base64").toString("utf8");
  return `Attached file ("${att.filename || "file"}"):\n\n${text}`;
}

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

function providerError(provider, status, body) {
  const label = PROVIDERS[provider].label;
  const detail = String(body?.error?.message || body?.message || "").slice(0, 300);
  if (status === 401 || status === 403) return httpError(400, `${label} rejected your API key. Check it in Settings.`, { code: "BAD_API_KEY" });
  if (status === 429) return httpError(429, `${label} says you're out of quota or rate-limited. ${detail}`.trim(), { code: "PROVIDER_LIMIT" });
  return httpError(502, `${label} error (${status}). ${detail}`.trim(), { code: "PROVIDER_ERROR" });
}

async function callAnthropic({ apiKey, model, system, prompt, attachment, maxTokens }) {
  const content = [{ type: "text", text: prompt }];
  if (attachment?.base64) {
    if (attachment.kind === "pdf") {
      content.unshift({ type: "document", source: { type: "base64", media_type: "application/pdf", data: attachment.base64 } });
    } else if (attachment.kind === "image" && IMAGE_TYPES.has(attachment.mediaType)) {
      content.unshift({ type: "image", source: { type: "base64", media_type: attachment.mediaType, data: attachment.base64 } });
    } else if (["spreadsheet", "text"].includes(attachment.kind)) {
      content.unshift({ type: "text", text: attachmentText(attachment) });
    }
  }
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content }] }),
    signal: AbortSignal.timeout(90_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw providerError("anthropic", res.status, data);
  return {
    text: data.content?.find((b) => b.type === "text")?.text || "",
    inputTokens: data.usage?.input_tokens || 0,
    outputTokens: data.usage?.output_tokens || 0,
    truncated: data.stop_reason === "max_tokens",
  };
}

async function callOpenAI({ apiKey, model, system, prompt, attachment, maxTokens, json }) {
  const parts = [{ type: "text", text: prompt }];
  if (attachment?.base64) {
    if (attachment.kind === "pdf") {
      parts.unshift({ type: "file", file: { filename: attachment.filename || "document.pdf", file_data: `data:application/pdf;base64,${attachment.base64}` } });
    } else if (attachment.kind === "image" && IMAGE_TYPES.has(attachment.mediaType)) {
      parts.unshift({ type: "image_url", image_url: { url: `data:${attachment.mediaType};base64,${attachment.base64}` } });
    } else if (["spreadsheet", "text"].includes(attachment.kind)) {
      parts.unshift({ type: "text", text: attachmentText(attachment) });
    }
  }
  const body = {
    model,
    max_completion_tokens: maxTokens,
    messages: [{ role: "system", content: system }, { role: "user", content: parts }],
  };
  if (json) body.response_format = { type: "json_object" };
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw providerError("openai", res.status, data);
  const choice = data.choices?.[0];
  return {
    text: choice?.message?.content || "",
    inputTokens: data.usage?.prompt_tokens || 0,
    outputTokens: data.usage?.completion_tokens || 0,
    truncated: choice?.finish_reason === "length",
  };
}

/** One call, either provider, same result shape: { text, inputTokens, outputTokens, truncated }. */
export async function runModel({ provider, ...rest }) {
  try {
    return await (provider === "openai" ? callOpenAI({ ...rest, json: true }) : callAnthropic(rest));
  } catch (err) {
    if (err.status) throw err; // already a friendly provider error
    const timedOut = err.name === "TimeoutError" || err.name === "AbortError";
    throw httpError(502, `Couldn't reach ${PROVIDERS[provider]?.label || "the AI provider"}${timedOut ? " (timed out)" : ""}. Try again in a moment.`, { code: "PROVIDER_UNREACHABLE" });
  }
}

/** Models sometimes wrap JSON in fences or add a sentence; pull out the outermost object. */
export function extractJson(text) {
  const raw = (text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const m = raw.match(/\{[\s\S]*\}/);
  return JSON.parse(m ? m[0] : raw);
}
