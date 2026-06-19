---
name: role-access-check
description: Verify role-access consistency between canAccess()/canEdit guards in App.jsx + views and the Role Access table in CLAUDE.md, detecting any leak of Admin access to Owner-only features (pricelist, settings, monitoring, statistik, finance, deleted audit). Use when the user adds a menu/view, changes a role guard, or wants to audit access control.
---

# Role Access Verifier

Audit that the app's runtime access guards match the authoritative **Role Access table**
in CLAUDE.md. Hierarchy: **Owner > Admin > Teknisi > Helper**. Getting this wrong has
real consequences — Admin must never reach Owner-only screens.

## Authoritative rules (from CLAUDE.md — re-read it, it's the source of truth)

Owner-only (Admin BLOCKED): **Price List edit, Settings, Monitoring, Statistik (reports),
Deleted Audit, Finance.** Finance role gets the Biaya menu + expenses CRUD (migration 096).
Teknisi/Helper: Dashboard, Jadwal, Laporan Saya only. Delete operations in views
(order/invoice/customer) are generally **Owner only** — Admin = input & edit, NO delete.

> Note: the two CLAUDE.md files disagree slightly on Statistik/Deleted Audit for Admin.
> The **workspace** `/Users/dedyrinaldi/VSC ACleanWebapp/CLAUDE.md` is newer (lists them
> Owner-only + Finance role). When they conflict, prefer the workspace file and flag the
> discrepancy to the user.

## Audit steps

1. **Read the Role Access table** in the workspace `CLAUDE.md` to load the intended matrix.

2. **Find `canAccess()`** in `src/App.jsx` — this is the central menu guard. List every
   menu key and the roles it permits. Compare against the table cell-by-cell.

3. **Find per-view edit/delete guards** — e.g. `canEdit` in `PriceListView`
   (must be Owner only), delete buttons in OrdersView/InvoiceView/CustomersView
   (must be Owner only), SettingsView toggles (Owner only). Grep for `currentUser.role`,
   `canEdit`, `canAccess`, `role ===`, `role !==` across `src/views/` and `src/App.jsx`.

4. **Report a matrix**: feature → intended roles (CLAUDE.md) → actual guard (code) →
   MATCH / MISMATCH. Flag as findings:
   - **CRITICAL**: Admin (or lower) can reach an Owner-only feature, or a view lacks any
     guard while the menu is gated (defense-in-depth gap — guard both the menu AND the
     view, since the menu guard alone is bypassable).
   - **HIGH**: delete buttons visible to Admin where rule says Owner-only.
   - **INFO**: CLAUDE.md table out of date vs. an intentional code change (e.g. Finance
     role not yet listed in the role table).

5. **When changes are needed**, do NOT widen Admin access without explicit Owner
   confirmation — that's a hard rule in CLAUDE.md. Tighten (fail closed) freely; widen
   only after asking.

6. **RLS layer**: frontend guards are not security on their own. For Owner-only data,
   confirm there's a matching RLS policy (the Finance/expenses gap in migration 096 was
   exactly a UI-allowed-but-RLS-blocked mismatch — check both directions: UI-allowed +
   RLS-blocked = silent empty; UI-blocked + RLS-open = real leak via direct anon query).

## Output
End with a short verdict: PASS (all guards match) or a numbered findings list ranked by
severity, each citing the file:line of the guard and the conflicting CLAUDE.md rule.
