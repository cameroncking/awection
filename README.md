# Awection

Mobile-first silent auction app built with TypeScript, Express, and SQLite.

## Quick Start

1. Copy `.env.example` to `.env`
2. Set `ADMIN_CONTACT`
3. Install dependencies

```bash
npm install
```

4. Start development

```bash
npm run dev
```

5. Build production output

```bash
npm run build
```

6. Run production build

```bash
npm start
```

## Environment

Important values:

- `PORT`
- `BASE_URL`
- `DB_PATH`
- `ADMIN_CONTACT`
- `AUCTION_ENDS_AT`
- `RESEND_API_KEY` / `RESEND_FROM`
- `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

Notes:

- `AUCTION_ENDS_AT` is only the initial default. Admins can later change the stored end time from the admin UI.
- `ADMIN_CONTACT` accepts a comma-separated list of admin email addresses and/or phone numbers. Any user who signs in with a matching contact gets admin privileges.
- If Resend or Twilio are missing, auth codes and notifications are logged to the server console.
- If Stripe is missing, bid-time preauthorization is faked and logged.
- Admin payment success/failure notifications are configured in the admin UI after an admin signs in.

## Admin

Admin access uses passwordless sign-in. Any contact listed in `ADMIN_CONTACT` receives admin privileges after code verification.

Admin capabilities:

- Edit, add, and delete items directly in the item table
- Import/export/update CSV
- Change auction end time
- Change site title and homepage copy
- Review winners after the auction closes
- Collect payment per winning user total
- Cancel bids before successful payment

## Main Paths

- `/`
- `/categories`
- `/items/:slug`
- `/login`
- `/account`
- `/wins`
- `/admin`

## CSV

Money columns are entered in dollars and converted internally.

Example:

```csv
slug,title,category,description,image_url,donor_name,retail_value_cents,starting_bid_cents,min_increment_cents,buy_now_cents,created_at
weekend-cabin,Weekend Cabin Escape,Travel,Two nights at a lake cabin,https://example.com/cabin.jpg,Community Donor,150,25,5,,2026-03-24T12:00:00.000Z
```

## More Detail

See [docs/product.md](docs/product.md) for the full product behavior, bidding rules, payment rules, notifications, and data/workflow notes.

## Author

Cameron King

## License

Released under ISC License

See LICENSE for details
