# 2026-10-31: Site photos switch (device uploads on / off)

## Request

The request was for an Admin option that enables or disables photo uploads. When disabled, the daily progress report and evidence submission accept only photos taken with the camera, and the site location is required.

## What changed

- **Admin > System settings > Site photos.** One checkbox: "Allow uploading photos from the device (gallery or files)". Like every system setting, everyone reads it, only the Super Admin (with MFA) saves it, and each save asks for confirmation and is written to the audit log. Default: **on**, which is the behaviour before this change for evidence photos.
- **On:**
  - Daily progress report: **Take photo** and **Upload photo**. Before this change daily reports were always camera-only.
  - Task / correction evidence: **Upload photos** and **Take photo**.
  - Foreman QA / NCR evidence: unchanged file picker.
  - Every photo's time and position are recorded, and a photo away from the site is flagged but accepted, as before.
- **Off:**
  - Only the in-app camera (`components/CameraCapture.tsx`, a live video frame with no file fallback) is offered for daily report photos, task / correction photos and the QA / NCR photos a Foreman adds.
  - Location must be on, and the photo must be inside the project site radius (the 100 m GPS-accuracy allowance still applies). Projects without a site location cannot accept these photos until one is set in Project Management.
  - The screen warns right after the shutter (`sitePhotoProblem`), and the database refuses anything else (`enforce_photo_capture_policy`).
  - Engineers' own inspection photos and client / site-issue photos are not affected.
- **What each photo records:** whether it was taken with the in-app camera or chosen from the device (`capture_source`). The offline queue carries it for task photos taken without signal; the database checks it when the photo is sent.

## Files

- Migration `supabase/migrations/20261031120532_photo_capture_policy.sql` (doc `sql/20261031120532_photo_capture_policy.md`), SQL suite `99-…-photo-capture-policy.cases.mjs`.
- Pure rules: `src/lib/photoStamp.ts` (`distanceM`, `siteFlag`, `sitePhotoProblem`, mirrors SQL) and `src/lib/settingsModel.ts` (`allowDeviceUpload`). Both are tested in `pnpm test:lib`.
- Data: `src/lib/photoPolicy.ts` (`usePhotoPolicy`; switch + site cached for a minute and per device for offline use), `lib/dailyReportCapture.ts`, `lib/qa.ts` (`uploadQaPhoto` source), `lib/offlineQueue.ts`.
- UI:
  - `pages/Admin/SystemSettings.tsx` (Site photos card).
  - `components/DailyReportPhotos.tsx`.
  - `components/editor/PinParts.tsx` (`ChecklistUploadButton`, `PinPhotos`).
  - `components/qa/QaBits.tsx` (`EvidenceStrip`).
  - `components/issues/{IssuePhotoPicker,MarkupUploadDialog}.tsx` (`allowFiles`).
  - `components/CameraCapture.tsx` (renamed from `DailyReportCamera.tsx`, title / file name configurable).
- Tests: `scripts/test-qa-photo-markup.mjs` (camera-only and upload flows for all three paths) and `scripts/test-worker-camera.mjs` (renamed camera).

## Limits

- A browser cannot prove a picture came from a real camera, and a determined person can fake GPS. The live-camera rule and the database site check raise the bar; the stamp still records what the phone sent.
- The switch is read when a page opens (cached for a minute). A page left open keeps its buttons until it reloads, but the database applies the new rule immediately.
- Live check on 2026-10-31: 1 of 2 open projects has a site location. If the switch is turned off, the other project needs a site location first, or its Foremen cannot add these photos.
