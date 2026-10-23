import { Router } from "express";
import { z } from "zod";
import { fail, validate } from "../middleware/security.js";
import { limiter } from "../middleware/limits.js";
export function publicRoutes(provider, config) {
  const r = Router();
  const admin = () => {
    const db = provider.admin();
    if (!db)
      throw fail(503, "Server configuration required.", "SETUP_REQUIRED");
    return db;
  };
  r.get("/content", async (_req, res) => {
    const result = await admin().rpc("api_public_content");
    if (result.error)
      throw fail(503, "Apply operations migration 009.", "SETUP_REQUIRED");
    res.json(result.data);
  });
  r.post(
    "/contact",
    limiter(provider, config, {
      name: "public-contact",
      seconds: 3600,
      limit: 5,
    }),
    validate(
      z
        .object({
          name: z.string().trim().min(2).max(100),
          email: z.email().max(254),
          phone: z
            .string()
            .regex(/^\+[1-9][0-9]{7,14}$/)
            .nullable()
            .optional(),
          topic: z.enum(["customer", "driver", "business", "support"]),
          message: z.string().trim().min(10).max(2000),
          consent: z.literal(true),
          website: z.literal("").optional(),
        })
        .strict(),
    ),
    async (req, res) => {
      const b = req.body,
        result = await admin().rpc("api_contact_enquiry", {
          p_name: b.name,
          p_email: b.email,
          p_phone: b.phone || null,
          p_topic: b.topic,
          p_message: b.message,
        });
      if (result.error)
        throw fail(503, "Your enquiry could not be saved. Please retry later.");
      res
        .status(201)
        .json({
          id: result.data,
          message:
            "Enquiry received. The Hyzz team can review it in the admin console.",
        });
    },
  );
  return r;
}
