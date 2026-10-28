// Submission never closes an NCR. Its own signed-off reinspection Pass enables automatic closure.
export function correctionCloseProblem(attemptId: string | null | undefined, status?: string | null, error = "", loading = false, findingPassed = false): string {
  if (!attemptId) return "" // Standalone findings retain their existing explicit Engineer verification workflow.
  if (error) return "Reinspection information is unavailable. Retry before closing the NCR."
  if (loading || !status) return "Checking the linked reinspection before NCR closure."
  if (findingPassed && ["passed", "failed", "conditional"].includes(status)) return ""
  if (["passed", "failed", "conditional", "cancelled"].includes(status)) return "This finding has no currently valid signed-off Pass in its linked reinspection. Resolve any failed or pending recheck before closure."
  return "Finish the linked reinspection and record a Pass for this finding before closing the NCR."
}
