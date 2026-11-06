import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import ts from "typescript"

const url = code => "data:text/javascript;base64," + Buffer.from(code).toString("base64")
const hooks = new Map()
let active
globalThis.__roleHooks = {
  useState(initial) { const n=active.cursor++, owner=active; if(!(n in owner.state)) owner.state[n]=typeof initial === "function" ? initial() : initial; return [owner.state[n], value => { owner.state[n]=typeof value === "function" ? value(owner.state[n]) : value }] },
  useMemo(fn,deps) { const n=active.cursor++; if(!active.state[n] || deps.some((v,i)=>v!==active.state[n].deps[i])) active.state[n]={deps,value:fn()}; return active.state[n].value },
  useCallback(fn,deps) { return this.useMemo(()=>fn,deps) },
  useEffect(fn,deps) { const n=active.cursor++, owner=active; if(!owner.effects[n] || deps.some((v,i)=>v!==owner.effects[n].deps[i])) owner.pending.push(()=>{owner.effects[n]?.cleanup?.();owner.effects[n]={deps,cleanup:fn()}}) },
}
const hooksUrl=url("const h=globalThis.__roleHooks;export const useState=(...a)=>h.useState(...a),useMemo=(...a)=>h.useMemo(...a),useCallback=(...a)=>h.useCallback(...a),useEffect=(...a)=>h.useEffect(...a),createContext=(value)=>({_value:value,Provider:()=>null}),useContext=(context)=>context._value;")
const parts=url("export const buttonPrimary='primary',buttonSecondary='secondary',inputClass='input';export function EmptyState(){}")
const dummy=url("export default function Component(){}")
const auth=url("export const useAuth=()=>globalThis.__roleAuth;")
const project={id:"p1",code:"P-001",name:"Actual project",status:"active",phase:"planning",archived_at:null,lead_engineer_id:"eng",lead_foreman_id:"fore",disciplines:[]}
const people=[{id:"eng",full_name:"Engineer One",email:"eng@example.test",role:"engineer"},{id:"fore",full_name:"Foreman One",email:"fore@example.test",role:"foreman"},{id:"new",full_name:"New Person",email:"new@example.test",role:"foreman"}]
const members=people.slice(0,2).map(p=>({project_id:"p1",user_id:p.id,member_role:p.role}))
const grants=members.map(m=>({project_id:"p1",user_id:m.user_id,blueprint_type:"architectural",access_level:"assigned"}))
globalThis.__roleData={project,people,members,grants}
globalThis.__roleAuth={profile:{role:"admin"},can:()=>true}
const mutations=[]
globalThis.__roleDB={from(table){let operation="read",payload;const query={select(){return query},in(){return query},eq(){return query},order(){return query},insert(value){operation="insert";payload=value;return query},update(value){operation="update";payload=value;return query},delete(){operation="delete";return query},then(resolve,reject){if(operation!=="read")mutations.push({table,operation,payload});const data=operation!=="read"?[{id:"p1"}]:table==="project_members"?members:table==="profiles"?people:table==="blueprints"?[{blueprint_type:"architectural",discipline:"architectural"}]:[];return Promise.resolve({data,error:null}).then(resolve,reject)}};return query}}
const supabase=url("export const supabase=globalThis.__roleDB;")
const projects=url("export const phaseLabels={planning:'Planning'},statusLabels={active:'Active'},disciplineLabels={}; export const useProjects=()=>({projects:[globalThis.__roleData.project],loading:false,error:null,reload:async()=>{}});export const useProject=()=>({project:null});export const getSelectedProjectId=()=>null;export const openProject=()=>{};export const rememberProject=()=>{};")
const managers=url("export const useProjectManagers=()=>({managers:[],reload:async()=>{}});export const setProjectArchived=async()=>{};export const assignProjectManager=async()=>{};")
const shell=url("export function AdminButton(){};export function PageIntro(){};")
async function compile(file,replacements){let source=ts.transpileModule(readFileSync(new URL(file,import.meta.url),"utf8"),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;for(const [name,replacement] of Object.entries({react:hooksUrl,"react/jsx-runtime":import.meta.resolve("react/jsx-runtime"),...replacements}))source=source.replaceAll(`from "${name}"`,`from ${JSON.stringify(replacement)}`);return (await import(url(source))).default}
const shared={"../../lib/auth":auth,"../../lib/supabase":supabase,"../../components/Modal":dummy,"../../components/ui/PageParts":parts,"../../lib/confirm":url("export const useConfirm=()=>async()=>true;"),"../../lib/toast":url("const toast={success(){},error(){}};export const useToast=()=>toast;")}
const Dialog=await compile("../src/pages/Admin/ProjectAccessDialog.tsx",{...shared,"../../lib/blueprintAccess":url("export const useBlueprintAccess=()=>({grants:globalThis.__roleData.grants,error:null,loading:false,reload:async()=>{}});export const saveBlueprintAccess=async()=>{};"),"../../lib/blueprintTypes":new URL("../src/lib/blueprintTypes.ts",import.meta.url).href})
const Management=await compile("../src/pages/Admin/ProjectManagement.tsx",{...shared,"./AdminShell":shell,"../../components/ProjectCard":dummy,"./ProjectAccessDialog":dummy,"./ProjectManagersDialog":dummy,"./ProjectRecycleBin":url("export default function ProjectRecycleBin(){};export function RemoveProjectModal(){}"),"../../lib/recycleBin":url("export const useRecycleBin=()=>({projects:[],loading:false,error:\"\",setup:false,reload:async()=>{}});"),"../../lib/recycleBinModel":new URL("../src/lib/recycleBinModel.ts",import.meta.url).href,"../../lib/projectManagers":managers,"../../lib/projectManagerModel":new URL("../src/lib/projectManagerModel.ts",import.meta.url).href,"../../lib/projects":projects,"../../components/ui/Skeleton":url("export function SkeletonCardGrid(){}"),"../../lib/photoStamp":url("export const captureStamp=async()=>({});")})
const Shell=await compile("../src/pages/Admin/AdminShell.tsx",{"../../lib/auth":auth,"../../lib/admin":url("export const useReviewCount=()=>0;"),"../../lib/projects":projects,"../../assets/valencia/logo-source.png":url("export default 'logo';"),"../../components/SampleNotice":dummy,"../../components/shell/AppShell":dummy,"./AdminIcon":dummy})
function render(Component,key,props={}){if(!hooks.has(key))hooks.set(key,{state:[],effects:[],pending:[],cursor:0});active=hooks.get(key);active.cursor=0;const tree=Component(props),pending=active.pending;active.pending=[];pending.forEach(fn=>fn());return tree}
const nodes=node=>!node?[]:Array.isArray(node)?node.flatMap(nodes):typeof node==="object"?[node,...nodes(node.props?.children),...nodes(node.props?.action),...nodes(node.props?.footer),...nodes(node.props?.actions)]:[]
const text=node=>Array.isArray(node)?node.map(text).join(""):typeof node==="object"&&node?text(node.props?.children):node===null||node===undefined||typeof node==="boolean"?"":String(node)
const find=(tree,predicate)=>nodes(tree).find(predicate)
const settle=()=>new Promise(resolve=>setImmediate(resolve))
const props={project,people,members,onClose(){},onMembersChanged:async()=>{}}

let tree=render(Dialog,"readonly",{...props,readOnly:true});await settle();tree=render(Dialog,"readonly",{...props,readOnly:true})
assert.ok(text(tree).includes("Engineer One"));assert.ok(!find(tree,n=>n.type==="input"&&n.props.id==="access-add"));assert.ok(!find(tree,n=>n.type==="button"&&text(n)==="Remove"))
find(tree,n=>n.type==="button"&&text(n)==="Blueprint access").props.onClick();tree=render(Dialog,"readonly",{...props,readOnly:true})
assert.ok(!find(tree,n=>n.type==="select"));assert.ok(text(tree).includes("Assigned work"));assert.ok(!find(tree,n=>n.type==="button"&&text(n)==="Save changes"));assert.equal(mutations.length,0)
tree=render(Dialog,"editable",props);assert.ok(find(tree,n=>n.type==="input"&&n.props.id==="access-add"));assert.ok(find(tree,n=>n.type==="button"&&text(n)==="Remove"))

for(const role of ["admin","super_admin"]){globalThis.__roleAuth={profile:{role},can:()=>true};tree=render(Shell,"shell-"+role,{activePage:"biometrics",onNavigate(){},children:"Recovery page"});const keys=tree.props.groups.flatMap(group=>group.items.map(item=>item.key));assert.equal(keys.includes("biometrics"),true,"Super Admin has every workspace page, Biometric management included");assert.equal(tree.props.children,"Recovery page"),assert.equal(keys.includes("pm-workspace"),role==="super_admin","only the Super Admin gets the link into the Project Manager workspace")}

for(const role of ["admin","super_admin"]){
  globalThis.__roleAuth={profile:{role},can:()=>true};const key="management-"+role,props={onNavigate(){}};tree=render(Management,key,props);await settle();tree=render(Management,key,props)
  assert.ok(find(tree,n=>n.type==="button"&&text(n)==="Managers"),"manager assignment remains available")
  assert.ok(find(tree,n=>n.type==="button"&&text(n)===(role==="admin"?"View team":"Team & access")))
  find(tree,n=>text(n)==="New project"&&typeof n.props?.onClick==="function").props.onClick();tree=render(Management,key,props)
  const code=find(tree,n=>n.type==="input"&&n.props.placeholder==="VCB-024");code.props.onChange({target:{value:"ROLE-NEW"}});tree=render(Management,key,props)
  const nameLabel=find(tree,n=>n.type==="label"&&text(n).startsWith("Project name"));find(nameLabel,n=>n.type==="input").props.onChange({target:{value:"New real project"}});tree=render(Management,key,props)
  assert.ok(!find(tree,n=>n.type==="label"&&text(n).startsWith("Engineer in charge")),"the Project Manager assigns the engineer after creation")
  assert.ok(!find(tree,n=>n.type==="label"&&text(n).startsWith("Foreman in charge")),"the Project Manager assigns the foreman after creation")
  assert.ok(find(find(tree,n=>n.type==="label"&&text(n).startsWith("Project Manager")),n=>n.type==="select"),"Admin can select a Project Manager when creating a project")
  find(tree,n=>n.type==="form").props.onSubmit({preventDefault(){}});await settle();const saved=mutations.at(-1);assert.equal(saved.table,"projects");assert.equal(Object.hasOwn(saved.payload,"lead_engineer_id"),false);assert.equal(Object.hasOwn(saved.payload,"lead_foreman_id"),false)
}
for(const owner of hooks.values())owner.effects.forEach(effect=>effect?.cleanup?.())
for(const key of ["__roleHooks","__roleAuth","__roleData","__roleDB"])delete globalThis[key]
console.log("Role separation: Super Admin menu/recovery, Admin read-only team/access, retained manager assignment and safe project-save payloads passed")
