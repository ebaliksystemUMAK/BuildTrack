import { useSiteStatus } from "../lib/siteStatus"
import { featureForPage, lockFor, stripsFor, type Strip } from "../lib/siteStatusModel"

const tones: Record<Strip["kind"], string> = {
  maintenance: "border-amber-300 bg-amber-100 text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-50",
  lock: "border-sky-300 bg-sky-100 text-sky-950 dark:border-sky-700 dark:bg-sky-950 dark:text-sky-50",
}

export function StripView({ strip }: { strip: Strip }) {
  return (
    <div role="status" aria-label={strip.title} className={`border-b px-4 py-2.5 text-sm ${tones[strip.kind]}`}>
      <p className="leading-snug"><strong className="font-extrabold">{strip.title}.</strong> <span className="whitespace-pre-line break-words">{strip.text}</span></p>
    </div>
  )
}

// Above every page (mounted in main.tsx): the maintenance notice, and the features paused for this person's role. Nothing is drawn when nothing applies.
export default function SiteStatusNotice() {
  const strips = stripsFor(useSiteStatus())
  return strips.length ? <div>{strips.map((strip) => <StripView key={strip.key} strip={strip} />)}</div> : null
}

// On the page itself: why the page you opened cannot save, in plain words (shown by the workspace shell for the page it is showing).
export function FeatureLockNotice({ persona, page }: { persona: string; page: string }) {
  const lock = lockFor(useSiteStatus(), featureForPage(persona, page))
  if (!lock) return null
  return (
    <div role="status" className="mb-4 rounded-xl border border-sky-300 bg-sky-100 px-4 py-3 text-sm text-sky-950 dark:border-sky-700 dark:bg-sky-950 dark:text-sky-50">
      <p className="font-extrabold">{lock.label} is paused for you</p>
      <p className="mt-0.5">{lock.message.trim() || "This feature is switched off for your role for now. Please try again later."} You can still look at the page, but saving here is not available until it is switched back on.</p>
    </div>
  )
}
