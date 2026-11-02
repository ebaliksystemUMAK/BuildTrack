# Safety notes for this programming session

Use this file only for the current admin-feature phases. It is not a permanent project policy. Read it with CLAUDE.md once per session; reread only if either changes. The owner's latest instructions take priority.

- Work only on BuildTrack. Never access E-Balik or copy its project configuration.
- Enhance existing features instead of rebuilding them. Keep the design, working workflows and role responsibilities intact, especially PM project authority and Engineer QA authority.
- Preserve all existing local changes and untracked files. Other work may be in progress. Do not overwrite, reset, discard or revert changes you did not make.
- Do not change the paper, questionnaires, presentation, Google Docs, Sheets or Canva during these programming phases.
- Be especially careful with Supabase migrations. Preserve existing data, permissions, RLS, functions, triggers and relationships. Do not assume older migration records mean a feature is missing. Ask before anything destructive.
- Do not apply hosted migrations, deploy, delete stored files, revoke real sessions or send real messages without explicit approval. Verify the intended BuildTrack project before any approved hosted action.
- Never expose secrets or read, copy or modify .env files.
- Keep new privileged features secure on the backend. Preserve existing MFA and account/project access restrictions.
- Read only what the current phase needs. Avoid repeated scans, unrelated cleanup, unnecessary dependencies and duplicate documentation files.
- Test the affected behaviour and check for regressions. Distinguish existing failures from new ones. Report anything unverified honestly.
- Complete only the requested phase. Briefly report changes, checks, risks and any owner setup needed. Do not commit or push unless asked.

The owner may remove this temporary file when these phases are finished. Do not add it to Google Drive or automatically delete it.
