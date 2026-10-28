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

The self-hosted UI domains resolve images through the authenticated API,
even when a CDN base is configured. Protected responses use private/no-store.
The legacy cookie name is retained for staging compatibility; cookies are
host-only, not shared between production and staging.

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
