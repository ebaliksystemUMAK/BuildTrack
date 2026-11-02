# Cloud infrastructure diagram, 23 October 2026

Added the Cloud Infrastructure tab to the existing paper Google Doc at the user's request. Tab ID: t.xwnl2r7el91k.

Figure CI-1 shows GitHub/Actions, Vercel asset hosting and SPA routing, browser execution and selected IndexedDB queue, direct browser-to-Supabase HTTPS/WSS traffic, Auth with administrator TOTP, PostgreSQL/RLS/RPCs, private Storage, Realtime and Edge Functions. External connections identify Google OAuth, the Brevo integration and the proposed AS608/ESP32 terminal.

Dashed paths explicitly distinguish unverified email delivery and unconnected/unvalidated physical hardware. The proposed VMware/Ubuntu server is not represented as current cloud infrastructure. No cloud region, plan, uptime, backup guarantee or successful physical device test is asserted. The public website could not be fetched through the research browser during this task, so the diagram relies on versioned deployment records and source; it is not a fresh live-service availability test.

Source checks: vercel.json, .github/workflows/ci.yml, src/lib/supabase.ts, src/lib/functions.ts, current development handover, deployed-navigation audit, email setup guide and official Vercel/Supabase documentation. Read-only inspection; no credentials or credential files read.

Formatting: Arial 12, double spacing, one-inch margins, bold figure number, italic caption title and a centered diagram. Exported the document and inspected the new tab's three rendered pages. Readback confirms the exact tab title and one native inline image. All mutation requests were confined to the new tab. An initial revision conflict was resolved by re-reading the document before creation; no concurrent user edits were overwritten.

Local artifacts: docs/paper/cloud-infrastructure.md, cloud-infrastructure.png, generate-cloud-infrastructure.ps1 and review-cloud-infrastructure.mjs. Review PDF/page renders remain local. No application/database changes, commit or push in this task.
