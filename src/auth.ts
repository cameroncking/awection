import {
  clearSecurityEvents,
  countSecurityEventsSince,
  db,
  ensureUser,
  findUserByContact,
  pruneSecurityEvents,
  recordSecurityEvent
} from "./db.js";
import { ContactKind, Viewer } from "./types.js";
import { detectContactKind, env, generateCode, hashValue, normalizeEmail, normalizePhone, nowIso, randomToken } from "./utils.js";

export async function requestAuthCode(contactInput: string) {
  const kind = detectContactKind(contactInput) as ContactKind;
  const contact = kind === "email" ? normalizeEmail(contactInput) : normalizePhone(contactInput);
  pruneSecurityEvents(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
  const latest = db.prepare(`
    SELECT created_at
    FROM auth_codes
    WHERE contact = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(contact) as { created_at: string } | undefined;

  if (latest) {
    const lastSentAt = new Date(latest.created_at).getTime();
    const nextAllowedAt = lastSentAt + 5 * 60 * 1000;
    if (Date.now() < nextAllowedAt) {
      const remainingMinutes = Math.ceil((nextAllowedAt - Date.now()) / 60000);
      throw new Error(`A new code can only be sent once every 5 minutes. Try again in about ${remainingMinutes} minute${remainingMinutes === 1 ? "" : "s"}.`);
    }
  }

  const code = generateCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  db.prepare("DELETE FROM auth_codes WHERE contact = ?").run(contact);
  db.prepare(
    "INSERT INTO auth_codes (contact, code, expires_at, created_at) VALUES (?, ?, ?, ?)"
  ).run(contact, hashValue(`${contact}:${code}`), expiresAt, nowIso());

  await deliverMessage(kind, contact, "Your auction sign-in code", `<p>Your sign-in code is <strong>${code}</strong>.</p><p>It expires in 10 minutes.</p>`, `Your sign-in code is ${code}. It expires in 10 minutes.`, "auth-code");
  return { contact, kind, expiresAt };
}

export async function deliverMessage(
  kind: ContactKind,
  contact: string,
  subject: string,
  html: string,
  text: string,
  logTag = "message"
) {
  if (kind === "email" && env("RESEND_API_KEY") && env("RESEND_FROM")) {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env("RESEND_API_KEY")}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: env("RESEND_FROM"),
        to: [contact],
        subject,
        html
      })
    });
    return;
  }

  if (kind === "phone" && env("TWILIO_ACCOUNT_SID") && env("TWILIO_AUTH_TOKEN") && env("TWILIO_FROM")) {
    const params = new URLSearchParams({
      To: contact,
      From: env("TWILIO_FROM"),
      Body: text
    });
    const auth = Buffer.from(`${env("TWILIO_ACCOUNT_SID")}:${env("TWILIO_AUTH_TOKEN")}`).toString("base64");
    await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env("TWILIO_ACCOUNT_SID")}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params
    });
    return;
  }

  console.log(`[${logTag}:${kind}] ${contact} -> ${text}`);
}

export function verifyAuthCode(contactInput: string, code: string, remoteKey: string) {
  const kind = detectContactKind(contactInput) as ContactKind;
  const contact = kind === "email" ? normalizeEmail(contactInput) : normalizePhone(contactInput);
  const normalizedRemoteKey = remoteKey.trim() || "unknown";
  const verifyWindowStart = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const contactFailures = countSecurityEventsSince("auth_verify_contact", contact, verifyWindowStart);
  const ipFailures = countSecurityEventsSince("auth_verify_ip", normalizedRemoteKey, verifyWindowStart);
  if (contactFailures >= 5 || ipFailures >= 25) {
    throw new Error("Too many failed attempts. Wait a few minutes and request a new code.");
  }
  const authCode = db.prepare(`
    SELECT 1 AS present
    FROM auth_codes
    WHERE contact = ? AND code = ? AND expires_at > ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(contact, hashValue(`${contact}:${code.trim()}`), nowIso()) as { present: number } | undefined;

  if (!authCode) {
    recordSecurityEvent("auth_verify_contact", contact);
    recordSecurityEvent("auth_verify_ip", normalizedRemoteKey);
    throw new Error("That code is invalid or expired.");
  }

  const existingViewer = kind === "email" ? findUserByContact(contact, null) : findUserByContact(null, contact);
  const viewer: Viewer = existingViewer
    ? existingViewer
    : kind === "email"
      ? ensureUser(contact, null, "")
      : ensureUser(null, contact, "");

  db.prepare("DELETE FROM auth_codes WHERE contact = ?").run(contact);
  clearSecurityEvents("auth_verify_contact", contact);
  clearSecurityEvents("auth_verify_ip", normalizedRemoteKey);
  return {
    session: createSession(viewer.id, isAdminContact(contact)),
    needsNickname: !viewer.nickname.trim()
  };
}

function createSession(userId: number, isAdmin: boolean) {
  const token = randomToken();
  const tokenHash = hashValue(token);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(
    "INSERT INTO sessions (user_id, token_hash, is_admin, expires_at, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(userId, tokenHash, isAdmin ? 1 : 0, expiresAt, nowIso());
  return { token, expiresAt };
}

export function clearSession(token: string) {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashValue(token));
}

function isAdminContact(contact: string) {
  const configured = env("ADMIN_CONTACT")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return configured.some((entry) => {
    const kind = detectContactKind(entry) as ContactKind;
    const normalized = kind === "email" ? normalizeEmail(entry) : normalizePhone(entry);
    return contact === normalized;
  });
}
