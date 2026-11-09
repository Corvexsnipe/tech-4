import dns from "node:dns";
import nodemailer from "nodemailer";
import { Prisma } from "@prisma/client";
import { AppError, appUrl, configured, db } from "./db";
import { digest, token } from "./security";

export function mailConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.MAIL_FROM);
}

// Operations inbox for new tickets and unassigned owner replies.
export const SUPPORT_ALERT_EMAIL = process.env.SUPPORT_ALERT_EMAIL || "zaidirehan904@gmail.com";

// Minimal branded HTML wrapper; the plain-text body remains the fallback.
function toHtml(text: string) {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const linked = escaped.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#6935d8">$1</a>');
  return `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f7f5fb;font-family:Arial,Helvetica,sans-serif;color:#221633"><div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e9e4f2;border-radius:12px;padding:28px"><div style="font-size:17px;font-weight:700;color:#49278f;margin-bottom:18px">review<span style="font-weight:400">matters</span></div><div style="font-size:13px;line-height:1.7;white-space:pre-wrap">${linked}</div><p style="font-size:10.5px;color:#9a8cae;margin-top:26px;border-top:1px solid #eee8f6;padding-top:14px">Review Matters · Real reviews. Clearer decisions.</p></div></body></html>`;
}

export const DEFAULT_TEMPLATES: Record<string, { subject: string; body: string; description: string }> = {
  verify: {
    subject: "Verify your Review Matters email",
    body: "Hello {{name}},\n\nVerify your email using this link:\n\n{{url}}\n\nIf you did not request this, ignore this email. Never share this link.",
    description: "Sent when someone registers or requests a new verification link. Placeholders: {{name}}, {{url}}",
  },
  reset: {
    subject: "Reset your Review Matters password",
    body: "Hello {{name}},\n\nReset your password using this link:\n\n{{url}}\n\nIf you did not request this, ignore this email. Never share this link.",
    description: "Sent for password reset requests. Placeholders: {{name}}, {{url}}",
  },
  "review-received": {
    subject: "Your review for {{business}} was submitted – Review Matters",
    body: "Hi {{name}},\n\nThank you for sharing your experience on Review Matters.\n\nYour review for {{business}} has been submitted successfully. It will go live publicly once our staff team verifies and approves it — every review is checked before publication to keep the platform trustworthy.\n\nYou can follow its status in your account:\n{{url}}\n\nThank you,\nTeam Review Matters",
    description: "Sent to the reviewer right after a review is submitted; it goes live only after staff approval. Placeholders: {{name}}, {{business}}, {{url}}",
  },
  "review-confirmation": {
    subject: "Your review for {{business}} was approved – Review Matters",
    body: "Hi {{name}},\n\nGood news — our moderation team approved your review for {{business}} and it is now live on the platform.\n\nThank you for helping others make better decisions.\n\n{{url}}\n\nThank you,\nTeam Review Matters",
    description: "Sent when a moderator approves and publishes a review. Placeholders: {{name}}, {{business}}, {{url}}",
  },
  "ticket-confirmation": {
    subject: "Support ticket {{ticket}} received – Review Matters",
    body: "Hi {{name}},\n\nYour support ticket {{ticket}} has been created.\n\nSubject: {{subject}}\nCategory: {{category}}\n\nOur team will review it and reply by email and in your dashboard. You can follow the conversation here:\n\n{{url}}\n\nThank you,\nTeam Review Matters",
    description: "Confirmation sent to the ticket creator. Placeholders: {{name}}, {{ticket}}, {{subject}}, {{category}}, {{url}}",
  },
  "ticket-alert": {
    subject: "New support ticket {{ticket}}: {{subject}}",
    body: "A new support ticket was created.\n\nTicket: {{ticket}}\nSubject: {{subject}}\nCategory: {{category}}\nBusiness: {{business}}\nFrom: {{name}} <{{email}}>\nSubmitted: {{created}}\n\nMessage preview:\n{{preview}}\n\nOpen the ticket: {{url}}",
    description: "Staff alert for new tickets and unassigned owner replies. Placeholders: {{ticket}}, {{subject}}, {{category}}, {{business}}, {{name}}, {{email}}, {{created}}, {{preview}}, {{url}}",
  },
  "ticket-reply-owner": {
    subject: "New reply on ticket {{ticket}} – Review Matters",
    body: "Hi {{name}},\n\nOur support team replied to your ticket {{ticket}} ({{subject}}).\n\nReply preview:\n{{preview}}\n\nView the conversation and respond: {{url}}\n\nThank you,\nTeam Review Matters",
    description: "Sent to the business owner when staff reply. Placeholders: {{name}}, {{ticket}}, {{subject}}, {{preview}}, {{url}}",
  },
  "ticket-reply-staff": {
    subject: "Owner replied on ticket {{ticket}}: {{subject}}",
    body: "The business owner replied to a ticket.\n\nTicket: {{ticket}}\nSubject: {{subject}}\nBusiness: {{business}}\nFrom: {{name}} <{{email}}>\n\nReply preview:\n{{preview}}\n\nOpen the ticket: {{url}}",
    description: "Sent to the assigned staff member (or the support inbox) when an owner replies. Placeholders: {{ticket}}, {{subject}}, {{business}}, {{name}}, {{email}}, {{preview}}, {{url}}",
  },
  "ticket-status": {
    subject: "Ticket {{ticket}} is now {{status}} – Review Matters",
    body: "Hi {{name}},\n\nThe status of your support ticket {{ticket}} ({{subject}}) changed to {{status}}.\n\n{{detail}}\n\nView the ticket: {{url}}\n\nThank you,\nTeam Review Matters",
    description: "Sent to the owner when a ticket status changes. Placeholders: {{name}}, {{ticket}}, {{subject}}, {{status}}, {{detail}}, {{url}}",
  },
  "claim-approval": {
    subject: "Your ownership of {{business}} was approved – Review Matters",
    body: "Hi {{name}},\n\nGood news — your ownership claim for {{business}} has been verified and approved.\n\nYou can now manage the business profile, reply to reviews, print your QR poster, and handle support tickets from your dashboard:\n\n{{url}}\n\nThank you,\nTeam Review Matters",
    description: "Sent to the claimant when an administrator approves a business ownership claim. Placeholders: {{name}}, {{business}}, {{url}}",
  },
  "review-decision": {
    subject: "Your review for {{business}} was {{status}} – Review Matters",
    body: "Hi {{name}},\n\nYour review for {{business}} was {{status}} by our moderation team.\n\n{{reason}}\n\nYou can view the status and appeal the decision from your account:\n{{url}}\n\nThank you,\nTeam Review Matters",
    description: "Sent when a moderator rejects, hides, or removes a review. Placeholders: {{name}}, {{business}}, {{status}}, {{reason}}, {{url}}",
  },
  "claim-decision": {
    subject: "Your ownership claim for {{business}} was {{status}} – Review Matters",
    body: "Hi {{name}},\n\nYour ownership claim for {{business}} was {{status}} by our verification team.\n\n{{reason}}\n\nView your dashboard for details:\n{{url}}\n\nThank you,\nTeam Review Matters",
    description: "Sent to the claimant when an administrator rejects a business ownership claim. Placeholders: {{name}}, {{business}}, {{status}}, {{reason}}, {{url}}",
  },
  "claim-decision-staff": {
    subject: "Claim {{status}}: {{business}} – Review Matters",
    body: "A business ownership claim was decided.\n\nBusiness: {{business}}\nClaimant: {{name}} <{{email}}>\nDecision: {{status}}\nReason: {{reason}}\n\nOpen the claims queue: {{url}}",
    description: "Sent to the operations inbox when a business claim is approved or rejected. Placeholders: {{business}}, {{name}}, {{email}}, {{status}}, {{reason}}, {{url}}",
  },
  "domain-proof": {
    subject: "Action needed: verify your domain for {{business}} – Review Matters",
    body: "Hi {{name}},\n\nTo continue your ownership verification for {{business}}, please prove control of {{website}}.\n\nAdd the following line where it is publicly visible on the website — for example in a page footer or a page linked from the homepage:\n\nreviewmatters-verification: {{code}}\n\nAlternatively, reply to this email from an email address on the business domain.\n\nOnce it is in place, let us know and an administrator will complete the check.\n\nThank you,\nTeam Review Matters",
    description: "Sent when an admin requests domain proof for a claim or ownership report. Placeholders: {{name}}, {{business}}, {{website}}, {{code}}",
  },
};

async function transport() {
  const host = process.env.SMTP_HOST || "";
  const secure = process.env.SMTP_SECURE === "true";
  // Node's bundled resolver (c-ares) can end up pointed at DNS servers that
  // never answer — e.g. a VPN's loopback resolver — failing every SMTP connect
  // with "queryA ETIMEOUT". Resolve through the OS resolver instead and keep
  // the real hostname for TLS SNI/certificate validation.
  let address = host;
  try { address = (await dns.promises.lookup(host)).address; } catch { /* keep hostname */ }
  return nodemailer.createTransport({
    host: address,
    port: Number(process.env.SMTP_PORT || 587),
    secure,
    requireTLS: !secure,
    ...(address !== host ? { tls: { servername: host } } : {}),
    ...(process.env.SMTP_USER ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } } : {}),
  });
}

async function render(kind: string, vars: Record<string, string>) {
  const stored = await db().emailTemplate.findUnique({ where: { key: kind } }).catch(() => null);
  const template = stored || DEFAULT_TEMPLATES[kind];
  if (!template) throw new AppError("This email type is not configured.", 503);
  const fill = (text: string) => text.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
  return { subject: fill(template.subject), body: fill(template.body) };
}

// EmailLog rows double as a persistent delivery queue: a "queued" row keeps
// its rendered subject/body and dedupe key until the message is delivered.
// The retry sweeper (processEmailQueue) keeps re-attempting queued rows with
// exponential backoff until they send — a temporary SMTP outage can no longer
// lose an email.
type LogRow = { id: string; recipient: string; subject: string; body: string; attempts: number };

// Renders the template and reserves the send. A dedupe key conflict means the
// same logical email is already queued or sent, so it is never duplicated.
async function enqueue(user: { id?: string; email: string }, kind: string, vars: Record<string, string>, dedupeKey?: string): Promise<LogRow | null> {
  const { subject, body } = await render(kind, vars);
  try {
    return await db().emailLog.create({
      data: { userId: user.id || null, recipient: user.email, kind, status: "queued", subject, body, nextRetryAt: new Date(), dedupeKey: dedupeKey || null },
      select: { id: true, recipient: true, subject: true, body: true, attempts: true },
    });
  } catch (error) {
    if (dedupeKey && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return null;
    throw error;
  }
}

// One delivery attempt against a queued row. The status flip to "sending" is
// an atomic claim so concurrent senders cannot deliver the same row twice.
async function attemptDelivery(row: LogRow): Promise<"sent" | "failed" | "claimed"> {
  const claimed = await db().emailLog.updateMany({ where: { id: row.id, status: "queued" }, data: { status: "sending" } });
  if (!claimed.count) return "claimed";
  const smtp = await transport();
  try {
    await smtp.sendMail({ from: process.env.MAIL_FROM, to: row.recipient, subject: row.subject, text: row.body, html: toHtml(row.body) });
    await db().emailLog.update({ where: { id: row.id }, data: { status: "sent", detail: "", nextRetryAt: null, attempts: { increment: 1 } } });
    return "sent";
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 300) : "Delivery failed.";
    // Back off exponentially (30s, 1m, 2m … capped at 1h). The row stays
    // queued — the sweeper retries until delivery succeeds.
    const delay = Math.min(30_000 * 2 ** Math.min(row.attempts, 6), 3600_000);
    await db().emailLog.update({ where: { id: row.id }, data: { status: "queued", detail, attempts: { increment: 1 }, nextRetryAt: new Date(Date.now() + delay) } });
    return "failed";
  } finally {
    smtp.close();
  }
}

export async function sendMail(user: { id?: string; email: string }, kind: string, vars: Record<string, string>, dedupeKey?: string) {
  if (!mailConfigured()) throw new AppError("Email delivery is not configured. Please contact the platform operator.", 503);
  const row = await enqueue(user, kind, vars, dedupeKey);
  if (!row) return;
  if (await attemptDelivery(row) === "failed") throw new AppError("The email could not be sent. Please try again later.", 503);
}

// Immediate retries for temporary delivery failures (e.g. SMTP timeouts),
// then the persistent queue takes over and keeps retrying in the background
// until the email is delivered.
export async function sendMailResilient(user: { id?: string; email: string }, kind: string, vars: Record<string, string>, dedupeKey?: string) {
  if (!mailConfigured()) return;
  let row: LogRow | null;
  try { row = await enqueue(user, kind, vars, dedupeKey); } catch { return; }
  if (!row) return;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise(resolve => setTimeout(resolve, 1500));
    const result = await attemptDelivery(row).catch(() => "failed" as const);
    if (result !== "failed") return;
  }
}

const RETRY_BATCH = 25;
const RETRY_CLAIM_STALE_MS = 5 * 60_000;
const RETRY_GRACE_MS = 60_000;

// Sweeps the persistent queue: retries every email whose backoff has elapsed.
// Rows stuck in "sending" (interrupted by a restart) are reclaimed first.
// Runs from the in-process scheduler and the security worker.
export async function processEmailQueue() {
  if (!configured() || !mailConfigured()) return { sent: 0, retried: 0 };
  const now = Date.now();
  await db().emailLog.updateMany({ where: { status: "sending", updatedAt: { lt: new Date(now - RETRY_CLAIM_STALE_MS) } }, data: { status: "queued", nextRetryAt: new Date() } });
  const due = await db().emailLog.findMany({
    where: { status: "queued", nextRetryAt: { lte: new Date() }, createdAt: { lt: new Date(now - RETRY_GRACE_MS) } },
    orderBy: { nextRetryAt: "asc" }, take: RETRY_BATCH,
    select: { id: true, recipient: true, subject: true, body: true, attempts: true },
  });
  let sent = 0, retried = 0;
  for (const row of due) {
    const result = await attemptDelivery(row).catch(() => "failed" as const);
    if (result === "sent") sent++;
    else if (result === "failed") retried++;
  }
  return { sent, retried };
}

// In-process retry scheduler for the web server; cron deployments get the
// same flushing through the security worker, which calls processEmailQueue.
declare global { var __emailRetryScheduler: NodeJS.Timeout | undefined }
export function startEmailRetryScheduler(intervalMs = 60_000, initialDelayMs = 15_000) {
  if (globalThis.__emailRetryScheduler) return;
  const tick = () => processEmailQueue().catch(() => {});
  const first = setTimeout(tick, initialDelayMs);
  first.unref();
  globalThis.__emailRetryScheduler = setInterval(tick, intervalMs);
  globalThis.__emailRetryScheduler.unref();
}

// Fired after a review is committed. Delivery is retried on failure; the
// review stays published regardless of the outcome. Safe to call without
// awaiting — every attempt is recorded in the email log.
export async function sendReviewConfirmation(user: { id: string; email: string; displayName?: string | null }, reviewId: string, businessName: string) {
  await sendMailResilient(user, "review-confirmation", { name: user.displayName || user.email, business: businessName, url: `${appUrl()}/account` }, `review-confirmation:${reviewId}`);
}

export async function sendAccountEmail(user: { id: string; email: string; displayName?: string }, kind: "verify" | "reset") {
  const raw = token();
  const id = digest(raw);
  await db().accountToken.create({ data: { id, userId: user.id, kind, expiresAt: new Date(Date.now() + (kind === "reset" ? 3600_000 : 86400_000)) } });
  const url = `${appUrl()}/${kind === "verify" ? "verify-email" : "reset-password"}?token=${raw}`;
  // Delivery is queued and retried until it succeeds, so the token must stay
  // alive — deleting it would send the user a link that no longer works.
  await sendMailResilient(user, kind, { name: user.displayName || user.email, url });
}
