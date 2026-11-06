# BuildTrack: Panel Defense Cheat Sheet

Prepared from the current application source and local research drafts. These are practice answers, not completed evaluation findings. Confirm research details against the latest approved manuscript before the defense.

## 30-second introduction

BuildTrack is a construction progress and quality assurance platform developed for Valencia Construction Services. It connects work tasks to pins on uploaded 2D blueprints, allowing Foremen to report work and submit evidence, Engineers to inspect and verify tasks, Project Managers to manage the team and schedule, and Clients to view authorized project updates. Its central principle is that reported work and verified completion are different: official progress increases only when tasks meet the Engineer's completion requirements.

## Purpose and contribution

### 1. What problem does BuildTrack address?

It addresses the difficulty of following construction progress when plans, daily reports, photographs and inspection findings are kept in separate records. BuildTrack connects these records to a project and mapped work location so authorized users can follow the task, its evidence, responsible person and decision history.

### 2. What is your main objective?

Our objective is to provide one platform for plan-based progress monitoring, quality assurance logging and project workforce records, with access appropriate to each user's role. We will assess its usefulness through documented functional tests and user evaluation.

### 3. Who benefits from the system?

Valencia Construction Services is the intended beneficiary. Administrators manage company access, Project Managers coordinate assigned projects, Engineers verify work, Foremen report site activity, and Clients follow their authorized project information.

### 4. What is the main contribution of your project?

The contribution is the connected workflow: an assigned task has a mapped location, evidence, inspection, corrections and verified completion record. These records also support progress views, reports and project oversight. We do not claim to be the first construction platform with these individual features.

### 5. Why not use spreadsheets and group chats?

Those tools can record information, but users must manually connect a message or photograph to the correct plan, task, inspection and decision. BuildTrack provides those links and controls who can perform each action. Any claimed improvement in reporting time still needs measurement.

### 6. Why use 2D mapping instead of 3D BIM?

The current scope uses uploaded 2D plans and location-linked work records. This supports monitoring without requiring a complete 3D model. BIM integration could be future work; the current system is not a full BIM or CAD authoring tool.

## Roles and project setup

### 7. What is the difference between an Admin, a Project Manager and an Engineer?

The Admin creates and archives projects and assigns Project Managers. The Project Manager manages the assigned project's details, team, work access and schedule. The Engineer handles technical work records, inspection decisions, NCR review and task completion. The separation makes responsibility identifiable.

### 8. What does the Foreman do?

The Foreman opens assigned work, records daily progress, adds photographs, submits tasks for QA review and corrects returned work. The Foreman cannot approve their own task as verified completion.

### 9. Why is the Foreman's page called Tasks rather than QA Requests?

The page includes assigned tasks that have not been submitted, tasks awaiting inspection and completed tasks. Tasks describes the entire page more accurately. Submitting for QA Review remains a specific action within the workflow.

### 10. What can Clients access?

Clients can view their assigned projects, verified progress, authorized plans, submitted site reports and published schedules. They can ask questions, request site visits and report problems. Client access does not give general access to internal workforce or QA records.

### 11. Who uploads blueprints?

Admins with Blueprint Management permission and authorized Project Managers can upload plans. Engineers can upload plans and revisions for blueprint types where they have Assigned work access. Foremen do not upload blueprints.

### 12. Does adding someone to a project automatically give access to every plan?

No. Engineers and Foremen also need the appropriate access for each blueprint type: No access, View only or Assigned work. This allows the project team to limit technical work to the relevant people.

### 13. Who sets the schedule?

The Admin form can capture overall start and end dates, and the Project Manager can maintain them in Project Details. For detailed work schedules, Engineers propose dates and the Project Manager reviews, approves and publishes them. The Project Manager can also save official task schedules directly.

### 14. What happens when a blueprint changes?

A new revision is added rather than overwriting the previous uploaded file. Revision history helps the team identify which drawings and records were used. A new drawing still needs human review; the system does not automatically confirm that existing task locations remain correct.

## Progress and quality assurance

### 15. What is the difference between a pin and a task?

A pin identifies work at a location on a blueprint, such as a bedroom. The pin can contain individual tasks, such as flooring or wall work. Each task can have its own QA evidence and completion state.

### 16. How is official progress calculated?

Official progress is the number of Engineer-approved tasks divided by the total number of work tasks, multiplied by 100. For example, 8 approved tasks out of 10 gives 80%. A task must be marked done and verified; notes are excluded from work-task totals.

### 17. Are all tasks equally weighted?

Yes, the current progress calculation counts tasks equally. It is a task-completion measure, not a cost-, quantity- or labor-weighted measure of physical construction. Consistent task breakdown matters. Weighted progress would require an agreed measurement basis and is a possible enhancement.

### 18. What if the Foreman reports 100% completion?

That is the Foreman's reported progress. It does not automatically become official verified progress. The Engineer must inspect the work and complete the task after the required QA and NCR conditions are satisfied.

### 19. What is the difference between Submitted, Passed and Completed?

Submitted means the Foreman sent the work for inspection. Passed means the inspection passed its criteria. Completed means the Engineer explicitly completed the task after passed QA and closure of its linked NCRs. Passing an inspection alone does not automatically complete the task.

### 20. What is an NCR?

NCR means Nonconformity Report. It records a finding that does not meet the relevant requirement and connects it to correction and verification. The Foreman submits corrective work, and the Engineer reviews the result and closes the NCR when appropriate.

### 21. What is your QA based on?

QA checks should be based on the project's approved drawings, specifications and applicable inspection requirements. The Engineer provides the criteria and records the inspection decision. BuildTrack organizes and retains the checklist, evidence and results; software alone does not establish construction compliance.

### 22. How do you calculate an inspection score?

The score is the total weight of passed checks divided by the total weight of applicable checks, multiplied by 100. Not-applicable checks are excluded. Failed critical or hold-point checks prevent an acceptable result even when the overall score is high. Task completion still requires passed inspection and closure of applicable linked NCRs.

### 23. Can BuildTrack automatically judge construction quality from a photograph?

No. Photographs provide supporting evidence. The Engineer interprets the evidence and performs the inspection. Automatic image-based quality assessment would need a separate validated model and suitable reference data.

### 24. How do you prevent evidence from being changed after submission?

The workflow locks submitted evidence and retains original submissions and correction attempts. New correction evidence is recorded separately so the Engineer can compare attempts. This supports traceability but cannot prove that a photograph truthfully represents every site condition.

### 25. Does GPS or a QR code prove a person was physically on site?

No. A QR code helps open the correct work record. Photo coordinates and time checks provide context and can flag concerns, but device accuracy, availability and possible manipulation remain limitations. The Engineer's verification is still necessary.

### 26. What does the S-curve show?

It compares cumulative planned task completion with cumulative verified task completion. The planned curve counts tasks due by each date, while the verified curve counts approved tasks by their verification dates. It is a task-based schedule view, not an earned-value cost calculation.

### 27. Can tasks complete while NCRs remain open?

A task cannot be completed while its linked NCRs remain open or its required inspection has not passed. The whole work pin also has completion conditions covering its tasks and applicable inspections and NCRs. The system checks these conditions before accepting completion.

## Technology, reliability and workforce records

### 28. What technologies did you use, and why?

The interface uses React, TypeScript, Vite and Tailwind CSS. The backend uses Supabase authentication, PostgreSQL, file storage, live updates and server functions. This supports a browser-based application with shared project records and database-enforced permissions. The technology choice does not by itself prove performance or security; those require testing.

### 29. How do you protect project access?

The interface provides role-appropriate actions, while database policies and server functions enforce the actual permissions. Checks include the user's role, project membership, relevant blueprint access and the requested action. Hiding a button is not the only control.

### 30. Can users access another project by changing its URL?

Changing a URL does not grant access. The backend must still authorize the project and record. We test this with accounts that have different roles and project assignments, including direct unauthorized requests.

### 31. Does the whole application work offline?

No. Selected progress actions, daily reports and pin-photo submissions can be queued locally using IndexedDB and attempted after reconnection. This does not make every plan or record available offline. QA decisions and schedule actions require a connection.

### 32. What if a queued submission is rejected after reconnecting?

The application distinguishes a connection problem from a server refusal. Network failures can be retried, while permission or validation failures are shown for attention. A queued item is not described as successfully saved until the server accepts it.

### 33. How does biometric attendance work?

The intended terminal uses an AS608 fingerprint sensor and an ESP32 controller. After a match, the controller submits an authenticated attendance event, and the backend links it to the enrolled worker and project. Worker attendance profiles are separate from website user accounts.

### 34. Have you proven that the physical fingerprint terminal works?

The repository documents implemented attendance software and receiver logic, but the reference firmware still requires physical hardware acceptance testing. We must present actual enrollment and scan results before claiming operational hardware performance. Simulated events do not prove fingerprint recognition accuracy.

### 35. Do you store fingerprint images in the website?

The intended design keeps fingerprint templates in the sensor. The backend stores worker mappings, enrollment states and attendance events rather than fingerprint images. The physical setup must be verified against this design during acceptance testing.

### 36. Is attendance a payroll system?

No. Attendance provides project time records and schedule-related indicators such as late arrival. The current attendance reports do not calculate wages, overtime pay or payroll deductions.

### 37. Can the system prevent all fraud or guarantee security?

No. Access restrictions, evidence retention, audit history and device credentials reduce specific risks and improve accountability. They do not eliminate stolen accounts, compromised devices, false site evidence or human collusion. We describe the controls tested and their remaining limits.

### 38. What happens if records are accidentally removed?

The system supports archiving and recoverable removal for defined records and projects, with audit history. Project exports provide another recovery resource, but they are not automatically a complete backup of every newer module. Restore coverage must be checked in an isolated test, and restoration currently needs an authorized developer.

## Methodology, testing and difficult questions

### 39. What development methodology did you use?

The local methodology draft describes iterative and incremental development. Related features are developed in manageable groups, tested against requirements and revised when defects or workflow conflicts are identified. The final explanation should match the latest approved manuscript.

### 40. How will you evaluate the system?

The draft evaluation uses assigned role-based tasks, functional and technical checks, and a researcher-developed questionnaire covering functional suitability, performance efficiency, interaction capability, reliability and security. Adviser review, participant details and the evaluation procedure must be confirmed before formal collection.

### 41. How many respondents do you have, and what are the results?

The local drafts do not establish a final respondent count or completed evaluation results. We will report only the actual approved participant count, completed sessions and collected responses. We will not invent satisfaction scores or performance improvements.

### 42. How will you analyze questionnaire responses?

The draft proposes frequencies, percentages, mean ratings and standard deviation where appropriate. Missing and not-observed answers are excluded rather than treated as neutral. Functional pass/fail records and measured response times are reported separately from opinion ratings.

### 43. How do you test the software?

The repository includes TypeScript checks and automated tests for application rules, project access, QA transitions, schedules, evidence handling and database permissions. Manual role-based scenarios, user evaluation and physical hardware tests provide different evidence. We should show the output for the specific build tested rather than claim every test currently passes.

### 44. Is your system ISO certified?

No. The research drafts use selected software-quality characteristics and security references to organize evaluation. This is not certification. We must support any claim with the actual scope, procedures and evidence in the approved study.

### 45. Have you proven that BuildTrack reduces delays or improves construction quality?

Not from implementation alone. The connected workflow is designed to support timely reporting and traceable decisions. Demonstrating fewer delays, less rework or faster reporting would need a defined comparison and actual data.

### 46. What are the main limitations?

Current limitations include partial offline support, equal task weighting, reliance on human inspection, unvalidated physical biometric hardware in the repository record, and recovery coverage that requires verification. Formal user-evaluation results are also not established in the local drafts.

### 47. What future improvements would you prioritize?

We would prioritize physical biometric validation, user acceptance testing and documented recovery tests. Other improvements could include weighted progress, stronger offline capabilities and location search with an adjustable map pin. Location search was discussed as a recommendation and has not been implemented in this conversation.

### 48. What if a panelist identifies a missing feature?

We would clarify the intended requirement and show the current behavior. If it is within the approved scope, we would record it as an implementation gap and explain the correction and verification needed. If it is beyond the scope, we would explain the tradeoff and document it as a possible enhancement.

## Suggested demonstration sequence

1. Admin: create a project and assign its Project Manager.
2. Project Manager: set up team and blueprint access; open the schedule.
3. Engineer: open a blueprint, identify a pin and its task, and show QC criteria.
4. Foreman: open Assigned tasks, add evidence and submit for QA Review.
5. Engineer: record inspection results; demonstrate an NCR and correction if time permits.
6. Engineer: explicitly complete an eligible task after passed QA and closed linked NCRs.
7. Client: show the resulting verified progress and published schedule.

Use prepared test accounts and records. Present physical biometric attendance as a separate demonstration only after real hardware validation.

## Five answers to memorize

- Reported progress is the Foreman's report; verified progress requires Engineer-approved tasks.
- Submitted, Passed and Completed are separate states.
- The Project Manager coordinates; the Engineer makes technical QA decisions; the Foreman performs and reports work.
- BuildTrack records and supports inspection; photographs do not automatically determine quality.
- Implemented software, physical hardware validation and completed user evaluation are different types of evidence.

## Local reference notes

The current application code takes priority where older prose conflicts with behavior. In particular, official progress is task-based, the Foreman's page is Tasks, and the Project Manager role has been restored from the temporary PIC label.

- `src/lib/taskProgress.ts`: official task-progress calculation.
- `src/lib/progress.ts`: planned versus verified S-curve.
- `src/lib/workItemModel.ts`: task stages and completion gates.
- `src/lib/qaModel.ts`: inspection scoring preview.
- `src/lib/pageGuides.ts`: role-specific workflows.
- `src/lib/blueprintTypes.ts`: blueprint-type upload and work access.
- `src/pages/Admin/ProjectManagement.tsx`: current project-creation fields.
- `src/lib/offlineModel.ts` and `src/lib/offlineQueue.ts`: selected offline operations.
- `hardware/esp32-as608/README.md`: hardware implementation and verification limits.
- `docs/paper/chapter-3-methodology-revision.md`: working methodology draft, not a complete current manuscript.
- `docs/paper/buildtrack-evaluation-questionnaire.md`: draft instrument and pending evaluation details.
