// Which photo buttons a person gets (20261031120532 + 20261031123546). Pure; mirrors SQL enforce_photo_capture_policy, which is
// what really decides. Tested in `pnpm test:lib`.
//   rule: the person's own choice set in System settings (null = follow the company switch photos.allow_device_upload)
//   kind: "field" = daily report and work item / correction photos; "qa" = QA / NCR evidence photos
export type PhotoRule = "allow" | "camera_only"
export type PhotoKind = "field" | "qa"

// true = only in-app camera photos taken at the project site are accepted. companyAllows null = not known yet.
export function cameraOnlyFor(kind: PhotoKind, companyAllows: boolean | null, rule: PhotoRule | null, role: string | null | undefined): boolean {
  if (rule === "allow") return false
  if (rule === "camera_only") return true
  if (companyAllows !== false) return false
  return kind === "field" || role === "foreman" // without a choice of their own, only a Foreman's QA photos follow the switch
}

// Field photos: true = offer "Upload", false = camera only, null = not known yet (upload hidden until it is).
export function fieldUploads(companyAllows: boolean | null, rule: PhotoRule | null): boolean | null {
  if (rule) return rule === "allow"
  return companyAllows
}

export const photoRuleLabels: Record<PhotoRule | "company", string> = {
  company: "Both",
  allow: "Allow uploads",
  camera_only: "Camera only (at site)",
}
