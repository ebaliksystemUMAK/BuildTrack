import type { PmPage } from "../../lib/projectRoutes"

export type PmPageKey = PmPage
export type PmNavigate = (page: PmPageKey, search?: string) => void
export type PmPageProps = { onNavigate: PmNavigate }
