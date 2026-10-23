import { Router } from "express";
import { z } from "zod";
import { fail, validate } from "../middleware/security.js";
const account = z
  .object({
    email: z.email().max(254),
    name: z.string().trim().min(2).max(100),
    kind: z.enum(["driver", "employee", "customer"]),
    role: z
      .enum([
        "super_admin",
        "operations",
        "verification",
        "support",
        "finance",
        "reporting",
      ])
      .nullable()
      .optional(),
  })
  .strict()
  .refine((v) => v.kind !== "employee" || !!v.role, {
    message: "Employee role is required",
    path: ["role"],
  });
export function adminRoutes(provider) {
  const r = Router();
  r.post("/accounts", validate(account), async (req, res) => {
    const body = req.body,
      required = body.kind === "employee" ? "staff.manage" : "users.manage";
    if (!req.profile.permissions.includes(required))
      throw fail(403, "Not authorized to create this account.");
    const admin = provider.admin();
    if (!admin)
      throw fail(
        503,
        "Configure SUPABASE_SERVICE_ROLE_KEY on the Node.js server for account creation.",
        "SETUP_REQUIRED",
      );
    const { data, error } = await admin.auth.admin.createUser({
      email: body.email.toLowerCase(),
      email_confirm: false,
    });
    if (error) throw fail(400, error.message);
    const { error: provisionError } = await req.db.rpc("admin_provision_user", {
      p_user: data.user.id,
      p_name: body.name,
      p_kind: body.kind,
      p_role: body.role || null,
    });
    if (provisionError) {
      const { error: cleanupError } = await admin.auth.admin.deleteUser(
        data.user.id,
      );
      throw fail(
        400,
        "Account provisioning failed." +
          (cleanupError
            ? " An unprivileged Auth account remains for administrator review."
            : ""),
      );
    }
    return res
      .status(201)
      .json({
        id: data.user.id,
        message:
          "Account created. The user can request an email sign-in code. No invitation email has been sent.",
      });
  });
  return r;
}
