import nodemailer from "nodemailer";
export function createMailer(config) {
  if (config.AUTH_EMAIL_DELIVERY !== "smtp") return null;
  const transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.MAIL_ENCRYPTION === "ssl",
    requireTLS: config.MAIL_ENCRYPTION === "tls",
    auth: { user: config.SMTP_USER, pass: config.SMTP_PASS },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
    logger: false,
    debug: false,
  });
  return {
    verify: () => transport.verify(),
    async sendCode(email, code) {
      if (!/^\d{6,10}$/.test(code)) throw new Error("Invalid provider OTP");
      await transport.sendMail({
        from: {
          name: config.MAIL_FROM_NAME,
          address: config.MAIL_FROM_ADDRESS,
        },
        to: email,
        subject: "Your Hyzz sign-in code",
        text: `Your Hyzz sign-in code is ${code}. Enter it in Hyzz. Never share it with another person. If you did not request this code, ignore this email.`,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
    },
  };
}
