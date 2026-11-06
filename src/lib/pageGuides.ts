import type { AdminPageKey } from "../pages/Admin/types"
import type { ClientPageKey } from "../pages/Client/types"
import type { EngineerPageKey } from "../pages/Engineer/types"
import type { ForemanPageKey } from "../pages/Foreman/types"
import type { PmPageKey } from "../pages/ProjectManager/types"
import type { UserPageKey } from "../pages/User/types"

// The "Page guide" shown from the top bar of every signed-in page (AppShell) and from the plan editor's View menu.
// Pure data: one short guide per page of each workspace. The Record types make TypeScript ask for a guide whenever a page key is
// added. Describe only what the page really does (no invented features); keep steps short and in the order people use them.
export type PageGuide = { title: string; purpose: string; steps: string[]; tips?: string[] }
export type GuidePersona = "admin" | "manager" | "engineer" | "foreman" | "client" | "user"

const calendar = (who: "staff" | "client"): PageGuide => ({
  title: "Project calendar",
  purpose: who === "client"
    ? "Work deadlines and project milestones of this project on one calendar."
    : "Work deadlines, QA inspections, reinspections, NCR deadlines and project milestones of this project on one calendar.",
  steps: [
    "Open Gantt Timeline for the schedule. Engineers propose work dates; the assigned Project Manager approves dates, phases and dependencies, then publishes the baseline for Clients.",
    ...(who === "staff" ? ["Gantt has separate Timeline, Pending requests, Unscheduled tasks and Request history tabs. Detailed rows show the pin/plan, Foreman, phase and dates; use View details to open the work and PM review actions to decide requests. Reasons are optional when approving or publishing a schedule."] : []),
    "Switch between Month, Week, Day and Schedule views, and move with the arrows or the small month picker.",
    "Turn the event types on or off and use \"Search this calendar\" to narrow the list.",
    "Open an event to see its details, then follow its link to the record or to its pin on the plan.",
  ],
  tips: ["Approved task dates appear on the task, the pin's overall schedule range, Calendar and Gantt. Proposed dates await PM approval. Reported progress is separate from Engineer QA verification.", "Gantt shows every day number under its month and year. Scroll horizontally for later dates; use Day, Week or Month zoom to change the spacing.", "Schedule requests notify assigned PMs, decisions notify the requester and assigned Foreman, and publication notifies project Clients. Email copies follow each person's email preferences and the scheduled sender."],
})

const fieldProjects = (role: "Engineer" | "Foreman"): PageGuide => ({
  title: "My projects",
  purpose: `The projects you are assigned to as ${role}, with what is waiting for you in each.`,
  steps: [
    "Open a project card. The sidebar then shows only that project's pages.",
    "Use \"All projects\" at the top of the sidebar to come back here and switch projects.",
  ],
  tips: ["A project you are not assigned to does not appear. Ask an Admin or the Project Manager if one is missing."],
})

const admin: Record<AdminPageKey, PageGuide> = {
  dashboard: {
    title: "Admin dashboard",
    purpose: "Live numbers for projects, people and quality across the company, and what is waiting for your decision.",
    steps: [
      "Start with the \"Needs your decision\" band: registrations, ID checks, access requests and data requests that wait. Click one to open it.",
      "Read the cards for projects, people and quality; click a card to open its page.",
      "Use the activity feed and its filter chips to see recent changes.",
      "While the \"Set up BuildTrack\" card is shown, follow its steps; they tick themselves from real data.",
    ],
  },
  "project-management": {
    title: "All projects",
    purpose: "Create and archive projects, appoint their Project Managers and view their teams. Project Managers run the day-to-day work in their own workspace.",
    steps: [
      "Create a project with its code, name and details.",
      "Set the project's site location (centre and radius). Photo location checks need it.",
      "View team shows the project team and its blueprint access. Project Managers add members and manage their access.",
      "Assign a primary and an optional backup Project Manager.",
      "Archive a project when the work is finished. It is kept with all its records and can be restored from the archive at any time. Use the Show filter for Open, Archived or the Recycle bin.",
      "An archived project can be removed: give a reason and type its code. It disappears for everyone, but nothing is deleted. The Recycle bin shows who removed it, when and why, and Restore brings it back archived.",
    ],
    tips: ["Membership alone opens no plans: each person needs access to the blueprint types they work on.", "Only a Super Admin can delete a project forever, after 30 days in the recycle bin and only if it holds no real records (work, inspections, reports, photos, attendance). Nothing expires on its own.", "A removed project keeps its code reserved, so no other project can take it."],
  },
  "user-management": {
    title: "User management",
    purpose: "Everyone's accounts, the review queue, access requests, the whitelist and (Super Admin) Admin permissions. What you can do depends on your permissions.",
    steps: [
      "All users: search and filter people, then edit, suspend, re-enable or create accounts.",
      "Review queue: click a registration or ID check to open its details. For a registration, choose the role in Approve as (Engineer, Foreman, Client or Project Manager) and approve it, or reject it with a reason. In the details, Previous / Next (keys J / K) move through the list and A / R approve or reject an ID check. Data erasure requests are decided here too.",
      "Access requests: approve or decline basic accounts asking for the Engineer, Foreman or Client role.",
      "Whitelist: pre-approve emails with a role (or import a CSV / TXT file); the role is given when the email is confirmed.",
      "Permissions (Super Admin): tick what each Admin may do, check the list of changes, then save.",
      "Delete account (Super Admin): open a person, press Delete account, read what will happen, then give a reason, type the phrase shown and enter a fresh code from your authenticator app.",
    ],
    tips: ["Critical actions ask you to confirm and are written to the audit log.", "You cannot change your own account or permissions here.", "Deleting an account never deletes what the person did: an account with work, quality, report or approval records is closed (name, email and photos wiped, records kept as \"Deleted account\"); only an account with no records at all is removed completely.", "A registration only reaches this queue after the person confirmed their email with a 6-digit code."],
  },
  invites: {
    title: "Invitations",
    purpose: "Invitation codes that give a field role, or the Project Manager role, to a basic account.",
    steps: [
      "Create a code: pick the role it gives and how long it stays valid.",
      "Share the code privately with the person.",
      "They redeem it on their My account page; you can see which codes were used.",
    ],
    tips: ["A Project Manager still needs an Admin to assign their projects."],
  },
  records: {
    title: "Records",
    purpose: "Remove a daily report, site issue or client report that should not be in the system, with a reason. It is hidden for everyone, not deleted, and you can restore it.",
    steps: [
      "Choose the kind of record, search for it and press Remove.",
      "Write the reason and type the confirmation shown (for example REMOVE SR-0001), then confirm.",
      "Open Removed records to see who removed what, when and why, and to restore one.",
    ],
    tips: ["Inspections, defect reports, attendance records and the audit log cannot be removed here.", "Every removal and restore is written to the audit log with your name.", "A record of a project in the recycle bin cannot be removed or restored until the project is restored."],
  },
  "access-messages": {
    title: "Access & messages",
    purpose: "Invitation codes, accounts that have not signed in for a while, and messages and announcements to people, as tabs of one page.",
    steps: [
      "Invitations: create a one-use or limited code that gives a role, and see who used it.",
      "Global access review: active accounts that have not signed in for the number of days set in Company Configuration. Switch off accounts that are no longer needed.",
      "Announcements & messages: send a message to chosen people or a whole role in the app, by email or both, and see what happened to each email.",
    ],
    tips: ["A tab appears only if your account has its permission (Review access requests, View users, Edit users).", "The site-wide banner is managed in System Control."],
  },
  "records-audit": {
    title: "Company Records and Audits",
    purpose: "The full audit trail of what happened in the system, and (Super Admin) the tool that hides a report from view and restores it.",
    steps: [
      "Company audit log: search and filter every recorded action, open an entry for its full details, and export what you see.",
      "Records (Super Admin): remove a daily report, site issue or client report with a reason, or restore one. Nothing is deleted.",
    ],
    tips: ["Audit entries cannot be edited or deleted.", "Administrator and system transactions are also listed, by category, in System Logs."],
  },
  "system-logs": {
    title: "System Logs",
    purpose: "What happened in the system and who did it (Super Admin only, read only): administrator and system transactions, the emails that were really sent, and locked codes.",
    steps: [
      "Transactions: account creation, approvals, role and status changes, settings, system controls and removals. Every entry has a reference, a time, who did it and to whom. Filter by category, search, or pick dates, and open an entry for everything recorded.",
      "Email delivery: how many notification emails were sent, failed or skipped, and the reason for each.",
      "Lockouts: sign-up and reset codes locked after wrong tries, invitation-code lockouts and blocked Google sign-ins.",
    ],
    tips: ["Plain work changes (a pin edited, a QA step saved) are in Company Records and Audits, not here.", "Wrong passwords at sign-in are kept by Supabase Auth: Supabase Dashboard, Authentication, Logs."],
  },
  "system-control": {
    title: "System Control",
    purpose: "The operating panel of the system itself (Super Admin only): health, maintenance and feature isolation, forced logout, the announcement banner, email and registration switches, who can open what, and a log of system actions. It never touches role work or records.",
    steps: [
      "Health: run the read-only checks, send yourself a test email and see storage sizes. Nothing is repaired for you.",
      "Maintenance & isolation: make non-admin accounts read-only with a message, or pause one feature for chosen roles. Schedule a window (Manila time) and maintenance switches on and off by itself. Forced logout is its own tab with a preview, a reason and a typed phrase.",
      "Announcement banner: write, preview and publish the banner shown on every page. Quick text fills a ready message such as New version available.",
      "Email: pause or resume notification emails. Registration: close or open new registrations with a message people will see. What was sent and who was locked out are in System Logs.",
      "Role access: see which role can open which workspace and Admin page, and edit each Admin's permissions. Every change you make here is recorded in System Logs.",
      "Switch everything off (top right) puts maintenance, feature pauses, registration and email back to normal in one step. It never signs anyone out.",
    ],
    tips: ["Admins, Super Admins and biometric devices are never restricted by maintenance or feature pauses.", "What each role may read or change inside the app is decided by the database rules and changes only with a migration; this page shows it and edits the Admin permissions.", "The older Site controls and System health addresses open the matching tab here."],
  },
  "site-controls": {
    title: "Site controls",
    purpose: "Pause saving during maintenance, pause one feature for chosen roles, or sign chosen non-admin accounts out. Everything starts off.",
    steps: [
      "Maintenance: write the message people will see and, if you know it, when you expect to be back, then switch it on. Non-admin accounts can still look at everything but cannot save until you switch it off.",
      "Feature isolation: pick the roles and a message, then pause just that feature. Other features and shared work keep working.",
      "Forced logout: choose roles (and optionally one project), preview who is affected, give a reason, then type the confirmation phrase.",
    ],
    tips: ["Admins, Super Admins and biometric devices are never restricted.", "Queued offline reports and photos are kept and sent after a pause or after the person signs in again.", "A sign-in token already issued can work for up to about an hour after a forced logout; suspend the account to stop it immediately.", "The return time is only information: maintenance stays on until you switch it off."],
  },
  "system-health": {
    title: "System health",
    purpose: "Read-only checks that tell a Super Admin whether the database, migrations, required schema, storage, email and scheduled jobs are working.",
    steps: [
      "Open the page: the checks run by themselves. Use Run checks again after the owner changes something.",
      "Read each result. Every problem or warning says what to do; nothing is repaired or re-run for you.",
      "Email test: send one test message to your own address. “Accepted” is the provider's answer; use Ask the provider to see whether it reports delivery.",
      "Daily admin digest: preview what each admin would be told. A preview creates and sends nothing.",
    ],
    tips: ["No secret is ever shown: email settings appear only as present or missing.", "Migration history is compared only for migrations since 18 Oct 2026; older ones are checked through the schema results.", "Switching on the digest schedule is the owner's step (SQL shown on the page)."],
  },
  communications: {
    title: "Announcements & messages",
    purpose: "Show a banner on every page, and send notices to people's notifications and inboxes.",
    steps: [
      "Banner (Super Admin): write a title and message, pick a tone, preview it, then publish. Edit it to show it again to people who closed the old one.",
      "Message: search for people or add a whole group, choose in the app, email or both, write the message and press Review and send.",
      "Check the audience summary, then confirm. Pressing Send twice never sends twice.",
      "Recent messages shows what happened to each email: sent, waiting, skipped or failed.",
    ],
    tips: ["Only active accounts receive messages. People who switched announcement emails off still get the bell message.", "A critical banner cannot be closed by readers, so keep it for real emergencies.", "Account and security notices are separate and always emailed."],
  },
  "access-review": {
    title: "Access review",
    purpose: "Active accounts that have not signed in for a while, so you can switch off the ones no longer needed.",
    steps: [
      "Check each listed account and its last sign-in.",
      "Disable the accounts that are no longer needed.",
    ],
    tips: ["The number of days is set in System settings > Access review.", "Administrators are never listed here."],
  },
  "audit-log": {
    title: "Audit log",
    purpose: "Every sensitive change: approvals, role changes, permissions, impersonation, invitation codes, settings and project edits.",
    steps: [
      "Search or filter to find a change.",
      "Open an entry to see who did it, when, and what changed.",
    ],
    tips: ["Entries cannot be edited or deleted."],
  },
  biometrics: {
    title: "Worker biometric registration",
    purpose: "Admin only: register workers, capture their portraits and enroll fingerprints through the connected sensor, and manage the devices.",
    steps: [
      "Add a worker to a project with their details and portrait.",
      "Enroll the worker's fingerprint with the connected sensor, following the on-screen instructions.",
      "Manage the scanner devices and the project's attendance schedule.",
    ],
    tips: ["Foremen and Project Managers only view attendance; registration stays with Admins."],
  },
  "qa-checklists": {
    title: "QC checklist library",
    purpose: "The company library of QC checklists every project can use.",
    steps: [
      "Open a checklist to see its items, hold points and the standards it cites, with their official documents where documented.",
      "Super Admin: create or edit company checklists. Built-in checklists are read-only.",
      "Engineers copy a checklist into their project and adapt it to that project's specification.",
    ],
    tips: ["The pass mark, item weights and the standards catalog are in System settings.", "New and edited QC checklists save drafts automatically in this browser, separately for your account and company/project. Reopen the same form to continue; Close keeps the draft and Discard draft clears it. Add item stays below the latest item."],
  },
  settings: {
    title: "Company Configuration",
    purpose: "Settings the whole product shares, grouped in tabs (quality scoring, working hours, standards, access review, site photos), and the company library of QC checklists. Everyone can read the settings.",
    steps: [
      "Pick a tab: Quality scoring, Working hours, Standards and codes, Access review or Site photos.",
      "Change the values and press Save on that card; a dot on a tab marks unsaved changes.",
      "Site photos: turn device photo uploads on or off for the company, and give single Foremen or Engineers their own rule.",
    ],
    tips: ["Only the Super Admin changes settings. Site photos can also be changed by an Admin with the Site photo rules permission.", "Every change is written to the audit log."],
  },
  backup: {
    title: "Full backup and export",
    purpose: "Download everything about one project in a single file.",
    steps: [
      "Pick the project.",
      "Start the export and wait until the file is ready: plans and revisions, pins with timelines and tasks, QC checklists and QA records, drawings, daily reports and photos.",
      "Store the file somewhere safe and private.",
    ],
    tips: ["Each export is recorded in the audit log."],
  },
  "project-overview": {
    title: "Project overview",
    purpose: "One project at a glance: who takes care of it and its team.",
    steps: ["Pick the project.", "Check its Project Managers, team members and details."],
  },
  "blueprint-upload": {
    title: "Blueprint management",
    purpose: "Upload plans by blueprint type and add revisions.",
    steps: [
      "Pick the project and the blueprint type.",
      "Choose a PDF or image file. A PDF expands into one card for each page.",
      "Label each PDF page, set its level or area, preview it if needed, and select the pages to upload as separate plans.",
      "For a revision, choose the PDF page that updates the existing plan, then upload it.",
    ],
    tips: ["CAD files (DWG / DXF) are not uploaded: export them to PDF or PNG first.", "Engineers and Foremen only see the types they are given in Team & access."],
  },
  "blueprint-mapping": {
    title: "Blueprint mapping",
    purpose: "Every sheet of a project with the pins and drawings placed on it, and how that work stands.",
    steps: ["Pick the project.", "Open a sheet to see its pins and their status."],
  },
  "blueprint-progress": {
    title: "Progress tracking",
    purpose: "Verified work per sheet and zone, against the planned schedule.",
    steps: ["Pick the project.", "Compare verified work with the plan per sheet and zone, and on the S-curve."],
  },
  "blueprint-version": {
    title: "Version control",
    purpose: "The history of every sheet. Each revision is kept as uploaded; a new one never overwrites an old one.",
    steps: ["Pick the project.", "Open a sheet to see its revisions and who uploaded them."],
  },
  calendar: calendar("staff"),
}

const manager: Record<PmPageKey, PageGuide> = {
  projects: {
    title: "My projects",
    purpose: "The projects an Admin assigned to you, as primary or backup Project Manager.",
    steps: ["Open a project. The sidebar then shows only that project's pages.", "Use \"All projects\" at the top of the sidebar to switch projects."],
  },
  dashboard: {
    title: "Project dashboard",
    purpose: "How the project is going: progress against the plan, deadlines, what waits for the Engineer's review and the quality issues still open.",
    steps: [
      "Start in Overview for the key figures and progress chart.",
      "Use Schedule & deadlines, QA, Team and Activity to see one section at a time. Schedule links to the project Calendar and Gantt; QA shows NCR totals; Team shows the people in charge; Activity shows recent changes.",
      "Open a card or a row to go to its page.",
    ],
  },
  details: {
    title: "Project details",
    purpose: "Dates, location, client details, status and the Engineer and Foreman in charge.",
    steps: ["Edit the fields you need.", "Save. Everyone on the project sees the change at once."],
    tips: ["Archiving a project and assigning Project Managers stay with Admins."],
  },
  team: {
    title: "Team & work access",
    purpose: "Who works on this project and what they may open or work on.",
    steps: [
      "Add or remove approved Engineers, Foremen and Clients.",
      "For each Engineer and Foreman, choose per blueprint type: No access, View only or Assigned work.",
      "Move work from one Foreman to another when needed.",
    ],
    tips: ["Changes ask for confirmation and are recorded in the project audit log."],
  },
  blueprints: {
    title: "Blueprints",
    purpose: "The project's plan sheets by blueprint type: uploads, revisions, the work mapped on each sheet and verified progress.",
    steps: [
      "Open a blueprint type, then a plan.",
      "Upload a new sheet or revision, or move a sheet to another type.",
      "Open a plan to view it. Plans open read-only for you: Engineers place and edit the work.",
    ],
    tips: ["Deleting a sheet stays with Admins."],
  },
  calendar: calendar("staff"),
  quality: {
    title: "Quality & QA",
    purpose: "Follow inspections, the project's QC checklists, NCRs and corrective work. Read-only.",
    steps: ["Check open inspections and NCRs and how late they are.", "Open a record to see its history and evidence."],
    tips: ["Engineers inspect, verify and close; Foremen correct."],
  },
  attendance: {
    title: "Project attendance",
    purpose: "Daily time records from the site scanners and the registered workers of this project.",
    steps: [
      "Pick a day to see each worker's Time in, Time out and status.",
      "Generate an attendance report for a day, week, month or date range.",
      "Flag anything that needs an Admin's attention.",
    ],
    tips: ["Worker registration, fingerprints and devices are managed by Admins."],
  },
  reports: {
    title: "Reports & export",
    purpose: "Daily site reports, progress, quality and attendance reports, and an export of this project only.",
    steps: ["Pick the report you need and its period.", "Print it or download the project export."],
  },
  audit: {
    title: "Project audit log",
    purpose: "Who changed what on this project and when, newest first. Read-only.",
    steps: ["Search for a person, record or action.", "Open an entry to see what changed."],
  },
}

const engineer: Record<EngineerPageKey, PageGuide> = {
  projects: fieldProjects("Engineer"),
  dashboard: {
    title: "Project dashboard",
    purpose: "What needs your decision on this project, and how it is going.",
    steps: [
      "Read the cards at the top: approved task progress, work to review, open issues, overdue work and QA to action. Click a card to open its page.",
      "Work through \"Needs your attention\": the most urgent items come first (repairs to verify, inspection requests, work waiting for review, issues, late work).",
      "Click an item to open it where you can act on it.",
    ],
  },
  calendar: calendar("staff"),
  "project-blueprint": {
    title: "Blueprints",
    purpose: "The project's plans, grouped by blueprint type.",
    steps: [
      "Open a blueprint type card (only types with plans are shown), then a plan.",
      "Use \"Upload plan\" to add a sheet; you pick its type.",
      "Open the editor to place and manage the work on the plan.",
    ],
    tips: ["You only see the types you have access to; Assigned work lets you edit, View only does not."],
  },
  annotation: {
    title: "Plan editor",
    purpose: "Place and manage the project's work on the plan sheets.",
    steps: ["Open the editor, then use View > Page guide inside it for the editor's own instructions."],
  },
  verification: {
    title: "QA register",
    purpose: "Manage inspections, verify NCR corrections, complete passed tasks and view completed work.",
    steps: ["Use the tabs: Overview, Inspections, NCR register and Client reports.", "Open an item to inspect, verify or send it back. Criteria saved from the Engineer task editor make Engineer inspection photos optional."],
  },
  qa: {
    title: "QA register",
    purpose: "Manage inspections, verify NCR corrections, complete passed tasks and view completed work.",
    steps: [
      "Overview: what waits for you and the defect trends.",
      "Inspections: start the inspection, then use Take photo on each criterion to capture, annotate and add inspection evidence. Upload photo is also available when allowed by the photo policy. Submitted evidence compares original and resubmitted photos before any QA decision. Engineer inspection photos are optional for criteria saved through the task editor. Record each result and complete the inspection. Each failed item raises an NCR for the Foreman.",
      "NCR register: verify submitted corrections and close the NCR, or send it back with a reason.",
      "Client reports: accept a client's report (it becomes an NCR) or decline it with a reason.",
      "When a task's inspection passed and its NCRs are closed, accept the task; the pin completes when every task is accepted.",
    ],
    tips: ["Hold points and critical items always fail the inspection when they fail.", "\"View only\" records belong to plan types where you have no Assigned work."],
  },
  checklists: {
    title: "QC checklists",
    purpose: "The QC checklists this project uses, with the standards they cite.",
    steps: [
      "Use \"Add from library\" to copy a company checklist into the project, then adapt it.",
      "Or create your own checklist with its items, hold points and cited standards.",
      "Open View to read a checklist's documentation and official sources.",
    ],
    tips: ["Only these checklists are offered when you set a task's criteria on the plan or request an inspection.", "Checklist drafts save automatically in this browser for your account and project. Reopen the same new/edit form to continue. Close keeps your draft; Save QC checklist or Discard draft clears it. Add item is below the latest item."],
  },
  "report-issue": {
    title: "Issue register",
    purpose: "Every problem found on site, how serious it is and how long it has been open.",
    steps: [
      "Filter the list and open an issue.",
      "Assign it, send it back to the Foreman with a note, or close it when it is fixed.",
      "Use Export CSV to share the list.",
    ],
  },
  progress: {
    title: "Progress by zone",
    purpose: "Approved tasks divided by all tasks, per zone and discipline, against the schedule.",
    steps: [
      "Choose a period (Today, This week, This month, Last month or your own dates) to see the progress made in it: tasks approved on those dates, progress at the end of the period and the change.",
      "Use Overview, Sheets & zones, Progress %, Chart, Deadlines and Approved tasks to view one section at a time. The period filter stays available across the tabs.",
      "Compare planned and verified progress on the S-curve, open a sheet from Sheets & zones, or export the zone figures as CSV. Approved tasks lists the Engineer approvals for the selected period.",
    ],
    tips: ["Progress made counts every work pin, with or without a due date.", "A pin completes after all its tasks are approved and its NCRs and inspections are clear."],
  },
  assignments: {
    title: "Assignment board",
    purpose: "All work pins of the project and the Foreman doing each one.",
    steps: ["Drag a work pin onto a Foreman to assign it, or back to Unassigned.", "Open a pin to see it on the plan."],
    tips: ["Only Foremen with Assigned work access to that plan type can take it.", "Unassigned work does not appear in any Foreman's task list."],
  },
  reports: {
    title: "Site logs and reports",
    purpose: "Daily reports from the Foreman, client questions and site visit requests, and printable progress reports.",
    steps: [
      "Read the Foreman's daily reports, with the progress reported for each task; reopen one if it needs changes.",
      "Answer client questions and confirm or decline site visit requests.",
      "Use Weekly report or the progress report to print a summary.",
    ],
  },
}

const foreman: Record<ForemanPageKey, PageGuide> = {
  projects: fieldProjects("Foreman"),
  dashboard: {
    title: "Dashboard",
    purpose: "Your work for today on this project.",
    steps: [
      "See your tasks, what was sent back and what waits for QA.",
      "Open a task to report it, add photos and submit it for QA Review.",
    ],
  },
  calendar: calendar("staff"),
  "daily-work": {
    title: "My work",
    purpose: "Your assigned work and its tasks (FLOOR, WALL…).",
    steps: [
      "Open a work item, then a task.",
      "Add photos as evidence for each task (Upload photos or Take photo).",
      "Submit the ready tasks for QA Review.",
    ],
    tips: [
      "If photo uploads are turned off, only Take photo works: take it at the project site with location turned on.",
      "Without signal, photos wait on the phone and are sent when you are back online.",
    ],
  },
  "daily-report": {
    title: "Daily progress report",
    purpose: "Record the work done on a date, and each task's progress and photos, all under one report.",
    steps: [
      "Pick the date, then press Add Task Progress. Filter by blueprint if you need to, and choose one of your assigned tasks (its pin fills in).",
      "Describe the work completed on the task. Its last submitted percentage before this date fills in automatically; type the new total completed. For example, increase 15% to 25% after another 10% of work. Add daily notes, issues and manpower as needed.",
      "Under the task, take photos (or upload several, if allowed), annotate them or add captions, and save them to the task.",
      "Press Add Task Progress again for each other task you worked on. All the entries stay on this one report.",
      "Save a draft during the day. Submit the report at the end of the day. It is read-only afterwards unless the Engineer returns it.",
    ],
    tips: [
      "The worker headcount comes from the project's biometric Time in records. Manpower is your own count for each task.",
      "Percentages are cumulative totals from 0 to 100. A saved draft keeps the total you entered. Official progress still comes from tasks the Engineer has approved.",
      "The client reads the work completed and the photos in the site logs. The notes, issues, manpower and percentages stay with the project team.",
    ],
  },
  "photo-documentation": {
    title: "Photo documentation",
    purpose: "Daily report and task photos of this project.",
    steps: ["Filter by date, sheet, pin or task.", "Open a photo to see its details, its time and place stamp and the linked work."],
  },
  "quality-control": {
    title: "QA requests",
    purpose: "Send tasks and stage / hold-point inspections to the Engineer for QA Review.",
    steps: [
      "Open an item and add photos.",
      "Submit it for QA Review. The Engineer records the inspection.",
      "Follow each request until the Engineer completes the task.",
    ],
    tips: ["QA requests need a connection; they are not queued offline."],
  },
  issues: {
    title: "Corrections",
    purpose: "Tasks sent back, corrections in review and completed tasks in one place.",
    steps: [
      "Open a returned task to see the reason and its NCRs.",
      "Fix the work, add new photos and remarks.",
      "Submit one correction package; the Engineer reinspects the full QC checklist.",
    ],
    tips: ["Only the Engineer closes an NCR and completes the task."],
  },
  "qa-workflow": {
    title: "QC checklist reference",
    purpose: "The QC checklists (measurements, material checks, workmanship) the Engineer inspects your tasks against.",
    steps: ["Open a checklist and use it to check your work before you submit it."],
    tips: ["This page is read-only; tasks are submitted from My work or QA requests."],
  },
  attendance: {
    title: "Workforce management",
    purpose: "Your crew's attendance for the day: Time in, Time out and status from the site scanners.",
    steps: [
      "Pick a day to see each worker's records.",
      "Open a worker to see their details and attendance.",
      "Generate an attendance report for a day, week, month or date range.",
    ],
    tips: ["Worker registration and fingerprints are handled by Admins."],
  },
}

const client: Record<ClientPageKey, PageGuide> = {
  projects: {
    title: "My projects",
    purpose: "Choose which assigned project to view in the Client portal.",
    steps: ["Search or filter your project cards, then open a project.", "Use that project's overview, plans, calendar, reports and communication.", "Choose All projects to return to your other projects."],
    tips: ["Only projects assigned to your account appear here. Each project's pages and messages stay in its own workspace."],
  },
  overview: {
    title: "Overview & progress",
    purpose: "How your project is going. Only work the engineer has checked and approved counts as done.",
    steps: [
      "Check the progress and the planned-versus-done chart.",
      "Open Weekly summary for a plain-language summary you can print.",
    ],
  },
  calendar: calendar("client"),
  blueprint: {
    title: "Blueprint & issues",
    purpose: "The project's plans with the work and issues placed on them. Read-only.",
    steps: ["Open a plan.", "Click a pin to see what it is and how it stands."],
  },
  ticket: {
    title: "Report a problem",
    purpose: "Tell the team about something that needs attention.",
    steps: [
      "Describe the problem in your own words and, if you can, link it to a place on the plan.",
      "Add up to four photos.",
      "Check your report and send it. The project engineer reviews it, and you can follow the repair here.",
    ],
    tips: ["You can send up to 10 reports a day, with at most 5 waiting for a decision."],
  },
  "site-logs": {
    title: "Site logs & media",
    purpose: "What happened on site each day, with the photos taken that day.",
    steps: ["Pick a day.", "Open a photo to see it full size."],
  },
  communication: {
    title: "Communication",
    purpose: "Ask the project engineers a question or request a site visit.",
    steps: ["Write your question, or request a site visit with its purpose, preferred date and time and number of visitors.", "Answers and confirmations appear here."],
  },
}

const user: Record<UserPageKey, PageGuide> = {
  home: {
    title: "My account",
    purpose: "Your account, and how to get access to project work.",
    steps: [
      "Verify your identity first, if you are asked to.",
      "Request elevated access: pick Engineer, Foreman or Client. An administrator approves or declines it.",
      "Or redeem an invitation code you received.",
      "Complete your profile and add a profile photo.",
    ],
  },
}

export const pageGuides: Record<GuidePersona, Record<string, PageGuide>> = { admin, manager, engineer, foreman, client, user }

const fallback: PageGuide = {
  title: "Page guide",
  purpose: "This page is part of your BuildTrack workspace.",
  steps: ["Use the sidebar to move between pages.", "Press Ctrl K to search or jump to any page."],
}

export function guideFor(persona: GuidePersona, page: string): PageGuide {
  return pageGuides[persona][page] ?? fallback
}

// The plan editor, which opens over the page; what it allows depends on the role (the database enforces it as well).
export function editorGuide(role: "engineer" | "foreman" | "client" | "admin", canEdit: boolean): PageGuide {
  if (role === "engineer" && canEdit) {
    return {
      title: "Plan editor",
      purpose: "Place and manage the work on this plan sheet.",
      steps: [
        "Choose a tool in the second row: Select, Add pin, Add note, Draw shape, Tape (sheet scale), Upload image or More.",
        "Click the selected plan to place a pin. Enter its title, proposed start, deadline and phase, and optionally choose an eligible Foreman before saving. Adding the pin saves its assignment and sends a PM approval request. The technical reason is optional. Missing or invalid fields receive focus.",
        "Details has Overview, Edit details and Schedule tabs. New tasks you add to a dated pin automatically receive their own PM requests using the sent pin schedule; PM approval makes dates official. Tasks & QC retains Engineer completion checks.",
        "Select a pin to change its status, lock it, open its details or delete it. Engineers can drag an unlocked pin with Select, or choose Move pin and click/tap its new location on this plan. Cancel or Esc leaves it in place; Undo restores its previous position. Moving needs Assigned work access on the latest plan revision. Select a drawing and drag a square corner to resize shapes, images, arrows, clouds or other strokes; Shift keeps drawing proportions. Text and symbols have their own size controls. In a photo's annotation editor, corner handles also resize shapes, drawings and text.",
        "Switch sheets with the sheet switcher or the pages bar; use Layers to order, hide or lock items.",
        "Undo with Ctrl+Z and redo with Ctrl+Shift+Z; export PNG / PDF from the top bar and compare revisions from View.",
      ],
      tips: ["The task and QC criteria form saves unfinished changes automatically in this browser, separately for your account and each project/pin/task. Close it, change pages or reopen the browser, then reopen the same form to continue. Save task creates the task; Discard draft removes the unfinished changes.", "Press ? for all keyboard shortcuts and Ctrl K for every command.", "Locked items can be selected but never move. Moving a pin after QA submission can require resubmission because its location is part of the inspection evidence.", "Each blueprint task shows its latest submitted Foreman percentage and report date. Engineer QA approval stays separate, including when 100% is reported."],
    }
  }
  if (role === "foreman") {
    return {
      title: "Plan editor",
      purpose: "See the plan and the work assigned to you, and report on it.",
      steps: [
        "Click a pin assigned to you to open its details.",
        "Report progress, add photos to its tasks and submit them for QA Review.",
        "Use the sheet switcher or the pages bar to change sheets.",
      ],
      tips: ["Only the Engineer places or edits work on the plan.", "Press ? for keyboard shortcuts."],
    }
  }
  return {
    title: "Plan viewer",
    purpose: role === "client" ? "The plan with the work placed on it. Read-only." : "The plan with the work placed on it. Read-only for you: Engineers place and edit the work.",
    steps: [
      "Zoom and move around the sheet; use the sheet switcher or the pages bar to change sheets.",
      "Click a pin to see its details and status.",
    ],
    tips: role === "admin" ? ["Admins with the Blueprints permission can upload or delete sheets."] : ["Press ? for keyboard shortcuts."],
  }
}
