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
find(n=>n.type==='textarea').props.onChange({target:{value:''}});render()
assert.equal(find(n=>n.type==='textarea').props.required,undefined)
assert.equal(find(n=>n.type==='textarea').props.minLength,undefined)
await find(n=>n.type==='form').props.onSubmit({preventDefault(){}});await Promise.resolve();render()
assert.equal(calls.filter(c=>c.name==='submit_pin_schedule_proposal').at(-1).args.p_reason,'','A technical reason is optional when sending dates to the PM')
await Promise.resolve();render()
const dateInputs=all(tree).filter(n=>n.type==='input'&&n.props.type==='date')
dateInputs[1].props.onChange({target:{value:'2026-11-01'}});render()
const count=calls.length
await find(n=>n.type==='form').props.onSubmit({preventDefault(){}});render();assert.equal(calls.length,count);assert.match(text(tree),/correct order/)
console.log('Engineer pin proposal: private draft loading, proposed dates, revision-safe submission, PM handoff, failed-save retention and date validation passed')

// Exercise the actual Add Pin dialog and its field refs, including submission from the modal footer.
const editor=readFileSync(new URL('../src/components/editor/BlueprintEditor.tsx',import.meta.url),'utf8')
const editorAst=ts.createSourceFile('editor.tsx',editor,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
const dialog=editorAst.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='NewPinDialog')
assert.ok(dialog)
const dialogSource=`import {useState,useRef} from "react";import Modal from "modal";const field='',primary='',secondary='',categoryLabels={progress:'Progress',note:'Note'},timelinePhases=['Preparation','Foundation'];${dialog.getText(editorAst)};export default NewPinDialog`
let dialogOutput=ts.transpileModule(dialogSource,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
dialogOutput=dialogOutput.replaceAll('from "react/jsx-runtime"',`from ${JSON.stringify(import.meta.resolve('react/jsx-runtime'))}`).replaceAll('from "react"',`from ${JSON.stringify(url('export const useState=globalThis.__proposalHooks.useState;export const useRef=globalThis.__proposalHooks.useRef'))}`).replaceAll('from "modal"',`from ${JSON.stringify(url('export default function Modal(){}'))}`)
const NewPin=(await import(url(dialogOutput))).default
slots=[];effects=[];jobs=[]
let created=[],focused=[],scrolled=[],createFailure=null,teamRetries=0
let newPinTeam=[{user_id:'FOREMAN',full_name:'Eligible Foreman',role:'foreman',can_take_work:true},{user_id:'VIEW',full_name:'View only Foreman',role:'foreman',can_take_work:false},{user_id:'ENGINEER',full_name:'Engineer',role:'engineer',can_take_work:true}]
let newPinTeamError='',newPinTeamLoading=false
const renderPin=()=>{
  cursor=0;tree=NewPin({planTitle:'First floor architectural plan',team:newPinTeam,teamLoading:newPinTeamLoading,teamError:newPinTeamError,onRetryTeam(){teamRetries++},onClose(){},onCreate:async(...args)=>{created.push(args);if(createFailure instanceof Error)throw createFailure;return createFailure}})
  const fields=all(tree).filter(n=>n.props?.ref)
  fields.forEach((node,index)=>node.props.ref({focus:()=>focused.push(index),scrollIntoView:()=>scrolled.push(index)}))
}
const change=(index,value)=>{all(tree).filter(n=>n.type==='input'||n.type==='textarea')[index].props.onChange({target:{value}});renderPin()}
const savePin=async()=>{await find(n=>n.type==='form').props.onSubmit({preventDefault(){}});renderPin()}
renderPin();assert.equal(tree.props.size,'lg');assert.match(text(tree),/First floor architectural plan/)
assert.match(text(tree),/Eligible Foreman/);assert.doesNotMatch(text(tree),/View only Foreman/)
const foremanSelect=()=>find(n=>n.type==='select'&&n.props['aria-describedby']==='new-pin-foreman-help')
foremanSelect().props.onChange({target:{value:'FOREMAN'}});renderPin()
await savePin();assert.equal(created.length,0);assert.equal(focused.at(-1),0);assert.equal(scrolled.at(-1),0)
assert.equal(find(n=>n.type==='input').props['aria-invalid'],true)
change(0,'  Foundation  ');change(1,'2026-12-01');await savePin()
assert.equal(created.length,0);assert.equal(focused.at(-1),3,'Missing deadline is focused')
change(1,'');change(2,'2026-12-10');await savePin();assert.equal(focused.at(-1),2,'Missing start is focused')
change(1,'2026-12-11');await savePin();assert.equal(focused.at(-1),3,'Reversed deadline is focused')
change(1,'1899-12-01');await savePin();assert.equal(focused.at(-1),2)
change(1,'2026-12-01');change(3,'');await savePin();assert.equal(focused.at(-1),4,'Missing proposed phase is focused')
change(3,'Foundation');await savePin()
assert.deepEqual(created.at(-1),['Foundation','progress',{start:'2026-12-01',end:'2026-12-10',phase:'Foundation',reason:''},'FOREMAN'])
assert.equal(find(n=>n.type==='textarea').props.required,undefined)
const assignedCount=created.length
newPinTeam=[];renderPin();await savePin();assert.equal(created.length,assignedCount);assert.equal(focused.at(-1),1,'Stale Foreman selection is focused without creating a partial pin')
newPinTeamError='Could not load the project team';renderPin()
find(n=>n.type==='button'&&text(n)==='Refresh Foreman list').props.onClick();assert.equal(teamRetries,1)
newPinTeamError='';newPinTeamLoading=true;renderPin();assert.equal(find(n=>n.type==='select'&&n.props.disabled).props.disabled,true)
newPinTeamLoading=false;renderPin();find(n=>n.type==='select'&&n.props.value==='FOREMAN').props.onChange({target:{value:''}});renderPin();await savePin()
assert.equal(created.at(-1)[3],null,'Leaving a new work pin unassigned is allowed')
change(1,'');change(2,'');const createdCount=created.length;await savePin();assert.equal(created.length,createdCount,'Work pins require a proposed schedule')
find(n=>n.type==='select').props.onChange({target:{value:'note'}});renderPin();await savePin();assert.equal(created.at(-1)[2],null,'Note pins do not request work schedules')
assert.equal(created.at(-1)[3],null)
assert.ok(!all(tree).some(n=>n.type==='select'&&n.props['aria-describedby']==='new-pin-foreman-help'),'Notes do not show a Foreman picker')
createFailure=new Error('Network unavailable');await savePin();assert.match(text(tree),/Could not add the pin/)
assert.equal(all(tree.props.footer).find(n=>n.type==='button'&&n.props.type==='submit').props.disabled,false,'Failed requests allow retry')
createFailure=null;await savePin();assert.ok(!all(tree).some(n=>n.props?.role==='alert'))
console.log('Add Pin: selected plan, eligible Foreman assignment, stale selection/loading/error/retry, required dates/phase, first invalid field focus/scroll, optional reason, note exception and failed-request retry passed')

const inspectorSource=readFileSync(new URL('../src/components/editor/Inspector.tsx',import.meta.url),'utf8')
const inspectorAst=ts.createSourceFile('inspector.tsx',inspectorSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
const detailFunction=inspectorAst.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='PinDetailSections')
assert.ok(detailFunction)
let detailOutput=ts.transpileModule(`import {useState} from 'react';function Tabs(){};function PinDetailsTab(){};function PinFields(){};function PinScheduleProposal(){};${detailFunction.getText(inspectorAst)};export default PinDetailSections`,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
detailOutput=detailOutput.replaceAll('from "react/jsx-runtime"',`from ${JSON.stringify(import.meta.resolve('react/jsx-runtime'))}`).replaceAll("from 'react'",`from ${JSON.stringify(url('export const useState=globalThis.__proposalHooks.useState'))}`)
const Details=(await import(url(detailOutput))).default
slots=[];let detailProps={pin:{id:'PIN',category:'progress'},canEdit:true,team:[],inDialog:true,onChanged(){},onPinChanged(){}}
const renderDetails=()=>{cursor=0;tree=Details(detailProps)}
renderDetails()
let tabs=find(n=>n.props?.label==='Pin detail sections')
assert.deepEqual(tabs.props.tabs.map(t=>t.key),['overview','edit','schedule'])
assert.equal(find(n=>n.props?.['aria-label']==='Pin overview').props.hidden,false)
tabs.props.onChange('edit');renderDetails()
assert.equal(find(n=>n.props?.['aria-label']==='Edit pin details').props.hidden,false)
assert.equal(find(n=>n.type?.name==='PinFields').props.onSaved,detailProps.onChanged)
find(n=>n.props?.label==='Pin detail sections').props.onChange('schedule');renderDetails()
assert.equal(find(n=>n.props?.['aria-label']==='Pin schedule').props.hidden,false)
assert.ok(all(tree).some(n=>n.type?.name==='PinFields'),'Edit form remains mounted when switching tabs')
detailProps={...detailProps,canEdit:false};renderDetails()
assert.ok(!all(tree).some(n=>['PinFields','PinScheduleProposal'].includes(n.type?.name)),'Read-only roles do not receive editor or proposal controls')
assert.equal(find(n=>n.props?.['aria-label']==='Pin overview').props.hidden,false)
detailProps={...detailProps,canEdit:true,pin:{id:'PIN',category:'note'}};renderDetails()
assert.deepEqual(find(n=>n.props?.label==='Pin detail sections').props.tabs.map(t=>t.key),['overview','edit'])
console.log('Pin Details: separate overview/edit/schedule tabs, preserved mounted forms, note and read-only role boundaries passed')
