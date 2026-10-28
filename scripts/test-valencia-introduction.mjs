import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import ts from "typescript"

const url = source => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
let slots = [], effects = [], pending = [], cursor = 0, tree
globalThis.__valenciaHooks = {
  useState(initial) {
    const n = cursor++
    if (!(n in slots)) slots[n] = typeof initial === "function" ? initial() : initial
    return [slots[n], value => { slots[n] = typeof value === "function" ? value(slots[n]) : value }]
  },
  useEffect(fn, deps) {
    const n = cursor++, old = effects[n]
    if (!old || deps?.some((value, i) => value !== old.deps?.[i])) pending.push(() => { old?.cleanup?.(); effects[n] = { deps, cleanup: fn() } })
  },
}
globalThis.__valenciaDeps = { readProjectRoute: () => null }
async function compile(file, overrides = {}) {
  const location = new URL(file, import.meta.url), source = readFileSync(location, "utf8")
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let output = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  const replacements = { "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"), ...overrides }
  for (const declaration of ast.statements.filter(ts.isImportDeclaration)) {
    if (!declaration.importClause) { output = output.replace(`import "${declaration.moduleSpecifier.text}";`, ""); continue }
    if (declaration.importClause.isTypeOnly) continue
    const name = declaration.moduleSpecifier.text, bindings = []
    if (name in replacements) continue
    if (/\.(png|jpe?g)$/.test(name)) {
      const path = fileURLToPath(new URL(name, location))
      assert.ok(existsSync(path), `Missing company asset ${name}`)
      replacements[name] = url(`export default ${JSON.stringify(path)}`)
      continue
    }
    if (declaration.importClause.name) bindings.push(`export default function ${declaration.importClause.name.text}(){return null}`)
    for (const binding of declaration.importClause.namedBindings?.elements ?? []) {
      if (binding.isTypeOnly) continue
      const key = binding.propertyName?.text ?? binding.name.text
      bindings.push(`export const ${key}=globalThis.__valenciaDeps.${key} ?? function ${key}(){return null}`)
    }
    replacements[name] = url(bindings.join(";"))
  }
  for (const [name, replacement] of Object.entries(replacements)) output = output.replaceAll(`from "${name}"`, `from ${JSON.stringify(replacement)}`)
  return { module: await import(url(output)), source }
}
const react = url(`export {Component,Suspense,lazy} from ${JSON.stringify(import.meta.resolve("react"))};export const useState=globalThis.__valenciaHooks.useState,useEffect=globalThis.__valenciaHooks.useEffect`)
const all = node => Array.isArray(node) ? node.flatMap(all) : node && typeof node === "object" ? [node, ...all(node.props?.children), ...all(node.props?.footer)] : []
const text = node => Array.isArray(node) ? node.map(text).join("") : node?.props ? text(node.props.children) : typeof node === "string" || typeof node === "number" ? String(node) : ""
const render = (Component, props = {}) => { cursor = 0; tree = Component(props); const jobs = pending; pending = []; jobs.forEach(fn => fn()); return tree }
const find = predicate => { const node = all(tree).find(predicate); assert.ok(node, "Expected company page control"); return node }

const oldWindow = globalThis.window, oldDocument = globalThis.document
const description = { content: "Original description" }
globalThis.document = { title: "BuildTrack", querySelector: () => description }
const historyCalls = []
const updateLocation = path => {
  const target = new URL(path, "https://buildtrack.test")
  Object.assign(globalThis.window.location, { href: target.href, origin: target.origin, pathname: target.pathname, search: target.search, hash: target.hash })
}
globalThis.window = { location: { href: "", pathname: "/valencia", search: "", hash: "" }, dispatchEvent() {}, history: {
  replaceState(_state, _title, path) { historyCalls.push({ method: "replace", path }); updateLocation(path) },
  pushState(_state, _title, path) { historyCalls.push({ method: "push", path }); updateLocation(path) },
}, scrollTo() {} }
try {
  const contentResult = await compile("../src/pages/Public/valenciaContent.ts")
  const content = contentResult.module
  assert.equal(content.valenciaProjects.length, 4)
  assert.equal(content.valenciaServices.length, 4)
  assert.equal(content.valenciaProcess.length, 4)
  assert.deepEqual(content.valenciaCompany.phones, ["09971270773", "09104292842"])
  assert.equal(content.valenciaCompany.email, "valenciaconstruction2019@gmail.com")
  const portraitBytes = readFileSync(content.valenciaCompany.proprietorPhoto)
  assert.equal(portraitBytes.subarray(1, 4).toString(), "PNG", "Proprietor portrait must be a real local image, not a Git LFS pointer")
  const inquiry = content.companyInquiryMailto("  Alex & Co  ", "alex+site@example.com", "A & B\nPlease call.")
  const params = new URLSearchParams(inquiry.split("?")[1])
  assert.match(params.get("body"), /^Name: Alex & Co\nEmail: alex\+site@example.com\n\nA & B\nPlease call\.$/)
  const logo = readFileSync(content.valenciaCompany.logo)
  assert.equal(logo.subarray(1, 4).toString(), "PNG")
  assert.equal(logo[25], 6, "Transparent logo must retain RGBA rather than flattening its alpha")

  const pageResult = await compile("../src/pages/Public/ValenciaIntroduction.tsx", { react, "./valenciaContent": url(await (async () => {
    const names = Object.keys(content)
    globalThis.__valenciaContent = content
    return names.map(name => `export const ${name}=globalThis.__valenciaContent.${name}`).join(";")
  })()) })
  const Page = pageResult.module.default
  let navigated = ""
  const props = { navigate: page => { navigated = page } }
  render(Page, props)
  assert.match(document.title, /Valencia Construction Services/)
  assert.match(description.content, /fit-outs/)
  assert.equal(all(tree).filter(node => node.type === "h1").length, 1)
  assert.equal(find(node => node.props?.className === "valencia-hero__photo").props.src, content.valenciaCompany.interior, "Hero reuses the supplied enhanced interior")
  const heroIdentity = find(node => node.props?.className === "valencia-hero__identity")
  assert.equal(heroIdentity.props.children.props.src, content.valenciaCompany.logo, "Hero overlays the supplied transparent logo")
  assert.ok(!all(tree).some(node => node.props?.className === "valencia-hero__angle"), "Requested red less-than decoration must be removed")
  assert.match(text(find(node => node.props?.id === "valencia-title")), /Built oncommitment\.Delivered with quality\./, "Keep the existing hero headline")
  for (const link of content.companySections) assert.ok(all(tree).some(node => node.props?.id === link.href.slice(1)), `Missing anchor ${link.href}`)
  const header = find(node => node.type?.name === "Header")
  assert.deepEqual(header.props.navigation, content.companyHeaderNavigation)
  assert.equal(header.props.brandPage, "valencia", "Company logo returns to its own introduction")
  assert.deepEqual(content.companyHeaderNavigation[0], { label: "BuildTrack", href: "/buildtrack" })
  assert.equal(header.props.mobileMenu.type.name, "ValenciaMobileNavigation", "Mobile navigation is mounted inside the header, not a separate horizontal link strip")
  assert.equal(header.props.mobileMenu.props.navigate, props.navigate)
  assert.ok(!all(tree).some(node => node.props?.className === "valencia-mobile-nav"))
  assert.ok(!/Listed as ongoing|Portfolio and status descriptions|checked October/.test(text(tree)), "Remove source-website status notes and the portfolio footnote")
  const proprietor = find(node => node.props?.className === "valencia-proprietor")
  const portrait = all(proprietor).find(node => node.type === "img")
  assert.equal(portrait.props.src, content.valenciaCompany.proprietorPhoto)
  assert.match(portrait.props.alt, /Roxan D\. Valencia/)
  assert.equal(portrait.props.loading, "lazy")
  assert.ok(!all(proprietor).some(node => node.type === "span" && text(node) === "RV"), "Proprietor initials are replaced by the supplied portrait")
  assert.equal(header.props.showAuthActions, false, "Company header hides login and registration")
  const footer = find(node => node.type?.name === "PublicFooter")
  assert.equal(footer.props.page, "valencia", "Company page uses the shared landing footer with neutral text and company section links")
  assert.equal(footer.props.navigate, props.navigate)
  assert.ok(!all(tree).some(node => node.type === "footer"), "No separate legacy company footer remains")
  assert.ok(!pageResult.source.includes("Stay connected"))
  assert.equal(all(tree).filter(node => node.props?.className === "valencia-project").length, 4)
  assert.ok(all(tree).filter(node => node.type === "img").every(node => typeof node.props.alt === "string"))
  assert.ok(all(tree).filter(node => node.props?.target === "_blank").every(node => /noopener/.test(node.props.rel)))

  find(node => node.type === "button" && text(node) === "Residential").props.onClick()
  render(Page, props)
  assert.equal(all(tree).filter(node => node.props?.className === "valencia-project").length, 1)
  assert.match(text(find(node => node.props?.className === "valencia-project")), /Ticzon Residence/)
  find(node => node.type === "button" && /View Ticzon Residence photos/.test(node.props?.["aria-label"])).props.onClick()
  render(Page, props)
  assert.match(find(node => node.props?.className === "valencia-gallery__caption").props.children, /perspective.*not a completion photograph/)
  find(node => node.props?.["aria-label"] === "Next project photo").props.onClick()
  render(Page, props)
  assert.match(text(tree), /Image 2 of 2/)
  assert.match(text(find(node => node.props?.className === "valencia-gallery__caption")), /construction photograph/)
  find(node => node.props?.["aria-label"] === "Next project photo").props.onClick()
  render(Page, props)
  assert.match(text(tree), /Image 1 of 2/)
  const gallery = find(node => node.props?.className === "valencia-gallery")
  let prevented = false
  gallery.props.onKeyDown({ key: "ArrowLeft", target: gallery, currentTarget: gallery, preventDefault() { prevented = true } })
  render(Page, props)
  assert.ok(prevented)
  assert.match(text(tree), /Image 2 of 2/)
  const modal = find(node => node.type?.name === "Modal")
  modal.props.onClose()
  render(Page, props)
  assert.ok(!all(tree).some(node => node.props?.className === "valencia-gallery"))
  find(node => node.type === "button" && text(node) === "All projects").props.onClick()
  render(Page, props)
  find(node => node.type === "button" && /View Biocare Centuria photos/.test(node.props?.["aria-label"])).props.onClick()
  render(Page, props)
  assert.match(text(tree), /Image 1 of 1/)
  assert.ok(!all(tree).some(node => node.props?.["aria-label"] === "Next project photo"))
  assert.ok(!/Listed as ongoing|checked October/.test(text(tree)), "The removed status text must not reappear in project galleries")
  find(node => node.type?.name === "Modal").props.onClose()
  render(Page, props)

  for (const [id, value] of [["valencia-name", "Alex & Co"], ["valencia-email", "alex+site@example.com"], ["valencia-message", "A home in Rizal"]]) {
    find(node => node.props?.id === id).props.onChange({ target: { value } })
  }
  render(Page, props)
  find(node => node.type === "form").props.onSubmit({ preventDefault() {} })
  render(Page, props)
  assert.equal(window.location.href, content.companyInquiryMailto("Alex & Co", "alex+site@example.com", "A home in Rizal"))
  assert.match(text(tree), /it has not been submitted by this website/)
  assert.ok(all(tree).some(node => node.props?.href === "tel:09971270773"))
  const maps = find(node => node.props?.href?.startsWith("https://www.google.com/maps/search/"))
  assert.equal(new URL(maps.props.href).searchParams.get("query"), content.valenciaCompany.address)
  find(node => node.type === "button" && text(node).includes("Explore BuildTrack")).props.onClick()
  assert.equal(navigated, "home")
  assert.ok(!/supabase|useAuth|dangerouslySetInnerHTML/.test(pageResult.source), "Company page must not load private records or source-site scripts")
  effects.forEach(effect => effect?.cleanup?.())
  assert.equal(document.title, "BuildTrack")
  assert.equal(description.content, "Original description")

  slots = []; effects = []; pending = []
  const { module: { handlePublicNavigation } } = await compile("../src/lib/publicNavigation.ts", { react })
  globalThis.__valenciaDeps.handlePublicNavigation = handlePublicNavigation
  const { module: { default: MobileNavigation } } = await compile("../src/pages/Public/ValenciaMobileNavigation.tsx", {
    react,
    "./valenciaContent": url("export const companyHeaderNavigation=globalThis.__valenciaContent.companyHeaderNavigation"),
  })
  const mediaListeners = new Set(), mobileCalls = []
  const desktop = { matches: false, addEventListener(_event, callback) { mediaListeners.add(callback) }, removeEventListener(_event, callback) { mediaListeners.delete(callback) } }
  window.matchMedia = query => { assert.equal(query, "(min-width: 1101px)"); return desktop }
  const mobileProps = { navigate: (page, hash) => mobileCalls.push({ page, hash }) }
  const menuButton = () => find(node => node.props?.["aria-label"] === "Open navigation menu")
  const menu = () => find(node => node.type?.name === "Modal")
  const click = extra => ({ button: 0, defaultPrevented: false, currentTarget: { getAttribute() { return null }, hasAttribute() { return false } }, preventDefault() { this.defaultPrevented = true }, ...extra })
  const showMenu = () => { menuButton().props.onClick(); render(MobileNavigation, mobileProps) }
  updateLocation("/valencia")
  render(MobileNavigation, mobileProps)
  assert.equal(menuButton().props["aria-expanded"], false)
  assert.equal(menuButton().props["aria-haspopup"], "dialog")
  assert.equal(menuButton().props["aria-controls"], "valencia-mobile-navigation")
  assert.ok(!all(tree).some(node => node.type?.name === "Modal"), "Closed navigation does not leave hidden focusable links or an overlay")
  for (const link of content.companyHeaderNavigation) {
    showMenu()
    assert.equal(menuButton().props["aria-expanded"], true)
    assert.equal(menu().props.placement, "right")
    assert.equal(find(node => node.type === "nav").props.id, "valencia-mobile-navigation")
    assert.deepEqual(all(tree).filter(node => node.type === "a").map(node => node.props.href), content.companyHeaderNavigation.map(item => item.href))
    const anchor = find(node => node.type === "a" && node.props.href === link.href), event = click()
    anchor.props.onClick(event)
    assert.ok(event.defaultPrevented)
    const destination = new URL(link.href, window.location.href)
    assert.deepEqual(mobileCalls.at(-1), { page: destination.pathname === "/valencia" ? "valencia" : "home", hash: destination.hash })
    render(MobileNavigation, mobileProps)
    assert.equal(menuButton().props["aria-expanded"], false, "Ordinary section/BuildTrack navigation closes the drawer")
    assert.equal(mediaListeners.size, 0, "Closing removes the responsive listener")
  }
  showMenu()
  const modified = click({ ctrlKey: true }), callCount = mobileCalls.length
  find(node => node.type === "a").props.onClick(modified)
  render(MobileNavigation, mobileProps)
  assert.ok(!modified.defaultPrevented)
  assert.equal(mobileCalls.length, callCount)
  assert.equal(menuButton().props["aria-expanded"], true, "Modified/new-tab links retain native behavior")
  menu().props.onClose(); render(MobileNavigation, mobileProps)
  assert.equal(menuButton().props["aria-expanded"], false, "Shared dialog close action closes the menu")
  showMenu()
  desktop.matches = true; mediaListeners.forEach(callback => callback()); render(MobileNavigation, mobileProps)
  assert.equal(menuButton().props["aria-expanded"], false, "Resizing to desktop dismisses an open mobile drawer")
  assert.equal(mediaListeners.size, 0)
  desktop.matches = false; showMenu()
  effects.forEach(effect => effect?.cleanup?.())
  assert.equal(mediaListeners.size, 0, "Unmounting removes listeners")
  slots = []; effects = []; pending = []

  const { module: { default: LandingPage } } = await compile("../src/pages/Public/LandingPage.tsx")
  tree = LandingPage(props)
  assert.equal(find(node => node.type?.name === "PublicFooter").props.navigate, props.navigate, "BuildTrack reuses the same footer rather than a duplicated layout")
  assert.ok(!all(tree).some(node => node.type === "footer"))

  const { module: { default: Header } } = await compile("../src/components/Header.tsx")
  tree = Header({ navigate() {} })
  assert.ok(all(tree).some(node => node.props?.href === "/valencia"))
  assert.ok(all(tree).some(node => node.type === "button" && text(node) === "Log in"), "Main landing header retains login")
  assert.ok(all(tree).some(node => node.type === "button" && text(node) === "Register"), "Main landing header retains registration")
  assert.ok(all(tree).some(node => node.props?.href === "/buildtrack#features"), "Landing links use the new explicit route")
  tree = Header({ navigate: page => { navigated = page }, navigation: content.companyHeaderNavigation, showAuthActions: false, brandPage: "valencia", mobileMenu: header.props.mobileMenu })
  assert.ok(all(tree).some(node => node.type?.name === "ValenciaMobileNavigation"), "Actual header includes the opt-in mobile menu")
  assert.ok(!all(tree).some(node => node.props?.className === "header-actions"), "No hidden authentication button container")
  assert.ok(!all(tree).some(node => node.type === "button" && /^(Log in|Register)$/.test(text(node))))
  assert.deepEqual(all(tree).filter(node => node.type === "a").map(node => node.props.href), content.companyHeaderNavigation.map(link => link.href), "Company navigation and BuildTrack link remain visible")
  find(node => node.props?.className === "brand-button").props.onClick()
  assert.equal(navigated, "valencia")
  tree = Header({ navigate() {}, brandingOnly: true, mobileMenu: header.props.mobileMenu })
  assert.ok(!all(tree).some(node => node.type === "nav" || node.type === "button"), "Standalone attendance header must remain branding-only")
  assert.ok(!all(tree).some(node => node.type?.name === "ValenciaMobileNavigation"))

  const { module: { default: App } } = await compile("../src/App.tsx", { react })
  updateLocation("/?campaign=company")
  const openingApp = new App({})
  assert.equal(openingApp.state.page, "valencia")
  assert.deepEqual(historyCalls.at(-1), { method: "replace", path: "/valencia?campaign=company" }, "Opening the site replaces the root URL instead of creating a Back loop")
  assert.equal(openingApp.render().type.name, "ErrorBoundary")
  updateLocation("/#features")
  assert.equal(new App({}).state.page, "home", "Legacy explicit landing-section links remain usable")
  assert.equal(window.location.pathname, "/buildtrack")
  assert.equal(window.location.hash, "#features")
  for (const path of ["/buildtrack", "/buildtrack/"]) {
    updateLocation(path)
    const landing = new App({})
    assert.equal(landing.state.page, "home")
    assert.equal(landing.render().type.name, "RouteGuard")
    assert.match(String(landing.renderPage().props.children.type._payload._result), /pages\/Public\/LandingPage/, "BuildTrack still renders the existing landing page")
  }
  const navigationApp = new App({})
  navigationApp.setState = patch => { navigationApp.state = { ...navigationApp.state, ...patch } }
  navigationApp.navigate("home")
  assert.deepEqual(historyCalls.at(-1), { method: "push", path: "/buildtrack" })
  navigationApp.navigate("home", "#services")
  assert.deepEqual(historyCalls.at(-1), { method: "push", path: "/buildtrack#services" }, "SPA header navigation preserves section hashes")
  navigationApp.navigate("valencia")
  assert.equal(window.location.pathname, "/valencia")
  for (const [path, expected] of [["/login", "login"], ["/register", "register"], ["/pin?pin=one", "pin-link"], ["/attendance?project=one", "attendance"]]) {
    updateLocation(path)
    assert.equal(new App({}).state.page, expected, `Preserve ${path}`)
  }
  for (const path of ["/valencia", "/valencia/"]) {
    window.location.pathname = path
    const app = new App({})
    assert.equal(app.state.page, "valencia")
    assert.equal(app.render().type.name, "ErrorBoundary", "Static company route must not wait for an account guard")
  }
  updateLocation("/engineer/verification?project=one&item=work-one")
  const protectedApp = new App({})
  assert.equal(protectedApp.state.page, "engineer/qa")
  assert.equal(window.location.pathname, "/engineer/qa", "Old review links land in the QA register")
  assert.equal(window.location.search, "?project=one&item=work-one", "Redirect preserves the linked checklist and project")
  assert.equal(protectedApp.render().type.name, "RouteGuard", "Workspace routes must remain protected")
  const css = readFileSync(new URL("../src/pages/Public/valencia.css", import.meta.url), "utf8")
  assert.match(css, /max-width: 720px/)
  assert.match(css, /prefers-reduced-motion/)
  assert.match(css, /focus-visible/)
  assert.match(css, /\.valencia-menu-toggle \{ display: none;/, "Hamburger is hidden on desktop")
  assert.match(css, /@media \(max-width: 1100px\) \{\s*\.valencia-menu-toggle \{ display: inline-flex; \}/, "Hamburger appears at the same breakpoint as the desktop links disappear")
  assert.ok(!/valencia-mobile-nav|valencia-source-note/.test(css), "No obsolete mobile link bar or removed note styles remain")
  assert.ok(!css.includes("valencia-hero__angle"), "No desktop or mobile chevron styling may remain")
  const identityRules = [...css.matchAll(/\.valencia-hero__identity\s*\{([^}]+)\}/g)].map(match => match[1])
  assert.equal(identityRules.length, 3, "Desktop, tablet and mobile logo layouts must be defined")
  for (const rule of identityRules) assert.ok(!/background|padding|border|box-shadow|backdrop-filter/.test(rule), "Transparent logo must not be placed inside a white/glass card")
  assert.match(identityRules[0], /left:\s*68%/, "Logo sits in the yellow-circled right-center photo area")
  assert.match(identityRules[0], /top:\s*58%/, "Logo moves down from the top into the marked area")
  assert.match(identityRules[0], /translate\(-50%,-50%\)/, "Logo is centered on the marked point")
  assert.match(identityRules[0], /width:\s*clamp\(320px,34vw,540px\)/, "Hero logo is enlarged without moving its center")
  assert.match(identityRules[1], /left:\s*78%/, "Tablet logo stays clear of the headline")
  assert.match(identityRules[1], /width:\s*clamp\(240px,30vw,340px\)/)
  assert.match(identityRules[2], /left:\s*50%/, "Logo centers above the mobile hero content")
  assert.match(identityRules[2], /top:\s*20px/)
  assert.match(identityRules[2], /translateX\(-50%\)/, "Mobile resets vertical translation so the logo is not clipped")
  assert.match(identityRules[2], /width:\s*clamp\(240px,68vw,330px\)/)
  assert.match(css, /\.valencia-hero__content\s*\{\s*width:\s*100%;\s*padding:\s*290px 24px 90px/, "Mobile reserves enough space below the enlarged logo")
  console.log("Valencia introduction: local/transparent assets, source-note removal, mobile hamburger/sidebar links/close/resizing/cleanup, public/private routing, unchanged branding-only header, project filters/slideshow/keyboard/perspective labels, honest encoded email inquiry, address links and metadata cleanup passed")
} finally {
  globalThis.window = oldWindow
  globalThis.document = oldDocument
  delete globalThis.__valenciaHooks
  delete globalThis.__valenciaDeps
  delete globalThis.__valenciaContent
}
