import { deliverMessage } from "./auth.js";
import {
  getNotificationPreferences,
  getPendingWonNotifications,
  getUserById,
  getUserPrimaryContact,
  hasNotificationEvent,
  recordNotificationEvent
} from "./db.js";
import { ContactKind } from "./types.js";
import { env, formatMoney } from "./utils.js";

export async function sendOutbidNotification(userId: number, item: { title: string; slug: string }, currentBidCents: number) {
  const prefs = getNotificationPreferences(userId);
  if (!prefs.outbid_enabled) {
    return;
  }
  const user = getUserById(userId);
  const contact = getUserPrimaryContact(userId);
  if (!user || !contact) {
    return;
  }
  const url = `${env("BASE_URL", "http://localhost:3000")}/items/${item.slug}`;
  await deliverMessage(
    contact.kind as ContactKind,
    contact.contact,
    `You were outbid on ${item.title}`,
    `<p>You were outbid on <strong>${item.title}</strong>.</p><p>The current bid is <strong>${formatMoney(currentBidCents)}</strong>.</p><p><a href="${url}">View item</a></p>`,
    `You were outbid on ${item.title}. The current bid is ${formatMoney(currentBidCents)}. View item: ${url}`,
    "outbid"
  );
}

export async function sendWonNotificationsIfNeeded() {
  const pending = getPendingWonNotifications();
  for (const winner of pending) {
    const prefs = getNotificationPreferences(winner.user_id);
    if (!prefs.won_enabled) {
      recordNotificationEvent("won", `item:${winner.item_id}`);
      continue;
    }
    const contact = getUserPrimaryContact(winner.user_id);
    if (!contact) {
      continue;
    }
    const url = `${env("BASE_URL", "http://localhost:3000")}/wins`;
    await deliverMessage(
      contact.kind as ContactKind,
      contact.contact,
      `You won ${winner.title}`,
      `<p>You won <strong>${winner.title}</strong> with a bid of <strong>${formatMoney(winner.amount_cents)}</strong>.</p><p>Open <a href="${url}">My Wins</a> for details.</p>`,
      `You won ${winner.title} with a bid of ${formatMoney(winner.amount_cents)}. Open My Wins: ${url}`,
      "won"
    );
    recordNotificationEvent("won", `item:${winner.item_id}`);
  }
}

export async function sendPaymentCollectedNotificationIfNeeded(userId: number, totalAmountCents: number) {
  const prefs = getNotificationPreferences(userId);
  if (!prefs.payment_enabled) {
    recordNotificationEvent("payment_collected", `user:${userId}:total:${totalAmountCents}`);
    return;
  }
  if (hasNotificationEvent("payment_collected", `user:${userId}:total:${totalAmountCents}`)) {
    return;
  }
  const contact = getUserPrimaryContact(userId);
  if (!contact) {
    return;
  }
  const url = `${env("BASE_URL", "http://localhost:3000")}/wins`;
  await deliverMessage(
    contact.kind as ContactKind,
    contact.contact,
    "Your auction payment was collected",
    `<p>Your auction payment of <strong>${formatMoney(totalAmountCents)}</strong> was collected.</p><p>You can review your winning items here: <a href="${url}">My Wins</a></p>`,
    `Your auction payment of ${formatMoney(totalAmountCents)} was collected. Review your winning items: ${url}`,
    "payment-collected"
  );
  recordNotificationEvent("payment_collected", `user:${userId}:total:${totalAmountCents}`);
}
