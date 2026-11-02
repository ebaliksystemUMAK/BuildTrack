import type { Profile } from "./auth"
import { supabase } from "./supabase"

// ---- Profile completeness ----
export type CompletenessItem = { key: string; label: string; done: boolean }

export function profileCompleteness(profile: Pick<Profile, "full_name" | "phone" | "company" | "position" | "avatar_url"> | null) {
  const filled = (value: string | null | undefined) => Boolean(value && value.trim().length > 1)
  const items: CompletenessItem[] = [
    { key: "full_name", label: "Full name", done: filled(profile?.full_name) },
    { key: "avatar_url", label: "Profile photo", done: filled(profile?.avatar_url) },
    { key: "phone", label: "Phone number", done: filled(profile?.phone) },
    { key: "company", label: "Company or organization", done: filled(profile?.company) },
    { key: "position", label: "Job title", done: filled(profile?.position) },
  ]
  const done = items.filter((item) => item.done).length
  return { items, percent: Math.round((done / items.length) * 100), missing: items.filter((item) => !item.done) }
}

// ---- Profile photo ----
const AVATAR_TYPES = ["image/png", "image/jpeg", "image/webp"]
const AVATAR_SIDE = 384

// Centre-crops to a square and shrinks, so the stored file is small (the bucket allows 2 MB).
async function squareBlob(file: File): Promise<Blob> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error("That picture could not be read. It may be damaged.")
  }
  const side = Math.min(bitmap.width, bitmap.height)
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = Math.min(AVATAR_SIDE, side)
  const context = canvas.getContext("2d")
  if (!context) throw new Error("Your browser cannot prepare the picture.")
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, canvas.width, canvas.height)
  bitmap.close?.()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.88))
  if (!blob) throw new Error("Could not prepare the picture.")
  return blob
}

export function validateAvatarFile(file: File | null | undefined): string {
  if (!file) return "Choose a picture."
  if (!AVATAR_TYPES.includes(file.type)) return "Use a PNG, JPEG or WebP picture."
  if (file.size === 0) return "That file is empty."
  if (file.size > 15 * 1024 * 1024) return "That picture is larger than 15 MB."
  return ""
}

// Stores the photo in the person's own folder and saves its public link on the profile. Returns the new link.
export async function uploadAvatar(userId: string, file: File): Promise<string> {
  const problem = validateAvatarFile(file)
  if (problem) throw new Error(problem)
  const blob = await squareBlob(file)
  const path = `${userId}/avatar-${Date.now()}.webp`
  const { error } = await supabase.storage.from("avatars").upload(path, blob, { contentType: "image/webp", upsert: false })
  if (error) throw new Error(error.message)
  const url = supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl
  const { error: saveError } = await supabase.from("profiles").update({ avatar_url: url }).eq("id", userId)
  if (saveError) throw new Error(saveError.message)
  // Old photos are not needed any more; failures here are harmless.
  const { data: old } = await supabase.storage.from("avatars").list(userId)
  const stale = (old ?? []).filter((entry) => `${userId}/${entry.name}` !== path).map((entry) => `${userId}/${entry.name}`)
  if (stale.length) void supabase.storage.from("avatars").remove(stale)
  return url
}

export async function removeAvatar(userId: string): Promise<void> {
  const { error } = await supabase.from("profiles").update({ avatar_url: null }).eq("id", userId)
  if (error) throw new Error(error.message)
  const { data: old } = await supabase.storage.from("avatars").list(userId)
  const all = (old ?? []).map((entry) => `${userId}/${entry.name}`)
  if (all.length) void supabase.storage.from("avatars").remove(all)
}

// ---- Invitation codes ----
export type InviteReason = "invalid" | "too_many" | "unconfirmed" | "already_has_role" | "inactive" | "not_verified" | "email_not_verified" | "registration_closed"
export type RedeemResult = { ok: true; role: string } | { ok: false; reason: InviteReason }

export const inviteReasonText: Record<InviteReason, string> = {
  invalid: "That code is not valid. Check it, or ask the person who gave it to you. It may have expired or been used up.",
  too_many: "Too many wrong codes. Please wait an hour and try again.",
  unconfirmed: "Confirm your email address first, then enter the code.",
  already_has_role: "Your account already has a role.",
  inactive: "Your account is not active. Contact an administrator.",
  not_verified: "Verify your identity first (see the Identity verification card), then enter the code.",
  registration_closed: "New registrations are closed right now. Please try again later.",
  email_not_verified: "Confirm your email first: use the \"Confirm your email\" card above to get a 6-digit code, then enter the invitation code.",
}

export const formatInviteCode = (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12).replace(/(.{4})(?=.)/g, "$1-")

export async function redeemInvite(code: string): Promise<RedeemResult> {
  const { data, error } = await supabase.rpc("redeem_invite", { p_code: code })
  if (error || !data) throw new Error(error?.message ?? "Could not check the code. Try again.")
  return data as RedeemResult
}
