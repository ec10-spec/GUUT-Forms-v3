import mongoose from "mongoose";
import crypto from "crypto";
import { decrypt } from "../utils/crypto.js";
import { FormSchema, SubmissionSchema } from "../models/tenantSchemas.js";
import { isProd } from "./env.js";
import { httpError } from "../utils/http.js";

const CONN_OPTS = { serverSelectionTimeoutMS: 8000, maxPoolSize: 5 };

// ---------------------------------------------------------------- platform DB
export async function connectPlatformDB() {
  let uri = process.env.MONGO_URI;
  if (!uri) {
    if (isProd) throw new Error("MONGO_URI is required in production.");
    const { MongoMemoryServer } = await import("mongodb-memory-server");
    uri = (await MongoMemoryServer.create()).getUri();
    console.log("No MONGO_URI set: using a throwaway in-memory MongoDB (data resets on restart).");
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  console.log(`Platform DB connected (${mongoose.connection.host}/${mongoose.connection.name})`);
}

export function platformStatus() {
  const c = mongoose.connection;
  return { connected: c.readyState === 1, host: c.host || null, name: c.name || null };
}

// ------------------------------------------------------------ tenant (company)
function modelsFor(conn) {
  return {
    Form: conn.models.Form || conn.model("Form", FormSchema),
    Submission: conn.models.Submission || conn.model("Submission", SubmissionSchema),
  };
}

export const tenantFromConnection = (conn, mode = "custom") => ({ mode, conn, ...modelsFor(conn) });

// Customer data never lives in the platform database.
export function noDatabaseError() {
  return httpError(409, "Your company hasn't linked a database yet. An admin can do this in Settings → Database.", { code: "NO_COMPANY_DB" });
}


const cache = new Map(); // companyId -> { fp, promise }

/** Returns the {Form, Submission} models bound to the company's database. */
export async function getTenant(company) {
  if (!company?.customUriEncrypted) throw noDatabaseError();
  const id = String(company._id);
  const fp = crypto.createHash("sha1").update(company.customUriEncrypted).digest("hex");
  const hit = cache.get(id);
  if (hit && hit.fp === fp) return hit.promise;
  if (hit) await dropTenant(id);

  const promise = (async () => {
    const conn = mongoose.createConnection(decrypt(company.customUriEncrypted), CONN_OPTS);
    try {
      await conn.asPromise();
    } catch (err) {
      await conn.close().catch(() => {});
      throw err;
    }
    conn.on("error", (e) => console.error(`[tenant ${id}] connection error:`, e.message));
    return tenantFromConnection(conn);
  })();
  cache.set(id, { fp, promise });
  try {
    return await promise;
  } catch (err) {
    cache.delete(id);
    throw httpError(503, "Couldn't reach your company's database. Ask your administrator to check the linked connection.", {
      code: "COMPANY_DB_DOWN",
      cause: err,
    });
  }
}

export async function dropTenant(companyId) {
  const hit = cache.get(String(companyId));
  cache.delete(String(companyId));
  if (hit) {
    try { await (await hit.promise).conn.close(); } catch { /* already gone */ }
  }
}

// ---------------------------------------------------- validating a database URI
export function parseMongoUri(uri) {
  const m = /^mongodb(\+srv)?:\/\/(?:[^@/]+@)?([^/?]+)\/([^?]+)/.exec(uri || "");
  if (!m) return null;
  return { host: m[2], dbName: decodeURIComponent(m[3]) };
}

/** Opens a connection, proves we can read AND write, and returns it (caller closes). */
export async function openVerifiedConnection(uri) {
  if (!/^mongodb(\+srv)?:\/\//.test(uri || "")) {
    throw httpError(400, "That doesn't look like a MongoDB connection string (it should start with mongodb:// or mongodb+srv://).");
  }
  const parsed = parseMongoUri(uri);
  if (!parsed) {
    throw httpError(400, "The connection string needs a database name, e.g. mongodb+srv://user:pass@cluster.mongodb.net/acme_forms");
  }
  const conn = mongoose.createConnection(uri, CONN_OPTS);
  try {
    await conn.asPromise();
    const col = conn.db.collection("_guut_healthcheck");
    const { insertedId } = await col.insertOne({ at: new Date() });
    await col.deleteOne({ _id: insertedId });
  } catch (err) {
    await conn.close().catch(() => {});
    throw httpError(400, `Couldn't connect with read/write access: ${String(err.message).replace(/mongodb(\+srv)?:\/\/\S+/g, "[uri]")}`);
  }
  return { conn, ...parsed };
}
