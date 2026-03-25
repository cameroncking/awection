# Product Notes

## Overview

Awection is a mobile-first silent auction site optimized for:

- frictionless browsing without login
- passwordless bidder onboarding
- bid-time payment preauthorization
- lightweight admin operations

## Public Experience

- Anyone can browse without an account.
- Categories are browseable.
- Empty categories are hidden.
- The sticky countdown header appears on every page and links back to the homepage.
- The footer always says:
  `Awection. Fast to browse. Fast to bid. Built for a phone in one hand.`

## Home Page

The homepage is composed in this order:

1. 3 most recently bid-on items
2. 3 random unbid items
3. Backfill with older quiet items if needed
4. Remaining inventory by popularity, with infinite scroll

## Authentication

- Passwordless sign-in only
- User starts with email or phone
- The next step is code verification
- Accounts are created immediately after successful code verification
- If a user has no nickname yet, they are redirected to set one before using the app
- Nicknames are required and are never auto-generated
- Auth codes are throttled to one send every 5 minutes per contact

## Bidding

- Standard bids are supported
- Proxy bids are supported
- Proxy bids auto-counter by increment up to the bidder's max
- Browsing does not require login
- Bidding does require login

## Payment Option Rules

- A payment option is required before a first bid is completed
- Stripe Checkout is used when configured
- If Stripe is not configured, preauth is faked and logged
- Users can replace their payment option from the account page
- Users cannot remove a payment option while they still have active bids or proxy bids

## Winner Eligibility

After the auction closes:

- A bidder must still have a completed payment method on file to be considered an eligible winner
- If the top bidder is ineligible, the next eligible bidder becomes the effective winner
- If the ineligible top bidder adds a payment method later, they can become eligible again
- The admin UI shows these ineligibility conditions

## Wins and Collection

- The system does not automatically charge winners at close
- Admins review winners after the auction closes
- Winners are grouped by user
- Payment collection is initiated once per user total, across all items won by that user
- If collection link creation fails, the admin is notified immediately
- As long as payment has not been successfully collected, bids can still be canceled by the admin

## Admin Item Management

Admins can:

- edit item rows directly in the table
- add new items directly
- delete items with a confirmation page
- create categories implicitly by entering new category names

## CSV Import

CSV upload adds new items and updates existing items in place by slug.

Typical columns:

- `slug`
- `title`
- `category`
- `description`
- `image_url`
- `donor_name`
- `retail_value_cents`
- `starting_bid_cents`
- `min_increment_cents`
- `buy_now_cents`
- `created_at`

Money fields are entered in dollars and stored internally as cents.

## Notifications

Notification preferences are editable on the profile page.

Supported preference toggles:

- outbid notifications
- winning item notifications
- payment collected notifications
- admin payment success/failure notifications for admin users

Delivery behavior:

- Email via Resend when configured
- SMS via Twilio when configured
- Console logging fallback when not configured

Planned/event helper coverage exists for:

- outbid
- won at close
- payment collected

## Admin Content Controls

Admins can edit:

- auction end time
- site title
- home page heading
- home page description

The footer brand line remains fixed to Awection.

## File Map

- `src/server.ts`: routes
- `src/db.ts`: schema and queries
- `src/views.ts`: HTML rendering
- `src/auth.ts`: login and message delivery
- `src/notifications.ts`: notification helpers
- `public/app.css`: styles
- `public/app.js`: countdown and infinite scroll
