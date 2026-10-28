import { useEffect, useState } from "react"
import BlueprintEditor from "./editor/BlueprintEditor"
import BlueprintUploadDialog from "./BlueprintUploadDialog"
import type { EditorRole } from "./editor/Inspector"
import { Skeleton, SkeletonCardGrid } from "./ui/Skeleton"
import { EmptyState, buttonPrimary, buttonSecondary } from "./ui/PageParts"
import { getSelectedProjectId, useProject } from "../lib/projects"
import { useBlueprints, useSignedUrl, type Blueprint } from "../lib/blueprints"
import { useBlueprintAccess } from "../lib/blueprintAccess"
import { useAuth } from "../lib/auth"
import { useToast } from "../lib/toast"
import { supabase } from "../lib/supabase"
import {
  BLUEPRINT_TYPES,
  blueprintTypeLabels,
  canEditType,
  canUploadType,
  readTypeParam,
  sheetType,
  typeCards,
  uploadTypes,
  typeScopedRole,
  type BlueprintType,
  type ClassifiedType,
  type TypeCard,
} from "../lib/blueprintTypes"

const badgeTone = (card: TypeCard, role: EditorRole) =>
  role === "admin" ? "bg-brand-soft text-brand-text" : card.level === "assigned" ? "bg-brand-soft text-brand-text" : "border border-line bg-surface-muted text-fg-muted"

function TypeTile({ card, role, onOpen }: { card: TypeCard; role: EditorRole; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="group flex min-h-36 flex-col rounded-2xl border border-line bg-surface p-4 text-left shadow-[var(--bt-shadow)] transition hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-[var(--bt-shadow-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
      <span className="flex items-start justify-between gap-3">
        <span className="text-base font-extrabold text-fg group-hover:text-brand-text">{card.label}</span>
        <span className="flex-none rounded-full bg-surface-muted px-2 py-0.5 text-xs font-bold text-fg">{card.count} {card.count === 1 ? "plan" : "plans"}</span>
      </span>
      <span className="mt-1 text-sm leading-snug text-fg-muted">{card.hint}</span>
      <span className={`mt-auto self-start rounded-full px-2 py-0.5 text-xs font-semibold ${badgeTone(card, role)}`}>{card.badge}</span>
    </button>
  )
}

function SheetCard({ blueprint, index, onOpen, moveTo }: { blueprint: Blueprint; index: number; onOpen: () => void; moveTo?: (type: ClassifiedType) => void }) {
  const revision = blueprint.blueprint_revisions[0]
  const { url, failed } = useSignedUrl("blueprints", revision ? (revision.thumb_path ?? revision.preview_path) : null)
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm transition hover:shadow-md">
      <button type="button" onClick={onOpen} className="group block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
        <div className="aspect-[4/3] w-full bg-white">
          {url ? <img src={url} alt="" loading="lazy" className="h-full w-full object-contain" /> : failed || !revision ? <div className="flex h-full items-center justify-center bg-surface-muted text-xs text-fg-muted">{revision ? "No preview" : "No file yet"}</div> : <Skeleton className="h-full w-full rounded-none" />}
        </div>
        <div className="p-3">
          <p className="truncate text-sm font-bold text-fg group-hover:text-brand-text">Sheet {String(index + 1).padStart(2, "0")} - {blueprint.title}</p>
          <p className="truncate text-xs text-fg-muted">{[blueprint.level, revision ? `Rev ${revision.revision}` : null].filter(Boolean).join(" • ") || "No level set"}</p>
        </div>
      </button>
      {moveTo ? (
        <label className="flex items-center gap-2 border-t border-line bg-surface-muted/60 px-3 py-2 text-xs font-semibold text-fg">
          Type
          <select className="min-h-8 flex-1 rounded-lg border border-line bg-surface px-2 text-xs text-fg" value={sheetType(blueprint)} onChange={(e) => e.target.value !== sheetType(blueprint) && moveTo(e.target.value as ClassifiedType)} aria-label={`Blueprint type of ${blueprint.title}`}>
            {BLUEPRINT_TYPES.map((type) => <option key={type} value={type}>{blueprintTypeLabels[type]}</option>)}
          </select>
        </label>
      ) : null}
    </div>
  )
}

// Project > Blueprints > blueprint type > plans > viewer / editor. Engineers and Foremen only get the types an Admin gave
// them (No access is hidden); a type card appears once it has a plan. The database enforces the same.
// canEdit = the role may do engineering work at all; the type's level decides per type. canUpload: Admins = blueprints.manage.
export default function SelectedProjectWorkspace({ role, canEdit, canUpload = canEdit }: { role: EditorRole; canEdit: boolean; canUpload?: boolean }) {
  const projectId = getSelectedProjectId()
  const { profile } = useAuth()
  const toast = useToast()
  const { project, loading, notFound } = useProject(projectId)
  const { blueprints, loading: sheetsLoading, error, reload } = useBlueprints(project ? project.id : null)
  const access = useBlueprintAccess(project && typeScopedRole(role) ? project.id : null)
  const [type, setType] = useState<BlueprintType | null>(() => readTypeParam(window.location.search))
  const [open, setOpen] = useState(Boolean(new URLSearchParams(window.location.search).get("pin")))
  const [uploading, setUploading] = useState(false)
  useEffect(() => {
    const follow = () => {
      const params = new URLSearchParams(window.location.search)
      setType(readTypeParam(window.location.search))
      if (params.get("pin")) setOpen(true)
    }
    window.addEventListener("popstate", follow)
    return () => window.removeEventListener("popstate", follow)
  }, [])

  // The chosen type stays in the address (?btype=) so a refresh or a shared link comes back to it.
  const chooseType = (next: BlueprintType | null) => {
    setType(next)
    const url = new URL(window.location.href)
    if (next) url.searchParams.set("btype", next)
    else url.searchParams.delete("btype")
    window.history.replaceState(window.history.state, "", url)
  }

  // Opening a plan card starts the editor on that plan (?sheet=); leaving the editor returns to the plan list.
  const setSheetParam = (sheetId: string | null) => {
    const url = new URL(window.location.href)
    if (sheetId) url.searchParams.set("sheet", sheetId)
    else url.searchParams.delete("sheet")
    window.history.replaceState(window.history.state, "", url)
  }
  const openPlans = (sheetId: string | null = null) => {
    setSheetParam(sheetId)
    setOpen(true)
  }

  if (!projectId || notFound) return null // ProjectContextBar above already explains it
  if (loading || !project) return <SkeletonCardGrid count={3} label="Loading blueprints" />

  const canManage = role === "admin" && canUpload
  const cards = typeCards({ role, sheets: blueprints, grants: access.grants, userId: profile?.id ?? null, projectId: project.id, canManage })
  const card = type ? (cards.find((item) => item.type === type) ?? null) : null
  const plans = card ? blueprints.filter((bp) => sheetType(bp) === card.type) : []
  const typeCanEdit = Boolean(card) && canEdit && (!typeScopedRole(role) || canEditType(role, card!.level))
  const typeCanUpload = Boolean(card) && canUpload && canUploadType(role, card!.level, canManage)
  // From the type list a new plan picks its type: that is how a type without plans gets its first card.
  const listUploadTypes = canUpload ? uploadTypes(role, (t) => (typeScopedRole(role) ? access.levelFor(profile?.id, t) : "view"), canManage) : []
  const holdsAnyType = !typeScopedRole(role) || access.grants.some((g) => g.user_id === profile?.id)
  const busy = sheetsLoading || access.loading
  const loadError = error || access.error

  const moveSheet = async (sheet: Blueprint, next: ClassifiedType) => {
    const { data, error: moveError } = await supabase.from("blueprints").update({ blueprint_type: next }).eq("id", sheet.id).select("id")
    if (moveError || !data?.length) return toast.error("Type not changed", moveError?.message ?? "You may not have the Blueprints permission.")
    toast.success(`${sheet.title} moved to ${blueprintTypeLabels[next]}`, "People with access to that type see it now.")
    void reload()
  }

  return (
    <section className="mb-6 space-y-4 text-fg" aria-label="Blueprints">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {card ? (
          <div className="min-w-0">
            <button type="button" onClick={() => chooseType(null)} className="inline-flex min-h-6 items-center gap-1 text-sm font-semibold text-brand-text hover:underline">
              <span aria-hidden="true">←</span> All blueprint types
            </button>
            <h2 className="flex flex-wrap items-center gap-2 border-l-4 border-accent pl-3 text-lg font-extrabold text-brand-strong">
              {card.label} plans ({plans.length})
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badgeTone(card, role)}`}>{card.badge}</span>
            </h2>
          </div>
        ) : (
          <div className="min-w-0">
            <h2 className="border-l-4 border-accent pl-3 text-lg font-extrabold text-brand-strong">Blueprints</h2>
            <p className="mt-1 pl-4 text-sm text-fg-muted">Choose a blueprint type to see its plans.</p>
          </div>
        )}
        {!type && listUploadTypes.length ? <button type="button" onClick={() => setUploading(true)} className={buttonPrimary}>Upload plan</button> : null}
        {card ? (
          <div className="flex flex-wrap gap-2">
            {typeCanUpload ? <button type="button" onClick={() => setUploading(true)} className={buttonSecondary}>Upload {card.label} plan</button> : null}
            {plans.length ? <button type="button" onClick={() => openPlans()} className={buttonPrimary}>{typeCanEdit ? "Open the editor" : "Open the plans"}</button> : null}
          </div>
        ) : null}
      </div>

      {loadError ? <p className="flex items-center gap-3 rounded-lg bg-danger-soft px-4 py-2 text-sm text-danger-fg">{loadError}<button className="font-bold underline" onClick={() => { void reload(); void access.reload() }}>Retry</button></p> : null}

      {busy ? <SkeletonCardGrid count={3} label="Loading blueprints" /> : !type ? (
        cards.length ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
            {cards.map((item) => <TypeTile key={item.type} card={item} role={role} onOpen={() => chooseType(item.type)} />)}
          </div>
        ) : (
          <EmptyState title={holdsAnyType ? "No plans yet" : "No blueprint types yet"} action={listUploadTypes.length ? <button type="button" className={buttonPrimary} onClick={() => setUploading(true)}>Upload plan</button> : undefined}>
            {!holdsAnyType ? "An Admin has not given you access to any blueprint type on this project. Ask them to set it in Project Management > Team & access." : listUploadTypes.length ? "Upload the first plan and choose its type: the type appears here with it." : typeScopedRole(role) ? "No plan has been uploaded for your blueprint types yet." : "No plan has been uploaded for this project yet."}
          </EmptyState>
        )
      ) : !card ? (
        <EmptyState title={`${blueprintTypeLabels[type]} plans are not available to you`} action={<button type="button" className={buttonSecondary} onClick={() => chooseType(null)}>All blueprint types</button>}>
          You do not have access to this blueprint type on this project, or it has no plans yet.
        </EmptyState>
      ) : plans.length === 0 ? (
        <EmptyState title={`No ${card.label} plans yet`} action={typeCanUpload ? <button type="button" className={buttonPrimary} onClick={() => setUploading(true)}>Upload {card.label} plan</button> : undefined}>
          {typeCanUpload ? "Upload the first plan of this type. Everyone with access to the type sees it straight away." : "Nothing has been uploaded for this type yet."}
        </EmptyState>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {plans.map((bp, index) => <SheetCard key={bp.id} blueprint={bp} index={index} onOpen={() => openPlans(bp.id)} moveTo={canManage ? (next) => void moveSheet(bp, next) : undefined} />)}
          </div>
        </>
      )}

      {open ? <BlueprintEditor key={project.id} projectId={project.id} role={role} canEdit={canEdit} canUpload={canUpload} blueprintType={card?.type ?? null} onExit={() => { setSheetParam(null); setOpen(false); void reload() }} /> : null}
      {uploading && (card || listUploadTypes.length) ? <BlueprintUploadDialog projectId={project.id} blueprintType={card?.type ?? null} uploadTypes={listUploadTypes} onClose={() => setUploading(false)} onDone={() => { setUploading(false); void reload() }} /> : null}
    </section>
  )
}
