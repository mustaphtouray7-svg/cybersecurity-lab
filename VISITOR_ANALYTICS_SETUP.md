# Visitor analytics setup

The visitor feature records a visit immediately when a tracking link is opened. It does not use Google OAuth or Google sign-in.

## Production configuration

The Render Blueprint connects this service to its dedicated PostgreSQL database and sets `SESSION_SECRET` and `PUBLIC_BASE_URL`. The app creates its `tracking_links` and `visitor_events` tables at startup.

Set `ADMIN_PASSWORD` as a secret environment variable on the Render web service. The administrator opens `/visitor-admin.html` and signs in with this password. Do not commit the password to GitHub or share it publicly.

## How it works

1. Open `/visitor-admin.html` and sign in.
2. Enter a destination URL and create a tracking link.
3. When someone opens the link, the server records the visit immediately.
4. The visitor can optionally type an email address and choose **Allow and share my email**, or choose **Continue without sharing**.
5. The visitor is redirected to the destination. The administrator can review visits in Visitor Analysis.

## Data and privacy

- The email field is optional. Visitors who decline are recorded without an email address.
- No Google sign-in is used. The site cannot read a Gmail address saved on a visitor's phone or browser. If a visitor types an email, it is not independently verified as belonging to them.
- Visit time and user-agent information are stored.
- The IP address is transformed into a one-way HMAC hash; the raw IP address is not stored. This supports limited duplicate/abuse analysis but cannot be used to recover the visitor's IP address or precise location.
- Publish a clear privacy notice and retention period before distributing tracking links publicly. Restrict administrator access and protect Render environment variables.
- The current Render free PostgreSQL instance expires on 10 December 2026. Upgrade or migrate it before that date to preserve records.
