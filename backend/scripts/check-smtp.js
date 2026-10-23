import { createMailer } from "../src/lib/mailer.js";
try {
  const mailer = createMailer({
    ...process.env,
    SMTP_PORT: Number(process.env.SMTP_PORT || 587),
  });
  if (!mailer) throw new Error("Set AUTH_EMAIL_DELIVERY=smtp.");
  await mailer.verify();
  console.log(
    "PASS SMTP connection, TLS and authentication. No email was sent; inbox delivery is not verified.",
  );
} catch (e) {
  console.error("SMTP verification failed:", e.code || e.name);
  process.exitCode = 1;
}
