import mongoose from "mongoose";

// Account types:
//   superadmin - us, the platform operator: all companies, users, platform logs
//   admin      - a customer company's administrator: links the company's own
//                database, manages its team, sees problems with its forms
//   user       - regular customer user: builds forms, manages own AI settings
const UserSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, default: "", trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["superadmin", "admin", "user"], default: "user" },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", default: null },
    active: { type: Boolean, default: true },
    lastLoginAt: { type: Date, default: null },
    settings: {
      theme: { type: String, enum: ["light", "dark", "system"], default: "system" },
      // Legacy single Anthropic key from v0.1; still read as a fallback.
      aiApiKeyEncrypted: { type: String, default: null },
    },
    // Bring-your-own AI. Keys are encrypted at rest and never sent to the client.
    ai: {
      provider: { type: String, enum: ["anthropic", "openai"], default: "anthropic" },
      anthropicKeyEncrypted: { type: String, default: null },
      openaiKeyEncrypted: { type: String, default: null },
      anthropicModel: { type: String, default: "" },
      openaiModel: { type: String, default: "" },
    },
  },
  { timestamps: true }
);

UserSchema.set("toJSON", {
  transform: (_doc, ret) => {
    const ai = ret.ai || {};
    ret.ai = {
      provider: ai.provider || "anthropic",
      hasAnthropicKey: !!(ai.anthropicKeyEncrypted || ret.settings?.aiApiKeyEncrypted),
      hasOpenaiKey: !!ai.openaiKeyEncrypted,
      anthropicModel: ai.anthropicModel || "",
      openaiModel: ai.openaiModel || "",
    };
    ret.hasAiApiKey = ret.ai.provider === "openai" ? ret.ai.hasOpenaiKey : ret.ai.hasAnthropicKey;
    if (ret.settings) delete ret.settings.aiApiKeyEncrypted;
    delete ret.passwordHash;
    return ret;
  },
});

export default mongoose.model("User", UserSchema);
