import "dotenv/config";
import express from "express";
import multer from "multer";
import crypto from "node:crypto";
import path from "node:path";
import { clearSession, requestAuthCode, verifyAuthCode } from "./auth.js";
import {
  cancelBidByAdmin,
  clearPaymentPreauthorization,
  createPendingBidAttempt,
  createAdminAlert,
  deletePendingBidAttempt,
  getAccountItemsForUser,
  getActiveBidCommitmentCount,
  getAdminItemById,
  getAuctionEndsAt,
  getBidHistory,
  getCategories,
  getHomeFeed,
  getItemById,
  getItemBySlug,
  getNextMinimumBid,
  getNotificationPreferences,
  getPendingBidAttempt,
  getPaymentPreauthorization,
  getPurchaseByItemId,
  getPurchasesByStripeSessionId,
  getPopularItemsPage,
  getSiteContentSettings,
  getViewerBySessionHash,
  getWinnerEligibilityAlerts,
  getWinningReviewItemsByUser,
  getWinningReviewRows,
  hasCompletedPreauthorization,
  getWinningItemsForUser,
  initDb,
  deleteAdminItem,
  listAdminAlerts,
  listAdminBidRows,
  listAdminItems,
  placeBid,
  placeProxyBid,
  saveAdminItem,
  setAuctionEndsAt,
  setSiteContentSettings,
  updatePurchasesForStripeSession,
  upsertPaymentPreauthorization,
  upsertPurchase,
  updateNotificationPreferences,
  updateUserNickname,
  upsertItemsFromRows
} from "./db.js";
import {
  sendAdminPaymentFailureAlert,
  sendAdminPaymentSuccessAlert,
  sendPaymentCollectedNotificationIfNeeded
} from "./notifications.js";
import { parseCsv, toCsv } from "./csv.js";
import { Flash, Viewer } from "./types.js";
import { clampBidAmount, env, hashValue, randomToken } from "./utils.js";
import {
  renderAdminDeleteConfirm,
  renderAdminPanel,
  renderCategories,
  renderCategoryPage,
  renderHome,
  renderAccountPage,
  renderItemCards,
  renderItemPage,
  renderLayout,
  renderLoginPage,
  renderWinsPage
} from "./views.js";

initDb();

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Number(env("MAX_UPLOAD_BYTES", "2097152"))
  }
});
const port = Number(env("PORT", "3000"));
const auctionName = env("AUCTION_NAME", "Silent Auction");

app.post("/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    await handleStripeWebhook(req);
    res.status(200).send("ok");
  } catch (error) {
    res.status(400).send(error instanceof Error ? error.message : "Webhook error");
  }
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.resolve(process.cwd(), "public")));

app.use((req, res, next) => {
  const cookies = parseCookies(req.headers.cookie || "");
  const csrfToken = cookies.csrf || randomToken();
  if (!cookies.csrf) {
    res.append("Set-Cookie", serializeCookie("csrf", csrfToken, {}));
  }
  const viewer = cookies.session ? getViewerBySessionHash(hashValue(cookies.session)) : null;
  const flash = cookies.flash ? decodeFlash(cookies.flash) : null;
  if (cookies.flash) {
    res.append("Set-Cookie", serializeCookie("flash", "", { expires: new Date(0) }));
  }
  res.locals.viewer = viewer;
  res.locals.flash = flash;
  res.locals.auctionEndsAt = getAuctionEndsAt();
  res.locals.csrfToken = csrfToken;
  next();
});

app.use((req, res, next) => {
  if (req.method !== "POST" || req.path === "/stripe/webhook") {
    next();
    return;
  }
  const contentType = String(req.headers["content-type"] || "");
  if (contentType.startsWith("multipart/form-data")) {
    next();
    return;
  }
  if (!hasValidCsrfToken(req)) {
    res.status(403).send(renderPage(
      "Forbidden",
      `<section class="section"><h1>Request could not be verified.</h1><p>Please go back and try again.</p></section>`,
      res.locals.viewer,
      { kind: "error", message: "Request verification failed." },
      res.locals.csrfToken as string
    ));
    return;
  }
  next();
});

app.use((req, res, next) => {
  const viewer = res.locals.viewer as Viewer | null;
  if (!viewer || viewer.nickname.trim()) {
    next();
    return;
  }
  const allowed = new Set(["/login/nickname", "/logout"]);
  if (allowed.has(req.path) || req.path.startsWith("/preauth/") || req.path === "/login" || req.path === "/login/start" || req.path === "/login/resend" || req.path === "/login/verify") {
    next();
    return;
  }
  redirectWithFlash(res, "/login/nickname", { kind: "info", message: "Set your nickname before using the app." });
});

app.get("/", (_req, res) => {
  const categories = getCategories();
  const feed = getHomeFeed();
  res.send(renderPage("Home", renderHome(feed, categories, getSiteContentSettings()), res.locals.viewer, res.locals.flash, res.locals.csrfToken as string));
});

app.get("/categories", (_req, res) => {
  res.send(renderPage("Categories", renderCategories(getCategories()), res.locals.viewer, res.locals.flash, res.locals.csrfToken as string));
});

app.get("/categories/:slug", (req, res) => {
  const category = getCategories().find((entry) => entry.slug === req.params.slug);
  if (!category) {
    res.status(404).send(renderPage("Not found", `<section class="section"><h1>Category not found</h1></section>`, res.locals.viewer, res.locals.flash, res.locals.csrfToken as string));
    return;
  }
  res.send(renderPage(category.name, renderCategoryPage(category, getPopularItemsPage(18, 0, category.slug)), res.locals.viewer, res.locals.flash, res.locals.csrfToken as string));
});

app.get("/items/:slug", (req, res) => {
  const item = getItemBySlug(req.params.slug);
  if (!item) {
    res.status(404).send(renderPage("Not found", `<section class="section"><h1>Item not found</h1></section>`, res.locals.viewer, res.locals.flash, res.locals.csrfToken as string));
    return;
  }
  const body = renderItemPage(item, getBidHistory(item.id), getNextMinimumBid(item), isAuctionClosed(res.locals.auctionEndsAt), res.locals.viewer);
  res.send(renderPage(item.title, body, res.locals.viewer, res.locals.flash, res.locals.csrfToken as string));
});

app.post("/items/:slug/bid", async (req, res) => {
  const viewer = res.locals.viewer as Viewer | null;
  if (!viewer) {
    redirectWithFlash(res, "/login", { kind: "error", message: "Sign in to place a bid." });
    return;
  }
  if (isAuctionClosed(res.locals.auctionEndsAt)) {
    redirectWithFlash(res, `/items/${req.params.slug}`, { kind: "error", message: "Bidding is closed." });
    return;
  }
  const item = getItemBySlug(req.params.slug);
  if (!item) {
    redirectWithFlash(res, "/", { kind: "error", message: "Item not found." });
    return;
  }
  try {
    const amountCents = clampBidAmount(req.body.amount);
    const preauth = await maybeRequireBidPreauthorization(viewer, item, "bid", amountCents);
    if (preauth.redirectUrl) {
      res.redirect(preauth.redirectUrl);
      return;
    }
    if (preauth.bidPlaced) {
      redirectWithFlash(res, `/items/${item.slug}`, { kind: "success", message: "Preauthorization recorded and bid placed." });
      return;
    }
    placeBid(item.id, viewer.id, amountCents);
    redirectWithFlash(res, `/items/${item.slug}`, { kind: "success", message: "Bid placed." });
  } catch (error) {
    redirectWithFlash(res, `/items/${req.params.slug}`, { kind: "error", message: error instanceof Error ? error.message : "Could not place bid." });
  }
});

app.post("/items/:slug/proxy", async (req, res) => {
  const viewer = res.locals.viewer as Viewer | null;
  if (!viewer) {
    redirectWithFlash(res, "/login", { kind: "error", message: "Sign in to place a proxy bid." });
    return;
  }
  if (isAuctionClosed(res.locals.auctionEndsAt)) {
    redirectWithFlash(res, `/items/${req.params.slug}`, { kind: "error", message: "Bidding is closed." });
    return;
  }
  const item = getItemBySlug(req.params.slug);
  if (!item) {
    redirectWithFlash(res, "/", { kind: "error", message: "Item not found." });
    return;
  }
  try {
    const amountCents = clampBidAmount(req.body.amount);
    const preauth = await maybeRequireBidPreauthorization(viewer, item, "proxy", amountCents);
    if (preauth.redirectUrl) {
      res.redirect(preauth.redirectUrl);
      return;
    }
    if (preauth.bidPlaced) {
      redirectWithFlash(res, `/items/${item.slug}`, { kind: "success", message: "Preauthorization recorded and proxy bid saved." });
      return;
    }
    placeProxyBid(item.id, viewer.id, amountCents);
    redirectWithFlash(res, `/items/${item.slug}`, { kind: "success", message: "Proxy bid saved. We’ll auto-bid up to your max." });
  } catch (error) {
    redirectWithFlash(res, `/items/${req.params.slug}`, { kind: "error", message: error instanceof Error ? error.message : "Could not place proxy bid." });
  }
});

app.get("/login", (_req, res) => {
  res.send(renderPage("Sign in", renderLoginPage("start"), res.locals.viewer, res.locals.flash, res.locals.csrfToken as string));
});

app.post("/login/start", async (req, res) => {
  try {
    const contact = String(req.body.contact || "");
    const authRequest = await requestAuthCode(contact);
    res.send(renderPage("Verify code", renderLoginPage("verify", { contact: authRequest.contact }), res.locals.viewer, res.locals.flash, res.locals.csrfToken as string));
  } catch (error) {
    redirectWithFlash(res, "/login", { kind: "error", message: error instanceof Error ? error.message : "Could not continue." });
  }
});

app.post("/login/resend", async (req, res) => {
  try {
    const contact = String(req.body.contact || "");
    const authRequest = await requestAuthCode(contact);
    res.send(renderPage("Verify code", renderLoginPage("verify", { contact: authRequest.contact }), res.locals.viewer, res.locals.flash, res.locals.csrfToken as string));
  } catch (error) {
    redirectWithFlash(res, "/login", { kind: "error", message: error instanceof Error ? error.message : "Could not resend code." });
  }
});

app.post("/login/verify", (req, res) => {
  try {
    const result = verifyAuthCode(String(req.body.contact || ""), String(req.body.code || ""), getClientKey(req));
    setSessionCookie(res, result.session.token, result.session.expiresAt);
    if (result.needsNickname) {
      redirectWithFlash(res, "/login/nickname", { kind: "info", message: "Set your nickname to finish signing in." });
      return;
    }
    redirectWithFlash(res, "/", { kind: "success", message: "You are signed in." });
  } catch (error) {
    redirectWithFlash(res, "/login", { kind: "error", message: error instanceof Error ? error.message : "Could not verify code." });
  }
});

app.get("/login/nickname", (_req, res) => {
  const viewer = res.locals.viewer as Viewer | null;
  if (!viewer) {
    redirectWithFlash(res, "/login", { kind: "error", message: "Sign in first." });
    return;
  }
  if (viewer.nickname.trim()) {
    redirectWithFlash(res, "/", { kind: "info", message: "Nickname already set." });
    return;
  }
  res.send(renderPage("Set nickname", renderLoginPage("nickname"), viewer, res.locals.flash, res.locals.csrfToken as string));
});

app.post("/login/nickname", (req, res) => {
  const viewer = res.locals.viewer as Viewer | null;
  if (!viewer) {
    redirectWithFlash(res, "/login", { kind: "error", message: "Sign in first." });
    return;
  }
  const nickname = String(req.body.nickname || "").trim();
  if (!nickname) {
    redirectWithFlash(res, "/login/nickname", { kind: "error", message: "Nickname is required." });
    return;
  }
  updateUserNickname(viewer.id, nickname);
  redirectWithFlash(res, "/", { kind: "success", message: "Nickname saved." });
});

app.get("/account", (req, res) => {
  const viewer = res.locals.viewer as Viewer | null;
  if (!viewer) {
    redirectWithFlash(res, "/login", { kind: "error", message: "Sign in to see your profile." });
    return;
  }
  const preauth = getPaymentPreauthorization(viewer.id);
  const activeBidCount = getActiveBidCommitmentCount(viewer.id, res.locals.auctionEndsAt).count;
  const body = renderAccountPage(
    viewer,
    getAccountItemsForUser(viewer.id, isAuctionClosed(res.locals.auctionEndsAt)),
    {
      hasPaymentMethod: Boolean(preauth && preauth.status === "completed"),
      canRemove: Boolean(preauth && preauth.status === "completed" && activeBidCount === 0),
      statusLabel: preauth?.status === "completed"
        ? "Payment option on file"
        : preauth?.status === "pending"
          ? "Payment option update in progress"
          : "No payment option on file"
    },
    {
      outbid: Boolean(getNotificationPreferences(viewer.id).outbid_enabled),
      won: Boolean(getNotificationPreferences(viewer.id).won_enabled),
      payment: Boolean(getNotificationPreferences(viewer.id).payment_enabled),
      adminPayment: Boolean(getNotificationPreferences(viewer.id).admin_payment_enabled)
    }
  );
  res.send(renderPage("Profile", body, viewer, res.locals.flash, res.locals.csrfToken as string));
});

app.post("/account/notifications", (req, res) => {
  const viewer = res.locals.viewer as Viewer | null;
  if (!viewer) {
    redirectWithFlash(res, "/login", { kind: "error", message: "Sign in to update notification settings." });
    return;
  }
  updateNotificationPreferences(viewer.id, {
    outbid: String(req.body.outbid || "") === "1",
    won: String(req.body.won || "") === "1",
    payment: String(req.body.payment || "") === "1",
    adminPayment: viewer.isAdmin && String(req.body.admin_payment || "") === "1"
  });
  redirectWithFlash(res, "/account", { kind: "success", message: "Notification settings updated." });
});

app.post("/account/payment/replace", async (req, res) => {
  const viewer = res.locals.viewer as Viewer | null;
  if (!viewer) {
    redirectWithFlash(res, "/login", { kind: "error", message: "Sign in to manage your payment option." });
    return;
  }
  try {
    const checkoutUrl = await createAccountPreauthorizationUrl(viewer);
    if (!checkoutUrl) {
      console.log(`[stripe-preauth:fake-replace] user=${viewer.id}`);
      upsertPaymentPreauthorization(viewer.id, "completed", "fake-session-replaced", null);
      redirectWithFlash(res, "/account", { kind: "success", message: "Payment option updated." });
      return;
    }
    upsertPaymentPreauthorization(viewer.id, "pending", null, checkoutUrl);
    res.redirect(checkoutUrl);
  } catch (error) {
    redirectWithFlash(res, "/account", { kind: "error", message: error instanceof Error ? error.message : "Could not update payment option." });
  }
});

app.post("/account/payment/remove", (req, res) => {
  const viewer = res.locals.viewer as Viewer | null;
  if (!viewer) {
    redirectWithFlash(res, "/login", { kind: "error", message: "Sign in to manage your payment option." });
    return;
  }
  const activeBidCount = getActiveBidCommitmentCount(viewer.id, res.locals.auctionEndsAt).count;
  if (activeBidCount > 0) {
    redirectWithFlash(res, "/account", { kind: "error", message: "You cannot remove your payment option while you still have active bids or proxy bids." });
    return;
  }
  clearPaymentPreauthorization(viewer.id);
  redirectWithFlash(res, "/account", { kind: "success", message: "Payment option removed." });
});

app.get("/preauth/complete", async (req, res) => {
  const viewer = res.locals.viewer as Viewer | null;
  if (!viewer) {
    redirectWithFlash(res, "/login", { kind: "error", message: "Sign in to complete preauthorization." });
    return;
  }
  const attemptToken = String(req.query.attempt || "");
  const sessionId = typeof req.query.session_id === "string" ? req.query.session_id : null;
  const attempt = getPendingBidAttempt(attemptToken, viewer.id);
  if (!attempt) {
    redirectWithFlash(res, "/", { kind: "error", message: "Bid attempt not found." });
    return;
  }

  try {
    if (!sessionId) {
      throw new Error("Missing Stripe session.");
    }
    await verifyStripeCheckoutSession(sessionId, {
      userId: viewer.id,
      purpose: "bid_preauthorization",
      attemptToken
    });
    const prior = getPaymentPreauthorization(viewer.id);
    upsertPaymentPreauthorization(viewer.id, "completed", sessionId || prior?.stripe_session_id || null, prior?.stripe_checkout_url || null);
    if (attempt.mode === "proxy") {
      placeProxyBid(attempt.item_id, viewer.id, attempt.amount_cents);
    } else {
      placeBid(attempt.item_id, viewer.id, attempt.amount_cents);
    }
    deletePendingBidAttempt(attemptToken);
    const item = getItemById(attempt.item_id);
    if (!item) {
      throw new Error("Item not found.");
    }
    redirectWithFlash(res, `/items/${item.slug}`, { kind: "success", message: "Preauthorization complete and bid placed." });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Stripe")) {
      redirectWithFlash(res, `/items/${getItemById(attempt.item_id)?.slug || ""}`, {
        kind: "error",
        message: "We could not confirm Stripe yet. Try opening the return link again in a moment."
      });
      return;
    }
    deletePendingBidAttempt(attemptToken);
    redirectWithFlash(res, "/", { kind: "error", message: error instanceof Error ? error.message : "Could not complete bid." });
  }
});

app.get("/account/preauth/complete", async (req, res) => {
  const viewer = res.locals.viewer as Viewer | null;
  if (!viewer) {
    redirectWithFlash(res, "/login", { kind: "error", message: "Sign in to complete your payment option update." });
    return;
  }
  try {
    const sessionId = typeof req.query.session_id === "string" ? req.query.session_id : null;
    if (!sessionId) {
      throw new Error("Missing Stripe session.");
    }
    await verifyStripeCheckoutSession(sessionId, {
      userId: viewer.id,
      purpose: "payment_option_replace"
    });
    const prior = getPaymentPreauthorization(viewer.id);
    upsertPaymentPreauthorization(viewer.id, "completed", sessionId || prior?.stripe_session_id || null, prior?.stripe_checkout_url || null);
    redirectWithFlash(res, "/account", { kind: "success", message: "Payment option updated." });
  } catch (error) {
    redirectWithFlash(res, "/account", { kind: "error", message: error instanceof Error ? error.message : "Could not complete payment option update." });
  }
});

app.post("/account/nickname", (req, res) => {
  const viewer = res.locals.viewer as Viewer | null;
  if (!viewer) {
    redirectWithFlash(res, "/login", { kind: "error", message: "Sign in to update your nickname." });
    return;
  }
  const nickname = String(req.body.nickname || "").trim();
  if (!nickname) {
    redirectWithFlash(res, "/account", { kind: "error", message: "Nickname cannot be empty." });
    return;
  }
  updateUserNickname(viewer.id, nickname);
  redirectWithFlash(res, "/account", { kind: "success", message: "Nickname updated." });
});

app.post("/logout", (req, res) => {
  const cookies = parseCookies(req.headers.cookie || "");
  if (cookies.session) {
    clearSession(cookies.session);
  }
  res.setHeader("Set-Cookie", serializeCookie("session", "", { expires: new Date(0) }));
  redirectWithFlash(res, "/", { kind: "info", message: "You are signed out." });
});

app.get("/logout", (req, res) => {
  redirectWithFlash(res, "/", { kind: "info", message: "Use the log out button to sign out." });
});

app.get("/wins", (req, res) => {
  const viewer = res.locals.viewer as Viewer | null;
  if (!viewer) {
    redirectWithFlash(res, "/login", { kind: "error", message: "Sign in to see your wins." });
    return;
  }
  const body = renderWinsPage(isAuctionClosed(res.locals.auctionEndsAt) ? getWinningItemsForUser(viewer.id) : []);
  res.send(renderPage("My wins", body, viewer, res.locals.flash, res.locals.csrfToken as string));
});

app.get("/api/items", (req, res) => {
  const offset = Number(req.query.offset || 0);
  const category = typeof req.query.category === "string" ? req.query.category : undefined;
  const items = getPopularItemsPage(12, offset, category);
  res.json({
    html: renderItemCards(items),
    nextOffset: offset + items.length,
    done: items.length < 12
  });
});

app.get("/admin/login", (_req, res) => {
  redirectWithFlash(res, "/login", { kind: "info", message: "Sign in with the configured admin contact to access admin tools." });
});

app.get("/admin", (_req, res) => {
  const viewer = res.locals.viewer as Viewer | null;
  if (!viewer?.isAdmin) {
    redirectWithFlash(res, "/login", { kind: "error", message: "Admin access required." });
    return;
  }
  res.send(renderPage("Admin", renderAdminPanel(
    listAdminItems(),
    groupWinnerRows(getWinningReviewRows()),
    isAuctionClosed(res.locals.auctionEndsAt),
    listAdminBidRows(),
    getWinnerEligibilityAlerts(),
    listAdminAlerts(),
    res.locals.auctionEndsAt,
    getSiteContentSettings()
  ), viewer, res.locals.flash, res.locals.csrfToken as string));
});

app.post("/admin/auction-end", (req, res) => {
  const viewer = res.locals.viewer as Viewer | null;
  if (!viewer?.isAdmin) {
    redirectWithFlash(res, "/login", { kind: "error", message: "Admin access required." });
    return;
  }
  const raw = String(req.body.auction_ends_at || "").trim();
  const parsed = new Date(raw);
  if (!raw || Number.isNaN(parsed.getTime())) {
    redirectWithFlash(res, "/admin", { kind: "error", message: "Enter a valid auction end time." });
    return;
  }
  setAuctionEndsAt(parsed.toISOString());
  redirectWithFlash(res, "/admin", { kind: "success", message: "Auction end time updated." });
});

app.post("/admin/site-content", (req, res) => {
  const viewer = res.locals.viewer as Viewer | null;
  if (!viewer?.isAdmin) {
    redirectWithFlash(res, "/login", { kind: "error", message: "Admin access required." });
    return;
  }
  const siteTitle = String(req.body.site_title || "").trim();
  const homeHeading = String(req.body.home_heading || "").trim();
  const homeDescription = String(req.body.home_description || "").trim();
  if (!siteTitle || !homeHeading || !homeDescription) {
    redirectWithFlash(res, "/admin", { kind: "error", message: "All site content fields are required." });
    return;
  }
  setSiteContentSettings({ siteTitle, homeHeading, homeDescription });
  redirectWithFlash(res, "/admin", { kind: "success", message: "Site content updated." });
});

app.post("/admin/items", (req, res) => {
  const viewer = res.locals.viewer as Viewer | null;
  if (!viewer?.isAdmin) {
    redirectWithFlash(res, "/login", { kind: "error", message: "Admin access required." });
    return;
  }
  try {
    saveAdminItem(req.body as Record<string, string>);
    redirectWithFlash(res, "/admin", { kind: "success", message: "Item added." });
  } catch (error) {
    redirectWithFlash(res, "/admin", { kind: "error", message: error instanceof Error ? error.message : "Could not add item." });
  }
});

app.post("/admin/items/:id", (req, res) => {
  const viewer = res.locals.viewer as Viewer | null;
  if (!viewer?.isAdmin) {
    redirectWithFlash(res, "/login", { kind: "error", message: "Admin access required." });
    return;
  }
  try {
    saveAdminItem(req.body as Record<string, string>, Number(req.params.id));
    redirectWithFlash(res, "/admin", { kind: "success", message: "Item updated." });
  } catch (error) {
    redirectWithFlash(res, "/admin", { kind: "error", message: error instanceof Error ? error.message : "Could not update item." });
  }
});

app.get("/admin/items/:id/delete", (req, res) => {
  const viewer = res.locals.viewer as Viewer | null;
  if (!viewer?.isAdmin) {
    redirectWithFlash(res, "/login", { kind: "error", message: "Admin access required." });
    return;
  }
  const item = getAdminItemById(Number(req.params.id));
  if (!item) {
    redirectWithFlash(res, "/admin", { kind: "error", message: "Item not found." });
    return;
  }
  res.send(renderPage("Confirm delete", renderAdminDeleteConfirm(item), viewer, res.locals.flash, res.locals.csrfToken as string));
});

app.post("/admin/items/:id/delete", (req, res) => {
  const viewer = res.locals.viewer as Viewer | null;
  if (!viewer?.isAdmin) {
    redirectWithFlash(res, "/login", { kind: "error", message: "Admin access required." });
    return;
  }
  try {
    deleteAdminItem(Number(req.params.id));
    redirectWithFlash(res, "/admin", { kind: "success", message: "Item deleted." });
  } catch (error) {
    redirectWithFlash(res, "/admin", { kind: "error", message: error instanceof Error ? error.message : "Could not delete item." });
  }
});

app.post("/admin/winners/users/:userId/collect", async (req, res) => {
  const viewer = res.locals.viewer as Viewer | null;
  if (!viewer?.isAdmin) {
    redirectWithFlash(res, "/login", { kind: "error", message: "Admin access required." });
    return;
  }
  if (!isAuctionClosed(res.locals.auctionEndsAt)) {
    redirectWithFlash(res, "/admin", { kind: "error", message: "Payment collection starts after the auction closes." });
    return;
  }
  const userId = Number(req.params.userId);
  const winningItems = getWinningReviewItemsByUser(userId);
  if (winningItems.length === 0) {
    redirectWithFlash(res, "/admin", { kind: "error", message: "Winning items not found." });
    return;
  }

  try {
    const existing = winningItems.map((item) => getPurchaseByItemId(item.id)).find((purchase) => purchase?.stripe_checkout_url);
    if (existing?.stripe_checkout_url) {
      redirectWithFlash(res, "/admin", { kind: "info", message: "Collection link already exists." });
      return;
    }
    const checkout = await createStripeCheckoutUrlForItems(winningItems);
    if (!checkout) {
      winningItems.forEach((item) => {
        upsertPurchase(item.id, item.user_id, item.amount_cents, "collection_failed", null);
      });
      redirectWithFlash(res, "/admin", {
        kind: "error",
        message: "Payment collection failed immediately because Stripe is not configured. You can still cancel bids."
      });
      return;
    }
    winningItems.forEach((item) => {
      upsertPurchase(item.id, item.user_id, item.amount_cents, "payment_requested", checkout.url, checkout.id);
    });
    redirectWithFlash(res, "/admin", { kind: "success", message: "Collection link created for the winner total." });
  } catch (error) {
    winningItems.forEach((item) => {
      upsertPurchase(item.id, item.user_id, item.amount_cents, "collection_failed", null);
    });
    redirectWithFlash(res, "/admin", {
      kind: "error",
      message: error instanceof Error ? `${error.message} You can still cancel bids.` : "Could not create collection link. You can still cancel bids."
    });
  }
});

app.post("/admin/bids/:id/cancel", (req, res) => {
  const viewer = res.locals.viewer as Viewer | null;
  if (!viewer?.isAdmin) {
    redirectWithFlash(res, "/login", { kind: "error", message: "Admin access required." });
    return;
  }
  try {
    const bid = cancelBidByAdmin(Number(req.params.id));
    redirectWithFlash(res, "/admin", { kind: "success", message: `Bid canceled for ${bid.slug}. Winner review has been refreshed.` });
  } catch (error) {
    redirectWithFlash(res, "/admin", { kind: "error", message: error instanceof Error ? error.message : "Could not cancel bid." });
  }
});

app.get("/admin/export.csv", (_req, res) => {
  const viewer = res.locals.viewer as Viewer | null;
  if (!viewer?.isAdmin) {
    res.status(403).send("Forbidden");
    return;
  }
  res.header("Content-Type", "text/csv");
  res.header("Content-Disposition", "attachment; filename=\"auction-items.csv\"");
  res.send(toCsv(listAdminItems()));
});

app.post("/admin/upload", upload.single("sheet"), (req, res) => {
  if (!hasValidCsrfToken(req)) {
    res.status(403).send(renderPage(
      "Forbidden",
      `<section class="section"><h1>Request could not be verified.</h1><p>Please go back and try again.</p></section>`,
      res.locals.viewer,
      { kind: "error", message: "Request verification failed." },
      res.locals.csrfToken as string
    ));
    return;
  }
  handleAdminUpload(req.file?.buffer, res);
});

app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    redirectWithFlash(res, "/admin", {
      kind: "error",
      message: "CSV file is too large. Increase MAX_UPLOAD_BYTES if you need a larger limit."
    });
    return;
  }
  next(error);
});

app.listen(port, () => {
  console.log(`${auctionName} listening on http://localhost:${port}`);
});

function renderPage(title: string, body: string, viewer: Viewer | null, flash: Flash | null, csrfToken: string) {
  const content = getSiteContentSettings();
  return renderLayout({
    title: `${title} | ${content.siteTitle}`,
    auctionEndsAt: getAuctionEndsAt(),
    siteTitle: content.siteTitle,
    csrfToken,
    viewer,
    flash,
    body: injectCsrfFields(body, csrfToken)
  });
}

function isAuctionClosed(auctionEndsAt: string) {
  return Date.now() >= new Date(auctionEndsAt).getTime();
}

function redirectWithFlash(res: express.Response, location: string, flash: Flash) {
  res.append("Set-Cookie", serializeCookie("flash", encodeFlash(flash), {}));
  res.redirect(location);
}

function setSessionCookie(res: express.Response, token: string, expiresAt: string) {
  res.append("Set-Cookie", serializeCookie("session", token, { expires: new Date(expiresAt) }));
}

function parseCookies(header: string) {
  return Object.fromEntries(
    header.split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
      const idx = part.indexOf("=");
      return [part.slice(0, idx), decodeURIComponent(part.slice(idx + 1))];
    })
  );
}

function serializeCookie(name: string, value: string, options: { expires?: Date }) {
  const bits = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (shouldUseSecureCookies()) {
    bits.push("Secure");
  }
  if (options.expires) {
    bits.push(`Expires=${options.expires.toUTCString()}`);
  }
  return bits.join("; ");
}

function hasValidCsrfToken(req: express.Request) {
  const cookies = parseCookies(req.headers.cookie || "");
  const cookieToken = cookies.csrf || "";
  const bodyToken = typeof req.body?._csrf === "string" ? req.body._csrf : "";
  return Boolean(cookieToken && bodyToken && cookieToken === bodyToken);
}

function shouldUseSecureCookies() {
  const baseUrl = env("BASE_URL");
  return baseUrl.startsWith("https://") || env("NODE_ENV") === "production";
}

function injectCsrfFields(body: string, csrfToken: string) {
  return body.replace(/<form\b([^>]*)>/g, `<form$1><input type="hidden" name="_csrf" value="${csrfToken}" />`);
}

function encodeFlash(flash: Flash) {
  return Buffer.from(JSON.stringify(flash), "utf8").toString("base64url");
}

function decodeFlash(value: string): Flash | null {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Flash;
  } catch {
    return null;
  }
}

function handleAdminUpload(buffer: Buffer | undefined, res: express.Response) {
  const viewer = res.locals.viewer as Viewer | null;
  if (!viewer?.isAdmin) {
    redirectWithFlash(res, "/login", { kind: "error", message: "Admin access required." });
    return;
  }
  if (!buffer) {
    redirectWithFlash(res, "/admin", { kind: "error", message: "Choose a CSV file." });
    return;
  }
  const rows = parseCsv(buffer.toString("utf8"));
  const [headers, ...entries] = rows;
  if (!headers || headers.length === 0) {
    redirectWithFlash(res, "/admin", { kind: "error", message: "CSV must include a header row." });
    return;
  }
  const mapped = entries.map((row) => Object.fromEntries(headers.map((header, index) => [header.trim(), row[index] ?? ""])));
  upsertItemsFromRows(mapped);
  redirectWithFlash(res, "/admin", { kind: "success", message: "Spreadsheet uploaded. Items were added or updated in place." });
}

async function maybeRequireBidPreauthorization(
  viewer: Viewer,
  item: { id: number; slug: string; title: string },
  mode: "bid" | "proxy",
  amountCents: number
) {
  if (hasCompletedPreauthorization(viewer.id)) {
    return { redirectUrl: null, bidPlaced: false };
  }

  const attemptToken = randomToken();
  createPendingBidAttempt(viewer.id, item.id, mode, amountCents, attemptToken);
  const checkoutUrl = await createPreauthorizationUrl(viewer, item, attemptToken);
  if (checkoutUrl) {
    upsertPaymentPreauthorization(viewer.id, "pending", null, checkoutUrl);
    return { redirectUrl: checkoutUrl, bidPlaced: false };
  }

  console.log(`[stripe-preauth:fake] user=${viewer.id} item=${item.slug} amount=${amountCents}`);
  upsertPaymentPreauthorization(viewer.id, "completed", "fake-session", null);
  if (mode === "proxy") {
    placeProxyBid(item.id, viewer.id, amountCents);
  } else {
    placeBid(item.id, viewer.id, amountCents);
  }
  deletePendingBidAttempt(attemptToken);
  return { redirectUrl: null, bidPlaced: true };
}

async function createPreauthorizationUrl(
  viewer: Viewer,
  item: { slug: string; title: string },
  attemptToken: string
) {
  const secretKey = env("STRIPE_SECRET_KEY");
  const baseUrl = env("BASE_URL", `http://localhost:${port}`);
  if (!secretKey) {
    return null;
  }

  const body = new URLSearchParams({
    mode: "payment",
    "success_url": `${baseUrl}/preauth/complete?attempt=${attemptToken}&slug=${item.slug}&session_id={CHECKOUT_SESSION_ID}`,
    "cancel_url": `${baseUrl}/items/${item.slug}`,
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": "100",
    "line_items[0][price_data][product_data][name]": `${auctionName}: bid preauthorization`,
    "line_items[0][quantity]": "1",
    "metadata[user_id]": String(viewer.id),
    "metadata[item_slug]": item.slug,
    "metadata[attempt_token]": attemptToken,
    "metadata[purpose]": "bid_preauthorization"
  });

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  if (!response.ok) {
    throw new Error("Stripe preauthorization could not be created.");
  }

  const payload = await response.json() as { id?: string; url?: string };
  upsertPaymentPreauthorization(viewer.id, "pending", payload.id || null, payload.url || null);
  return payload.url || null;
}

async function createAccountPreauthorizationUrl(viewer: Viewer) {
  const secretKey = env("STRIPE_SECRET_KEY");
  const baseUrl = env("BASE_URL", `http://localhost:${port}`);
  if (!secretKey) {
    return null;
  }

  const body = new URLSearchParams({
    mode: "payment",
    "success_url": `${baseUrl}/account/preauth/complete?session_id={CHECKOUT_SESSION_ID}`,
    "cancel_url": `${baseUrl}/account`,
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": "100",
    "line_items[0][price_data][product_data][name]": `${auctionName}: payment option update`,
    "line_items[0][quantity]": "1",
    "metadata[user_id]": String(viewer.id),
    "metadata[purpose]": "payment_option_replace"
  });

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  if (!response.ok) {
    throw new Error("Stripe payment option update could not be created.");
  }

  const payload = await response.json() as { id?: string; url?: string };
  return payload.url || null;
}

async function createStripeCheckoutUrlForItems(items: Array<{ slug: string; title: string; amount_cents: number }>) {
  const secretKey = env("STRIPE_SECRET_KEY");
  const baseUrl = env("BASE_URL", `http://localhost:${port}`);
  if (!secretKey) {
    return null;
  }

  const body = new URLSearchParams({
    mode: "payment",
    "success_url": `${baseUrl}/wins`,
    "cancel_url": `${baseUrl}/wins`
  });

  items.forEach((item, index) => {
    body.set(`line_items[${index}][price_data][currency]`, "usd");
    body.set(`line_items[${index}][price_data][unit_amount]`, String(item.amount_cents));
    body.set(`line_items[${index}][price_data][product_data][name]`, `${auctionName}: ${item.title}`);
    body.set(`line_items[${index}][quantity]`, "1");
    body.set(`metadata[item_${index}_slug]`, item.slug);
  });

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  if (!response.ok) {
    throw new Error("Stripe checkout could not be created.");
  }

  const payload = await response.json() as { id?: string; url?: string };
  if (!payload.id || !payload.url) {
    throw new Error("Stripe checkout session response was incomplete.");
  }
  return { id: payload.id, url: payload.url };
}

async function verifyStripeCheckoutSession(
  sessionId: string,
  expected: { userId: number; purpose: string; attemptToken?: string }
) {
  const secretKey = env("STRIPE_SECRET_KEY");
  if (!secretKey) {
    throw new Error("Stripe is not configured.");
  }

  const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
    headers: {
      Authorization: `Bearer ${secretKey}`
    }
  });

  if (!response.ok) {
    throw new Error("Stripe could not confirm this checkout session.");
  }

  const payload = await response.json() as {
    id?: string;
    status?: string;
    payment_status?: string;
    metadata?: Record<string, string | undefined>;
  };

  if (payload.id !== sessionId || payload.status !== "complete" || payload.payment_status !== "paid") {
    throw new Error("Stripe did not confirm a successful checkout session.");
  }

  if (payload.metadata?.user_id !== String(expected.userId) || payload.metadata?.purpose !== expected.purpose) {
    throw new Error("Stripe session metadata did not match this account.");
  }

  if (expected.attemptToken && payload.metadata?.attempt_token !== expected.attemptToken) {
    throw new Error("Stripe session did not match the pending bid attempt.");
  }

  return payload;
}

function groupWinnerRows(rows: Array<{ user_id: number; nickname: string; contact: string; slug: string; title: string; category_name: string; amount_cents: number; purchase_status: string | null; stripe_checkout_url: string | null }>) {
  const grouped = new Map<number, {
    user_id: number;
    nickname: string;
    contact: string;
    total_amount_cents: number;
    purchase_status: string | null;
    stripe_checkout_url: string | null;
    items: Array<{ slug: string; title: string; category_name: string; amount_cents: number }>;
  }>();

  for (const row of rows) {
    const entry = grouped.get(row.user_id) ?? {
      user_id: row.user_id,
      nickname: row.nickname,
      contact: row.contact,
      total_amount_cents: 0,
      purchase_status: row.purchase_status,
      stripe_checkout_url: row.stripe_checkout_url,
      items: []
    };
    entry.total_amount_cents += row.amount_cents;
    entry.purchase_status = entry.purchase_status || row.purchase_status;
    entry.stripe_checkout_url = entry.stripe_checkout_url || row.stripe_checkout_url;
    entry.items.push({
      slug: row.slug,
      title: row.title,
      category_name: row.category_name,
      amount_cents: row.amount_cents
    });
    grouped.set(row.user_id, entry);
  }

  return Array.from(grouped.values()).sort((a, b) => a.nickname.localeCompare(b.nickname));
}

function getClientKey(req: express.Request) {
  return String(req.ip || req.socket.remoteAddress || "unknown");
}

async function handleStripeWebhook(req: express.Request) {
  const secretKey = env("STRIPE_SECRET_KEY");
  const webhookSecret = env("STRIPE_WEBHOOK_SECRET");
  if (!secretKey || !webhookSecret) {
    throw new Error("Stripe webhook is not configured.");
  }

  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
  const signature = String(req.headers["stripe-signature"] || "");
  const event = verifyStripeWebhookSignature(rawBody, signature, webhookSecret) as {
    type?: string;
    data?: {
      object?: {
        id?: string;
        mode?: string;
        status?: string;
        payment_status?: string;
      };
    };
  };

  const session = event.data?.object;
  if (!session?.id || session.mode !== "payment") {
    return;
  }

  const purchases = getPurchasesByStripeSessionId(session.id);
  if (purchases.length === 0) {
    return;
  }

  if (event.type === "checkout.session.completed" && session.payment_status === "paid") {
    updatePurchasesForStripeSession(session.id, "paid");
    const totalAmountCents = purchases.reduce((sum, purchase) => sum + purchase.amount_cents, 0);
    await sendPaymentCollectedNotificationIfNeeded(purchases[0].user_id, totalAmountCents);
    await sendAdminPaymentSuccessAlert(
      `Payment collected successfully for Stripe session ${session.id}. Total: $${(totalAmountCents / 100).toFixed(2)}.`
    );
    return;
  }

  if (event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed") {
    updatePurchasesForStripeSession(session.id, "payment_failed");
    const message = `Payment collection failed for Stripe session ${session.id}. Status: ${session.status || "unknown"}. Payment status: ${session.payment_status || "unknown"}.`;
    createAdminAlert("error", message);
    await sendAdminPaymentFailureAlert(message);
    console.error(`[stripe-payment-failed] ${message}`);
  }
}

function verifyStripeWebhookSignature(payload: Buffer, signatureHeader: string, webhookSecret: string) {
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((part) => {
      const [key, value] = part.split("=", 2);
      return [key, value];
    })
  ) as Record<string, string | undefined>;

  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) {
    throw new Error("Missing Stripe signature.");
  }

  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > 300) {
    throw new Error("Stripe signature timestamp is invalid.");
  }

  const expected = crypto
    .createHmac("sha256", webhookSecret)
    .update(`${timestamp}.${payload.toString("utf8")}`)
    .digest("hex");

  const provided = Buffer.from(signature, "hex");
  const computed = Buffer.from(expected, "hex");
  if (provided.length !== computed.length || !crypto.timingSafeEqual(provided, computed)) {
    throw new Error("Invalid Stripe signature.");
  }

  return JSON.parse(payload.toString("utf8"));
}
