export function qaSubmissionMessage(done: number, total: number) {
  const opening = done === total && total > 0
    ? "Confirm that all required tasks are completed and the uploaded photos accurately show the work."
    : `This is a partial submission (${done}/${total} tasks complete). Confirm that the uploaded photos accurately show the current work. Remaining items must be completed before final verification.`
  return `${opening} The Engineer will inspect it against the approved drawings and project specifications.`
}

// A cancelled dialog must never invoke the write, including when used for resubmission.
export async function submitAfterConfirmation(confirm: () => Promise<boolean>, submit: () => Promise<void>) {
  if (!(await confirm())) return false
  await submit()
  return true
}
