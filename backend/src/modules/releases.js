import { Router } from "express";
import { z } from "zod";
import yauzl from "yauzl";
import { createHash } from "node:crypto";
import { fail, permission, validate } from "../middleware/security.js";
export const MAX_APK = 50 * 1024 * 1024;
// Bounded extraction of metadata only. This does NOT replace apksigner verification.
export function inspectApk(buffer) {
  return new Promise((resolve, reject) => {
    if (buffer.length < 1024 || buffer.length > MAX_APK)
      return reject(fail(400, "APK must be between 1 KiB and 50 MiB."));
    yauzl.fromBuffer(
      buffer,
      { lazyEntries: true, validateEntrySizes: true },
      (err, zip) => {
        if (err) return reject(fail(400, "Upload a valid APK ZIP archive."));
        let entries = 0,
          config = null,
          manifest = false,
          dex = false,
          reading = false;
        const bad = () => {
          zip.close();
          reject(fail(400, "APK archive metadata is invalid or too large."));
        };
        zip.on("error", bad);
        zip.on("entry", (e) => {
          if (
            ++entries > 10000 ||
            e.fileName.includes("..") ||
            e.fileName.startsWith("/") ||
            e.fileName.includes("\\")
          )
            return bad();
          if (e.fileName === "AndroidManifest.xml") manifest = true;
          if (e.fileName === "classes.dex") dex = true;
          if (e.fileName !== "assets/app.config") return zip.readEntry();
          if (config !== null || reading || e.uncompressedSize > 65536)
            return bad();
          reading = true;
          zip.openReadStream(e, (error, stream) => {
            if (error) return bad();
            const chunks = [];
            let size = 0;
            stream.on("error", bad);
            stream.on("data", (chunk) => {
              size += chunk.length;
              if (size > 65536) {
                stream.destroy();
                bad();
              } else chunks.push(chunk);
            });
            stream.on("end", () => {
              try {
                config = JSON.parse(Buffer.concat(chunks).toString("utf8"));
                reading = false;
                zip.readEntry();
              } catch {
                bad();
              }
            });
          });
        });
        zip.on("end", () => {
          if (!manifest || !dex || !config)
            return reject(
              fail(
                400,
                "APK needs Android manifest, classes and embedded Expo app.config.",
              ),
            );
          resolve(config);
        });
        zip.readEntry();
      },
    );
  });
}
function service(provider) {
  const db = provider.admin();
  if (!db) throw fail(503, "Server service credentials required.");
  return db;
}
export function releasePublicRoutes(provider) {
  const r = Router();
  r.get("/latest/:audience", async (req, res) => {
    if (!["driver", "customer"].includes(req.params.audience))
      throw fail(400, "Invalid audience.");
    const result = await service(provider).rpc("api_latest_release", {
      p_audience: req.params.audience,
    });
    if (result.error)
      throw fail(503, "Apply release migration 010.", "SETUP_REQUIRED");
    res.json(result.data);
  });
  r.get("/:id/download", async (req, res) => {
    if (!z.uuid().safeParse(req.params.id).success)
      throw fail(400, "Invalid release.");
    const db = service(provider),
      row = await db.rpc("api_release_record", {
        p_id: req.params.id,
        p_actor: null,
      });
    if (row.error || !row.data) throw fail(404, "Published release not found.");
    const url = await db.storage
      .from("app-releases")
      .createSignedUrl(row.data.storage_path, 60, {
        download: `Hyzz-${row.data.audience}-${row.data.version}.apk`,
      });
    if (url.error) throw fail(503, "Download temporarily unavailable.");
    res.redirect(302, url.data.signedUrl);
  });
  return r;
}
export function releaseAdminRoutes(provider) {
  const r = Router();
  r.use(permission("releases.manage"));
  r.post(
    "/upload",
    validate(
      z
        .object({
          audience: z.enum(["driver", "customer"]),
          version: z.string().regex(/^\d+\.\d+\.\d+$/),
          version_code: z.number().int().positive().max(100000000),
          notes: z.string().trim().min(5).max(2000),
        })
        .strict(),
    ),
    async (req, res) => {
      const b = req.body,
        result = await req.db.rpc("admin_release_draft", {
          p_audience: b.audience,
          p_version: b.version,
          p_version_code: b.version_code,
          p_notes: b.notes,
        });
      if (result.error) throw fail(400, result.error.message);
      const signed = await service(provider)
        .storage.from("app-releases")
        .createSignedUploadUrl(result.data.storage_path, { upsert: false });
      if (signed.error)
        throw fail(
          503,
          "Cannot prepare storage upload. Apply migration 010 and check storage configuration.",
        );
      res.json({
        id: result.data.id,
        signedUrl: signed.data.signedUrl,
        path: result.data.storage_path,
      });
    },
  );
  r.post(
    "/:id/publish",
    validate(z.object({ signature_checked: z.literal(true) }).strict()),
    async (req, res) => {
      if (!z.uuid().safeParse(req.params.id).success)
        throw fail(400, "Invalid release.");
      const db = service(provider),
        row = await db.rpc("api_release_record", {
          p_id: req.params.id,
          p_actor: req.user.id,
        });
      if (row.error || !row.data) throw fail(404, "Release not found.");
      const file = await db.storage
        .from("app-releases")
        .download(row.data.storage_path);
      if (file.error)
        throw fail(400, "Upload the APK successfully before publishing.");
      if (file.data.size > MAX_APK) throw fail(400, "APK exceeds 50 MiB.");
      const bytes = Buffer.from(await file.data.arrayBuffer()),
        config = await inspectApk(bytes),
        record = row.data;
      if (
        config.extra?.appVariant !== record.audience ||
        config.android?.package !== `com.hyzz.${record.audience}` ||
        config.version !== record.version ||
        config.android?.versionCode !== record.version_code
      )
        throw fail(
          400,
          "Embedded APK audience/package/version does not match the draft. Rebuild or correct the release details.",
        );
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const published = await db.rpc("api_publish_release", {
        p_id: record.id,
        p_actor: req.user.id,
        p_hash: sha256,
        p_bytes: bytes.length,
      });
      if (published.error) throw fail(400, published.error.message);
      const notices = await db.rpc("api_release_notifications");
      res.json({
        published: true,
        sha256,
        bytes: bytes.length,
        notified: notices.error ? 0 : notices.data,
        notification_pending: !!notices.error,
      });
    },
  );
  r.post("/notify", async (_req, res) => {
    const result = await service(provider).rpc("api_release_notifications");
    if (result.error)
      throw fail(503, "Notification batch could not be processed.");
    res.json({ notified: result.data });
  });
  return r;
}
