import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import ts from "typescript"
import { passwordChecks, passwordIssue } from "../src/lib/passwordPolicy.ts"
import { phoneDigits, phoneIssue, PHONE_DIGITS } from "../src/lib/phoneNumber.ts"

// Real components, isolated hooks and fake responses: no accounts, emails or live sessions.
const url = source => "data:text/javascript;base64," + Buffer.from(source).toString("base64")
const settle = () => new Promise(resolve => setTimeout(resolve, 5))
const deferred = () => { let resolve, reject; const promise = new Promise((yes,no) => { resolve=yes; reject=no }); return { promise, resolve, reject } }
const all = node => Array.isArray(node) ? node.flatMap(all) : node?.props ? [node,...all(node.props.children)] : []
const text = node => Array.isArray(node) ? node.map(text).join("") : node?.props ? text(node.props.children) : typeof node === "string" ? node : ""
const event = { preventDefault() {} }
let harness, tree
function makeHarness() {
  let slots=[], cursor=0, effects=[], jobs=[], writes=0
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]))
  const hooks={
    useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==="function"?initial():initial;return[slots[i],v=>{writes++;slots[i]=typeof v==="function"?v(slots[i]):v}]},
    useRef(initial){const i=cursor++;return slots[i]??={current:initial}},
    useMemo(fn,deps){const i=cursor++;if(!same(slots[i]?.deps,deps))slots[i]={deps,value:fn()};return slots[i].value},
    useCallback(fn,deps){return hooks.useMemo(()=>fn,deps)},
    useEffect(fn,deps){const i=cursor++;if(!same(effects[i]?.deps,deps))jobs.push(()=>{effects[i]?.cleanup?.();effects[i]={deps,cleanup:fn()}})},
    createContext:()=>({Provider:"FixtureProvider"}),
  }
  return {hooks,render(Component,props){cursor=0;tree=Component(props);const work=jobs.splice(0);work.forEach(fn=>fn());return tree},unmount(){effects.forEach(e=>e?.cleanup?.())},get writes(){return writes}}
}
globalThis.__authFlowHooks=new Proxy({}, {get:(_,key)=>key==="createContext"?()=>({Provider:"FixtureProvider"}):(...args)=>harness.hooks[key](...args)})
const storage=new Map(), intervals=new Map()
let timerId=0, now=1_000_000
const originalNow=Date.now
Date.now=()=>now
globalThis.sessionStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}
globalThis.window={location:{origin:"https://fixture.test",assign(){}},setInterval(fn){intervals.set(++timerId,fn);return timerId},clearInterval(id){intervals.delete(id)},addEventListener(){},removeEventListener(){}}
globalThis.document={visibilityState:"visible"}
const advance=ms=>{now+=ms;for(const fn of [...intervals.values()])fn()}
let fixtureProfile=null, callback, initialSession, readProfile, readPermissions, readAssurance
const calls={password:[],google:[],signup:[],verify:[],resend:[],notices:[],signout:0,intents:[],clear:0,rpc:[]}
let passwordAnswer,googleAnswer,signupAnswer,verifyAnswer,resendAnswer,rpcAnswer
const deps=globalThis.__authFlowDeps={
  passwordChecks,passwordIssue,phoneDigits,phoneIssue,PHONE_DIGITS,PRIVACY_VERSION:"fixture-version",
  useAuth:()=>({session:fixtureProfile?{user:{id:fixtureProfile.id}}:null,profile:fixtureProfile,signOut:async()=>{calls.signout++}}),
  useToast:()=>({success(){},error(){},info(){}}),
  loadRegistrationStatus:async()=>({closed:false,message:""}),
  takeLoginNotice:()=>"",takeLoginSuccessNotice:()=>null,setLoginSuccessNotice:(...args)=>calls.notices.push(args),
  setLoginNotice(){},setOAuthIntent:intent=>calls.intents.push(intent),clearOAuthIntent:()=>{calls.clear++},shouldForceSignOut:()=>false,beginRecovery(){},
  invokeFunction:async()=>({data:{removed:false},error:null}),
  supabase:{
    auth:{
      signInWithPassword:input=>{calls.password.push(input);return passwordAnswer()},
      signInWithOAuth:input=>{calls.google.push(input);return googleAnswer()},
      signUp:input=>{calls.signup.push(input);return signupAnswer()},
      verifyOtp:input=>{calls.verify.push(input);return verifyAnswer()},
      resend:input=>{calls.resend.push(input);return resendAnswer()},
      signOut:async()=>{calls.signout++;return{error:null}},
      getSession:()=>initialSession.promise,
      onAuthStateChange:fn=>{callback=fn;return{data:{subscription:{unsubscribe(){}}}}},
      mfa:{getAuthenticatorAssuranceLevel:()=>readAssurance()},
    },
    rpc:(name,input)=>{calls.rpc.push([name,input]);return rpcAnswer()},
    from(table){let id;return{select(){return this},eq(_key,value){id=value;return this},maybeSingle:()=>readProfile(id),then:(yes,no)=>readPermissions(id).then(yes,no)}},
  },
}
async function compile(path) {
  const source=readFileSync(new URL(path,import.meta.url),"utf8")
  const ast=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
  let output=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
  for(const declaration of ast.statements.filter(ts.isImportDeclaration)){
    if(!declaration.importClause||declaration.importClause.isTypeOnly)continue
    const name=declaration.moduleSpecifier.text,exports=[]
    if(declaration.importClause.name)exports.push("export default function Stub(){return null}")
    for(const binding of declaration.importClause.namedBindings?.elements??[]){if(binding.isTypeOnly)continue;const key=binding.propertyName?.text??binding.name.text;exports.push(`export const ${key}=globalThis.${name==="react"?"__authFlowHooks":"__authFlowDeps"}.${key}`)}
    output=output.replaceAll(`from "${name}"`,`from ${JSON.stringify(url(exports.join(";")+`\n// ${path}`))}`)
  }
  output=output.replaceAll('from "react/jsx-runtime"',`from ${JSON.stringify(import.meta.resolve("react/jsx-runtime"))}`)
  return import(url(output))
}
const Login=(await compile("../src/pages/Auth/LoginPage.tsx")).default
const Register=(await compile("../src/pages/Auth/RegisterPage.tsx")).default
const Provider=(await compile("../src/lib/auth.tsx")).AuthProvider
const props={navigate:page=>calls.notices.push(["navigate",page])}
let Component
const draw=()=>harness.render(Component,props)
const mount=component=>{harness?.unmount();harness=makeHarness();Component=component;draw()}
const find=predicate=>{const node=all(tree).find(predicate);assert.ok(node,"Expected auth control");return node}
const button=label=>find(n=>n.type==="button"&&text(n)===label)
const field=name=>find(n=>n.props?.name===name)
const submit=()=>find(n=>n.type==="form").props.onSubmit(event)
const setField=(name,value)=>{field(name).props.onChange(value);draw()}

// Password and Google are mutually exclusive, including calls before React re-renders.
let waiting=deferred();passwordAnswer=()=>waiting.promise;googleAnswer=async()=>({error:null})
mount(Login);setField("email"," Fixture@Example.test ");setField("password","FixturePass123!")
const staleGoogle=button("Sign in with Google"), staleSubmit=find(n=>n.type==="form").props.onSubmit
const signing=submit();staleGoogle.props.onClick();staleSubmit(event);draw()
assert.equal(calls.password.length,1);assert.equal(calls.google.length,0);assert.equal(button("Sign in with Google").props.disabled,true)
assert.equal(calls.password[0].email,"fixture@example.test")
waiting.resolve({error:{message:"Invalid login credentials"}});await signing;draw()
assert.match(text(tree),/Incorrect email or password/);assert.equal(button("Sign in with Google").props.disabled,false)
googleAnswer=async()=>{throw new Error("Network unavailable")}
await button("Sign in with Google").props.onClick();await settle();draw()
assert.equal(calls.clear,1);assert.equal(button("Login to BuildTrack").props.disabled,false)
googleAnswer=async()=>({error:null})
await button("Sign in with Google").props.onClick();await settle();draw()
assert.equal(button("Sign in with Google").props.disabled,true)
await submit();assert.equal(calls.password.length,1)
assert.equal(calls.google.at(-1).options.queryParams.prompt,"select_account")

// Email signup has the same exclusion guard and releases after a rejected/failed request.
fixtureProfile=null;mount(Register)
for(const [name,value] of [["name","Fixture User"],["email","fixture@example.test"],["phone","09123456789"],["password","FixturePass123!"],["confirmPassword","FixturePass123!"]])setField(name,value)
submit();draw()
waiting=deferred();signupAnswer=()=>waiting.promise
const confirm=find(n=>n.props?.title==="Check your information").props.onConfirm
const registering=confirm();confirm();button("Register with Google").props.onClick();draw()
assert.equal(calls.signup.length,1);assert.equal(button("Register with Google").props.disabled,true)
waiting.reject(new Error("Offline"));await registering;draw()
assert.match(text(tree),/Cannot reach the server/);assert.equal(button("Register with Google").props.disabled,false)
submit();draw();signupAnswer=async()=>({error:null})
await find(n=>n.props?.title==="Check your information").props.onConfirm();draw()
assert.equal(button("Resend code in 60s").props.disabled,true)
button("Resend code in 60s").props.onClick();assert.equal(calls.resend.length,0)
verifyAnswer=async()=>({error:null})
await submit();assert.equal(calls.verify.length,0)
assert.equal(field("code").props.value,"");assert.equal(field("code").props.inputMode,"numeric");assert.equal(field("code").props.maxLength,6)
setField("code","12a 34");assert.equal(field("code").props.value,"1234");assert.equal(button("Verify and continue").props.disabled,true)
setField("code","1234567890");assert.equal(field("code").props.value,"123456");assert.equal(button("Verify and continue").props.disabled,false)
advance(60_001);draw();assert.equal(button("Resend code").props.disabled,false)
waiting=deferred();resendAnswer=()=>waiting.promise
const oldVerify=find(n=>n.type==="form").props.onSubmit
const resend=button("Resend code")
resend.props.onClick();resend.props.onClick();oldVerify(event);draw()
assert.equal(calls.resend.length,1);assert.equal(calls.verify.length,0);assert.equal(button("Verify and continue").props.disabled,true)
waiting.resolve({error:null});await settle();draw();assert.equal(button("Resend code in 60s").props.disabled,true)
advance(60_001);draw();resendAnswer=async()=>{throw new Error("Offline")}
button("Resend code").props.onClick();await settle();draw();assert.equal(button("Resend code").props.disabled,false)
waiting=deferred();verifyAnswer=()=>waiting.promise
const verifying=submit();submit();button("Resend code").props.onClick();draw()
assert.equal(calls.verify.length,1);assert.equal(calls.resend.length,2)
waiting.resolve({error:{message:"Token has expired"}});await verifying;draw();assert.match(text(tree),/incorrect or has expired/)
verifyAnswer=async()=>({error:null});await submit();assert.deepEqual(calls.verify.at(-1),{email:"fixture@example.test",token:"123456",type:"signup"});assert.equal(calls.signout,1)
assert.deepEqual(calls.notices.at(-1),["navigate","login"])
harness.unmount();assert.equal(intervals.size,0,"Expired countdown timers clean up")

mount(Register)
for(const [name,value] of [["name","Fixture User"],["email","fixture@example.test"],["phone","09123456789"],["password","FixturePass123!"],["confirmPassword","FixturePass123!"]])setField(name,value)
submit();draw();await find(n=>n.props?.title==="Check your information").props.onConfirm();draw()
assert.ok(intervals.size>0);harness.unmount();assert.equal(intervals.size,0,"Active countdown timers clean up on navigation")

// Google registration locks email signup until the redirect, and unlocks after an OAuth error.
mount(Register);googleAnswer=async()=>({error:{message:"Provider unavailable"}})
button("Register with Google").props.onClick();await settle();draw()
assert.match(text(tree),/Provider unavailable/);assert.equal(button("Register").props.disabled,false)
googleAnswer=async()=>({error:null});button("Register with Google").props.onClick();await settle();draw()
assert.equal(button("Register").props.disabled,true);assert.equal(calls.intents.at(-1),"register")

// Finishing Google registration cannot submit twice or switch accounts during its RPC.
fixtureProfile={id:"google-user",status:"pending",full_name:"Fixture User",email:"fixture@example.test",email_verified_at:"2026-11-06"}
mount(Register)
const finish=find(n=>typeof n.type==="function"&&n.type.name==="CompleteGoogleRegistration")
mount(finish.type);setField("phone",{target:{value:"09123456789"}});setField("role",{target:{value:"foreman"}})
find(n=>n.type==="input"&&n.props.type==="checkbox").props.onChange({target:{checked:true}});draw();submit();draw()
waiting=deferred();rpcAnswer=()=>waiting.promise
const googleConfirm=find(n=>n.props?.title==="Check your registration").props.onConfirm
const finishing=googleConfirm();googleConfirm();button("Use a different account").props.onClick();assert.equal(calls.rpc.length,1)
waiting.resolve({error:{message:"Registration is closed"}});await finishing;draw();assert.match(text(tree),/Registration is closed/)
fixtureProfile=null

// Profile responses must match both the current account and newest request.
const session=id=>({user:{id}})
const profile=(id,role="engineer")=>({id,role,status:"active"})
readAssurance=async()=>({data:{currentLevel:"aal2"}})
readPermissions=async()=>({data:[{permission:"users.view"}]})
initialSession=deferred();const oldA=deferred();readProfile=()=>oldA.promise
mount(Provider);initialSession.resolve({data:{session:session("A")}});await settle();draw()
callback("SIGNED_OUT",null);draw();assert.equal(tree.props.value.session,null);assert.equal(tree.props.value.profile,null)
oldA.resolve({data:profile("A")});await settle();draw();assert.equal(tree.props.value.profile,null);assert.equal(tree.props.value.loading,false)

// A late initial getSession cannot replace a newer SIGNED_IN event.
initialSession=deferred();readProfile=async id=>({data:profile(id)})
mount(Provider);callback("SIGNED_IN",session("B"));draw();assert.equal(tree.props.value.loading,true)
initialSession.resolve({data:{session:session("A")}});await settle();draw()
assert.equal(tree.props.value.session.user.id,"B");assert.equal(tree.props.value.profile.id,"B");assert.equal(tree.props.value.loading,false)
const latePermissions=deferred();readProfile=async id=>({data:profile(id,id==="C"?"admin":"engineer")});readPermissions=()=>latePermissions.promise
callback("SIGNED_IN",session("C"));await settle();draw()
assert.equal(tree.props.value.profile,null);assert.equal(tree.props.value.loading,true)
callback("SIGNED_IN",session("D"));await settle();draw()
assert.equal(tree.props.value.profile.id,"D");assert.deepEqual(tree.props.value.permissions,[])
latePermissions.resolve({data:[{permission:"users.edit"}]});await settle();draw()
assert.equal(tree.props.value.profile.id,"D");assert.deepEqual(tree.props.value.permissions,[])
let firstRefresh=deferred(),secondRefresh=deferred(),refreshCount=0
readProfile=()=>++refreshCount===1?firstRefresh.promise:secondRefresh.promise
const refreshOne=tree.props.value.refreshProfile();await settle()
const refreshTwo=tree.props.value.refreshProfile();await settle()
secondRefresh.resolve({data:{...profile("D"),full_name:"Latest"}});await refreshTwo
firstRefresh.resolve({data:{...profile("D"),full_name:"Stale"}});await refreshOne;draw()
assert.equal(tree.props.value.profile.full_name,"Latest")
const pendingUnmount=deferred();readProfile=()=>pendingUnmount.promise
const unmountRead=tree.props.value.refreshProfile();await settle();harness.unmount();const beforeWrites=harness.writes
pendingUnmount.resolve({data:profile("D")});await unmountRead;assert.equal(harness.writes,beforeWrites,"Unmounted loads do not write state")
initialSession=deferred();mount(Provider);initialSession.reject(new Error("Storage unavailable"));await settle();draw();assert.equal(tree.props.value.loading,false)
harness.unmount();Date.now=originalNow
delete globalThis.__authFlowHooks;delete globalThis.__authFlowDeps
console.log("Auth flows: stale profile/permission/initial-session responses rejected; current-account loading, same-account refresh ordering and unmount/error guards passed")
console.log("Login/registration: immediate mutual exclusion, OAuth errors/retry/redirect lock and account chooser, signup failure recovery, resend cooldown/cleanup and verify/resend exclusion passed")
console.log("Signup code: controlled six-digit numeric value, paste cleaning, invalid-code guard, expired-code retry and confirmed signup/sign-out/navigation flow passed")
