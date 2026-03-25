import { DashboardData, Flash, ItemRow, LoginStep, Viewer } from "./types.js";
import { formatMoney } from "./utils.js";

type LayoutOptions = {
  title: string;
  auctionEndsAt: string;
  siteTitle: string;
  csrfToken: string;
  viewer?: Viewer | null;
  flash?: Flash | null;
  body: string;
};

export function renderLayout({ title, auctionEndsAt, siteTitle, csrfToken, viewer, flash, body }: LayoutOptions) {
  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${escapeHtml(title)}</title>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet">
      <link rel="stylesheet" href="/app.css" />
    </head>
    <body data-auction-ends-at="${auctionEndsAt}">
      <header class="auction-status" data-auction-status>
        <a href="/" class="auction-status__inner">
          <strong data-auction-label>Loading</strong>
        </a>
      </header>
      <div class="page-shell">
        <nav class="topbar">
          <a href="/" class="brand">${escapeHtml(siteTitle)}</a>
          <div class="topbar__actions">
            <a href="/categories">Categories</a>
            ${viewer ? `<a href="/account">Profile</a><a href="/wins">My Wins</a><span class="chip">${escapeHtml(viewer.nickname)}</span><form method="post" action="/logout"><input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}" /><button class="link-button" type="submit">Log out</button></form>` : `<a class="button button--ghost" href="/login">Bid / Sign in</a>`}
            ${viewer?.isAdmin ? `<a class="button button--dark" href="/admin">Admin</a>` : ``}
          </div>
        </nav>
        ${flash ? `<div class="flash flash--${flash.kind}">${escapeHtml(flash.message)}</div>` : ""}
        ${body}
        <footer class="site-footer">
          <p>Awection. Fast to browse. Fast to bid. Built for a phone in one hand.</p>
        </footer>
      </div>
      <script src="/app.js" defer></script>
    </body>
  </html>`;
}

export function renderHome(
  data: DashboardData,
  categories: Array<{ name: string; slug: string }>,
  content: { homeHeading: string; homeDescription: string }
) {
  return `
    <section class="hero">
      <div>
        <p class="eyebrow">Silent auction</p>
        <h1>${escapeHtml(content.homeHeading)}</h1>
        <p class="hero__copy">${escapeHtml(content.homeDescription)}</p>
      </div>
      <div class="hero__panel">
        <p class="hero__panel-title">Browse by category</p>
        <div class="category-pills">
          ${categories.map((category) => `<a class="pill" href="/categories/${category.slug}">${escapeHtml(category.name)}</a>`).join("")}
        </div>
      </div>
    </section>
    ${renderFeedSection("Recently active", "Most recently bid on items", data.recent)}
    ${renderFeedSection("Fresh finds", "Random unbid items, then the oldest quiet listings", data.fresh)}
    <section class="section">
      <div class="section__header">
        <div>
          <p class="eyebrow">Explore everything</p>
          <h2>Popular items</h2>
        </div>
      </div>
      <div class="item-grid" id="popular-grid">
        ${data.popular.map(renderItemCard).join("")}
      </div>
      <div class="load-more" data-load-more data-endpoint="/api/items?offset=${data.popular.length}">
        <button class="button button--ghost">Load more</button>
      </div>
    </section>
  `;
}

export function renderCategories(categories: Array<{ name: string; slug: string }>) {
  return `
    <section class="section">
      <div class="section__header">
        <div>
          <p class="eyebrow">Browse</p>
          <h1>Categories</h1>
        </div>
      </div>
      <div class="category-grid">
        ${categories.map((category) => `
          <a href="/categories/${category.slug}" class="category-card">
            <span>${escapeHtml(category.name)}</span>
            <strong>Open category</strong>
          </a>
        `).join("")}
      </div>
    </section>
  `;
}

export function renderCategoryPage(category: { name: string; slug: string }, items: ItemRow[]) {
  return `
    <section class="section">
      <div class="section__header">
        <div>
          <p class="eyebrow">Category</p>
          <h1>${escapeHtml(category.name)}</h1>
        </div>
      </div>
      <div class="item-grid" id="popular-grid">
        ${items.map(renderItemCard).join("")}
      </div>
      <div class="load-more" data-load-more data-endpoint="/api/items?category=${category.slug}&offset=${items.length}">
        <button class="button button--ghost">Load more</button>
      </div>
    </section>
  `;
}

export function renderItemPage(
  item: ItemRow,
  history: Array<{ amount_cents: number; created_at: string; nickname: string }>,
  nextMinimumBid: number,
  auctionClosed: boolean,
  viewer: Viewer | null
) {
  return `
    <section class="item-page">
      <div class="item-page__media">
        <img src="${escapeHtml(item.image_url || `https://picsum.photos/seed/item-${item.id}/800/600`)}" alt="${escapeHtml(item.title)}" />
      </div>
      <div class="item-page__content">
        <p class="eyebrow">${escapeHtml(item.category_name)}</p>
        <h1>${escapeHtml(item.title)}</h1>
        <p class="lede">${escapeHtml(item.description)}</p>
        <div class="price-stack">
          <div class="price-card">
            <span>Current bid</span>
            <strong>${formatMoney(item.current_bid_cents ?? item.starting_bid_cents)}</strong>
            <small>${item.current_bidder_nickname ? `Leading: ${escapeHtml(item.current_bidder_nickname)}` : "No bids yet"}</small>
          </div>
          <div class="price-card">
            <span>Next minimum</span>
            <strong>${formatMoney(nextMinimumBid)}</strong>
            <small>Increment ${formatMoney(item.min_increment_cents)}</small>
          </div>
        </div>
        <div class="meta-grid">
          <div><span>Donor</span><strong>${escapeHtml(item.donor_name || "Community donor")}</strong></div>
          <div><span>Retail value</span><strong>${formatMoney(item.retail_value_cents)}</strong></div>
        </div>
        ${auctionClosed
          ? `<div class="callout callout--closed">Bidding is closed. Winning bidders can finish payment with Stripe if enabled or show their phone to a checkout volunteer.</div>`
          : viewer
            ? `<div class="bid-actions">
                <div class="callout">
                  <p>Your first bid may require a card preauthorization. Winning bids are collected after the auction ends, following admin review.</p>
                </div>
                <form method="post" action="/items/${item.slug}/bid" class="bid-form">
                  <label>
                    Bid now
                    <input name="amount" type="number" min="${(nextMinimumBid / 100).toFixed(2)}" step="0.01" value="${(nextMinimumBid / 100).toFixed(2)}" />
                  </label>
                  <button class="button" type="submit">Place bid</button>
                </form>
                <form method="post" action="/items/${item.slug}/proxy" class="bid-form">
                  <label>
                    Max auto bid
                    <input name="amount" type="number" min="${(nextMinimumBid / 100).toFixed(2)}" step="0.01" value="${(nextMinimumBid / 100).toFixed(2)}" />
                  </label>
                  <button class="button button--ghost" type="submit">Save proxy bid</button>
                  <small>We’ll automatically raise your bid by the minimum increment, only when needed, up to this max.</small>
                </form>
              </div>`
            : `<div class="callout"><p>Browsing is open to everyone. Sign in only when you’re ready to bid.</p><a class="button" href="/login">Continue to sign in</a></div>`
        }
      </div>
    </section>
    <section class="section">
      <div class="section__header">
        <div>
          <p class="eyebrow">Bid history</p>
          <h2>Latest activity</h2>
        </div>
      </div>
      <div class="history-list">
        ${history.length > 0 ? history.map((entry) => `
          <div class="history-row">
            <strong>${formatMoney(entry.amount_cents)}</strong>
            <span>${escapeHtml(entry.nickname)}</span>
            <time>${new Date(entry.created_at).toLocaleString()}</time>
          </div>
        `).join("") : `<p class="empty-state">No bids yet.</p>`}
      </div>
    </section>
  `;
}

export function renderLoginPage(step: LoginStep, values?: { contact?: string }) {
  const contact = escapeHtml(values?.contact || "");

  if (step === "verify") {
    return `
      <section class="auth-shell">
        <div class="auth-card">
          <p class="eyebrow">Check your ${contact.includes("@") ? "email" : "phone"}</p>
          <h1>We sent you a login code</h1>
          <p>Enter the code to log in.</p>
          <form method="post" action="/login/verify" class="stack">
            <input type="hidden" name="contact" value="${contact}" />
            <label>Login code
              <input type="text" name="code" inputmode="numeric" required autofocus />
            </label>
            <button class="button button--dark" type="submit">Log in</button>
          </form>
          <form method="post" action="/login/resend" class="stack stack--compact">
            <input type="hidden" name="contact" value="${contact}" />
            <button class="link-button" type="submit">Send a new code</button>
          </form>
        </div>
      </section>
    `;
  }

  if (step === "nickname") {
    return `
      <section class="auth-shell">
        <div class="auth-card">
          <p class="eyebrow">One more step</p>
          <h1>Choose your nickname</h1>
          <p>Your nickname is shown with your bids. You can change it later from your profile.</p>
          <form method="post" action="/login/nickname" class="stack">
            <label>Nickname
              <input type="text" name="nickname" required autofocus />
            </label>
            <button class="button" type="submit">Save nickname</button>
          </form>
        </div>
      </section>
    `;
  }

  return `
    <section class="auth-shell">
      <div class="auth-card">
        <p class="eyebrow">Passwordless sign-in</p>
        <h1>Enter your email or phone</h1>
        <p>Browse first. Sign in only when you want to bid, track activity, or check out a win.</p>
        <form method="post" action="/login/start" class="stack">
          <label>Email or phone
            <input type="text" name="contact" placeholder="name@example.com or 555-123-4567" required />
          </label>
          <button class="button" type="submit">Continue</button>
        </form>
      </div>
    </section>
  `;
}

export function renderAccountPage(
  viewer: Viewer,
  items: Array<{ item_slug: string; item_title: string; category_name: string; my_bid_cents: number; leading_bid_cents: number; status: string }>,
  payment: { hasPaymentMethod: boolean; canRemove: boolean; statusLabel: string },
  notifications: { outbid: boolean; won: boolean; payment: boolean; adminPayment: boolean }
) {
  return `
    <section class="section">
      <div class="section__header">
        <div>
          <p class="eyebrow">Profile</p>
          <h1>${escapeHtml(viewer.nickname)}</h1>
        </div>
      </div>
      <div class="admin-grid">
        <form method="post" action="/account/nickname" class="auth-card stack">
          <h2>Change nickname</h2>
          <label>Nickname
            <input type="text" name="nickname" value="${escapeHtml(viewer.nickname)}" required />
          </label>
          <button class="button" type="submit">Save nickname</button>
        </form>
        <div class="auth-card stack">
          <h2>Contact</h2>
          <p>${escapeHtml(viewer.email || viewer.phone || "")}</p>
          <p class="empty-state">Your nickname appears with your bids.</p>
        </div>
        <div class="auth-card stack">
          <h2>Payment option</h2>
          <p>${escapeHtml(payment.statusLabel)}</p>
          <p class="empty-state">You can replace your payment option anytime if the new preauthorization succeeds.</p>
          <form method="post" action="/account/payment/replace">
            <button class="button" type="submit">${payment.hasPaymentMethod ? "Replace payment option" : "Add payment option"}</button>
          </form>
          <form method="post" action="/account/payment/remove">
            <button class="button button--ghost" type="submit" ${payment.canRemove ? "" : "disabled"}>Remove payment option</button>
          </form>
          ${payment.canRemove ? "" : `<p class="empty-state">You cannot remove your payment option while you still have active bids or proxy bids.</p>`}
        </div>
        <form method="post" action="/account/notifications" class="auth-card stack">
          <h2>Notifications</h2>
          <div class="toggle-list">
            <label class="toggle-row">
              <input type="checkbox" name="outbid" value="1" ${notifications.outbid ? "checked" : ""} />
              <span>Outbid notifications</span>
            </label>
            <label class="toggle-row">
              <input type="checkbox" name="won" value="1" ${notifications.won ? "checked" : ""} />
              <span>Winning item notifications when the auction closes</span>
            </label>
            <label class="toggle-row">
              <input type="checkbox" name="payment" value="1" ${notifications.payment ? "checked" : ""} />
              <span>Payment collected notifications</span>
            </label>
            ${viewer.isAdmin ? `
              <label class="toggle-row">
                <input type="checkbox" name="admin_payment" value="1" ${notifications.adminPayment ? "checked" : ""} />
                <span>Admin payment success and failure notifications</span>
              </label>
            ` : ""}
          </div>
          <button class="button" type="submit">Save notification settings</button>
        </form>
      </div>
    </section>
    <section class="section">
      <div class="section__header">
        <div>
          <p class="eyebrow">Activity</p>
          <h2>Items you’ve bid on</h2>
        </div>
      </div>
      <div class="wins-list">
        ${items.length > 0 ? items.map((item) => `
          <article class="win-card">
            <div>
              <p class="eyebrow">${escapeHtml(item.category_name)}</p>
              <h2><a href="/items/${item.item_slug}">${escapeHtml(item.item_title)}</a></h2>
              <p>Your top bid: <strong>${formatMoney(item.my_bid_cents)}</strong></p>
              <p>Current leading bid: <strong>${formatMoney(item.leading_bid_cents)}</strong></p>
            </div>
            <div class="win-card__actions">
              <span class="chip">${escapeHtml(item.status)}</span>
              <a class="button button--ghost" href="/items/${item.item_slug}">View item</a>
            </div>
          </article>
        `).join("") : `<p class="empty-state">You haven’t placed any bids yet.</p>`}
      </div>
    </section>
  `;
}

export function renderWinsPage(
  items: Array<{ slug: string; title: string; category_name: string; amount_cents: number; purchase_status: string | null; stripe_checkout_url: string | null }>
) {
  return `
    <section class="section">
      <div class="section__header">
        <div>
          <p class="eyebrow">After the auction</p>
          <h1>Your winning items</h1>
        </div>
      </div>
      <div class="wins-list">
        ${items.length > 0 ? items.map((item) => `
          <article class="win-card">
            <div>
              <p class="eyebrow">${escapeHtml(item.category_name)}</p>
              <h2>${escapeHtml(item.title)}</h2>
              <p>Winning bid: <strong>${formatMoney(item.amount_cents)}</strong></p>
            </div>
            <div class="win-card__actions">
              ${item.stripe_checkout_url
                ? `<a class="button" href="${escapeHtml(item.stripe_checkout_url)}">Pay with Stripe</a>`
                : `<span class="chip">Awaiting admin review</span>`
              }
              <span class="checkout-pass">Show this phone to checkout staff</span>
              <span class="chip">${escapeHtml(formatStatusLabel(item.purchase_status || "Awaiting payment"))}</span>
            </div>
          </article>
        `).join("") : `<p class="empty-state">No winning items yet.</p>`}
      </div>
    </section>
  `;
}

export function renderAdminDeleteConfirm(item: { id: number; slug: string; title: string; category: string }) {
  return `
    <section class="auth-shell">
      <div class="auth-card stack">
        <p class="eyebrow">Confirm deletion</p>
        <h1>Delete ${escapeHtml(item.title)}?</h1>
        <p>Category: <strong>${escapeHtml(item.category)}</strong></p>
        <p>Slug: <strong>${escapeHtml(item.slug)}</strong></p>
        <p class="empty-state">This removes the item and all related bids, proxy bids, purchases, and pending bid attempts.</p>
        <form method="post" action="/admin/items/${item.id}/delete">
          <button class="button" type="submit">Yes, delete item</button>
        </form>
        <p><a href="/admin">Cancel and return to admin</a></p>
      </div>
    </section>
  `;
}

export function renderAdminPanel(
  rows: Array<Record<string, string | number | null>>,
  winnerGroups: Array<{ user_id: number; nickname: string; contact: string; total_amount_cents: number; purchase_status: string | null; stripe_checkout_url: string | null; items: Array<{ slug: string; title: string; category_name: string; amount_cents: number }> }>,
  auctionClosed: boolean,
  bids: Array<{ id: number; item_slug: string; item_title: string; category_name: string; nickname: string; contact: string; amount_cents: number; created_at: string; purchase_status: string | null }>,
  eligibilityAlerts: Array<{ slug: string; title: string; category_name: string; top_bidder_nickname: string; top_bidder_contact: string; top_bid_amount_cents: number; top_bidder_payment_status: string; eligible_winner_nickname: string | null; eligible_winner_amount_cents: number | null }>,
  adminAlerts: Array<{ id: number; level: string; message: string; created_at: string }>,
  auctionEndsAt: string,
  content: { siteTitle: string; homeHeading: string; homeDescription: string }
) {
  const localDateTimeValue = toLocalDateTimeValue(auctionEndsAt);
  return `
    ${adminAlerts.length > 0 ? `
      <section class="section">
        <div class="section__header">
          <div>
            <p class="eyebrow">Admin alerts</p>
            <h1>Recent system issues</h1>
          </div>
        </div>
        <div class="wins-list">
          ${adminAlerts.map((alert) => `
            <article class="win-card">
              <div>
                <p><strong>${escapeHtml(alert.level.toUpperCase())}</strong></p>
                <p>${escapeHtml(alert.message)}</p>
              </div>
              <div class="win-card__actions">
                <span class="chip">${new Date(alert.created_at).toLocaleString()}</span>
              </div>
            </article>
          `).join("")}
        </div>
      </section>
    ` : ""}
    <section class="section">
      <div class="section__header">
        <div>
          <p class="eyebrow">Admin</p>
          <h1>Settings</h1>
        </div>
        <div class="topbar__actions">
          <a class="button button--ghost" href="/admin/export.csv">Download CSV</a>
        </div>
      </div>
      <div class="admin-settings-grid">
        <form method="post" action="/admin/site-content" class="auth-card stack">
          <h2>Site content</h2>
          <label>Site title
            <input type="text" name="site_title" value="${escapeHtml(content.siteTitle)}" required />
          </label>
          <label>Home page heading
            <input type="text" name="home_heading" value="${escapeHtml(content.homeHeading)}" required />
          </label>
          <label>Home page description
            <input type="text" name="home_description" value="${escapeHtml(content.homeDescription)}" required />
          </label>
          <button class="button" type="submit">Update site content</button>
        </form>
        <div class="stack admin-settings-side">
          <form method="post" action="/admin/auction-end" class="auth-card stack">
            <h2>Auction end time</h2>
            <label>Ends at
              <input type="datetime-local" name="auction_ends_at" value="${escapeHtml(localDateTimeValue)}" required />
            </label>
            <button class="button" type="submit">Update end time</button>
          </form>
          <form method="post" action="/admin/upload" enctype="multipart/form-data" class="auth-card stack">
            <h2>Spreadsheet upload</h2>
            <input type="file" name="sheet" accept=".csv,text/csv" required />
            <p class="empty-state">Uploads add new items and update existing items in place by slug.</p>
            <button class="button" type="submit">Upload spreadsheet</button>
          </form>
        </div>
      </div>
      <div class="table-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th>actions</th>
              <th>id</th>
              <th>slug</th>
              <th>title</th>
              <th>category</th>
              <th>description</th>
              <th>image_url</th>
              <th>donor_name</th>
              <th>retail_value</th>
              <th>starting_bid</th>
              <th>min_increment</th>
              <th>buy_now</th>
              <th>popularity</th>
              <th>bid_count</th>
              <th>last_bid_at</th>
              <th>created_at</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => renderAdminItemRow(row)).join("")}
            ${renderAdminNewItemRow()}
          </tbody>
        </table>
      </div>
    </section>
    ${auctionClosed ? `
      ${eligibilityAlerts.length > 0 ? `
        <section class="section">
          <div class="section__header">
            <div>
              <p class="eyebrow">Payment eligibility</p>
              <h1>Highest bids currently ineligible</h1>
            </div>
          </div>
          <div class="wins-list">
            ${eligibilityAlerts.map((alert) => `
              <article class="win-card">
                <div>
                  <p class="eyebrow">${escapeHtml(alert.category_name)}</p>
                  <h2><a href="/items/${alert.slug}">${escapeHtml(alert.title)}</a></h2>
                  <p>Top bid: <strong>${formatMoney(alert.top_bid_amount_cents)}</strong> by <strong>${escapeHtml(alert.top_bidder_nickname)}</strong></p>
                  <p>Contact: <strong>${escapeHtml(alert.top_bidder_contact)}</strong></p>
                  <p>Payment status: <strong>${escapeHtml(alert.top_bidder_payment_status)}</strong></p>
                  <p class="empty-state">If this bidder re-adds a payment method, they can become the winner again and you can collect payment from them.</p>
                </div>
                <div class="win-card__actions">
                  <span class="chip">
                    ${alert.eligible_winner_nickname
                      ? `Current eligible winner: ${escapeHtml(alert.eligible_winner_nickname)} ${formatMoney(alert.eligible_winner_amount_cents)}`
                      : "No eligible winner yet"}
                  </span>
                </div>
              </article>
            `).join("")}
          </div>
        </section>
      ` : ""}
      <section class="section">
        <div class="section__header">
          <div>
            <p class="eyebrow">Review winners</p>
            <h1>Collect payment per user</h1>
          </div>
        </div>
        <div class="wins-list">
          ${winnerGroups.length > 0 ? winnerGroups.map((winner) => `
            <article class="win-card">
              <div>
                <p class="eyebrow">Winner</p>
                <h2>${escapeHtml(winner.nickname)}</h2>
                <p>Winner: <strong>${escapeHtml(winner.nickname)}</strong></p>
                <p>Contact: <strong>${escapeHtml(winner.contact)}</strong></p>
                <p>Total due: <strong>${formatMoney(winner.total_amount_cents)}</strong></p>
                <div class="history-list">
                  ${winner.items.map((item) => `
                    <div class="history-row">
                      <span>${escapeHtml(item.title)}</span>
                      <strong>${formatMoney(item.amount_cents)}</strong>
                    </div>
                  `).join("")}
                </div>
              </div>
              <div class="win-card__actions">
                ${winner.stripe_checkout_url
                  ? `<a class="button" href="${escapeHtml(winner.stripe_checkout_url)}">Open collection link</a>`
                  : `<form method="post" action="/admin/winners/users/${winner.user_id}/collect"><button class="button" type="submit">Collect total</button></form>`
                }
                <span class="chip">${escapeHtml(formatStatusLabel(winner.purchase_status || "Awaiting review"))}</span>
              </div>
            </article>
          `).join("") : `<p class="empty-state">No winning bids yet.</p>`}
        </div>
      </section>
    ` : ""}
    <section class="section">
      <div class="section__header">
        <div>
          <p class="eyebrow">Bid review</p>
          <h1>Cancel bids before successful payment</h1>
        </div>
      </div>
      <div class="wins-list">
        ${bids.length > 0 ? bids.map((bid) => `
          <article class="win-card">
            <div>
              <p class="eyebrow">${escapeHtml(bid.category_name)}</p>
              <h2><a href="/items/${bid.item_slug}">${escapeHtml(bid.item_title)}</a></h2>
              <p>Bidder: <strong>${escapeHtml(bid.nickname)}</strong></p>
              <p>Contact: <strong>${escapeHtml(bid.contact)}</strong></p>
              <p>Bid amount: <strong>${formatMoney(bid.amount_cents)}</strong></p>
              <p>Placed: <strong>${new Date(bid.created_at).toLocaleString()}</strong></p>
            </div>
            <div class="win-card__actions">
              <span class="chip">${escapeHtml(formatStatusLabel(bid.purchase_status || "No collection started"))}</span>
              <form method="post" action="/admin/bids/${bid.id}/cancel">
                <button class="button button--ghost" type="submit">Cancel bid</button>
              </form>
            </div>
          </article>
        `).join("") : `<p class="empty-state">No active bids.</p>`}
      </div>
    </section>
  `;
}

function formatAdminCell(key: string, value: string | number | null) {
  if (value == null) {
    return "";
  }
  const moneyKeys = new Set([
    "retail_value_cents",
    "starting_bid_cents",
    "min_increment_cents",
    "buy_now_cents",
    "amount_cents",
    "top_bid_amount_cents",
    "eligible_winner_amount_cents",
    "total_amount_cents"
  ]);
  if (moneyKeys.has(key) && typeof value === "number") {
    return formatMoney(value);
  }
  return String(value);
}

function renderAdminItemRow(row: Record<string, string | number | null>) {
  const formId = `admin-item-${row.id}`;
  return `
    <tr>
      <td class="admin-actions">
        <form id="${formId}" method="post" action="/admin/items/${row.id}"></form>
        <button class="button" type="submit" form="${formId}">Save</button>
        <a class="button button--ghost" href="/admin/items/${row.id}/delete">Delete</a>
      </td>
      <td>${escapeHtml(String(row.id ?? ""))}</td>
      <td>${renderAdminInput(formId, "slug", row.slug)}</td>
      <td>${renderAdminInput(formId, "title", row.title)}</td>
      <td>${renderAdminInput(formId, "category", row.category)}</td>
      <td>${renderAdminInput(formId, "description", row.description)}</td>
      <td>${renderAdminInput(formId, "image_url", row.image_url)}</td>
      <td>${renderAdminInput(formId, "donor_name", row.donor_name)}</td>
      <td>${renderAdminInput(formId, "retail_value_cents", centsToDollars(row.retail_value_cents))}</td>
      <td>${renderAdminInput(formId, "starting_bid_cents", centsToDollars(row.starting_bid_cents))}</td>
      <td>${renderAdminInput(formId, "min_increment_cents", centsToDollars(row.min_increment_cents))}</td>
      <td>${renderAdminInput(formId, "buy_now_cents", centsToDollars(row.buy_now_cents))}</td>
      <td>${escapeHtml(formatAdminCell("popularity_score", row.popularity_score))}</td>
      <td>${escapeHtml(formatAdminCell("bid_count", row.bid_count))}</td>
      <td>${escapeHtml(formatAdminCell("last_bid_at", row.last_bid_at))}</td>
      <td>${renderAdminInput(formId, "created_at", row.created_at)}</td>
    </tr>
  `;
}

function renderAdminNewItemRow() {
  const formId = "admin-item-new";
  return `
    <tr>
        <td class="admin-actions">
          <form id="${formId}" method="post" action="/admin/items"></form>
          <button class="button" type="submit" form="${formId}">Add</button>
        </td>
        <td>new</td>
        <td>${renderAdminInput(formId, "slug", "")}</td>
        <td>${renderAdminInput(formId, "title", "")}</td>
        <td>${renderAdminInput(formId, "category", "")}</td>
        <td>${renderAdminInput(formId, "description", "")}</td>
        <td>${renderAdminInput(formId, "image_url", "")}</td>
        <td>${renderAdminInput(formId, "donor_name", "")}</td>
        <td>${renderAdminInput(formId, "retail_value_cents", "")}</td>
        <td>${renderAdminInput(formId, "starting_bid_cents", "")}</td>
        <td>${renderAdminInput(formId, "min_increment_cents", "")}</td>
        <td>${renderAdminInput(formId, "buy_now_cents", "")}</td>
        <td></td>
        <td></td>
        <td></td>
        <td>${renderAdminInput(formId, "created_at", "")}</td>
    </tr>
  `;
}

function renderAdminInput(formId: string, name: string, value: string | number | null | undefined) {
  return `<input class="admin-cell-input" type="text" form="${escapeHtml(formId)}" name="${escapeHtml(name)}" value="${escapeHtml(String(value ?? ""))}" />`;
}

function centsToDollars(value: string | number | null | undefined) {
  if (value == null || value === "") {
    return "";
  }
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) {
    return String(value);
  }
  return (numberValue / 100).toFixed(2);
}

function formatStatusLabel(value: string) {
  return value
    .trim()
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function toLocalDateTimeValue(iso: string) {
  const date = new Date(iso);
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}

export function renderItemCards(items: ItemRow[]) {
  return items.map(renderItemCard).join("");
}

function renderFeedSection(title: string, subtitle: string, items: ItemRow[]) {
  return `
    <section class="section">
      <div class="section__header">
        <div>
          <p class="eyebrow">${escapeHtml(subtitle)}</p>
          <h2>${escapeHtml(title)}</h2>
        </div>
      </div>
      <div class="item-grid">
        ${items.map(renderItemCard).join("")}
      </div>
    </section>
  `;
}

function renderItemCard(item: ItemRow) {
  return `
    <article class="item-card">
      <a href="/items/${item.slug}" class="item-card__image">
        <img src="${escapeHtml(item.image_url || `https://picsum.photos/seed/card-${item.id}/640/480`)}" alt="${escapeHtml(item.title)}" />
      </a>
      <div class="item-card__body">
        <div class="item-card__meta">
          <span class="chip">${escapeHtml(item.category_name)}</span>
          <span>${item.bid_count} bids</span>
        </div>
        <h3><a href="/items/${item.slug}">${escapeHtml(item.title)}</a></h3>
        <p>${escapeHtml(item.description)}</p>
        <div class="item-card__footer">
          <strong>${formatMoney(item.current_bid_cents ?? item.starting_bid_cents)}</strong>
          <a href="/items/${item.slug}" class="button button--ghost">View</a>
        </div>
      </div>
    </article>
  `;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
