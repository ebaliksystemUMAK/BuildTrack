// Time and place stamp for site photos (migration 0039). The phone sends what it knows (its clock and, if the person allows it, a GPS
// position with its accuracy); the DATABASE decides the flag and the distance, so the screen only displays what is stored.
// Pure except `captureStamp`. Tested in `pnpm test:lib`.
// A photo away from the site still counts as evidence (20261023120000): only an untrusted time keeps it out, as in SQL photo_eligible.

export type PhotoStamp = { taken_at: string; lat?: number; lng?: number; accuracy_m?: number }

export type StampFlag = "at_site" | "away_from_site" | "no_site_set" | "no_location" | "clock_ahead" | "old_photo"
export type StampedPhoto = { stamp_flag: StampFlag | null; distance_m: number | null; taken_at: string | null }

export const photoEligible = (photo: { stamp_flag?: StampFlag | null }) =>
  !photo.stamp_flag || !["clock_ahead", "old_photo"].includes(photo.stamp_flag)
export const photoPreviewBlocked = (role: string | null | undefined, photo: { stamp_flag?: StampFlag | null }) =>
  role === "engineer" && !photoEligible(photo)

// What an insert may carry (never the flag or the distance).
export function stampFields(stamp?: PhotoStamp | null): Record<string, string | number> {
  if (!stamp) return {}
  const out: Record<string, string | number> = { taken_at: stamp.taken_at }
  if (typeof stamp.lat === "number" && typeof stamp.lng === "number") {
    out.lat = Math.round(stamp.lat * 1e6) / 1e6
    out.lng = Math.round(stamp.lng * 1e6) / 1e6
    if (typeof stamp.accuracy_m === "number") out.accuracy_m = Math.max(0, Math.round(stamp.accuracy_m))
  }
  return out
}

// How a photo was added (20261031120532): the in-app camera, or a file chosen from the device. While the Super Admin has turned
// photo uploads off, the database refuses "upload" (and any stamp but at_site) for daily reports and field evidence.
export type CaptureSource = "camera" | "upload"
export type ProjectSite = { lat: number | null; lng: number | null; radius_m: number }

// Great-circle distance in whole metres, as SQL public.distance_m.
export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = (deg: number) => (deg * Math.PI) / 180
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2
  return Math.round(2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(a))))
}

// The place part of SQL stamp_evidence_photo (a photo just taken has a trusted time), so the screen can warn before sending.
export function siteFlag(stamp: PhotoStamp, site: ProjectSite | null): { flag: "at_site" | "away_from_site" | "no_site_set" | "no_location"; distance_m: number | null } {
  if (typeof stamp.lat !== "number" || typeof stamp.lng !== "number") return { flag: "no_location", distance_m: null }
  if (!site || site.lat === null || site.lng === null) return { flag: "no_site_set", distance_m: null }
  const sent = stampFields(stamp) as { lat: number; lng: number; accuracy_m?: number }
  const distance = distanceM(sent.lat, sent.lng, site.lat, site.lng)
  return { flag: distance - Math.min(sent.accuracy_m ?? 0, 100) <= site.radius_m ? "at_site" : "away_from_site", distance_m: distance }
}

// Uploads off: why the database will refuse this camera photo (same words as enforce_photo_capture_policy), or "" at the site.
export function sitePhotoProblem(stamp: PhotoStamp, site: ProjectSite | null): string {
  const { flag, distance_m } = siteFlag(stamp, site)
  if (flag === "no_location") return "Turn on location: photos must be taken at the project site, and this photo has no position."
  if (flag === "no_site_set") return "This project has no site location yet, so photos cannot be checked. Ask an Admin or the Project Manager to set it."
  if (flag === "away_from_site") return `This photo was taken ${metres(distance_m ?? 0)} from the project site. Photos must be taken at the site.`
  return ""
}

export const metres = (value: number) => (value < 1000 ? `${value} m` : `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)} km`)

export type StampLabel = { text: string; tone: "good" | "warn" | "bad" | "muted"; detail: string }

// null for photos taken before the stamp existed: nothing is shown rather than a misleading "no location".
export function stampLabel(photo: StampedPhoto): StampLabel | null {
  switch (photo.stamp_flag) {
    case "at_site":
      return { text: "At the site", tone: "good", detail: `Taken at the project site${photo.distance_m !== null ? ` (${metres(photo.distance_m)} from its centre)` : ""}.` }
    case "away_from_site":
      return { text: `Away from site${photo.distance_m !== null ? ` · ${metres(photo.distance_m)}` : ""}`, tone: "warn", detail: "The phone's position was outside the project site when this photo was added. It still counts as evidence." }
    case "no_site_set":
      return { text: "Location saved", tone: "muted", detail: "A position was saved, but the project has no site location yet, so it cannot be checked." }
    case "no_location":
      return { text: "No location", tone: "warn", detail: "No position was sent (location blocked or unavailable), so this photo cannot be placed on the site." }
    case "clock_ahead":
      return { text: "Phone clock ahead", tone: "bad", detail: "The phone's time was in the future when this photo was added, so its time cannot be trusted." }
    case "old_photo":
      return { text: "Old photo", tone: "bad", detail: "The phone's time says this picture is more than 3 days older than its upload." }
    default:
      return null
  }
}

// One short line for a list of photos ("2 of 3 photos have no location"), or "" when everything is fine or unstamped.
export function stampSummary(photos: StampedPhoto[]): string {
  const stamped = photos.filter((photo) => photo.stamp_flag !== null)
  const bad = stamped.filter((photo) => photo.stamp_flag === "clock_ahead" || photo.stamp_flag === "old_photo").length
  const away = stamped.filter((photo) => photo.stamp_flag === "away_from_site").length
  const none = stamped.filter((photo) => photo.stamp_flag === "no_location").length
  const parts: string[] = []
  if (bad) parts.push(`${bad} of ${stamped.length} photo${stamped.length === 1 ? "" : "s"} ${bad === 1 ? "has a wrong time and does" : "have a wrong time and do"} not count`)
  if (away) parts.push(`${away} ${away === 1 ? "was" : "were"} taken away from the site`)
  if (none) parts.push(`${none} ${none === 1 ? "has" : "have"} no location`)
  return parts.join("; ")
}

// Asks for the phone's position now. Never rejects: a denied or slow request just means "no position". The time is the phone's clock.
export function captureStamp(timeoutMs = 6000): Promise<PhotoStamp> {
  const taken_at = new Date().toISOString()
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve({ taken_at })
  return new Promise((resolve) => {
    let done = false
    const finish = (stamp: PhotoStamp) => {
      if (!done) {
        done = true
        resolve(stamp)
      }
    }
    const timer = setTimeout(() => finish({ taken_at }), timeoutMs + 500)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        clearTimeout(timer)
        finish({ taken_at, lat: position.coords.latitude, lng: position.coords.longitude, accuracy_m: position.coords.accuracy })
      },
      () => {
        clearTimeout(timer)
        finish({ taken_at })
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 },
    )
  })
}
