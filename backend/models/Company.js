import mongoose from "mongoose";

// A customer organisation. Users belong to one company. Forms and responses are
// stored ONLY in the company's own database (customUriEncrypted). Until one is
// linked, the company can't create forms; we never store them on our side.
const CompanySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    customUriEncrypted: { type: String, default: null },
    dbHost: { type: String, default: null },  // display only, never credentials
    dbName: { type: String, default: null },  // display only
    dbCheckedAt: { type: Date, default: null },
    dbLinkedBy: { type: String, default: null },
  },
  { timestamps: true }
);

CompanySchema.set("toJSON", {
  transform: (_doc, ret) => {
    ret.dbMode = ret.customUriEncrypted ? "custom" : "none";
    delete ret.customUriEncrypted;
    return ret;
  },
});

export default mongoose.model("Company", CompanySchema);
