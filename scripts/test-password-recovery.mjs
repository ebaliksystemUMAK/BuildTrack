import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import ts from "typescript"

// Everything here runs against fakes: no email is sent, no account is touched, nobody is signed in or out.
const url = (code) => "data:text/javascript;base64," + Buffer.from(code).toString("base64")
const fileUrl = (path) => new URL(path, import.meta.url).href
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8")
const settle = () => new Promise((resolve) => setImmediate(resolve))
const transpile = (path, replacements) => {
  let source = ts.transpileModule(read(path), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  for (const [name, replacement] of Object.entries(replacements)) source = source.replaceAll(`from "${name}"`, `from ${JSON.stringify(replacement)}`)
  return source
}
const text = (node) => Array.isArray(node) ? node.map(text).join("") : typeof node === "object" && node ? text(node.props?.children) : node === undefined || node === null || typeof node === "boolean" ? "" : String(node)
const all = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap((child) => all(child, predicate)) : [...(predicate(node) ? [node] : []), ...all(node.props?.children, predicate)]

function hooksHarness() {
  let state = [], effects = [], cursor = 0, pending = []
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]))
  const hooks = {
    useState(initial) { const n = cursor++; if (!(n in state)) state[n] = typeof initial === "function" ? initial() : initial; return [state[n], (value) => { state[n] = typeof value === "function" ? value(state[n]) : value }] },
    useEffect(fn, deps) { const n = cursor++; if (!same(effects[n]?.deps, deps)) pending.push(() => { effects[n]?.cleanup?.(); effects[n] = { deps, cleanup: fn() } }) },
  }
  return { hooks, render(fn) { cursor = 0; const value = fn(); const work = pending; pending = []; work.forEach((run) => run()); return value }, unmount() { effects.forEach((effect) => effect?.cleanup?.()) } }
}

// ---------------------------------------------------------------- a fake browser
const storage = new Map()
globalThis.sessionStorage = { getItem: (k) => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) }
globalThis.window = { location: { origin: "https://app.test", hash: "" } }

// ---------------------------------------------------------------- the "mid-reset" note
{
  const make = async (hash, keep = false) => {
    if (!keep) storage.clear()
    globalThis.window.location.hash = hash
    const source = transpile("../src/lib/passwordRecovery.ts", { react: url("export const useSyncExternalStore=(subscribe, snapshot)=>snapshot();") })
    return import(url(source + "\n// " + Math.random()))
  }
  let m = await make("")
  assert.equal(m.isRecovering(), false); assert.equal(m.startupLinkProblem, null)
  for (const hash of ["#access_token=abc&expires_in=3600&refresh_token=x&token_type=bearer&type=recovery", "#type=recovery", "#a=1&type=recovery&b=2"]) assert.equal(m.linkIsRecovery(hash), true, hash)
  for (const hash of ["", "#access_token=abc&type=signup", "#type=recovery_x", "#subtype=recovery", "#access_token=abc&type=magiclink"]) assert.equal(m.linkIsRecovery(hash), false, hash)
  assert.match(m.linkProblem("#error=access_denied&error_code=otp_expired&error_description=x"), /expired or was already used/); assert.equal(m.linkProblem("#access_token=abc&type=recovery"), null); assert.equal(m.linkProblem(""), null)
  const heard = []; const listener = () => heard.push(m.isRecovering())
  m.beginRecovery(); assert.equal(m.isRecovering(), true); assert.equal(storage.get("buildtrack.recovering"), "1", "a reload in the middle of a reset keeps the note")
  m.endRecovery(); assert.equal(m.isRecovering(), false); assert.equal(storage.has("buildtrack.recovering"), false); void listener

  m = await make("#access_token=abc&type=recovery")
  assert.equal(m.isRecovering(), true, "opening a reset link starts the note before the auth client removes the address")
  m = await make("#error=access_denied&error_code=otp_expired")
  assert.equal(m.isRecovering(), false); assert.match(m.startupLinkProblem, /expired or was already used/, "an expired link is remembered for the screen")
  storage.set("buildtrack.recovering", "1"); m = await make("", true)
  assert.equal(m.isRecovering(), true, "a note saved by this tab is read back after a reload")
  globalThis.window.location.hash = ""
}

// ---------------------------------------------------------------- forgot password: choose a link or a code
const noticesAtStart = 0
const calls = { reset: [], verify: [], update: [], invoke: [], signOut: 0, begin: 0, end: 0, notice: [], navigate: [], toast: [], order: [] }
let resetAnswer = { error: null }, verifyAnswer = { error: null }, updateAnswer = { error: null }, invokeAnswer = { data: { ok: true }, error: null }
globalThis.__prInvoke = async (name, body) => { calls.invoke.push([name, body]); return invokeAnswer }
let auth = { session: null, loading: false }
globalThis.__prSupabase = {
  auth: {
    resetPasswordForEmail: async (email, options) => { calls.reset.push([email, options]); return resetAnswer },
    verifyOtp: async (input) => { calls.order.push("verify"); calls.verify.push(input); return verifyAnswer },
    updateUser: async (input) => { calls.order.push("update"); calls.update.push(input); return updateAnswer },
    signOut: async () => { calls.order.push("signOut"); calls.signOut++ },
  },
}
globalThis.__prRecovery = { beginRecovery: () => { calls.order.push("begin"); calls.begin++ }, endRecovery: () => { calls.order.push("end"); calls.end++ }, startupLinkProblem: null }
globalThis.__prToast = { success: (...a) => calls.toast.push(["success", ...a]), error: (...a) => calls.toast.push(["error", ...a]) }
globalThis.__prAuth = () => auth
globalThis.__prNotice = (...a) => { calls.order.push("notice"); calls.notice.push(a) }
const stubs = {
  react: url("export const useState=(...a)=>globalThis.__prHooks.useState(...a),useEffect=(...a)=>globalThis.__prHooks.useEffect(...a);"), "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
  "../../components/Brand": url("export default function Brand(){return null}"), "../../components/Modal": url("export default function Modal(){return null}"), "../../components/FormField": url("export default function FormField(){return null}"), "../../components/Header": url("export default function Header(){return null}"),
  "../../lib/supabase": url("export const supabase=globalThis.__prSupabase;"), "../../lib/toast": url("export const useToast=()=>globalThis.__prToast;"),
  "../../lib/passwordRecovery": url("export const beginRecovery=()=>globalThis.__prRecovery.beginRecovery(),endRecovery=()=>globalThis.__prRecovery.endRecovery(),startupLinkProblem=globalThis.__prRecovery.startupLinkProblem;"),
  "../../lib/auth": url("export const useAuth=()=>globalThis.__prAuth();"), "../../lib/oauthIntent": url("export const setLoginSuccessNotice=(...a)=>globalThis.__prNotice(...a);"),
  "../../lib/passwordPolicy": fileUrl("../src/lib/passwordPolicy.ts"),
  // the real client for the emailed codes, with only the network call replaced
  "../../lib/emailCodes": url(transpile("../src/lib/emailCodes.ts", { "./functions": url("export const invokePublicFunction=(...a)=>globalThis.__prInvoke(...a);") })),
}
const field = (tree, name) => all(tree, (n) => typeof n.type === "function" && n.type.name === "FormField" && n.props.name === name)[0]
const button = (tree, wording) => all(tree, (n) => n.type === "button" && text(n).includes(wording))[0]
const submit = async (tree) => { const forms = all(tree, (n) => n.type === "form"); await forms[forms.length - 1].props.onSubmit({ preventDefault() {} }); await settle() }
const click = async (element) => { await element.props.onClick(); await settle() }

const modal = (tree) => all(tree, (n) => typeof n.type === "function" && n.type.name === "Modal")[0]
{
  const harness = hooksHarness(); globalThis.__prHooks = harness.hooks
  const page = await import(url(transpile("../src/pages/Auth/ForgotPasswordPage.tsx", stubs)))
  const navigate = (target) => calls.navigate.push(target)
  const draw = () => harness.render(() => page.default({ navigate }))
  let tree = draw()
  // step 1: only the email, one button, no pop-up yet
  assert.match(text(tree), /Reset your password/); assert.ok(button(tree, "Find my account")); assert.ok(button(tree, "Back to sign in")); assert.equal(modal(tree), undefined, "no pop-up before the address is entered")
  assert.equal(button(tree, "reset link"), undefined, "the two ways are not offered on the first screen"); assert.equal(button(tree, "6-digit"), undefined)
  await submit(tree); tree = draw(); assert.match(text(tree), /Enter the email address of your account/); assert.equal(modal(tree), undefined); assert.equal(calls.reset.length + calls.invoke.length, 0, "nothing is requested for an empty address")
  field(tree, "email").props.onChange("not-an-email"); tree = draw(); await submit(tree); tree = draw(); assert.equal(modal(tree), undefined)

  // step 2: a valid address opens the pop-up with the two ways; nothing is sent yet and nothing says whether the account exists
  field(tree, "email").props.onChange("  Santos@Example.COM "); tree = draw(); await submit(tree); tree = draw()
  assert.equal(modal(tree).props.title, "How do you want to reset it?"); assert.match(modal(tree).props.description, /santos@example\.com/)
  assert.ok(button(tree, "Email me a reset link")); assert.ok(button(tree, "Email me a 6-digit code"))
  assert.equal(calls.reset.length + calls.invoke.length, 0, "choosing the address sends nothing"); assert.doesNotMatch(text(tree), /not found|no account|does not exist/i)
  modal(tree).props.onClose(); tree = draw(); assert.equal(modal(tree), undefined, "closing the pop-up returns to the email step"); assert.equal(field(tree, "email").props.value, "  Santos@Example.COM ", "the address is kept")
  await submit(tree); tree = draw()

  // step 3a: the link choice goes through Supabase Auth, never through the code function
  await click(button(tree, "Email me a reset link")); tree = draw()
  assert.deepEqual(calls.reset[0], ["santos@example.com", { redirectTo: "https://app.test/reset-password" }], "the address is cleaned and the link returns to the reset screen"); assert.equal(calls.invoke.length, 0)
  assert.equal(modal(tree).props.title, "Check your email"); assert.match(text(tree), /10 minutes and only once/); assert.equal(calls.toast.at(-1)[1], "Reset link requested")
  assert.match(text(button(tree, "Send the email again")), /Send the email again in (60|59)s/); assert.equal(button(tree, "Send the email again").props.disabled, true, "no sending again for a minute")

  // step 3b: the code choice goes through BuildTrack's own function, NOT through the Supabase reset email
  const resetsBefore = calls.reset.length
  await click(button(tree, "6-digit code instead")); tree = draw()
  assert.deepEqual(calls.invoke.at(-1), ["email-code", { action: "send_reset", email: "santos@example.com" }]); assert.equal(calls.reset.length, resetsBefore, "asking for a code does not send a reset link")
  assert.equal(modal(tree).props.title, "Enter your code"); assert.equal(calls.toast.at(-1)[1], "Code requested")
  assert.equal(field(tree, "password"), undefined, "no password field until the code is accepted"); assert.equal(field(tree, "confirmPassword"), undefined)
  assert.equal(button(tree, "Send a new code").props.disabled, true, "no sending again for a minute")

  // the code step takes ONLY the code and the server checks it
  const verify = () => button(tree, "Verify code")
  assert.equal(verify().props.disabled, true)
  field(tree, "code").props.onChange("12ab34"); tree = draw(); assert.equal(verify().props.disabled, true, "letters are dropped: only 4 digits so far")
  field(tree, "code").props.onChange("123 456"); tree = draw(); assert.equal(verify().props.disabled, false)
  invokeAnswer = { data: null, error: "That code is incorrect or has expired. Ask for a new one." }
  await submit(tree); tree = draw()
  assert.deepEqual(calls.invoke.at(-1), ["email-code", { action: "check_reset", email: "santos@example.com", code: "123456" }]); assert.match(text(tree), /incorrect or has expired/)
  assert.equal(modal(tree).props.title, "Enter your code", "a wrong code stays on the code step"); assert.equal(field(tree, "password"), undefined)
  invokeAnswer = { data: { ok: true }, error: null }
  await submit(tree); tree = draw()

  // step 4: only now the new password; it is checked in the browser first, then the server checks the code again together with the password
  assert.equal(modal(tree).props.title, "Choose a new password"); assert.ok(field(tree, "password")); assert.ok(field(tree, "confirmPassword")); assert.equal(field(tree, "code"), undefined)
  const invokesBefore = calls.invoke.length
  await submit(tree); tree = draw(); assert.match(text(tree), /Password needs/); assert.equal(calls.invoke.length, invokesBefore, "a weak or empty password is refused in the browser before anything is sent")
  field(tree, "password").props.onChange("Correct-Horse-9-Battery"); field(tree, "confirmPassword").props.onChange("Different-Horse-9-Battery"); tree = draw()
  await submit(tree); tree = draw(); assert.match(text(tree), /Passwords do not match/); assert.equal(calls.invoke.length, invokesBefore)
  field(tree, "confirmPassword").props.onChange("Correct-Horse-9-Battery"); tree = draw()
  invokeAnswer = { data: null, error: "That code is incorrect or has expired. Ask for a new one." }
  await submit(tree); tree = draw()
  assert.deepEqual(calls.invoke.at(-1), ["email-code", { action: "verify_reset", email: "santos@example.com", code: "123456", password: "Correct-Horse-9-Battery" }])
  assert.equal(modal(tree).props.title, "Enter your code", "a code that stopped working sends the person back to ask for a new one"); assert.match(text(tree), /incorrect or has expired/)
  assert.deepEqual(calls.navigate, []); assert.deepEqual(calls.notice.slice(noticesAtStart), [])
  invokeAnswer = { data: { ok: true }, error: null }
  field(tree, "code").props.onChange("654321"); tree = draw(); await submit(tree); tree = draw()
  field(tree, "password").props.onChange("Correct-Horse-9-Battery"); field(tree, "confirmPassword").props.onChange("Correct-Horse-9-Battery"); tree = draw()
  invokeAnswer = { data: null, error: "Choose a password you have not used before." }
  await submit(tree); tree = draw(); assert.equal(modal(tree).props.title, "Choose a new password", "a password problem stays on the password step"); assert.match(text(tree), /not used before/)
  invokeAnswer = { data: { ok: true }, error: null }
  await submit(tree)
  assert.deepEqual(calls.navigate, ["login"], "after the change the person signs in with the new password"); assert.equal(calls.notice.at(-1)[0], "Password changed")
  assert.equal(calls.verify.length, 0, "a code never signs anyone in: no one-time session is created"); assert.equal(calls.begin, 0, "so there is no reset note to keep")
  harness.unmount()
}

{
  // another visit: prefilled address, rate limit, offline, the function being unavailable
  storage.set("buildtrack.forgotEmail", "prefilled@example.com")
  const harness = hooksHarness(); globalThis.__prHooks = harness.hooks
  const page = await import(url(transpile("../src/pages/Auth/ForgotPasswordPage.tsx", stubs) + "\n// second"))
  const draw = () => harness.render(() => page.default({ navigate() {} }))
  let tree = draw(); assert.equal(field(tree, "email").props.value, "prefilled@example.com", "the address typed on the sign-in screen is carried over"); assert.equal(storage.has("buildtrack.forgotEmail"), false)
  await submit(tree); tree = draw()
  resetAnswer = { error: { message: "email rate limit exceeded" } }; await click(button(tree, "Email me a reset link")); tree = draw(); assert.match(text(tree), /Too many requests/); assert.equal(modal(tree).props.title, "How do you want to reset it?")
  resetAnswer = { error: { message: "Failed to fetch" } }; await click(button(tree, "Email me a reset link")); tree = draw(); assert.match(text(tree), /Cannot reach the server/)
  resetAnswer = { error: null }
  invokeAnswer = { data: null, error: "Emailed codes are not available right now. Use the reset link instead, or contact your administrator." }
  await click(button(tree, "Email me a 6-digit code")); tree = draw()
  assert.match(text(tree), /not available right now/, "when the mail service is down the person is told, and stays on the choice"); assert.equal(modal(tree).props.title, "How do you want to reset it?")
  invokeAnswer = { data: null, error: 'Cannot reach the "email-code" function. It may not be deployed yet, or you are offline.' }
  await click(button(tree, "Email me a 6-digit code")); tree = draw(); assert.match(text(tree), /Cannot reach the server/)
  invokeAnswer = { data: { ok: true, message: "x" }, error: null }
  await click(button(tree, "Email me a 6-digit code")); tree = draw(); assert.equal(modal(tree).props.title, "Enter your code")
  harness.unmount()
}

// ---------------------------------------------------------------- reset password: the one screen both ways end on
{
  const strong = "Correct-Horse-9-Battery"
  const run = async (problem = null) => {
    globalThis.__prRecovery.startupLinkProblem = problem
    const harness = hooksHarness(); globalThis.__prHooks = harness.hooks
    // A fresh copy of the stubbed module each time, because a module's exported value is fixed when it is first loaded.
    const fresh = { ...stubs, "../../lib/passwordRecovery": url(`export const beginRecovery=()=>globalThis.__prRecovery.beginRecovery(),endRecovery=()=>globalThis.__prRecovery.endRecovery(),startupLinkProblem=globalThis.__prRecovery.startupLinkProblem; // ${Math.random()}`) }
    const page = await import(url(transpile("../src/pages/Auth/ResetPasswordPage.tsx", fresh) + "\n// " + Math.random()))
    return { harness, draw: () => harness.render(() => page.default({ navigate: (target) => calls.navigate.push(target) })) }
  }
  auth = { session: null, loading: true }
  let { harness, draw } = await run()
  let tree = draw(); assert.match(text(tree), /Checking your reset link/)
  auth = { session: null, loading: false }; const endsBefore = calls.end; tree = draw(); await settle(); tree = draw()
  assert.match(text(tree), /Link not usable/); assert.match(text(tree), /There is no reset waiting/); assert.ok(calls.end > endsBefore, "nothing is waiting, so the reset note is cleared")
  await click(button(tree, "Ask for a new link or code")); assert.equal(calls.navigate.at(-1), "forgot-password"); harness.unmount()
  ;({ harness, draw } = await run("This reset link has expired or was already used. Ask for a new one."))
  tree = draw(); assert.match(text(tree), /expired or was already used/, "an expired link says so"); harness.unmount()

  auth = { session: { user: { id: "u1" } }, loading: false }
  const noticesBefore = calls.notice.length
  ;({ harness, draw } = await run()); tree = draw()
  assert.match(text(tree), /Choose a new password/); assert.ok(field(tree, "password")); assert.ok(field(tree, "confirmPassword"))
  await submit(tree); tree = draw(); assert.match(text(tree), /Password needs/); assert.equal(calls.update.length, 0, "a weak password is refused before anything is sent")
  field(tree, "password").props.onChange(strong); field(tree, "confirmPassword").props.onChange(strong + "x"); tree = draw(); await submit(tree); tree = draw()
  assert.match(text(tree), /Passwords do not match/); assert.equal(calls.update.length, 0)
  field(tree, "confirmPassword").props.onChange(strong); tree = draw()
  for (const [message, expected] of [["New password should be different from the old password.", /not used before/], ["AAL2 session is required to update password when MFA is enabled", /authenticator app/], ["Password is known to be weak and easy to guess", /too easy to guess/], ["Failed to fetch", /Cannot reach the server/]]) {
    updateAnswer = { error: { message } }; await submit(tree); tree = draw(); assert.match(text(tree), expected, message)
  }
  assert.equal(calls.notice.length, noticesBefore, "a failed save leaves no sign-in message"); assert.ok(!calls.order.includes("signOut"), "and signs nobody out")
  updateAnswer = { error: null }; calls.order.length = 0; calls.navigate.length = 0
  await submit(tree)
  assert.deepEqual(calls.update.at(-1), { password: strong })
  assert.deepEqual(calls.order, ["update", "end", "notice", "signOut"], "save, end the note, leave a message for the sign-in screen, then end the one-time session")
  assert.deepEqual(calls.notice.at(-1), ["Password changed", "Sign in with your new password."]); assert.deepEqual(calls.navigate, ["login"])
  calls.order.length = 0; calls.navigate.length = 0
  tree = draw(); await click(button(tree, "Cancel and sign out"))
  assert.deepEqual(calls.order, ["end", "signOut"]); assert.deepEqual(calls.navigate, ["login"], "cancelling leaves nothing behind")
  harness.unmount()
}

// ---------------------------------------------------------------- the pieces around them
{
  const login = read("../src/pages/Auth/LoginPage.tsx")
  assert.doesNotMatch(login, /resetPasswordForEmail/, "the sign-in screen no longer sends a link itself: the reset has its own screen")
  assert.match(login, /navigate\("forgot-password"\)/); assert.match(login, /button--gold button--wide[\s\S]{0,160}Create an account/, "the register button is a full-width call to action")
  assert.ok(login.indexOf("Create an account") < login.indexOf("Sign in with Google"), "it is above the Google button, not a small link at the bottom")
  const app = read("../src/App.tsx")
  for (const route of ["forgot-password", "reset-password"]) { assert.match(app, new RegExp(`pathname === "/${route}"\\) return "${route}"`)); assert.match(app, new RegExp(`page === "${route}"`)) }
  const guard = read("../src/components/RouteGuard.tsx")
  assert.match(guard, /page === "forgot-password" \|\| page === "reset-password"/, "both screens are public"); assert.match(guard, /if \(page !== "reset-password"\) navigate\("reset-password"\)/, "a reset session never opens a workspace")
  assert.match(guard, /useRecovering\(\) && Boolean\(session\)/)
  const auth = read("../src/lib/auth.tsx")
  assert.match(auth, /event === "PASSWORD_RECOVERY"\) beginRecovery\(\)/)
  const template = read("../supabase/email-templates/reset-password.html")
  assert.match(template, /\{\{ \.ConfirmationURL \}\}/, "the button works"); assert.doesNotMatch(template, /\{\{ \.Token \}\}/, "the Supabase email is the LINK email: the 6-digit code is BuildTrack's own email, so it does not depend on this template")
  assert.doesNotMatch(template, /1 hour/, "the wording matches the 10-minute setting"); assert.match(template, /10 minutes/)
  assert.match(read("../supabase/email-templates/README.md"), /link only/i)
  // the code choice must not go through Supabase's reset email, and must never sign the person in
  const forgot = read("../src/pages/Auth/ForgotPasswordPage.tsx")
  assert.match(forgot, /requestResetCode\(address\)/); assert.match(forgot, /finishReset\(address, code, password\)/); assert.doesNotMatch(forgot, /verifyOtp|beginRecovery/, "no one-time session is created by a code")
  // sign-up still asks for the code before the account exists for anyone to approve
  const register = read("../src/pages/Auth/RegisterPage.tsx")
  assert.ok(register.indexOf('type: "signup"') > register.indexOf("signUp({")); assert.match(register, /await supabase\.auth\.signOut\(\)\s+navigate\("login"\)/, "after the code the person signs in again; the verification step cannot be skipped")
}

console.log("Password recovery: reset note, link and 6-digit code choice, new-password screen, guard, login page button and email template passed")
