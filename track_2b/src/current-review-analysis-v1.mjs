/** Current review only: invocation-private complete native observations.
 * Frozen analysis ordering/minimization and coverage checks are retained.
 * No supplied rows, cross-request cache or alternate execution hooks.
 */
import {Version} from 'survey-core';
import {lintSurvey} from 'survey-core/linter';
import {assignments,digest,evaluateCondition,executeSurvey,validateFields,validateRules,validateSurvey} from './core.mjs';
const fail=message=>{throw new Error(message);};
const familyDigest=family=>digest({id:family.id,policy:family.policy,fields:family.fields});
const familyHash=familyDigest;
function differences(rules,answers,states){
  return rules.flatMap(r=>{const state=states[r.field];if(r.property==='required'&&!state.visible)return [];const expected=evaluateCondition(r.condition,answers), observed=state[r.property];return expected===observed?[]:[{ruleId:r.id,field:r.field,property:r.property,expected,observed,source:r.source,condition:r.condition}];});
}
function subsets(names,k,start=0,path=[],out=[]){if(!k){out.push(path);return out;}for(let i=start;i<=names.length-k;i++)subsets(names,k-1,i+1,[...path,names[i]],out);return out;}
const signature=d=>`${d.ruleId}:${d.expected}:${d.observed}`;
/** Index complete assignment partitions once per driver subset. A signature is
 * sufficient for a cube exactly when it occurs in every row in that partition.
 * Intersection keeps hidden requiredness rows in the universal obligation.
 * BigInt avoids the 32-bit limit: ten fields can produce 36 mismatch groups.
 * Search preserves the frozen ordering: cardinality, field subset, first row.
 * This is invocation-private; no supplied rows or cross-request index is used.
 */
function minimumWitnesses(groups,rows,names){
  const witnesses=new Map();
  if(!groups.size)return witnesses;
  const bits=new Map([...groups.keys()].map((sig,index)=>[sig,1n<<BigInt(index)]));
  const rowMasks=rows.map(row=>row.differences.reduce((mask,d)=>mask|bits.get(signature(d)),0n));
  for(let size=0;size<=names.length;size++)for(const subset of subsets(names,size)){
    const partitions=new Map();
    rows.forEach((row,index)=>{
      // Domains are validated primitives; JSON arrays preserve typed tuples.
      const values=subset.map(name=>row.answers[name]),key=JSON.stringify(values);
      let partition=partitions.get(key);
      if(!partition){partition={values,first:row,count:0,common:rowMasks[index]};partitions.set(key,partition);}
      partition.count++;
      partition.common&=rowMasks[index];
    });
    // Map insertion order is the first complete assignment for each cube.
    // If sufficient, that assignment is also its first violating assignment.
    for(const partition of partitions.values())for(const [sig,bit] of bits){
      if(witnesses.has(sig)||(partition.common&bit)===0n)continue;
      const {first,values,count}=partition;
      witnesses.set(sig,{minimalAnswers:Object.fromEntries(subset.map((name,index)=>[name,values[index]])),
        guaranteedCompletions:count,answers:first.answers,states:first.states,steps:first.steps});
    }
    if(witnesses.size===groups.size)return witnesses;
  }
  fail('Witness minimization invariant failed');
}
export function analyzeReviewWithCoverage(family,survey,rules,options={}){
  const origin=options.origin??'unverified';
  const reviewStatus=options.reviewStatus??'pending-human-review';
  validateFields(family);validateRules(family,rules);validateSurvey(family,survey);
  const start=performance.now();const native=lintSurvey(survey);
  const rows=assignments(family).map(answers=>{const run=executeSurvey(family,survey,answers);return {answers,...run,differences:differences(rules,answers,run.states)};});
  const groups=new Map();for(const row of rows)for(const d of row.differences){const sig=signature(d);if(!groups.has(sig))groups.set(sig,[]);groups.get(sig).push({...row,difference:d});}
  const names=family.fields.filter(f=>f.role==='driver').map(f=>f.name);
  const witnesses=minimumWitnesses(groups,rows,names);
  const findings=[...groups.entries()].map(([sig,group])=>{const witness=witnesses.get(sig);return {...group[0].difference,...witness,violatingStates:group.length,certificate:{familyId:family.id,familySha256:familyDigest(family),surveySha256:digest(survey),rulesSha256:digest(rules),answers:witness.answers}};}).sort((a,b)=>Object.keys(a.minimalAnswers).length-Object.keys(b.minimalAnswers).length||a.ruleId.localeCompare(b.ruleId)||Number(a.expected)-Number(b.expected));
  const report={familyId:family.id,provenance:{origin,reviewStatus,modelInference:'not-run',claim:'Finite execution against supplied rules; not evidence of prose interpretation accuracy.'},engine:{name:'survey-core',version:'3.1.2'},native,statesChecked:rows.length,findings,durationMs:Math.round((performance.now()-start)*10)/10,surveySha256:digest(survey),rulesSha256:digest(rules)};
  return {report,operationalCoverage:coverageFromCompleteRows(family,survey,rules,report,rows)};
}
function coverageFromCompleteRows(family,survey,rules,report,rows){
  const surveySha256=digest(survey),rulesSha256=digest(rules);
  if(!report||report.familyId!==family.id||report.surveySha256!==surveySha256||report.rulesSha256!==rulesSha256
    ||report.statesChecked!==rows.length||report.engine?.name!=='survey-core'||report.engine.version!==Version||Version!=='3.1.2'
    ||!Array.isArray(report.findings))fail('Operational coverage does not match the complete analysis inputs or engine');
  const counts=rules.map(rule=>({ruleId:rule.id,field:rule.field,property:rule.property,totalStates:rows.length,
    conditionTrueStates:0,comparedStates:0,skippedHiddenStates:0,conditionTrueComparedStates:0,mismatchStates:0}));
  for(const {answers,states} of rows){
    rules.forEach((rule,index)=>{
      const row=counts[index],expected=evaluateCondition(rule.condition,answers),actual=states[rule.field];
      if(typeof expected!=='boolean'||typeof actual?.visible!=='boolean'||typeof actual?.[rule.property]!=='boolean')fail('Operational coverage requires complete Boolean observations');
      if(expected)row.conditionTrueStates++;
      if(rule.property==='required'&&!actual.visible){row.skippedHiddenStates++;return;}
      row.comparedStates++;if(expected)row.conditionTrueComparedStates++;
      if(expected!==actual[rule.property])row.mismatchStates++;
    });
  }
  const mismatches=new Map(rules.map(rule=>[rule.id,0]));
  for(const finding of report.findings){
    if(!mismatches.has(finding.ruleId)||!Number.isSafeInteger(finding.violatingStates)||finding.violatingStates<1)fail('Operational coverage requires complete finding counts');
    mismatches.set(finding.ruleId,mismatches.get(finding.ruleId)+finding.violatingStates);
  }
  for(const row of counts){
    if(row.comparedStates+row.skippedHiddenStates!==row.totalStates||row.conditionTrueStates>row.totalStates
      ||row.conditionTrueComparedStates>row.comparedStates||row.mismatchStates>row.comparedStates
      ||row.mismatchStates!==mismatches.get(row.ruleId))fail('Operational coverage differs from the complete finding counts');
  }
  const uncheckedSlots=family.fields.filter(field=>field.role==='target').flatMap(field=>['visible','required']
    .filter(property=>!rules.some(rule=>rule.field===field.name&&rule.property===property)).map(property=>({field:field.name,property})));
  return {kind:'finite-rule-applicability',version:1,familyId:family.id,familySha256:familyHash(family),surveySha256,rulesSha256,
    engine:{name:'survey-core',version:Version},totalStates:rows.length,rules:counts,uncheckedSlots,
    domainScope:{kind:'declared-finite-domains',integerDrivers:family.fields.filter(field=>field.role==='driver'&&field.kind==='integer').map(field=>field.name),
      claim:'Only complete answers in the declared finite driver domains are counted. Declared integer domains exclude fractions. Missing, null, out-of-domain and target-answer combinations are not covered.'},
    claim:'Counts describe predicate truth and comparisons actually made. Requiredness is compared only while the form actually shows the target. A never-true predicate can be intentional; these counts do not establish policy truth or whole-form correctness.'};
}
