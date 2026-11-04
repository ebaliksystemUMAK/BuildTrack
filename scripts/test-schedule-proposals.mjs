import assert from "node:assert/strict"
import {readFileSync} from "node:fs"
import ts from "typescript"

const url=source=>"data:text/javascript;base64,"+Buffer.from(source).toString("base64")
let slots=[],cursor=0,tree,effects=[],jobs=[],calls=[],failure=null,notices=[]
globalThis.__proposalHooks={
  useState(initial){const n=cursor++;if(!(n in slots))slots[n]=typeof initial==='function'?initial():initial;return[slots[n],value=>{slots[n]=typeof value==='function'?value(slots[n]):value}]},
  useRef(initial){return this.useState({current:initial})[0]},
  useEffect(fn,values){const n=cursor++,old=effects[n];if(!old||values.some((v,i)=>v!==old.values[i]))jobs.push(()=>{old?.cleanup?.();effects[n]={values,cleanup:fn()}})},
}
// Imported hook functions need no receiver.
globalThis.__proposalHooks.useRef=initial=>globalThis.__proposalHooks.useState({current:initial})[0]
let revision=1
globalThis.__proposalDeps={
  useToast:()=>({success:(...args)=>notices.push(args)}),timelinePhases:["Foundation","Structural","Unassigned"],
  supabase:{rpc(name,args){calls.push({name,args});return Promise.resolve(name==='get_pin_schedule_proposal'?{data:{draft:{proposal:{planned_start:'2026-12-01',planned_end:'2026-12-10',phase:'Foundation'},reason:'Technical sequencing',expected_revision:revision},can_propose:true,pending:0},error:null}:{data:2,error:failure})}},
}
const source=readFileSync(new URL('../src/components/editor/PinScheduleProposal.tsx',import.meta.url),'utf8')
const ast=ts.createSourceFile('proposal.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
const compiled=ts.transpileModule(source,{reportDiagnostics:true,compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}})
assert.equal(compiled.diagnostics?.length??0,0)
let output=compiled.outputText
const replacements={'react/jsx-runtime':import.meta.resolve('react/jsx-runtime')}
for(const node of ast.statements.filter(ts.isImportDeclaration)){
 if(node.importClause?.isTypeOnly)continue
 const name=node.moduleSpecifier.text,bindings=[]
 for(const b of node.importClause?.namedBindings?.elements??[]){if(!b.isTypeOnly)bindings.push(`export const ${b.name.text}=globalThis.${name==='react'?'__proposalHooks':'__proposalDeps'}.${b.name.text}`)}
 replacements[name]=url(bindings.join(';'))
}
for(const[name,value]of Object.entries(replacements))output=output.replaceAll(`from "${name}"`,`from ${JSON.stringify(value)}`)
const Component=(await import(url(output))).default
const render=()=>{cursor=0;tree=Component({pin:{id:'PIN',project_id:'PROJECT',category:'progress'}});const pending=jobs;jobs=[];pending.forEach(fn=>fn());return tree}
const all=node=>Array.isArray(node)?node.flatMap(all):node&&typeof node==='object'?[node,...all(node.props?.children)]:[]
const text=node=>Array.isArray(node)?node.map(text).join(''):node?.props?text(node.props.children):typeof node==='string'||typeof node==='number'?String(node):''
const find=fn=>{const result=all(tree).find(fn);assert.ok(result,'Expected proposal control');return result}
render();await Promise.resolve();render()
assert.match(text(tree),/Propose work dates/)
assert.equal(find(n=>n.type==='input'&&n.props.type==='date').props.value,'2026-12-01')
await find(n=>n.type==='form').props.onSubmit({preventDefault(){}});await Promise.resolve();render()
let sent=calls.find(c=>c.name==='submit_pin_schedule_proposal');assert.ok(sent);assert.deepEqual(sent.args,{p_pin:'PIN',p_start:'2026-12-01',p_end:'2026-12-10',p_phase:'Foundation',p_reason:'Technical sequencing',p_expected:1})
assert.match(notices[0][0],/Project Manager/)
await Promise.resolve();render()
failure={message:'Schedule changed. Reload before saving.'}
await find(n=>n.type==='button'&&text(n)==='Save proposal draft').props.onClick({preventDefault(){}});await Promise.resolve();render()
assert.match(text(tree),/Schedule changed/)
assert.equal(find(n=>n.type==='input'&&n.props.type==='date').props.value,'2026-12-01','Failed save retains the Engineer input')
failure=null
const dateInputs=all(tree).filter(n=>n.type==='input'&&n.props.type==='date')
dateInputs[1].props.onChange({target:{value:'2026-11-01'}});render()
const count=calls.length
await find(n=>n.type==='form').props.onSubmit({preventDefault(){}});render();assert.equal(calls.length,count);assert.match(text(tree),/correct order/)
console.log('Engineer pin proposal: private draft loading, proposed dates, revision-safe submission, PM handoff, failed-save retention and date validation passed')
