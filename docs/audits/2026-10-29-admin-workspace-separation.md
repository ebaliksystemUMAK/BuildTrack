# 2026-10-29 Admin and Project Manager workspace separation

The owner requested removing the Admin shortcut to the Project Manager workspace, keeping the Control center focused on project creation, manager assignment and company administration.

- Removed the Admin sidebar's Project operations entry and the per-project Open project operations button.
- `/pm/*` now accepts only `project_manager`, using `PM_WORKSPACE_ROLES` in RouteGuard. Direct visits by Admin/Super Admin follow the existing unauthorized-route redirect to `/admin/dashboard` before rendering PM content.
- Removed Admin oversight banners, alternate project-list copy and the Admin editing override from the PM UI access model. Assigned primary/backup PMs retain their workspace; archived projects remain read-only.
- All projects controls, including creating projects, manager assignment and archive/restore, are unchanged. Existing Admin project screens and backend administrative permissions are unchanged. No database migration or deployment is part of this UI change.

Verification: `pnpm test:project-manager` passed all 10 cases, including the route role list, refusal of non-PM roles, primary/backup access and archived/unassigned cases. `pnpm exec tsc --noEmit` passed. Production build passed with the bundle loader outside the sandbox (Vite's Windows resolver needs to spawn a process). The default runner failed loading CommonJS `picomatch` inside the sandbox; the full pre-push `pnpm check` subsequently passed outside the sandbox, including every model/UI suite, all 531 SQL cases and the standard production build. No build configuration or dependency files were changed.
