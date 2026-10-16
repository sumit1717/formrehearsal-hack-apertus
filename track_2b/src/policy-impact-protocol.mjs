/** Additive, data-only transport. The existing comparison remains semantic authority. */
import {digest,domain} from './core.mjs';
import {createHash} from 'node:crypto';
import {parseFormJson} from './new-input.mjs';
import {parseArtifactJson,SPECIFICATION_FILE_LIMIT} from './specification-io.mjs';
import {COMPUTATION_INPUT_BYTES,COMPUTATION_OUTPUT_BYTES,computationError} from './computation-settings.mjs';
export const POLICY_IMPACT_BODY_LIMIT=2*1024*1024;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,keys)=>object(value)&&Object.keys(value).sort().join('\0')===[...keys].sort().join('\0');
const fail=message=>{throw Object.assign(new Error(message),{status:400});};
const check=value=>{if(!value)throw computationError('invalid-result');};
export function impactProfileCount(spec){
  if(spec?.kind!=='formrehearsal-approved-specification'||spec.version!==2)fail('Choose a current version 2 approved specification');
  const fields=spec.reviewBasis?.suppliedInput?.family?.fields;
  if(!Array.isArray(fields)||fields.length<5||fields.length>10||fields.some(f=>!object(f)||!['boolean','choice'].includes(f.kind)||!['driver','target'].includes(f.role)))fail('Policy impact supports 5–10 Boolean or finite-choice fields only');
  const drivers=fields.filter(f=>f.role==='driver');
  if(!drivers.length||drivers.length>6||drivers.length===fields.length)fail('Policy impact needs 1–6 independent drivers and a target');
  const count=drivers.reduce((n,f)=>n*domain(f).length,1);
  if(count>256||spec.reviewBasis.suppliedInput.states!==count)fail('Policy impact supports at most 256 complete declared scenarios');
  return count;
}
export function preparePolicyImpactPayload(oldSpecificationText,newSpecification){
  const oldSpecification=parseArtifactJson(oldSpecificationText), next=parseArtifactJson(JSON.stringify(newSpecification));
  impactProfileCount(oldSpecification);impactProfileCount(next);
  const formText=next.reviewBasis.suppliedInput.rawInputs?.formText;
  if(typeof formText!=='string'||Buffer.byteLength(formText)>32768)fail('Current reviewed form must fit the 32 KiB limit');
  const payload={operation:'policy-impact',oldSpecification,newSpecification:next,formText};
  if(Buffer.byteLength(JSON.stringify(payload))>COMPUTATION_INPUT_BYTES-1024)fail('Combined comparison inputs exceed the 2 MiB computation limit');
  return payload;
}
export function assertPolicyImpactPayload(payload){
  if(!exact(payload,['operation','oldSpecification','newSpecification','formText'])||payload.operation!=='policy-impact')fail('Invalid policy comparison input');
  for(const spec of [payload.oldSpecification,payload.newSpecification]){
    if(Buffer.byteLength(JSON.stringify(spec))>SPECIFICATION_FILE_LIMIT)fail('Approved specification exceeds 1 MiB');
    impactProfileCount(spec);
  }
  if(payload.formText!==payload.newSpecification.reviewBasis.suppliedInput.rawInputs?.formText)fail('Use the exact current reviewed form');
  if(typeof payload.formText!=='string'||Buffer.byteLength(payload.formText)>32768||Buffer.byteLength(JSON.stringify(payload))>COMPUTATION_INPUT_BYTES-1024)fail('Comparison input exceeds its byte limit');
}
/** Completeness and request binding only, never a second predicate evaluator. */
export function assertPolicyImpactResponse(payload,message){
  check(Buffer.byteLength(JSON.stringify(message))<=COMPUTATION_OUTPUT_BYTES);
  check(exact(message,['requestSha256','status',message?.status==='complete'?'result':'error'])&&message.requestSha256===digest(payload));
  if(message.status==='invalid'){
    check(typeof message.error==='string'&&message.error.length>0&&message.error.length<=1000&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(message.error));return;
  }
  check(message.status==='complete');
  const r=message.result,n=impactProfileCount(payload.newSpecification),fields=payload.newSpecification.reviewBasis.suppliedInput.family.fields;
  check(exact(r,['kind','engine','summary','reviews','currentForm','fields','changedSlots','unknownSlots','slotCounts','scenarios','limitations'])
    &&r.kind==='formrehearsal-policy-change-impact'&&digest(r.engine)===digest({name:'survey-core',version:'3.1.2'})
    &&exact(r.currentForm,['formText','hashes','attestation'])&&r.currentForm.formText===payload.formText&&r.currentForm.attestation==='not-user-attested'&&digest(r.fields)===digest(fields)
    &&Array.isArray(r.scenarios)&&r.scenarios.length===n&&Array.isArray(r.changedSlots)&&Array.isArray(r.unknownSlots)&&Array.isArray(r.slotCounts)&&Array.isArray(r.limitations));
  for(const side of ['old','new']){
    const spec=payload[side+'Specification'],review=r.reviews?.[side],basis=spec.reviewBasis;
    check(review?.specificationSha256===spec.specificationSha256&&review.policyText===basis.suppliedInput.rawInputs.policyText
      &&digest(review.review)===digest(basis.review)&&digest(review.provenance)===digest(basis.manualProvenance??basis.reviewProvenance)
      &&review.policyTextSha256===basis.suppliedInput.hashes.policyTextSha256&&review.sourceKind===basis.kind
      &&digest(review.extractionProvenance)===digest(basis.recording?.provenance??basis.priorRecording?.provenance??null));
  }
  const original=payload.oldSpecification.reviewBasis.suppliedInput,rawInputs={...original.rawInputs,formText:payload.formText};
  const sha=text=>createHash('sha256').update(text).digest('hex');
  const family={...original.family,id:'input-'+digest(rawInputs)};
  check(digest(r.currentForm.hashes)===digest({policyTextSha256:sha(rawInputs.policyText),formTextSha256:sha(rawInputs.formText),
    driverTextSha256:sha(rawInputs.driverText),rawInputsSha256:digest(rawInputs),familySha256:digest(family),schemaSha256:digest(original.family.fields),formSha256:digest(parseFormJson(payload.formText))}));
  const drivers=fields.filter(f=>f.role==='driver'),slots=fields.filter(f=>f.role==='target').flatMap(f=>['visible','required'].map(p=>f.name+'/'+p)),seen=new Set();
  const covered=Object.fromEntries(['old','new'].map(side=>[side,new Set(payload[side+'Specification'].reviewBasis.rules.map(rule=>rule.field+'/'+rule.property))]));
  const totals={changedScenarios:0,fullyUnchangedScenarios:0,noKnownChangeButUnknownScenarios:0,scenariosWithUnknownSlots:0,changedScenariosNeedingFormUpdate:0,scenariosWithCurrentFormDiscrepancy:0};
  for(const row of r.scenarios){
    check(exact(row,['answers','slots'])&&exact(row.answers,drivers.map(f=>f.name))&&exact(row.slots,slots));
    const key=JSON.stringify(drivers.map(f=>{check(domain(f).includes(row.answers[f.name]));return row.answers[f.name];}));check(!seen.has(key));seen.add(key);
    for(const [slot,state]of Object.entries(row.slots)){
      check(exact(state,['status','oldExpected','newExpected','currentFormBehavior','currentVisible','comparison'])
        &&typeof state.currentFormBehavior==='boolean'&&typeof state.currentVisible==='boolean');
      for(const side of ['old','new'])check(covered[side].has(slot)?typeof state[side+'Expected']==='boolean':state[side+'Expected']===null);
      const status=!covered.old.has(slot)||!covered.new.has(slot)?'unknown':state.oldExpected===state.newExpected?'unchanged':'changed';
      const required=slot.endsWith('/required');
      const comparison=status==='unknown'?'unknown':required&&!state.currentVisible?'skipped-hidden-target':state.currentFormBehavior===state.newExpected?'matches-new':'differs-from-new';
      check(state.status===status&&state.comparison===comparison&&(!required?state.currentFormBehavior===state.currentVisible:true));
    }
    for(const field of fields.filter(f=>f.role==='target'))check(row.slots[field.name+'/required'].currentVisible===row.slots[field.name+'/visible'].currentFormBehavior);
    const values=Object.values(row.slots),changed=values.some(s=>s.status==='changed'),unknown=values.some(s=>s.status==='unknown');
    totals.changedScenarios+=Number(changed);totals.fullyUnchangedScenarios+=Number(!changed&&!unknown);
    totals.noKnownChangeButUnknownScenarios+=Number(!changed&&unknown);totals.scenariosWithUnknownSlots+=Number(unknown);
    totals.changedScenariosNeedingFormUpdate+=Number(values.some(s=>s.status==='changed'&&s.comparison==='differs-from-new'));
    totals.scenariosWithCurrentFormDiscrepancy+=Number(values.some(s=>s.comparison==='differs-from-new'));
  }
  check(digest(r.summary)===digest({declaredScenarios:n,...totals}));
  // Every complete changed direction needs one card; a truncated card list must
  // not leave a nonzero headline beside an empty-result claim.
  const direction=(slot,state)=>digest({slot,oldExpected:state.oldExpected,newExpected:state.newExpected,
    currentFormBehavior:state.currentFormBehavior,currentVisible:state.currentVisible,comparison:state.comparison});
  const groups=new Map();
  for(const row of r.scenarios)for(const [slot,state]of Object.entries(row.slots))if(state.status==='changed'){
    const key=direction(slot,state);groups.set(key,(groups.get(key)??0)+1);
  }
  check(r.changedSlots.length===groups.size);
  const cards=new Set();
  for(const card of r.changedSlots){
    const slot=card.field+'/'+card.property,key=direction(slot,card),row=r.scenarios.find(row=>digest(row.answers)===digest(card.answers));
    check(groups.has(key)&&!cards.has(key)&&card.status==='changed'&&card.declaredScenarios===groups.get(key)
      &&row&&direction(slot,row.slots[slot])===key&&object(card.minimalAnswers)
      &&Object.entries(card.minimalAnswers).every(([name,value])=>drivers.some(f=>f.name===name)&&card.answers[name]===value));
    cards.add(key);
    for(const side of ['old','new'])check(digest(card[side+'Rule'])===digest(payload[side+'Specification'].reviewBasis.rules.find(rule=>rule.field===card.field&&rule.property===card.property)));
    const completions=r.scenarios.filter(row=>Object.entries(card.minimalAnswers).every(([name,value])=>row.answers[name]===value));
    check(card.guaranteedCompletions===completions.length&&completions.every(row=>row.slots[slot].status==='changed'&&direction(slot,row.slots[slot])===key));
    check(card.unchangedNeighbor===null?!r.scenarios.some(row=>row.slots[slot].status==='unchanged'):object(card.unchangedNeighbor));
    if(card.unchangedNeighbor){
      const neighbor=card.unchangedNeighbor,neighborRow=r.scenarios.find(row=>digest(row.answers)===digest(neighbor.answers));
      check(neighborRow?.slots[slot].status==='unchanged'&&neighbor.scope==='this-target-property-only'
        &&neighbor.expected===neighborRow.slots[slot].oldExpected&&neighbor.currentFormBehavior===neighborRow.slots[slot].currentFormBehavior
        &&neighbor.currentVisible===neighborRow.slots[slot].currentVisible&&neighbor.comparison===neighborRow.slots[slot].comparison);
    }
  }
  check(r.slotCounts.length===slots.length&&new Set(r.slotCounts.map(slot=>slot.field+'/'+slot.property)).size===slots.length);
  for(const count of r.slotCounts){const slot=count.field+'/'+count.property;check(slots.includes(slot));
    for(const status of ['changed','unchanged','unknown'])check(count[status]===r.scenarios.filter(row=>row.slots[slot].status===status).length);
  }
  const unknown=slots.filter(slot=>r.scenarios.some(row=>row.slots[slot].status==='unknown'));
  check(r.unknownSlots.length===unknown.length&&new Set(r.unknownSlots.map(slot=>slot.field+'/'+slot.property)).size===unknown.length);
  for(const slot of r.unknownSlots){check(unknown.includes(slot.field+'/'+slot.property));
    for(const side of ['old','new']){
      const basis=payload[side+'Specification'].reviewBasis,rule=basis.rules.find(rule=>rule.field===slot.field&&rule.property===slot.property);
      check(slot[side+'RulePresent']===!!rule&&digest(slot[side+'Disposition'])===digest((basis.manualProvenance??basis.reviewProvenance).dispositions.find(item=>item.field===slot.field&&item.property===slot.property)??null));
    }
  }
}
