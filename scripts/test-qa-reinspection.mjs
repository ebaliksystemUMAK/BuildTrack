import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import ts from "typescript"
import { correctionCloseProblem } from "../src/lib/qaReinspectionModel.ts"
import { toleranceText } from "../src/lib/qaModel.ts"
import { inspectionReportHtml } from "../src/lib/qaPrint.ts"
import { linkedDefects, irRef, ncrRef } from "../src/lib/workItemModel.ts"
import { photoEligible } from "../src/lib/photoStamp.ts"
import { createContext } from "react"

const uri = value => "data:text/javascript;base64," + Buffer.from(value).toString("base64")
let slots=[],effects=[],queued=[],cursor=0,tree,calls=[],changed=0,toasts=[]
globalThis.__reinspectHooks={
  useState(initial){const n=cursor++;if(!(n in slots))slots[n]=typeof initial==="function"?initial():initial;return[slots[n],next=>{slots[n]=typeof next==="function"?next(slots[n]):next}]},
  useRef(initial){const n=cursor++;return slots[n]??={current:initial}},
  useMemo:fn=>fn(), createContext,
  useCallback(fn,deps){const n=cursor++,old=slots[n];if(old&&deps.every((d,i)=>d===old.deps[i]))return old.fn;slots[n]={fn,deps};return fn},
  useEffect(fn,deps){const n=cursor++,old=effects[n];if(!old||deps.some((d,i)=>d!==old.deps?.[i]))queued.push(()=>{old?.cleanup?.();effects[n]={deps,cleanup:fn()}})},
}
globalThis.__reinspectDeps={toleranceText,buttonSecondary:"button",inputClass:"input",refNumber:(_,n)=>`IR-${String(n).padStart(4,"0")}`,useToast:()=>({success:(...v)=>toasts.push(v),error:(...v)=>toasts.push(v)}),byColumn:()=>[],useLiveReload:()=>{}}
async function compile(file){
  const source=readFileSync(new URL(file,import.meta.url),"utf8"),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
  let output=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
  for(const decl of ast.statements.filter(ts.isImportDeclaration)){
    if(!decl.importClause||decl.importClause.isTypeOnly)continue
    const name=decl.moduleSpecifier.text,exports=[]
    if(decl.importClause.name)exports.push("export default function Stub(){return null}")
    for(const item of decl.importClause.namedBindings?.elements??[]){if(item.isTypeOnly)continue;const key=item.propertyName?.text??item.name.text;exports.push(`export const ${key}=globalThis.${name==="react"?"__reinspectHooks":"__reinspectDeps"}.${key}`)}
    output=output.replaceAll(`from "${name}"`,`from ${JSON.stringify(uri(exports.join(";")))}`)
  }
  output=output.replaceAll('from "react/jsx-runtime"',`from ${JSON.stringify(import.meta.resolve("react/jsx-runtime"))}`)
  return import(uri(output))
}
const all=n=>Array.isArray(n)?n.flatMap(all):n&&typeof n==="object"?[n,...all(n.props?.children)]:[]
const text=n=>Array.isArray(n)?n.map(text).join(""):n?.props?text(n.props.children):typeof n==="string"||typeof n==="number"?String(n):""
const find=fn=>{const n=all(tree).find(fn);assert.ok(n,"Expected reinspection control");return n}
const button=label=>find(n=>n.type==="button"&&text(n)===label)
const render=(Component,props)=>{cursor=0;tree=Component(props);const jobs=queued;queued=[];jobs.forEach(fn=>fn());return tree}
const reset=()=>{effects.forEach(e=>e?.cleanup?.());slots=[];effects=[];queued=[];cursor=0}
const {default:Scope}=await compile("../src/components/qa/ReinspectionScope.tsx")
let props={loading:false,error:"",onChanged:async()=>changed++,onOpenInspection:id=>calls.push(["open",id]),rows:[
  {id:"passed",inspection_id:"original",source_number:1,text:"Finish",result:"pass",acceptance_criteria:"Approved finish"},
  {id:"failed",inspection_id:"original",source_number:1,text:"Opening",result:"fail"},
  {id:"selected",inspection_id:"original",source_number:1,text:"Alignment",result:"fail"},
]}
render(Scope,props)
assert.match(text(tree),/Full QC checklist reinspection/)
assert.match(text(tree),/Every check.*fresh result.*including previously passed checks/s)
assert.match(text(tree),/does not resubmit unrelated QC checklists or the whole project/)
assert.match(text(tree),/Previous Pass.*Must be checked again/s)
assert.match(text(tree),/Earlier results and evidence remain unchanged/)
assert.ok(!all(tree).some(n=>n.type==="select"||n.type==="textarea"),"No selective-scope editor")
assert.ok(!all(tree).some(n=>n.type==="details"),"Previous results are immediately visible in their own tab")
assert.match(text(tree),/close automatically.*fresh signed-off Pass/)
button("View original result and evidence").props.onClick();assert.deepEqual(calls.at(-1),["open","original"])
reset();render(Scope,{...props,nameOf:()=>"Earlier Engineer",rows:[{...props.rows[1],kind:"measure",measured_value:0,unit:"mm",min_value:0,max_value:5,remarks:"Opening was below the approved size",checked_by:"engineer",checked_at:"2026-10-27T01:00:00Z"}]})
assert.match(text(tree),/Previous Fail/);assert.match(text(tree),/Recorded measurement: 0 mm/)
assert.match(text(tree),/Previous remarks: Opening was below the approved size/)
assert.match(text(tree),/Earlier Engineer/)
assert.ok(!all(tree).some(n=>n.type==="input"||n.type==="textarea"||n.type==="select"),"Earlier results and measurements are read-only")
reset();render(Scope,{...props,fullChecklist:false})
assert.match(text(tree),/current QC Checklist tab defines what must be reinspected/)
assert.doesNotMatch(text(tree),/Every check.*fresh result|Must be checked again/)
for(const extra of [{loading:true},{error:"offline"}]){
  reset();render(Scope,{...props,...extra})
  assert.ok(!all(tree).some(n=>n.type==="li"),"Old history hidden while loading or unavailable")
}
await button("Retry").props.onClick();assert.equal(changed,1)
assert.equal(correctionCloseProblem(null,"requested"),"")
assert.equal(correctionCloseProblem("attempt","passed","",false,true),"")
assert.equal(correctionCloseProblem("attempt","failed","",false,true),"","An unrelated failed check does not invalidate this finding's signed-off Pass")
assert.ok(correctionCloseProblem("attempt","passed","",false,false),"A passed request for a different finding cannot close this NCR")
for(const status of [null,"requested","in_progress","conditional","failed","cancelled"])assert.ok(correctionCloseProblem("attempt",status))
assert.match(correctionCloseProblem("attempt","passed","offline"),/unavailable/)
assert.ok(correctionCloseProblem("attempt","passed","",true))
console.log("Full checklist QA UI: every check needs fresh results, immutable reference history, no selective scope, error/retry and NCR closure readiness passed")

// Context queries are keyed, reject late answers, and never leave earlier scope visible for a new inspection.
const requests=[]
globalThis.__reinspectDeps.supabase={rpc:(name,args)=>new Promise(resolve=>requests.push({name,args,resolve}))}
const {useReinspectionContext,useCorrectionInspection}=await compile("../src/lib/qaReinspection.ts")
let result
const Hook=({id})=>{result=useReinspectionContext(id);return null}
reset();render(Hook,{id:"old"});render(Hook,{id:"new"})
assert.equal(result.loading,true);assert.deepEqual(result.rows,[])
requests[1].resolve({data:[{id:"new-check"}],error:null});await new Promise(resolve=>setImmediate(resolve));render(Hook,{id:"new"});assert.equal(result.rows[0].id,"new-check")
requests[0].resolve({data:[{id:"old-check"}],error:null});await new Promise(resolve=>setImmediate(resolve));render(Hook,{id:"new"});assert.equal(result.rows[0].id,"new-check")
render(Hook,{id:"bad"});requests[2].resolve({error:{message:"denied"}});await new Promise(resolve=>setImmediate(resolve));render(Hook,{id:"bad"});assert.ok(result.error);assert.deepEqual(result.rows,[])
const count=requests.length;render(Hook,{id:null});render(Hook,{id:null});assert.equal(requests.length,count);assert.equal(result.loading,false)
console.log("QA history context: exact RPC id, stale inspection masking, late-answer rejection, read failure and disabled query passed")

const Ready=({defect,attempt})=>{result=useCorrectionInspection(defect,attempt);return null}
reset();const offset=requests.length
render(Ready,{defect:"NCR-A",attempt:"shared-package"})
render(Ready,{defect:"NCR-B",attempt:"shared-package"})
assert.equal(result.loading,true);assert.equal(result.ready,false)
assert.deepEqual(requests[offset].args,{p_defect:"NCR-A"});assert.deepEqual(requests[offset+1].args,{p_defect:"NCR-B"})
requests[offset+1].resolve({data:{id:"repair",status:"failed",number:2,ready:false},error:null});await new Promise(resolve=>setImmediate(resolve));render(Ready,{defect:"NCR-B",attempt:"shared-package"})
requests[offset].resolve({data:{id:"repair",status:"failed",number:2,ready:true},error:null});await new Promise(resolve=>setImmediate(resolve));render(Ready,{defect:"NCR-B",attempt:"shared-package"})
assert.equal(result.ready,false,"NCR A's late Pass cannot authorize NCR B, even within one shared correction package")
assert.equal(result.loading,false)
console.log("NCR readiness: keyed by finding and attempt, same-package isolation and stale-Pass rejection passed")

const report=inspectionReportHtml({inspection:{number:2,title:"Wall",status:"passed",score:100,threshold:75,trade:"general",standards:[],full_checklist_reinspection:true,reinspection_of:"original"},items:[{position:0,text:"Opening",severity:"major",kind:"check",result:"pass",measured_value:null,acceptance_criteria:"Approved <finish>"}],defects:[],project:{name:"Test",code:"T"},nameOf:()=>"Engineer"})
assert.match(report,/Full QC checklist reinspection, including previously passed checks/);assert.match(report,/not whole-project acceptance/);assert.match(report,/Approved &lt;finish&gt;/)
assert.doesNotMatch(report,/Targeted|reinspection scope only|Engineer scope reason/)
console.log("Full checklist QA print report: complete scope, preserved history, no project-acceptance claim and escaping passed")

// Correction confirmation uses a wider dialog and short labels that fit one aligned button row on mobile.
let options, confirmed=false, submissions=0, busy=[]
Object.assign(globalThis.__reinspectDeps,{
  useAuth:()=>({profile:{id:"foreman"}}), useConfirm:()=>async value=>{options=value;return confirmed}, linkedDefects, irRef, ncrRef, photoEligible,
  qaActions:{submitCorrection:async()=>{submissions++;return {ok:true}}},
})
const originalNavigator=Object.getOwnPropertyDescriptor(globalThis,"navigator")
Object.defineProperty(globalThis,"navigator",{configurable:true,value:{onLine:true}})
const {default:CorrectionForm}=await compile("../src/components/qa/CorrectionForm.tsx")
const item={id:"wall",text:"WALL"},draft={id:"repair",item_id:item.id,remarks:"Repaired and checked wall finish",previous_inspection_id:"old"}
const formProps={formId:"correction",item,pin:{id:"pin"},draft,previousIr:7,pinItems:[item],attempts:[draft],photos:[{id:"photo",qa_attempt_id:draft.id,stamp_flag:null}],defects:[],submissions:[],onChanged:async()=>{},onBusy:value=>busy.push(value)}
reset();render(CorrectionForm,formProps)
const submitForm=async()=>{find(node=>node.type==="form").props.onSubmit({preventDefault(){}});await new Promise(resolve=>setImmediate(resolve))}
await submitForm()
assert.equal(options.title,"Submit correction?")
assert.equal(options.size,"md")
assert.equal(options.confirmLabel,"Submit request")
assert.match(options.message,/full recorded QC checklist will be reinspected.*including previously passed checks/)
assert.match(options.message,/Original results and evidence stay unchanged/)
assert.equal(submissions,0,"Cancel must not submit the correction")
confirmed=true
await submitForm()
assert.equal(submissions,1,"The short button still submits only after confirmation")
assert.deepEqual(busy,[true,false,true,false])

const {ConfirmProvider}=await compile("../src/lib/confirm.tsx")
reset();render(ConfirmProvider,{children:null})
let answer=tree.props.value(options)
render(ConfirmProvider,{children:null})
let dialog=find(node=>node.props?.title==="Submit correction?")
assert.equal(dialog.props.size,"md")
let actions=all(dialog.props.footer).filter(node=>node.type==="button")
assert.deepEqual(actions.map(text),["Cancel","Submit request"])
assert.ok(actions.every(node=>node.props.type==="button"))
assert.ok(actions.every(node=>node.props.className.includes("px-4 py-2")),"Both controls retain equal vertical padding")
actions[0].props.onClick();assert.equal(await answer,false)
render(ConfirmProvider,{children:null});assert.ok(!all(tree).some(node=>node.props?.title))
answer=tree.props.value({title:"Other confirmation"})
render(ConfirmProvider,{children:null});dialog=find(node=>node.props?.title==="Other confirmation")
assert.equal(dialog.props.size,"sm","Other confirmations retain their existing size")
actions=all(dialog.props.footer).filter(node=>node.type==="button")
actions[1].props.onClick();assert.equal(await answer,true)
if(originalNavigator)Object.defineProperty(globalThis,"navigator",originalNavigator);else delete globalThis.navigator
console.log("Foreman correction confirmation: wider dialog, compact title/action, aligned button padding, cancel/confirm safety and unchanged shared-dialog defaults passed")
