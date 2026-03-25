import crypto from "node:crypto";

export function env(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

export function nowIso() {
  return new Date().toISOString();
}

export function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || `item-${crypto.randomUUID().slice(0, 8)}`;
}

export function formatMoney(cents: number | null | undefined) {
  if (cents == null) {
    return "TBD";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(cents / 100);
}

export function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function randomToken() {
  return crypto.randomBytes(32).toString("hex");
}

export function hashValue(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function normalizePhone(value: string) {
  return value.replace(/[^\d+]/g, "");
}

export function detectContactKind(value: string) {
  return value.includes("@") ? "email" : "phone";
}

export function isValidEmail(value: string) {
  const normalized = normalizeEmail(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
}

export function isValidPhone(value: string) {
  const trimmed = value.trim();
  if (!trimmed || !/^\+?[\d\s().-]+$/.test(trimmed)) {
    return false;
  }
  const digitsOnly = trimmed.replace(/\D/g, "");
  return digitsOnly.length >= 10 && digitsOnly.length <= 15;
}

export function nicknameFromSeed(seed: string) {
  const adjective = [
    "Swift", "Bright", "Lucky", "Golden", "Kind", "Quiet", "Happy", "Clever", "Sunny", "Brave"
  ];
  const noun = [
    "Fox", "Otter", "Maple", "Robin", "Comet", "Pine", "Harbor", "Willow", "Sparrow", "River"
  ];
  const hash = crypto.createHash("md5").update(seed).digest();
  return `${adjective[hash[0] % adjective.length]} ${noun[hash[1] % noun.length]} ${100 + (hash[2] % 900)}`;
}

export function clampBidAmount(value: string) {
  const cents = Math.round(Number(value) * 100);
  return Number.isFinite(cents) && cents > 0 ? cents : 0;
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
