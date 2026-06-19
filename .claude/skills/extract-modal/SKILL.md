---
name: extract-modal
description: Extract an inline modal from the monolithic App.jsx into its own component file under src/, wiring props/state/handlers correctly. Use when the user wants to refactor a modal out of App.jsx, continue the sfm-modal-batch refactor, or reduce App.jsx size. App.jsx is ~13k lines with ~20 inline modals.
---

# Modal Extraction Helper

Continue the ongoing refactor (branch `refactor/sfm-modal-batch-*`) of pulling inline
modals out of `src/App.jsx` (~13k lines) into dedicated components. Recent commits
33c50dc and eeb0f05 show the established pattern: extract to a new file, pass state via
props, keep behavior identical.

## Steps

1. **Locate the modal** in App.jsx. Identify its full JSX block, the state it reads
   (open flag, form fields, the record being edited), and every handler/callback it
   calls (save, close, delete, sendWA, etc.).

2. **Decide the file location.** Modal components go in `src/components/` (small,
   reusable) or alongside related views. Match where the last batch (BrainCustomerModal,
   EditInvoiceModal, InvoicePreviewModal — commit 33c50dc) placed them. Check that
   commit first to mirror the convention exactly:
   ```bash
   git show 33c50dc --stat
   ```

3. **Create the component file** as a named function component that receives via props:
   - the `open`/visibility flag and an `onClose` callback,
   - the data record(s) it renders,
   - every handler it invokes (do NOT reach into App.jsx internals — pass them in),
   - `cs` (the theme object from `src/theme/cs.js`) — styling is inline JS objects,
     no CSS framework. Pass `cs` as a prop or import it directly as other components do.

4. **Wire it back in App.jsx**: import the new component, replace the inline JSX block
   with `<TheModal open={...} onClose={...} ...handlers />`. Keep the state declarations
   in App.jsx (this batch extracts the *view*, not necessarily the state) unless the
   user asks to colocate state.

5. **Preserve behavior exactly** — same fields, same validation, same WA/DB calls.
   This is a pure refactor. Do not "improve" logic in the same pass.

6. **Verify it builds**:
   ```bash
   npm run build
   ```
   Fix any unresolved imports / undefined props. The build must pass before done.

7. **Report** the line count removed from App.jsx (the refactor's whole point) and list
   the props the new component now requires.

## Guardrails
- No tests exist for these (except `src/lib/__tests__`), so the build + a careful diff
  ARE the safety net. Read the inline block fully before deleting it.
- Don't batch unrelated modals in one commit — one modal (or one cohesive group, like
  the last batch's 3) per commit, matching the existing history.
- Respect role-access guards: if the modal was conditionally rendered behind a
  `canAccess`/`currentUser.role` check, keep that guard at the call site in App.jsx.
