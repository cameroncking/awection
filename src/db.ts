import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { AccountBidRow, DashboardData, ItemRow, Viewer } from "./types.js";
import { detectContactKind, env, normalizeEmail, normalizePhone, nowIso, slugify } from "./utils.js";

const dbPath = path.resolve(process.cwd(), env("DB_PATH", "./data/awection.sqlite"));
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE,
      phone TEXT UNIQUE,
      nickname TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contact TEXT NOT NULL,
      code TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      is_admin INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS pending_registrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL UNIQUE,
      contact TEXT NOT NULL,
      kind TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category_id INTEGER NOT NULL,
      image_url TEXT,
      donor_name TEXT,
      retail_value_cents INTEGER,
      starting_bid_cents INTEGER NOT NULL,
      min_increment_cents INTEGER NOT NULL DEFAULT 100,
      buy_now_cents INTEGER,
      popularity_score INTEGER NOT NULL DEFAULT 0,
      bid_count INTEGER NOT NULL DEFAULT 0,
      last_bid_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(category_id) REFERENCES categories(id)
    );

    CREATE TABLE IF NOT EXISTS bids (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      amount_cents INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      canceled_at TEXT,
      FOREIGN KEY(item_id) REFERENCES items(id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      amount_cents INTEGER NOT NULL,
      status TEXT NOT NULL,
      stripe_session_id TEXT,
      stripe_checkout_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(item_id) REFERENCES items(id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS proxy_bids (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      max_amount_cents INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(item_id, user_id),
      FOREIGN KEY(item_id) REFERENCES items(id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS payment_preauthorizations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      status TEXT NOT NULL,
      stripe_session_id TEXT,
      stripe_checkout_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS pending_bid_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      item_id INTEGER NOT NULL,
      mode TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(item_id) REFERENCES items(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notification_preferences (
      user_id INTEGER PRIMARY KEY,
      outbid_enabled INTEGER NOT NULL DEFAULT 1,
      won_enabled INTEGER NOT NULL DEFAULT 1,
      payment_enabled INTEGER NOT NULL DEFAULT 1,
      admin_payment_enabled INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS notification_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      event_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(event_type, event_key)
    );

    CREATE TABLE IF NOT EXISTS security_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL,
      event_key TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  try {
    db.exec("ALTER TABLE bids ADD COLUMN canceled_at TEXT");
  } catch {
    // Migration already applied.
  }

  try {
    db.exec("ALTER TABLE purchases ADD COLUMN stripe_session_id TEXT");
  } catch {
    // Migration already applied.
  }

  try {
    db.exec("ALTER TABLE notification_preferences ADD COLUMN admin_payment_enabled INTEGER NOT NULL DEFAULT 0");
  } catch {
    // Migration already applied.
  }

  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('auction_ends_at', ?)")
    .run(env("AUCTION_ENDS_AT", new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()));
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('site_title', 'Awection')").run();
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('home_heading', 'Fast to browse. Fast to bid. Built for a phone in one hand.')").run();
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('home_description', 'Jump straight into active items, explore by category, and only sign in when you’re ready to place a bid or check out a win.')").run();
  seedIfEmpty();
}

export function getAuctionEndsAt() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'auction_ends_at'").get() as { value: string } | undefined;
  return row?.value || env("AUCTION_ENDS_AT", new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString());
}

export function setAuctionEndsAt(value: string) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES ('auction_ends_at', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(value);
}

export function getSiteContentSettings() {
  const rows = db.prepare(`
    SELECT key, value
    FROM settings
    WHERE key IN ('site_title', 'home_heading', 'home_description')
  `).all() as Array<{ key: string; value: string }>;
  const map = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  return {
    siteTitle: map.site_title || "Awection",
    homeHeading: map.home_heading || "Fast to browse. Fast to bid. Built for a phone in one hand.",
    homeDescription: map.home_description || "Jump straight into active items, explore by category, and only sign in when you’re ready to place a bid or check out a win."
  };
}

export function setSiteContentSettings(input: { siteTitle: string; homeHeading: string; homeDescription: string }) {
  const transaction = db.transaction(() => {
    db.prepare(`
      INSERT INTO settings (key, value) VALUES ('site_title', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(input.siteTitle);
    db.prepare(`
      INSERT INTO settings (key, value) VALUES ('home_heading', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(input.homeHeading);
    db.prepare(`
      INSERT INTO settings (key, value) VALUES ('home_description', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(input.homeDescription);
  });
  transaction();
}

function seedIfEmpty() {
  const itemCount = db.prepare("SELECT COUNT(*) AS count FROM items").get() as { count: number };
  if (itemCount.count > 0) {
    return;
  }

  const categoryNames = ["Experiences", "Dining", "Wellness", "Kids", "Travel", "Art"];
  const insertCategory = db.prepare("INSERT INTO categories (name, slug) VALUES (?, ?)");
  for (const category of categoryNames) {
    insertCategory.run(category, slugify(category));
  }

  const categoryIds = db.prepare("SELECT id, name FROM categories").all() as Array<{ id: number; name: string }>;
  const insertItem = db.prepare(`
    INSERT INTO items (
      slug, title, description, category_id, image_url, donor_name, retail_value_cents,
      starting_bid_cents, min_increment_cents, buy_now_cents, popularity_score, bid_count, last_bid_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const samples = [
    ["Weekend Cabin Escape", "Two nights at a lake cabin with kayaking and a fire pit.", "Travel"],
    ["Chef's Tasting for Four", "A five-course dinner and wine pairing from a local chef.", "Dining"],
    ["Family Museum Bundle", "Museum admission plus a private behind-the-scenes tour.", "Kids"],
    ["Private Yoga Series", "Six personal yoga sessions with a certified instructor.", "Wellness"],
    ["Custom Pet Portrait", "Commissioned watercolor portrait from a local artist.", "Art"],
    ["Concert Backstage Passes", "Two premium tickets and backstage access.", "Experiences"],
    ["Coffee for a Year", "Monthly curated beans from a neighborhood roaster.", "Dining"],
    ["Spa Day Retreat", "Massage, facial, and day pass for two.", "Wellness"],
    ["Zoo Encounter", "VIP animal encounter and family admission.", "Kids"],
    ["City Hotel Stay", "One-night luxury staycation with breakfast included.", "Travel"],
    ["Gallery Membership", "Annual membership with preview-night invitations.", "Art"],
    ["Golf Foursome", "18-hole round with cart and clubhouse lunch.", "Experiences"]
  ];

  const now = Date.now();
  samples.forEach(([title, description, category], index) => {
    const categoryId = categoryIds.find((entry) => entry.name === category)?.id ?? categoryIds[0].id;
    insertItem.run(
      slugify(title),
      title,
      description,
      categoryId,
      `https://picsum.photos/seed/awection-${index + 1}/800/600`,
      "Community Donor",
      15000 + index * 2500,
      2000 + index * 300,
      500,
      null,
      Math.max(0, 100 - index * 6),
      0,
      null,
      new Date(now - index * 36_000_00).toISOString()
    );
  });

  const guest = ensureUser(null, "5550001111", "Seed Demo");
  const items = db.prepare("SELECT id, starting_bid_cents FROM items ORDER BY id LIMIT 3").all() as Array<{ id: number; starting_bid_cents: number }>;
  const insertBid = db.prepare("INSERT INTO bids (item_id, user_id, amount_cents, created_at) VALUES (?, ?, ?, ?)");
  const updateItem = db.prepare("UPDATE items SET bid_count = bid_count + 1, popularity_score = popularity_score + 25, last_bid_at = ? WHERE id = ?");
  items.forEach((item, index) => {
    const ts = new Date(Date.now() - index * 20 * 60 * 1000).toISOString();
    insertBid.run(item.id, guest.id, item.starting_bid_cents + (index + 1) * 500, ts);
    updateItem.run(ts, item.id);
  });
}

export function ensureUser(email: string | null, phone: string | null, nickname = "") {
  const existing = db.prepare("SELECT * FROM users WHERE email = ? OR phone = ?").get(email, phone) as Viewer | undefined;
  if (existing) {
    return existing;
  }
  const createdAt = nowIso();
  const resolvedNickname = nickname.trim();
  const result = db.prepare(
    "INSERT INTO users (email, phone, nickname, created_at) VALUES (?, ?, ?, ?)"
  ).run(email, phone, resolvedNickname, createdAt);
  db.prepare("INSERT OR IGNORE INTO notification_preferences (user_id) VALUES (?)").run(result.lastInsertRowid);
  return db.prepare("SELECT * FROM users WHERE id = ?").get(result.lastInsertRowid) as Viewer;
}

export function findUserByContact(email: string | null, phone: string | null) {
  return db.prepare("SELECT * FROM users WHERE email = ? OR phone = ?").get(email, phone) as Viewer | undefined;
}

export function getUserById(userId: number) {
  return db.prepare("SELECT id, email, phone, nickname FROM users WHERE id = ?").get(userId) as {
    id: number;
    email: string | null;
    phone: string | null;
    nickname: string;
  } | undefined;
}

export function getUserPrimaryContact(userId: number) {
  const user = getUserById(userId);
  if (!user) {
    return null;
  }
  if (user.email) {
    return { kind: "email", contact: user.email };
  }
  if (user.phone) {
    return { kind: "phone", contact: user.phone };
  }
  return null;
}

export function updateUserNickname(userId: number, nickname: string) {
  db.prepare("UPDATE users SET nickname = ? WHERE id = ?").run(nickname.trim(), userId);
}

export function getNotificationPreferences(userId: number) {
  db.prepare("INSERT OR IGNORE INTO notification_preferences (user_id) VALUES (?)").run(userId);
  return db.prepare(`
    SELECT outbid_enabled, won_enabled, payment_enabled, admin_payment_enabled
    FROM notification_preferences
    WHERE user_id = ?
  `).get(userId) as {
    outbid_enabled: number;
    won_enabled: number;
    payment_enabled: number;
    admin_payment_enabled: number;
  };
}

export function updateNotificationPreferences(userId: number, input: { outbid: boolean; won: boolean; payment: boolean; adminPayment?: boolean }) {
  db.prepare("INSERT OR IGNORE INTO notification_preferences (user_id) VALUES (?)").run(userId);
  db.prepare(`
    UPDATE notification_preferences
    SET outbid_enabled = ?, won_enabled = ?, payment_enabled = ?, admin_payment_enabled = ?
    WHERE user_id = ?
  `).run(input.outbid ? 1 : 0, input.won ? 1 : 0, input.payment ? 1 : 0, input.adminPayment ? 1 : 0, userId);
}

export function getAdminNotificationRecipients() {
  const adminContacts = env("ADMIN_CONTACT")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (adminContacts.length === 0) {
    return [];
  }
  const emails = adminContacts.filter((value) => detectContactKind(value) === "email").map((value) => normalizeEmail(value));
  const phones = adminContacts.filter((value) => detectContactKind(value) !== "email").map((value) => normalizePhone(value));
  const emailPlaceholders = emails.map(() => "?").join(", ");
  const phonePlaceholders = phones.map(() => "?").join(", ");
  const clauses: string[] = [];
  const params: string[] = [];
  if (emails.length > 0) {
    clauses.push(`users.email IN (${emailPlaceholders})`);
    params.push(...emails);
  }
  if (phones.length > 0) {
    clauses.push(`users.phone IN (${phonePlaceholders})`);
    params.push(...phones);
  }
  if (clauses.length === 0) {
    return [];
  }
  return db.prepare(`
    SELECT users.id, users.email, users.phone
    FROM users
    JOIN notification_preferences ON notification_preferences.user_id = users.id
    WHERE notification_preferences.admin_payment_enabled = 1
      AND (${clauses.join(" OR ")})
  `).all(...params) as Array<{
    id: number;
    email: string | null;
    phone: string | null;
  }>;
}

export function hasNotificationEvent(eventType: string, eventKey: string) {
  const row = db.prepare("SELECT 1 AS present FROM notification_events WHERE event_type = ? AND event_key = ?").get(eventType, eventKey) as { present: number } | undefined;
  return Boolean(row?.present);
}

export function recordNotificationEvent(eventType: string, eventKey: string) {
  db.prepare(`
    INSERT OR IGNORE INTO notification_events (event_type, event_key, created_at)
    VALUES (?, ?, ?)
  `).run(eventType, eventKey, nowIso());
}

export function countSecurityEventsSince(scope: string, eventKey: string, sinceIso: string) {
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM security_events
    WHERE scope = ? AND event_key = ? AND created_at >= ?
  `).get(scope, eventKey, sinceIso) as { count: number };
  return row.count;
}

export function recordSecurityEvent(scope: string, eventKey: string) {
  db.prepare(`
    INSERT INTO security_events (scope, event_key, created_at)
    VALUES (?, ?, ?)
  `).run(scope, eventKey, nowIso());
}

export function clearSecurityEvents(scope: string, eventKey: string) {
  db.prepare(`
    DELETE FROM security_events
    WHERE scope = ? AND event_key = ?
  `).run(scope, eventKey);
}

export function pruneSecurityEvents(beforeIso: string) {
  db.prepare("DELETE FROM security_events WHERE created_at < ?").run(beforeIso);
}

export function createAdminAlert(level: string, message: string) {
  db.prepare(`
    INSERT INTO admin_alerts (level, message, created_at)
    VALUES (?, ?, ?)
  `).run(level, message, nowIso());
}

export function listAdminAlerts(limit = 20) {
  return db.prepare(`
    SELECT id, level, message, created_at
    FROM admin_alerts
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit) as Array<{
    id: number;
    level: string;
    message: string;
    created_at: string;
  }>;
}

export function getViewerBySessionHash(tokenHash: string) {
  const viewer = db.prepare(`
    SELECT users.id, users.nickname, users.email, users.phone, sessions.is_admin AS isAdmin
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).get(tokenHash, nowIso()) as Viewer | undefined;
  if (!viewer) {
    return undefined;
  }
  return {
    ...viewer,
    isAdmin: isConfiguredAdminContact(viewer.email, viewer.phone)
  };
}

function isConfiguredAdminContact(email: string | null, phone: string | null) {
  const configured = env("ADMIN_CONTACT")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return configured.some((entry) => {
    const kind = detectContactKind(entry);
    if (kind === "email") {
      if (!email) {
        return false;
      }
      return normalizeEmail(entry) === normalizeEmail(email);
    }
    if (!phone) {
      return false;
    }
    return normalizePhone(entry) === normalizePhone(phone);
  });
}

export function getCategories() {
  return db.prepare(`
    SELECT categories.id, categories.name, categories.slug
    FROM categories
    WHERE EXISTS (
      SELECT 1
      FROM items
      WHERE items.category_id = categories.id
    )
    ORDER BY categories.name
  `).all() as Array<{ id: number; name: string; slug: string }>;
}

function itemSelectSql(extraWhere = "") {
  return `
    SELECT
      items.id,
      items.slug,
      items.title,
      items.description,
      items.category_id,
      categories.name AS category_name,
      items.image_url,
      items.donor_name,
      items.retail_value_cents,
      items.starting_bid_cents,
      items.min_increment_cents,
      items.buy_now_cents,
      items.popularity_score,
      items.bid_count,
      items.last_bid_at,
      items.created_at,
      (
        SELECT bids.amount_cents
        FROM bids
        WHERE bids.item_id = items.id AND bids.canceled_at IS NULL
        ORDER BY bids.amount_cents DESC, bids.created_at DESC
        LIMIT 1
      ) AS current_bid_cents,
      (
        SELECT users.nickname
        FROM bids
        JOIN users ON users.id = bids.user_id
        WHERE bids.item_id = items.id AND bids.canceled_at IS NULL
        ORDER BY bids.amount_cents DESC, bids.created_at DESC
        LIMIT 1
      ) AS current_bidder_nickname
    FROM items
    JOIN categories ON categories.id = items.category_id
    ${extraWhere}
  `;
}

export function getItemById(itemId: number) {
  return db.prepare(itemSelectSql("WHERE items.id = ?")).get(itemId) as ItemRow | undefined;
}

export function getHomeFeed(limit = 18, offset = 0): DashboardData {
  const recent = db.prepare(`${itemSelectSql("WHERE items.bid_count > 0")} ORDER BY items.last_bid_at DESC LIMIT 3`).all() as ItemRow[];
  const fresh = db.prepare(`
    ${itemSelectSql("WHERE items.bid_count = 0")}
    ORDER BY RANDOM()
    LIMIT 3
  `).all() as ItemRow[];

  const fillerCount = Math.max(0, 3 - fresh.length);
  const filler = fillerCount > 0
    ? db.prepare(`${itemSelectSql("WHERE items.bid_count = 0")} ORDER BY items.created_at ASC LIMIT ?`).all(fillerCount) as ItemRow[]
    : [];

  const excludedIds = [...recent, ...fresh, ...filler].map((item) => item.id);
  const placeholders = excludedIds.length > 0 ? excludedIds.map(() => "?").join(",") : "";
  const popularSql = excludedIds.length > 0
    ? `${itemSelectSql(`WHERE items.id NOT IN (${placeholders})`)} ORDER BY items.popularity_score DESC, COALESCE(items.last_bid_at, items.created_at) DESC LIMIT ? OFFSET ?`
    : `${itemSelectSql()} ORDER BY items.popularity_score DESC, COALESCE(items.last_bid_at, items.created_at) DESC LIMIT ? OFFSET ?`;

  const popular = excludedIds.length > 0
    ? db.prepare(popularSql).all(...excludedIds, limit, offset) as ItemRow[]
    : db.prepare(popularSql).all(limit, offset) as ItemRow[];

  return {
    recent,
    fresh: [...fresh, ...filler].slice(0, 3),
    popular
  };
}

export function getPopularItemsPage(limit: number, offset: number, categorySlug?: string) {
  const params: Array<number | string> = [];
  let where = "";
  if (categorySlug) {
    where = "WHERE categories.slug = ?";
    params.push(categorySlug);
  }
  params.push(limit, offset);
  return db.prepare(`${itemSelectSql(where)} ORDER BY items.popularity_score DESC, COALESCE(items.last_bid_at, items.created_at) DESC LIMIT ? OFFSET ?`)
    .all(...params) as ItemRow[];
}

export function getItemBySlug(slug: string) {
  return db.prepare(itemSelectSql("WHERE items.slug = ?")).get(slug) as ItemRow | undefined;
}

export function getBidHistory(itemId: number) {
  return db.prepare(`
    SELECT bids.amount_cents, bids.created_at, users.nickname
    FROM bids
    JOIN users ON users.id = bids.user_id
    WHERE bids.item_id = ? AND bids.canceled_at IS NULL
    ORDER BY bids.amount_cents DESC, bids.created_at DESC
    LIMIT 12
  `).all(itemId) as Array<{ amount_cents: number; created_at: string; nickname: string }>;
}

export function getNextMinimumBid(item: ItemRow) {
  const base = item.current_bid_cents ?? item.starting_bid_cents;
  return base + item.min_increment_cents;
}

export function placeBid(itemId: number, userId: number, amountCents: number) {
  const item = getItemById(itemId);
  if (!item) {
    throw new Error("Item not found.");
  }
  const minimum = getNextMinimumBid(item);
  if (amountCents < minimum) {
    throw new Error(`Bid must be at least ${minimum / 100}.`);
  }
  const createdAt = nowIso();
  db.prepare("INSERT INTO bids (item_id, user_id, amount_cents, created_at) VALUES (?, ?, ?, ?)").run(itemId, userId, amountCents, createdAt);
  db.prepare(`
    UPDATE items
    SET bid_count = bid_count + 1,
        popularity_score = popularity_score + 10,
        last_bid_at = ?
    WHERE id = ?
  `).run(createdAt, itemId);
  resolveProxyBids(itemId);
}

export function placeProxyBid(itemId: number, userId: number, maxAmountCents: number) {
  const item = getItemById(itemId);
  if (!item) {
    throw new Error("Item not found.");
  }

  const nextMinimum = getNextMinimumBid(item);
  const currentLeaderId = getCurrentLeaderUserId(itemId);
  const currentMax = getUserKnownMaxBid(itemId, userId);
  if (maxAmountCents <= currentMax) {
    throw new Error("Proxy max must be higher than your current top bid.");
  }
  if (currentLeaderId !== userId && maxAmountCents < nextMinimum) {
    throw new Error(`Proxy bid must be at least ${nextMinimum / 100}.`);
  }

  const timestamp = nowIso();
  const existing = db.prepare("SELECT id FROM proxy_bids WHERE item_id = ? AND user_id = ?").get(itemId, userId) as { id: number } | undefined;
  if (existing) {
    db.prepare(`
      UPDATE proxy_bids
      SET max_amount_cents = ?, updated_at = ?
      WHERE item_id = ? AND user_id = ?
    `).run(maxAmountCents, timestamp, itemId, userId);
  } else {
    db.prepare(`
      INSERT INTO proxy_bids (item_id, user_id, max_amount_cents, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(itemId, userId, maxAmountCents, timestamp, timestamp);
  }

  const refreshed = getItemById(itemId);
  if (!refreshed) {
    throw new Error("Item not found.");
  }

  const minimumToEnter = getNextMinimumBid(refreshed);
  if (currentLeaderId !== userId && maxAmountCents >= minimumToEnter) {
    insertVisibleBid(itemId, userId, minimumToEnter);
  }

  resolveProxyBids(itemId);
}

export function getWinningItemsForUser(userId: number) {
  return db.prepare(`
    WITH winners AS (
      SELECT
        bids.item_id,
        bids.user_id,
        bids.amount_cents,
        ROW_NUMBER() OVER (PARTITION BY bids.item_id ORDER BY bids.amount_cents DESC, bids.created_at DESC) AS ranking
      FROM bids
      JOIN payment_preauthorizations ON payment_preauthorizations.user_id = bids.user_id
      WHERE bids.canceled_at IS NULL
        AND payment_preauthorizations.status = 'completed'
    )
    SELECT
      items.id,
      items.slug,
      items.title,
      categories.name AS category_name,
      winners.amount_cents,
      purchases.status AS purchase_status,
      purchases.stripe_checkout_url
    FROM winners
    JOIN items ON items.id = winners.item_id
    JOIN categories ON categories.id = items.category_id
    LEFT JOIN purchases ON purchases.item_id = items.id
    WHERE winners.ranking = 1 AND winners.user_id = ?
    ORDER BY items.title
  `).all(userId) as Array<{
    id: number;
    slug: string;
    title: string;
    category_name: string;
    amount_cents: number;
    purchase_status: string | null;
    stripe_checkout_url: string | null;
  }>;
}

export function getWinningReviewRows() {
  return db.prepare(`
    WITH winners AS (
      SELECT
        bids.item_id,
        bids.user_id,
        bids.amount_cents,
        ROW_NUMBER() OVER (PARTITION BY bids.item_id ORDER BY bids.amount_cents DESC, bids.created_at DESC) AS ranking
      FROM bids
      JOIN payment_preauthorizations ON payment_preauthorizations.user_id = bids.user_id
      WHERE bids.canceled_at IS NULL
        AND payment_preauthorizations.status = 'completed'
    )
    SELECT
      users.id AS user_id,
      items.slug,
      items.title,
      categories.name AS category_name,
      users.nickname,
      COALESCE(users.email, users.phone) AS contact,
      winners.amount_cents,
      purchases.status AS purchase_status,
      purchases.stripe_checkout_url
    FROM winners
    JOIN items ON items.id = winners.item_id
    JOIN categories ON categories.id = items.category_id
    JOIN users ON users.id = winners.user_id
    LEFT JOIN purchases ON purchases.item_id = items.id
    WHERE winners.ranking = 1
    ORDER BY categories.name, items.title
  `).all() as Array<{
    user_id: number;
    slug: string;
    title: string;
    category_name: string;
    nickname: string;
    contact: string;
    amount_cents: number;
    purchase_status: string | null;
    stripe_checkout_url: string | null;
  }>;
}

export function getWinningReviewItemsByUser(userId: number) {
  return db.prepare(`
    WITH winners AS (
      SELECT
        bids.item_id,
        bids.user_id,
        bids.amount_cents,
        ROW_NUMBER() OVER (PARTITION BY bids.item_id ORDER BY bids.amount_cents DESC, bids.created_at DESC) AS ranking
      FROM bids
      JOIN payment_preauthorizations ON payment_preauthorizations.user_id = bids.user_id
      WHERE bids.canceled_at IS NULL
        AND payment_preauthorizations.status = 'completed'
    )
    SELECT
      items.id,
      items.slug,
      items.title,
      winners.user_id,
      winners.amount_cents
    FROM winners
    JOIN items ON items.id = winners.item_id
    WHERE winners.ranking = 1 AND winners.user_id = ?
    ORDER BY items.title
  `).all(userId) as Array<{ id: number; slug: string; title: string; user_id: number; amount_cents: number }>;
}

export function getPendingWonNotifications() {
  return db.prepare(`
    WITH winners AS (
      SELECT
        bids.item_id,
        bids.user_id,
        bids.amount_cents,
        ROW_NUMBER() OVER (PARTITION BY bids.item_id ORDER BY bids.amount_cents DESC, bids.created_at DESC) AS ranking
      FROM bids
      JOIN payment_preauthorizations ON payment_preauthorizations.user_id = bids.user_id
      WHERE bids.canceled_at IS NULL
        AND payment_preauthorizations.status = 'completed'
    )
    SELECT
      items.id AS item_id,
      items.title,
      items.slug,
      winners.user_id,
      winners.amount_cents
    FROM winners
    JOIN items ON items.id = winners.item_id
    LEFT JOIN notification_events
      ON notification_events.event_type = 'won'
     AND notification_events.event_key = 'item:' || items.id
    WHERE winners.ranking = 1
      AND notification_events.id IS NULL
    ORDER BY items.id
  `).all() as Array<{
    item_id: number;
    title: string;
    slug: string;
    user_id: number;
    amount_cents: number;
  }>;
}

export function getWinnerEligibilityAlerts() {
  return db.prepare(`
    WITH ranked_bids AS (
      SELECT
        bids.item_id,
        bids.user_id,
        bids.amount_cents,
        users.nickname,
        COALESCE(users.email, users.phone) AS contact,
        payment_preauthorizations.status AS payment_status,
        ROW_NUMBER() OVER (PARTITION BY bids.item_id ORDER BY bids.amount_cents DESC, bids.created_at DESC) AS ranking
      FROM bids
      JOIN users ON users.id = bids.user_id
      LEFT JOIN payment_preauthorizations ON payment_preauthorizations.user_id = bids.user_id
      WHERE bids.canceled_at IS NULL
    ),
    eligible_winners AS (
      SELECT
        bids.item_id,
        bids.user_id,
        bids.amount_cents,
        users.nickname,
        ROW_NUMBER() OVER (PARTITION BY bids.item_id ORDER BY bids.amount_cents DESC, bids.created_at DESC) AS ranking
      FROM bids
      JOIN users ON users.id = bids.user_id
      JOIN payment_preauthorizations ON payment_preauthorizations.user_id = bids.user_id
      WHERE bids.canceled_at IS NULL
        AND payment_preauthorizations.status = 'completed'
    )
    SELECT
      items.slug,
      items.title,
      categories.name AS category_name,
      ranked_bids.nickname AS top_bidder_nickname,
      ranked_bids.contact AS top_bidder_contact,
      ranked_bids.amount_cents AS top_bid_amount_cents,
      COALESCE(ranked_bids.payment_status, 'missing') AS top_bidder_payment_status,
      eligible_winners.nickname AS eligible_winner_nickname,
      eligible_winners.amount_cents AS eligible_winner_amount_cents
    FROM ranked_bids
    JOIN items ON items.id = ranked_bids.item_id
    JOIN categories ON categories.id = items.category_id
    LEFT JOIN eligible_winners ON eligible_winners.item_id = ranked_bids.item_id AND eligible_winners.ranking = 1
    WHERE ranked_bids.ranking = 1
      AND COALESCE(ranked_bids.payment_status, '') != 'completed'
    ORDER BY categories.name, items.title
  `).all() as Array<{
    slug: string;
    title: string;
    category_name: string;
    top_bidder_nickname: string;
    top_bidder_contact: string;
    top_bid_amount_cents: number;
    top_bidder_payment_status: string;
    eligible_winner_nickname: string | null;
    eligible_winner_amount_cents: number | null;
  }>;
}

export function listAdminBidRows() {
  return db.prepare(`
    SELECT
      bids.id,
      items.slug AS item_slug,
      items.title AS item_title,
      categories.name AS category_name,
      users.nickname,
      COALESCE(users.email, users.phone) AS contact,
      bids.amount_cents,
      bids.created_at,
      purchases.status AS purchase_status
    FROM bids
    JOIN items ON items.id = bids.item_id
    JOIN categories ON categories.id = items.category_id
    JOIN users ON users.id = bids.user_id
    LEFT JOIN purchases ON purchases.item_id = items.id
    WHERE bids.canceled_at IS NULL
    ORDER BY items.title, bids.amount_cents DESC, bids.created_at DESC
  `).all() as Array<{
    id: number;
    item_slug: string;
    item_title: string;
    category_name: string;
    nickname: string;
    contact: string;
    amount_cents: number;
    created_at: string;
    purchase_status: string | null;
  }>;
}

export function getAccountItemsForUser(userId: number, auctionClosed: boolean) {
  const topBidSource = auctionClosed
    ? `
      SELECT
        bids.item_id,
        bids.user_id,
        bids.amount_cents,
        ROW_NUMBER() OVER (PARTITION BY bids.item_id ORDER BY bids.amount_cents DESC, bids.created_at DESC) AS ranking
      FROM bids
      JOIN payment_preauthorizations ON payment_preauthorizations.user_id = bids.user_id
      WHERE bids.canceled_at IS NULL
        AND payment_preauthorizations.status = 'completed'
    `
    : `
      SELECT
        bids.item_id,
        bids.user_id,
        bids.amount_cents,
        ROW_NUMBER() OVER (PARTITION BY bids.item_id ORDER BY bids.amount_cents DESC, bids.created_at DESC) AS ranking
      FROM bids
      WHERE bids.canceled_at IS NULL
    `;

  const rows = db.prepare(`
    WITH user_items AS (
      SELECT item_id FROM bids WHERE user_id = ? AND canceled_at IS NULL
      UNION
      SELECT item_id FROM proxy_bids WHERE user_id = ?
    ),
    user_max AS (
      SELECT item_id, MAX(amount_cents) AS my_bid_cents
      FROM bids
      WHERE user_id = ? AND canceled_at IS NULL
      GROUP BY item_id
    ),
    user_proxy AS (
      SELECT item_id, max_amount_cents
      FROM proxy_bids
      WHERE user_id = ?
    ),
    top_bids AS (
      ${topBidSource}
    )
    SELECT
      items.id AS item_id,
      items.slug AS item_slug,
      items.title AS item_title,
      categories.name AS category_name,
      MAX(COALESCE(user_max.my_bid_cents, 0), COALESCE(user_proxy.max_amount_cents, 0)) AS my_bid_cents,
      top_bids.amount_cents AS leading_bid_cents,
      CASE WHEN top_bids.user_id = ? THEN 1 ELSE 0 END AS is_leading,
      CASE WHEN top_bids.user_id = ? THEN 1 ELSE 0 END AS did_win
    FROM user_items
    JOIN items ON items.id = user_items.item_id
    JOIN categories ON categories.id = items.category_id
    LEFT JOIN user_max ON user_max.item_id = items.id
    LEFT JOIN user_proxy ON user_proxy.item_id = items.id
    JOIN top_bids ON top_bids.item_id = items.id AND top_bids.ranking = 1
    ORDER BY COALESCE(items.last_bid_at, items.created_at) DESC, items.title
  `).all(userId, userId, userId, userId, userId, userId) as AccountBidRow[];

  return rows.map((row) => ({
    ...row,
    status: auctionClosed
      ? (row.did_win ? "Won" : "Lost")
      : (row.is_leading ? "In the lead" : "Outbid")
  }));
}

function getCurrentLeaderUserId(itemId: number) {
  const row = db.prepare(`
    SELECT user_id
    FROM bids
    WHERE item_id = ? AND canceled_at IS NULL
    ORDER BY amount_cents DESC, created_at DESC
    LIMIT 1
  `).get(itemId) as { user_id: number } | undefined;
  return row?.user_id ?? null;
}

function getUserKnownMaxBid(itemId: number, userId: number) {
  const row = db.prepare(`
    SELECT MAX(max_value) AS value
    FROM (
      SELECT MAX(amount_cents) AS max_value FROM bids WHERE item_id = ? AND user_id = ? AND canceled_at IS NULL
      UNION ALL
      SELECT MAX(max_amount_cents) AS max_value FROM proxy_bids WHERE item_id = ? AND user_id = ?
    )
  `).get(itemId, userId, itemId, userId) as { value: number | null };
  return row.value ?? 0;
}

function insertVisibleBid(itemId: number, userId: number, amountCents: number) {
  const createdAt = nowIso();
  db.prepare("INSERT INTO bids (item_id, user_id, amount_cents, created_at) VALUES (?, ?, ?, ?)").run(itemId, userId, amountCents, createdAt);
  db.prepare(`
    UPDATE items
    SET bid_count = bid_count + 1,
        popularity_score = popularity_score + 10,
        last_bid_at = ?
    WHERE id = ?
  `).run(createdAt, itemId);
}

function resolveProxyBids(itemId: number) {
  for (let turns = 0; turns < 50; turns += 1) {
    const item = getItemById(itemId);
    if (!item) {
      return;
    }
    const leaderUserId = getCurrentLeaderUserId(itemId);
    const nextMinimum = getNextMinimumBid(item);
    const challenger = db.prepare(`
      SELECT user_id, max_amount_cents
      FROM proxy_bids
      WHERE item_id = ?
        AND user_id != COALESCE(?, -1)
        AND max_amount_cents >= ?
      ORDER BY max_amount_cents DESC, created_at ASC
      LIMIT 1
    `).get(itemId, leaderUserId, nextMinimum) as { user_id: number; max_amount_cents: number } | undefined;

    if (!challenger) {
      return;
    }

    insertVisibleBid(itemId, challenger.user_id, nextMinimum);
  }
}

export function getWinningItemForUser(userId: number, slug: string) {
  return db.prepare(`
    WITH winners AS (
      SELECT
        bids.item_id,
        bids.user_id,
        bids.amount_cents,
        ROW_NUMBER() OVER (PARTITION BY bids.item_id ORDER BY bids.amount_cents DESC, bids.created_at DESC) AS ranking
      FROM bids
      JOIN payment_preauthorizations ON payment_preauthorizations.user_id = bids.user_id
      WHERE bids.canceled_at IS NULL
        AND payment_preauthorizations.status = 'completed'
    )
    SELECT
      items.id,
      items.slug,
      items.title,
      winners.amount_cents
    FROM winners
    JOIN items ON items.id = winners.item_id
    WHERE winners.ranking = 1 AND winners.user_id = ? AND items.slug = ?
    LIMIT 1
  `).get(userId, slug) as { id: number; slug: string; title: string; amount_cents: number } | undefined;
}

export function getPurchaseByItemId(itemId: number) {
  return db.prepare("SELECT * FROM purchases WHERE item_id = ?").get(itemId) as {
    id: number;
    user_id: number;
    amount_cents: number;
    stripe_session_id: string | null;
    stripe_checkout_url: string | null;
    status: string;
  } | undefined;
}

export function getPurchasesByStripeSessionId(stripeSessionId: string) {
  return db.prepare(`
    SELECT *
    FROM purchases
    WHERE stripe_session_id = ?
    ORDER BY item_id
  `).all(stripeSessionId) as Array<{
    id: number;
    item_id: number;
    user_id: number;
    amount_cents: number;
    status: string;
    stripe_session_id: string | null;
    stripe_checkout_url: string | null;
  }>;
}

export function getPaymentPreauthorization(userId: number) {
  return db.prepare("SELECT * FROM payment_preauthorizations WHERE user_id = ?").get(userId) as {
    status: string;
    stripe_checkout_url: string | null;
    stripe_session_id: string | null;
  } | undefined;
}

export function upsertPaymentPreauthorization(
  userId: number,
  status: string,
  stripeSessionId: string | null,
  stripeCheckoutUrl: string | null
) {
  const existing = getPaymentPreauthorization(userId);
  const timestamp = nowIso();
  if (existing) {
    db.prepare(`
      UPDATE payment_preauthorizations
      SET status = ?, stripe_session_id = ?, stripe_checkout_url = ?, updated_at = ?
      WHERE user_id = ?
    `).run(status, stripeSessionId, stripeCheckoutUrl, timestamp, userId);
    return;
  }
  db.prepare(`
    INSERT INTO payment_preauthorizations (user_id, status, stripe_session_id, stripe_checkout_url, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(userId, status, stripeSessionId, stripeCheckoutUrl, timestamp, timestamp);
}

export function hasCompletedPreauthorization(userId: number) {
  return getPaymentPreauthorization(userId)?.status === "completed";
}

export function clearPaymentPreauthorization(userId: number) {
  db.prepare("DELETE FROM payment_preauthorizations WHERE user_id = ?").run(userId);
}

export function getActiveBidCommitmentCount(userId: number, auctionEndsAt: string) {
  return db.prepare(`
    WITH open_items AS (
      SELECT id
      FROM items
      WHERE ? < ?
    ),
    leaders AS (
      SELECT item_id, user_id
      FROM (
        SELECT
          bids.item_id,
          bids.user_id,
          ROW_NUMBER() OVER (PARTITION BY bids.item_id ORDER BY bids.amount_cents DESC, bids.created_at DESC) AS ranking
        FROM bids
        WHERE bids.canceled_at IS NULL
      )
      WHERE ranking = 1
    ),
    active_items AS (
      SELECT leaders.item_id
      FROM leaders
      JOIN open_items ON open_items.id = leaders.item_id
      WHERE leaders.user_id = ?
      UNION
      SELECT proxy_bids.item_id
      FROM proxy_bids
      JOIN open_items ON open_items.id = proxy_bids.item_id
      WHERE proxy_bids.user_id = ?
    )
    SELECT COUNT(*) AS count
    FROM active_items
  `).get(nowIso(), auctionEndsAt, userId, userId) as { count: number };
}

export function createPendingBidAttempt(
  userId: number,
  itemId: number,
  mode: "bid" | "proxy",
  amountCents: number,
  token: string
) {
  db.prepare(`
    INSERT INTO pending_bid_attempts (token, user_id, item_id, mode, amount_cents, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(token, userId, itemId, mode, amountCents, nowIso());
}

export function getPendingBidAttempt(token: string, userId: number) {
  return db.prepare(`
    SELECT * FROM pending_bid_attempts
    WHERE token = ? AND user_id = ?
    LIMIT 1
  `).get(token, userId) as {
    id: number;
    item_id: number;
    mode: "bid" | "proxy";
    amount_cents: number;
  } | undefined;
}

export function deletePendingBidAttempt(token: string) {
  db.prepare("DELETE FROM pending_bid_attempts WHERE token = ?").run(token);
}

export function createPendingRegistration(contact: string, kind: "email" | "phone", token: string) {
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  db.prepare("DELETE FROM pending_registrations WHERE contact = ?").run(contact);
  db.prepare(`
    INSERT INTO pending_registrations (token, contact, kind, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(token, contact, kind, expiresAt, nowIso());
}

export function getPendingRegistration(token: string) {
  return db.prepare(`
    SELECT token, contact, kind
    FROM pending_registrations
    WHERE token = ? AND expires_at > ?
    LIMIT 1
  `).get(token, nowIso()) as {
    token: string;
    contact: string;
    kind: "email" | "phone";
  } | undefined;
}

export function deletePendingRegistration(token: string) {
  db.prepare("DELETE FROM pending_registrations WHERE token = ?").run(token);
}

export function cancelBidByAdmin(bidId: number) {
  const bid = db.prepare(`
    SELECT bids.id, bids.item_id, bids.user_id, items.slug
    FROM bids
    JOIN items ON items.id = bids.item_id
    WHERE bids.id = ? AND bids.canceled_at IS NULL
  `).get(bidId) as { id: number; item_id: number; user_id: number; slug: string } | undefined;

  if (!bid) {
    throw new Error("Bid not found.");
  }

  const purchase = getPurchaseByItemId(bid.item_id);
  if (purchase?.status === "paid") {
    throw new Error("Paid items can no longer have bids canceled.");
  }

  const transaction = db.transaction(() => {
    db.prepare("UPDATE bids SET canceled_at = ? WHERE id = ?").run(nowIso(), bidId);
    db.prepare("DELETE FROM proxy_bids WHERE item_id = ? AND user_id = ?").run(bid.item_id, bid.user_id);
    db.prepare("DELETE FROM purchases WHERE item_id = ? AND status != 'paid'").run(bid.item_id);

    const stats = db.prepare(`
      SELECT COUNT(*) AS bid_count, MAX(created_at) AS last_bid_at
      FROM bids
      WHERE item_id = ? AND canceled_at IS NULL
    `).get(bid.item_id) as { bid_count: number; last_bid_at: string | null };

    db.prepare(`
      UPDATE items
      SET bid_count = ?, last_bid_at = ?
      WHERE id = ?
    `).run(stats.bid_count, stats.last_bid_at, bid.item_id);

    resolveProxyBids(bid.item_id);
  });

  transaction();
  return bid;
}

export function upsertPurchase(
  itemId: number,
  userId: number,
  amountCents: number,
  status: string,
  stripeCheckoutUrl: string | null,
  stripeSessionId: string | null = null
) {
  const existing = getPurchaseByItemId(itemId);
  const timestamp = nowIso();
  if (existing) {
    db.prepare(`
      UPDATE purchases
      SET user_id = ?, amount_cents = ?, status = ?, stripe_checkout_url = ?, stripe_session_id = ?, updated_at = ?
      WHERE item_id = ?
    `).run(userId, amountCents, status, stripeCheckoutUrl, stripeSessionId, timestamp, itemId);
    return;
  }
  db.prepare(`
    INSERT INTO purchases (item_id, user_id, amount_cents, status, stripe_session_id, stripe_checkout_url, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(itemId, userId, amountCents, status, stripeSessionId, stripeCheckoutUrl, timestamp, timestamp);
}

export function updatePurchasesForStripeSession(stripeSessionId: string, status: string) {
  const timestamp = nowIso();
  db.prepare(`
    UPDATE purchases
    SET status = ?, updated_at = ?
    WHERE stripe_session_id = ?
  `).run(status, timestamp, stripeSessionId);
}

export function listAdminItems() {
  return db.prepare(`
    SELECT
      items.id,
      items.slug,
      items.title,
      categories.name AS category,
      items.description,
      items.image_url,
      items.donor_name,
      items.retail_value_cents,
      items.starting_bid_cents,
      items.min_increment_cents,
      items.buy_now_cents,
      items.popularity_score,
      items.bid_count,
      items.last_bid_at,
      items.created_at
    FROM items
    JOIN categories ON categories.id = items.category_id
    ORDER BY items.id
  `).all() as Array<Record<string, string | number | null>>;
}

export function getAdminItemById(itemId: number) {
  return db.prepare(`
    SELECT
      items.id,
      items.slug,
      items.title,
      categories.name AS category
    FROM items
    JOIN categories ON categories.id = items.category_id
    WHERE items.id = ?
    LIMIT 1
  `).get(itemId) as { id: number; slug: string; title: string; category: string } | undefined;
}

export function saveAdminItem(input: Record<string, string>, itemId?: number) {
  const title = input.title?.trim();
  if (!title) {
    throw new Error("Title is required.");
  }

  const categoryName = input.category?.trim() || "Uncategorized";
  const categorySlug = slugify(categoryName);
  db.prepare("INSERT OR IGNORE INTO categories (name, slug) VALUES (?, ?)").run(categoryName, categorySlug);
  const category = db.prepare("SELECT id FROM categories WHERE slug = ?").get(categorySlug) as { id: number };

  const slug = slugify(input.slug?.trim() || title);
  const description = input.description?.trim() || "";
  const imageUrl = input.image_url?.trim() || null;
  const donorName = input.donor_name?.trim() || null;
  const retailValueCents = toNullableCents(input.retail_value_cents);
  const startingBidCents = toCents(input.starting_bid_cents, 1000);
  const minIncrementCents = toCents(input.min_increment_cents, 100);
  const buyNowCents = toNullableCents(input.buy_now_cents);
  const createdAt = input.created_at?.trim() || nowIso();

  if (itemId) {
    db.prepare(`
      UPDATE items
      SET slug = ?,
          title = ?,
          description = ?,
          category_id = ?,
          image_url = ?,
          donor_name = ?,
          retail_value_cents = ?,
          starting_bid_cents = ?,
          min_increment_cents = ?,
          buy_now_cents = ?,
          created_at = ?
      WHERE id = ?
    `).run(
      slug,
      title,
      description,
      category.id,
      imageUrl,
      donorName,
      retailValueCents,
      startingBidCents,
      minIncrementCents,
      buyNowCents,
      createdAt,
      itemId
    );
    return;
  }

  db.prepare(`
    INSERT INTO items (
      slug, title, description, category_id, image_url, donor_name, retail_value_cents,
      starting_bid_cents, min_increment_cents, buy_now_cents, popularity_score, bid_count, last_bid_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, ?)
  `).run(
    slug,
    title,
    description,
    category.id,
    imageUrl,
    donorName,
    retailValueCents,
    startingBidCents,
    minIncrementCents,
    buyNowCents,
    createdAt
  );
}

export function deleteAdminItem(itemId: number) {
  const transaction = db.transaction(() => {
    db.prepare("DELETE FROM pending_bid_attempts WHERE item_id = ?").run(itemId);
    db.prepare("DELETE FROM proxy_bids WHERE item_id = ?").run(itemId);
    db.prepare("DELETE FROM purchases WHERE item_id = ?").run(itemId);
    db.prepare("DELETE FROM bids WHERE item_id = ?").run(itemId);
    db.prepare("DELETE FROM items WHERE id = ?").run(itemId);
  });
  transaction();
}

export function upsertItemsFromRows(rows: Array<Record<string, string>>) {
  const insertCategory = db.prepare("INSERT OR IGNORE INTO categories (name, slug) VALUES (?, ?)");
  const insertItem = db.prepare(`
    INSERT INTO items (
      slug, title, description, category_id, image_url, donor_name, retail_value_cents,
      starting_bid_cents, min_increment_cents, buy_now_cents, popularity_score, bid_count, last_bid_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, ?)
  `);
  const updateItem = db.prepare(`
    UPDATE items
    SET title = ?,
        description = ?,
        category_id = ?,
        image_url = ?,
        donor_name = ?,
        retail_value_cents = ?,
        starting_bid_cents = ?,
        min_increment_cents = ?,
        buy_now_cents = ?
    WHERE slug = ?
  `);

  const transaction = db.transaction(() => {
    for (const row of rows) {
      const title = row.title?.trim();
      if (!title) {
        continue;
      }
      const categoryName = row.category?.trim() || "Uncategorized";
      insertCategory.run(categoryName, slugify(categoryName));
      const category = db.prepare("SELECT id FROM categories WHERE slug = ?").get(slugify(categoryName)) as { id: number };
      const slug = slugify(row.slug?.trim() || title);
      const existing = db.prepare("SELECT id FROM items WHERE slug = ?").get(slug) as { id: number } | undefined;
      const createdAt = row.created_at?.trim() || nowIso();
      const params = [
        title,
        row.description?.trim() || "",
        category.id,
        row.image_url?.trim() || null,
        row.donor_name?.trim() || null,
        toNullableCents(row.retail_value_cents),
        toCents(row.starting_bid_cents, 1000),
        toCents(row.min_increment_cents, 100),
        toNullableCents(row.buy_now_cents)
      ];

      if (existing) {
        updateItem.run(...params, slug);
      } else {
        insertItem.run(slug, ...params, createdAt);
      }
    }
  });

  transaction();
}

function toCents(value: string | undefined, fallback: number) {
  const cents = Math.round(Number(value || 0) * 100);
  return Number.isFinite(cents) && cents > 0 ? cents : fallback;
}

function toNullableCents(value: string | undefined) {
  const cents = Math.round(Number(value || 0) * 100);
  return Number.isFinite(cents) && cents > 0 ? cents : null;
}
