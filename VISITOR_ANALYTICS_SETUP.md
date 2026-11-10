# Visitor analytics setup

The visitor feature is consent-based. A visitor can choose **Continue with Google** or **Continue without sharing**. Google sign-in requests only the OpenID Connect `openid email` scopes. The app records an email only after Google returns a verified email address. The site cannot read an email address stored in a visitor's browser.

## Required production configuration

Create a dedicated PostgreSQL database for this app. Do not reuse a database that contains unrelated personal or business data. The app creates its `tracking_links` and `visitor_events` tables at startup.

Set these environment variables on the Render web service:

- `DATABASE_URL`: connection string for the dedicated PostgreSQL database.
- `GOOGLE_CLIENT_ID`: OAuth 2.0 client ID from Google Cloud.
- `GOOGLE_CLIENT_SECRET`: OAuth 2.0 client secret. Keep it in Render environment variables; never commit it.
- `GOOGLE_REDIRECT_URI`: `https://YOUR-RENDER-HOST/auth/google/callback`.
- `ADMIN_EMAIL`: exact Google email address allowed to access Visitor Analysis.
- `SESSION_SECRET`: a long random secret (at least 32 random bytes).
- `PUBLIC_BASE_URL`: `https://YOUR-RENDER-HOST`, with no trailing slash.

In Google Cloud Console, configure an OAuth consent screen and create a **Web application** OAuth client. Add the exact `GOOGLE_REDIRECT_URI` above under **Authorized redirect URIs**. The app requests only `openid email`. If the OAuth app is in Testing mode, add the intended administrator as a test user. Publish/verify the OAuth app as required before general public use.

## How to use

1. Open `/visitor-admin.html` and sign in with the Google account matching `ADMIN_EMAIL`.
2. Enter a destination URL and create a tracking link.
3. Share that link. Visitors can choose whether to share their Google email.
4. View recorded visits in Visitor Analysis.

## Privacy and operations

- The email is optional. The visitor can continue without sharing.
- No browser-saved Gmail address is read or extracted.
- The server stores the visitor's verified Google email only after the visitor completes Google sign-in.
- The server stores a one-way HMAC of the IP address for basic duplicate/abuse analysis; it does not store the raw IP address.
- User-agent strings are stored to show browser/device information.
- Set and publish an appropriate privacy notice and retention period before collecting real visitor data. Restrict access to the administrator account and protect the Render environment variables.
- This feature is not fully operational until all environment variables and the dedicated PostgreSQL database are configured.
