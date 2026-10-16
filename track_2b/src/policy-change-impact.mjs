/** Bounded policy amendment comparison. Existing approval/recheck contracts stay unchanged. */
import {assignments,digest,evaluateCondition,executeSurvey} from './core.mjs';
import {validateCurrentSpecification,recheckCurrentSpecification} from './extraction-specification-r5.mjs';
import {validateCurrentInput} from './current-admission.mjs';
import {reviewSlots,slotKey} from './review-provenance.mjs';

const fail=message=>{throw new Error(message);};
const provenance=spec=>spec.reviewBasis.manualProvenance??spec.reviewBasis.reviewProvenance;
function reviewed(value){
  const result=validateCurrentSpecification(value);
  if(result.specification.version!==2)fail('Policy impact requires two separately reviewed current version 2 specifications');
  if(result.input.family.fields.some(field=>!['boolean','choice'].includes(field.kind)))fail('Policy impact supports Boolean and finite choice fields only');
  return result;
}
function context(input){
  const form=structuredClone(input.survey),targets=new Set(input.family.fields.filter(field=>field.role==='target').map(field=>field.name));
  for(const question of form.pages?.[0]?.elements??form.elements)if(targets.has(question.name)){
    for(const property of ['visibleIf','requiredIf','visible','isRequired'])delete question[property];
  }
  return {form,fields:input.family.fields,driverText:input.rawInputs.driverText};
}
function* subsets(names,size,start=0,path=[]){
  if(size===0){yield path;return;}
  for(let index=start;index<=names.length-size;index++)yield* subsets(names,size-1,index+1,[...path,names[index]]);
}
/** Exhaustive smallest-cardinality sufficient constraint, including current behavior.
 * Mirrors core's finite minimization without changing its frozen source fingerprint.
 */
function minimum(group,rows,names,key,signature){
  for(let size=0;size<=names.length;size++)for(const subset of subsets(names,size))for(const row of group){
    const minimalAnswers=Object.fromEntries(subset.map(name=>[name,row.answers[name]]));
    const completions=rows.filter(item=>subset.every(name=>item.answers[name]===row.answers[name]));
    if(completions.every(item=>item.slots[key].signature===signature))return {
      minimalAnswers,guaranteedCompletions:completions.length,answers:row.answers,steps:row.steps,
    };
  }
  fail('Policy impact minimization invariant failed');
}
function reviewSummary(spec){
  const basis=spec.reviewBasis;
  return {specificationSha256:spec.specificationSha256,policyText:basis.suppliedInput.rawInputs.policyText,
    policyTextSha256:basis.suppliedInput.hashes.policyTextSha256,review:structuredClone(basis.review),
    provenance:structuredClone(provenance(spec)),sourceKind:basis.kind,
    extractionProvenance:structuredClone(basis.recording?.provenance??basis.priorRecording?.provenance??null)};
}

/** Inputs are independently validated before any comparison. Never transfers approval. */
export function comparePolicyChange(oldSpecification,newSpecification,formText){
  const old=reviewed(oldSpecification),next=reviewed(newSpecification);
  if(old.specification.specificationSha256===next.specification.specificationSha256
    ||old.specification.reviewBasis.review.approvalHash===next.specification.reviewBasis.review.approvalHash)
    fail('Supply two separately approved specifications');
  if(old.input.rawInputs.policyText===next.input.rawInputs.policyText)fail('The policy text has not changed');
  if(digest(context(old.input))!==digest(context(next.input)))fail('Policy impact requires identical driver and target context; review the same declared form context on both sides');
  const current=validateCurrentInput({...old.input.rawInputs,formText});
  if(digest(context(current))!==digest(context(old.input)))fail('Current form context differs; only target visibility and requiredness logic may change');
  // Both original contracts independently admit the current form. No policy is
  // passed through recheck, no approval is edited and no replacement is approved.
  recheckCurrentSpecification(old.specification,formText);
  recheckCurrentSpecification(next.specification,formText);
  const slots=reviewSlots(old.input.family),names=old.input.family.fields.filter(field=>field.role==='driver').map(field=>field.name);
  const oldRules=new Map(old.specification.reviewBasis.rules.map(rule=>[slotKey(rule),rule]));
  const newRules=new Map(next.specification.reviewBasis.rules.map(rule=>[slotKey(rule),rule]));
  const rows=assignments(current.family).map(answers=>{
    const run=executeSurvey(current.family,current.survey,answers),states={};
    for(const slot of slots){
      const key=slotKey(slot),a=oldRules.get(key),b=newRules.get(key),native=run.states[slot.field];
      const before=a?evaluateCondition(a.condition,answers):null,after=b?evaluateCondition(b.condition,answers):null;
      const status=!a||!b?'unknown':before===after?'unchanged':'changed';
      const comparison=status==='unknown'?'unknown':slot.property==='required'&&!native.visible?'skipped-hidden-target':native[slot.property]===after?'matches-new':'differs-from-new';
      const value={status,oldExpected:before,newExpected:after,currentFormBehavior:native[slot.property],currentVisible:native.visible,comparison};
      // Unknown has no equality signature, even when both sides omit a slot.
      states[key]={...value,signature:status==='unknown'?null:digest(value)};
    }
    return {answers,steps:run.steps,slots:states};
  });
  if(rows.length>256||rows.length!==current.states)fail('Policy impact requires at most 256 complete declared scenarios');
  const changedSlots=[],unknownSlots=[];
  for(const slot of slots){
    const key=slotKey(slot),a=oldRules.get(key),b=newRules.get(key);
    if(!a||!b){
      unknownSlots.push({...slot,oldRulePresent:Boolean(a),newRulePresent:Boolean(b),
        oldDisposition:structuredClone(provenance(old.specification).dispositions.find(item=>slotKey(item)===key)??null),
        newDisposition:structuredClone(provenance(next.specification).dispositions.find(item=>slotKey(item)===key)??null)});
      continue;
    }
    const groups=new Map();
    for(const row of rows)if(row.slots[key].status==='changed'){
      const signature=row.slots[key].signature;if(!groups.has(signature))groups.set(signature,[]);groups.get(signature).push(row);
    }
    for(const [signature,group] of groups){
      const witness=minimum(group,rows,names,key,signature),state=group[0].slots[key];
      // A nearest unchanged neighbour applies to this target/property only.
      // Other slots can still be unknown or changed; the report says so.
      const distance=row=>names.filter(name=>row.answers[name]!==witness.answers[name]).length;
      const neighbor=rows.filter(row=>row.slots[key].status==='unchanged').sort((a,b)=>{
        const delta=distance(a)-distance(b);if(delta)return delta;
        // On a distance tie preserve earlier declared drivers (the cohort) first.
        for(const name of names){const tie=Number(a.answers[name]!==witness.answers[name])-Number(b.answers[name]!==witness.answers[name]);if(tie)return tie;}
        return 0;
      })[0];
      const {signature:ignored,...behavior}=state;
      changedSlots.push({...slot,...behavior,oldRule:structuredClone(a),newRule:structuredClone(b),
        declaredScenarios:group.length,...witness,unchangedNeighbor:neighbor?{
          answers:neighbor.answers,differingDrivers:names.filter(name=>neighbor.answers[name]!==witness.answers[name]),
          expected:neighbor.slots[key].oldExpected,currentFormBehavior:neighbor.slots[key].currentFormBehavior,
          currentVisible:neighbor.slots[key].currentVisible,comparison:neighbor.slots[key].comparison,
          scope:'this-target-property-only',otherUnknownSlots:Object.entries(neighbor.slots).filter(([,value])=>value.status==='unknown').map(([name])=>name),
        }:null});
    }
  }
  const has=(row,status)=>Object.values(row.slots).some(slot=>slot.status===status);
  const summary={declaredScenarios:rows.length,changedScenarios:rows.filter(row=>has(row,'changed')).length,
    fullyUnchangedScenarios:rows.filter(row=>Object.values(row.slots).every(slot=>slot.status==='unchanged')).length,
    noKnownChangeButUnknownScenarios:rows.filter(row=>!has(row,'changed')&&has(row,'unknown')).length,
    scenariosWithUnknownSlots:rows.filter(row=>has(row,'unknown')).length,
    changedScenariosNeedingFormUpdate:rows.filter(row=>Object.values(row.slots).some(slot=>slot.status==='changed'&&slot.comparison==='differs-from-new')).length,
    scenariosWithCurrentFormDiscrepancy:rows.filter(row=>Object.values(row.slots).some(slot=>slot.comparison==='differs-from-new')).length};
  return {kind:'formrehearsal-policy-change-impact',engine:{name:'survey-core',version:'3.1.2'},summary,
    reviews:{old:reviewSummary(old.specification),new:reviewSummary(next.specification)},
    currentForm:{formText,hashes:current.hashes,attestation:'not-user-attested'},fields:current.family.fields,
    changedSlots,unknownSlots,
    slotCounts:slots.map(slot=>({...slot,...Object.fromEntries(['changed','unchanged','unknown'].map(status=>[status,rows.filter(row=>row.slots[slotKey(slot)].status===status).length]))})),
    scenarios:rows.map(({answers,slots:values})=>({answers,slots:Object.fromEntries(Object.entries(values).map(([key,{signature,...value}])=>[key,value]))})),
    limitations:[
      'Counts describe complete declared driver assignments, not people, traffic, likelihood or business impact.',
      'Changes compare reviewed Boolean predicates. Required-predicate changes are reported even for currently hidden targets; native requiredness comparison is skipped while hidden.',
      'Unknown slots never count as unchanged or passing. An unchanged neighbor describes only the named target/property.',
      'Only the existing single-page Boolean/choice finite subset is supported. Missing answers, target answers, transitions and submission are not checked.',
      'Both approvals and their provenance remain separate. Identity is unverified; no policy truth, independent human review or new model result is established.',
      'Current form execution is fresh and is not approved by either original review. No automatic repair or production change is performed.',
    ]};
}
