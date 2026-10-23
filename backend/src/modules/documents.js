import { Router } from "express";
import multer from "multer";
import { fail } from "../middleware/security.js";
const upload = multer({
  storage: multer.memoryStorage(),
  // Leave room for multipart headers below Vercel's request-body limit.
  limits: { fileSize: 4194304, files: 1, fields: 5 },
});
function objectPath(req) {
  const path = req.params.path || "";
  if (
    path.length > 250 ||
    !/^([0-9a-f-]{36})\/[a-zA-Z0-9_.-]+\.(pdf|png|jpe?g)$/.test(path) ||
    path.includes("..")
  )
    throw fail(400, "Invalid private document path.");
  return path;
}
function verifyFile(file) {
  if (!file) throw fail(400, "Choose a document.");
  const b = file.buffer;
  const valid =
    (file.mimetype === "application/pdf" &&
      b.subarray(0, 5).toString() === "%PDF-") ||
    (file.mimetype === "image/png" &&
      b
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
    (file.mimetype === "image/jpeg" &&
      b[0] === 255 &&
      b[1] === 216 &&
      b[2] === 255);
  if (!valid) throw fail(400, "File contents must match PDF, PNG or JPEG.");
}
export function documentRoutes() {
  const r = Router();
  // Express 5 regex routes avoid ambiguous wildcard decoding.
  r.post(
    /^\/(vehicles\/)?upload\/(.+)$/,
    (req, res, next) => {
      req.params.path = req.params[1];
      req.bucket = req.params[0] ? "customer-vehicles" : "driver-documents";
      next();
    },
    upload.single("file"),
    async (req, res) => {
      const path = objectPath(req);
      if (
        req.bucket === "customer-vehicles" &&
        !(req.profile.kind === "customer" && path.startsWith(req.user.id + "/"))
      )
        throw fail(403, "Customer document owner required.");
      if (
        req.bucket === "driver-documents" &&
        !(
          req.profile.kind === "driver" && path.startsWith(req.user.id + "/")
        ) &&
        !req.profile.permissions.includes("drivers.review")
      )
        throw fail(
          403,
          "Only the driver owner or an authorized reviewer can upload documents.",
        );
      verifyFile(req.file);
      const { data, error } = await req.db.storage
        .from(req.bucket)
        .upload(path, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert: false,
        });
      if (error)
        throw fail(
          400,
          "Document upload rejected. Confirm your review permission and file path.",
        );
      return res.json({ Key: data.fullPath, Id: data.id });
    },
  );
  r.post(
    /^\/(vehicles\/)?sign\/(.+)$/,
    (req, res, next) => {
      req.params.path = req.params[1];
      req.bucket = req.params[0] ? "customer-vehicles" : "driver-documents";
      next();
    },
    async (req, res) => {
      const path = objectPath(req);
      if (req.body?.expiresIn !== 60)
        throw fail(400, "Document viewing links must expire after 60 seconds.");
      const { data, error } = await req.db.storage
        .from(req.bucket)
        .createSignedUrl(path, 60);
      if (error) throw fail(403, "Document access denied.");
      return res.json({ signedURL: data.signedUrl });
    },
  );
  return r;
}
