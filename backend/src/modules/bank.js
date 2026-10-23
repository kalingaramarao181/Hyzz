import { Router } from "express";
import { z } from "zod";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { fail, validate } from "../middleware/security.js";
function key(config) {
  const value = Buffer.from(config.BANK_DETAILS_ENCRYPTION_KEY || "", "base64");
  if (value.length !== 32)
    throw fail(
      503,
      "Configure BANK_DETAILS_ENCRYPTION_KEY on the backend before saving bank details.",
      "SETUP_REQUIRED",
    );
  return value;
}
export function encryptBank(config, driver, details) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(config), iv);
  cipher.setAAD(Buffer.from(driver));
  const body = Buffer.concat([
    cipher.update(JSON.stringify(details), "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), body]
    .map((v) => v.toString("base64"))
    .join(".");
}
export function decryptBank(config, driver, value) {
  const [iv, tag, data] = value.split(".").map((v) => Buffer.from(v, "base64"));
  const cipher = createDecipheriv("aes-256-gcm", key(config), iv);
  cipher.setAAD(Buffer.from(driver));
  cipher.setAuthTag(tag);
  return JSON.parse(
    Buffer.concat([cipher.update(data), cipher.final()]).toString("utf8"),
  );
}
const bank = z
  .object({
    name: z.string().trim().min(2).max(100),
    account: z.string().regex(/^[0-9]{9,18}$/),
    ifsc: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/),
  })
  .strict();
export function bankRoutes(provider, config) {
  const r = Router();
  r.post("/details", validate(bank), async (req, res) => {
    if (req.profile.kind !== "driver")
      throw fail(403, "Driver account required.");
    const admin = provider.admin();
    if (!admin)
      throw fail(503, "Server service credentials required.", "SETUP_REQUIRED");
    const body = req.body,
      ciphertext = encryptBank(config, req.user.id, body);
    const result = await admin.rpc("api_store_driver_bank", {
      p_driver: req.user.id,
      p_ciphertext: ciphertext,
      p_name: body.name,
      p_ifsc: body.ifsc,
      p_last4: body.account.slice(-4),
    });
    if (result.error)
      throw fail(
        503,
        "Bank details could not be saved. Apply migration 008 and retry.",
        "SETUP_REQUIRED",
      );
    res.json({ saved: true, last4: body.account.slice(-4) });
  });
  r.post("/payout/:id/reveal", async (req, res) => {
    if (!req.profile.permissions?.includes("finance.manage"))
      throw fail(403, "Finance permission required.");
    const id = z.uuid().safeParse(req.params.id);
    if (!id.success) throw fail(400, "Invalid payout ID.");
    const admin = provider.admin();
    if (!admin) throw fail(503, "Server service credentials required.");
    const result = await admin.rpc("api_reveal_payout_bank", {
      p_payout: id.data,
      p_actor: req.user.id,
    });
    if (result.error || !result.data)
      throw fail(403, "Payout bank access denied.");
    try {
      res.json(
        decryptBank(config, result.data.driver_id, result.data.ciphertext),
      );
    } catch {
      throw fail(
        503,
        "Cannot read this bank record. Check the original backend encryption key.",
        "SETUP_REQUIRED",
      );
    }
  });
  return r;
}
