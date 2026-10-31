# 2026-11-01: Expand System settings and simplify Site photos

- Removed the Company setting card from Site photos and its local edit/reset/dirty state.
- Expanded Per-account choices to the full available width. All five System settings tab panels now use that width, and the Working hours time fields fill their two-column row.
- Renamed the dropdown's Follow company setting option to **Both**. Existing stored values and capture-policy enforcement are preserved; this is a display-label change, not a new database mode.
- Replaced company-switch help text and the photo-permission description with account-focused wording. The list count now reports matching accounts.
- Preserved staged account choices across tabs, unsaved indicators, confirmation and partial-save retry.

Verification: photo-settings regression suite, TypeScript and `pnpm build` pass. No SQL migration or Edge Function deployment is required for this layout/label change.
