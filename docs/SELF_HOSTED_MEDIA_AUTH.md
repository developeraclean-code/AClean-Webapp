# Self-hosted media API authorization

The self-hosted production app at `app.aclean.id` must set
`ACLEAN_MEDIA_AUTH_REQUIRED=true` as a server runtime variable. Its entrypoint
refuses to start without this setting. The dedicated staging bucket continues
to enable the same checks automatically. Existing Vercel and company-website
environments are unchanged when the flag is absent.

The media API verifies its HttpOnly, Secure, host-only session cookie and
rechecks the active application profile on each request. Owner/Admin access
the existing media scopes; Finance is limited to invoice/payment media;
Teknisi/Helper access assigned report-job media only. Unknown field-media
prefixes are denied, not guessed. Other field workflows and customer portals
still require compatibility testing before release.

The staff UI on `app.aclean.id` resolves images through the authenticated API,
even when a CDN base is configured. Protected responses use private/no-store.
The legacy cookie name is retained for staging compatibility; cookies are
host-only, not shared between production and staging.

## Customer portal photos (2 November 2026)

The customer, maintenance and project portals use `/api/portal-foto` with their
portal token. The server checks the token and compares the requested R2 key
against photos in the customer's VERIFIED service report, the maintenance
client's own logs, or the project's VERIFIED daily reports. Invalid, expired,
disabled or unrelated tokens cannot read an arbitrary object through this API.
The response is `private, no-store`. Staff media remains on `/api/foto` and
requires the staff media cookie on self-hosted production.

`status.aclean.id` must route to the same self-hosted app as `app.aclean.id`.
The self-hosted server serves only token portal paths, assets and portal API
routes on the status host. It does not expose the staff UI or other API routes
through that hostname. Once the status host has a valid certificate and the
portal plus a real photo load successfully, set the runtime variable
`STATUS_PORTAL_REDIRECT_READY=true` and restart the app to redirect old
`app.aclean.id/status/...` links there. Also set the existing
`customer_portal_url` application setting to `https://status.aclean.id` so
newly generated customer links use the dedicated hostname. Neither action
restarts the paused legacy Vercel project.

Production already stores `https://status.aclean.id` in `customer_portal_url`.
The application keeps generating `app.aclean.id` links until the runtime flag
is enabled; enabling it also allows the configured status hostname in new
customer and reminder links. The Settings screen displays the stored value.

Read-only incident evidence on 2 November 2026: the old status hostname
returned `503 DEPLOYMENT_PAUSED` from Vercel; the new app's customer-status
API returned 200 and four photo references, while anonymous `/api/foto`
returned 401. This established an API access mismatch, not missing images.

## Deliberate compatibility boundary

This patch protects **API reads/uploads**, not every copy of an R2 object.
Production upload response URLs retain their existing delivery format so
existing Fonnte attachments and external links are not silently broken.
Staging still returns only its private proxy URL.

**Existing public R2/CDN URLs remain public if the bucket/domain is public.**
Do not label this patch end-to-end private storage. Disabling the shared
production bucket or moving objects to a private bucket requires a separate
inventory of website assets, customer portals, WhatsApp attachments and old
links. Do not disable public access as a side effect of this deployment.

Validate with synthetic media in an isolated bucket and a full role matrix.
Do not test uploads by writing over real customer objects. Publish/deploy this
patch only with the configured production flag, and keep maintenance active
until runtime authorization and compatibility checks pass.
