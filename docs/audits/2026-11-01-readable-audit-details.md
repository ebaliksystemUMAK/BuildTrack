# Readable company audit details

Verified 2026-11-01 against BuildTrack only (`ruimjlhsfpaezkgfphsz`).

The viewer previously printed raw JSON. `get_audit_log` cut it at 400 characters, frequently producing invalid JSON, while the shared table kept cells on one line. Most older update entries saved only an after-row snapshot, so genuine previous values cannot be reconstructed.

The RPC now returns a complete sanitized details envelope and resolves related project, blueprint, pin, task, inspection, report and account names. Search includes those names; action/date filters and stable pagination remain. Private lookup helpers remain unavailable to API roles. Credentials and biometric identifiers are excluded from expanded display/search; stored history is untouched. Generic row/project audit triggers preserve their row payload and add the real old row for future updates.

The shared Admin/Super Admin page presents wrapping summaries, a full-details dialog and readable CSV for loaded entries. It distinguishes recorded values from genuine recorded changes and identifies related names as current reference labels. Action names are readable across the shared activity-label consumers. Filter changes invalidate old requests so delayed pages cannot overwrite new results.

Verification:

- Full `pnpm check` passed: TypeScript, all frontend suites, 558 SQL cases and production build. New page tests exercise full remarks, dialog, CSV quoting, pagination, Manila date bounds, permission errors and delayed-response races.
- Local load test: 50 sheets, 5,000 pins, 300 inspections, 500 NCRs through the real triggers; complete 100-entry audit page median 87.1 ms, related-name search median 143.8 ms in PGlite (network excluded).
- Initial Windows deployment decoded the UTF-8 separator incorrectly. The applied first migration artifact records that exact deployment; the small follow-up corrects only the two display function sources. SQL cases passed again after both migrations, and final six-function body hashes match the intended tested sources.
- Live authenticated/MFA read resolved LAUNDRY, DINING AREA, CR and CR-FLOOR and returned complete entries up to 10,891 characters in the checked page. Related-name search returned correctly encoded results.
- Original audit IDs through 580: 335 records; before/after fingerprint `7298c62c3e1baaf98104a5383770e669`. No history rewrites or account/permission changes.
- Empty function search paths retained. Only authenticated may execute the users.view/MFA-gated viewer; new helpers and internal triggers remain inaccessible to anon/authenticated.
- Security advisor findings have no additions/removals: 4 existing RLS-without-policy info notices, 120 existing authenticated-definer warnings and 1 existing Auth password-protection warning.

Applied migrations: `20261031170819_readable_audit_details` and `20261031171048_audit_label_encoding`. Local filenames match hosted history. No Edge Function or frontend hosting deployment was needed/performed; the local Vite preview uses the updated frontend.
