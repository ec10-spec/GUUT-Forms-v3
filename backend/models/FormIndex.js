import mongoose from "mongoose";

// Lightweight directory in the PLATFORM db: which company (and therefore which
// database) a form lives in, so public links, /explore and submissions can find
// the right database without scanning every customer's. Holds only listing
// metadata; the form itself and all responses stay in the company's database.
// Title/description are kept here ONLY for forms the owner chose to list on
// Explore; private forms are indexed by id alone.
const FormIndexSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    ownerId: { type: String, required: true },
    title: { type: String, default: "" },
    description: { type: String, default: "" },
    fieldCount: { type: Number, default: 0 },
    isPublic: { type: Boolean, default: false },
    publishedAt: { type: Date, default: null },
  },
  { timestamps: true }
);
FormIndexSchema.index({ isPublic: 1, publishedAt: -1 });

const FormIndex = mongoose.model("FormIndex", FormIndexSchema);
export default FormIndex;

/** Upserts the directory entry for a form (same _id as the form). */
export function syncIndex(form, companyId) {
  return FormIndex.findByIdAndUpdate(
    form._id,
    {
      companyId,
      ownerId: form.ownerId,
      title: form.isPublic ? form.title : "",
      description: form.isPublic ? form.description || "" : "",
      fieldCount: form.isPublic ? form.fields?.length || 0 : 0,
      isPublic: !!form.isPublic,
      publishedAt: form.publishedAt || null,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}
