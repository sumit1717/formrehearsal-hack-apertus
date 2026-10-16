/** Data-only native visibility handoff. Fixed installed release; no model or transport. */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Version,Model} from 'survey-core';
import {runSurveyTests,SurveyTestTargets} from 'survey-core/tester';
import {assignments,domain,evaluateCondition,digest} from './core.mjs';
import {importCurrentSpecification,validateCurrentSpecification,recheckCurrentSpecification} from './extraction-specification-r5.mjs';
import {parseArtifactJson,SPECIFICATION_FILE_LIMIT} from './specification-io.mjs';
import {NEW_INPUT_LIMITS} from './new-input.mjs';

export const NATIVE_PROFILE='formrehearsal-native-visibility-regression-v1';
export const NATIVE_FILE_LIMIT=4*1024*1024;
export const nativeJson=value=>JSON.stringify(value,null,2)+'\n';
const sha=value=>createHash('sha256').update(value).digest('hex');
const fail=message=>{throw new Error(message);};
const clone=value=>structuredClone(value);
// Fixed semantic closure plus the original specification's own validated profile.
// No artifact-selected module, filename, options, callback or fingerprint override.
const files=[
  'native-regression-export.mjs','native-regression-cli.mjs','core.mjs','specification-io.mjs',
  'extraction-specification-r5.mjs','extraction-specification.mjs',
  'current-specification.mjs','current-specification-v5.mjs','historical-specification-r5.mjs',
  'approved-specification.mjs','approved-specification-v5.mjs','historical-recording-r5.mjs',
  'current-admission.mjs','new-input.mjs','apertus.mjs','quote-extraction.mjs',
  'review-provenance.mjs','review-approval.mjs','manual-specification.mjs','manual-prior-v5.mjs',
  'judge-contract.mjs','judge-contract-v5.mjs','current-review-analysis-v1.mjs',
  'current-review-execution-v1.mjs','computation-runner.mjs','computation-settings.mjs',
  'computation-supervisor.mjs','computation-task.mjs',
];
export function nativeVisibilityProfile(){
  if(Version!=='3.1.2')fail('Native visibility handoff requires installed survey-core 3.1.2');
  const implementation=Object.fromEntries(files.map(name=>[name,sha(readFileSync(new URL(name,import.meta.url)))]));
  for(const name of ['survey-core','survey-core/linter','survey-core/tester'])implementation[name]=sha(readFileSync(new URL(import.meta.resolve(name))));
  return {kind:NATIVE_PROFILE,version:1,engine:{name:'survey-core',version:Version},implementation};
}
const warnings=[
  'Unsigned hashes establish consistency, not reviewer or provider authentication. A coherently fabricated artifact may pass consistency validation.',
  'Native passed covers exported visibility assertions only. Requiredness and originally unchecked slots have not passed.',
  'No claim of policy truth, whole-form correctness, source rights, or native-engine independence.',
  'Complete declared driver assignments only; missing answers, target answers, transitions, submission and new domains are not covered.',
  'Original approval stays attached to the original form. A replacement is not-user-attested.',
  'Private policy, form, review and source evidence stay local. Export does not authorize upload or sharing.',
  'Closed r5 facade checks are local to the exact installed source; hosted/current release qualification remains pending.',
];
function admitted(specificationText){
  const parsed=parseArtifactJson(specificationText,{limit:SPECIFICATION_FILE_LIMIT});
  if(parsed?.version!==2)fail('Native visibility export requires current-admitted specification version 2');
  const specification=importCurrentSpecification(specificationText);
  return validateCurrentSpecification(specification);
}
function bounded(value,label){
  const text=nativeJson(value);
  if(Buffer.byteLength(text)>NATIVE_FILE_LIMIT)fail(`${label} exceeds its 4 MiB byte limit`);
  // The generated sidecar must obey the same parser/structural caps as verification.
  parseArtifactJson(text,{limit:NATIVE_FILE_LIMIT});
  return text;
}
/** Preserve the caller's exact original UTF-8 specification text, including whitespace. */
export function createNativeVisibilityExport(specificationText){
  const {specification:spec,input,coverage}=admitted(specificationText);
  const basis=spec.reviewBasis,provenance=basis.manualProvenance??basis.reviewProvenance;
  const drivers=input.family.fields.filter(field=>field.role==='driver');
  if(drivers.some(field=>!['boolean','choice'].includes(field.kind)))fail('Native handoff supports Boolean and string-choice drivers only');
  const states=assignments(input.family),rules=basis.rules.filter(rule=>rule.property==='visible');
  const expectedStates=drivers.reduce((count,field)=>count*domain(field).length,1);
  if(states.length<1||states.length>256||states.length!==expectedStates||states.length!==input.states||new Set(states.map(digest)).size!==states.length)fail('Invalid complete finite assignment enumeration');
  for(const state of states)if(Object.keys(state).join('\0')!==drivers.map(field=>field.name).join('\0')||drivers.some(field=>!domain(field).includes(state[field.name])))fail('Incomplete or out-of-domain assignment');
  if(!rules.length)fail('No reviewed visibility rule; refusing a zero-assertion export');
  // SurveyJS reserves "survey" and warns on page/question name collisions.
  // Admission permits those IDs; this new exporter refuses ambiguous native addressing.
  const model=new Model(input.survey);
  try{
    for(const name of new Set([...drivers.map(field=>field.name),...rules.map(rule=>rule.field)])){
      const question=model.getQuestionByName(name),target=SurveyTestTargets.resolve(model,name);
      if(target?.kind!=='question'||target.obj!==question||model.getPageByName(name))fail('Native target name is reserved or ambiguous; requires a fresh review with unambiguous names');
    }
  }finally{model.dispose();}
  const assertionMap=[];
  const tests=states.map((answers,index)=>{
    const name=`state-${String(index+1).padStart(3,'0')}`,expect={};
    for(const rule of rules){
      const expected=evaluateCondition(rule.condition,answers);
      if(typeof expected!=='boolean')fail('Reviewed visibility predicate is not Boolean');
      expect[rule.field]={visible:expected};
      assertionMap.push({test:name,target:rule.field,check:'visible',ruleId:rule.id,
        source:clone(rule.source),sourceOffsets:'UTF-16-end-exclusive',condition:clone(rule.condition),expected});
    }
    return {name,steps:[...drivers.map(field=>({set:{[field.name]:answers[field.name]}})),{expect}]};
  });
  const assertionCount=states.length*rules.length;
  if(assertionMap.length!==assertionCount||tests.some(test=>!Object.keys(test.steps.at(-1).expect).length))fail('Native assertion coverage mismatch');
  const suite={name:'FormRehearsal reviewed visibility regression',
    description:'Complete declared driver assignments; reviewed visibility only. See the local provenance sidecar for scope and omissions.',
    options:{stopOnFirstFailure:false},tests};
  const suiteText=bounded(suite,'Native suite');
  const source=basis.recording??basis.priorRecording??null;
  const payload={profile:nativeVisibilityProfile(),
    scope:{properties:'visibility-only',assignments:'complete-declared-driver-assignments',stateCount:states.length,
      exportedVisibilityRuleCount:rules.length,assertionCount,driverOrder:drivers.map(field=>field.name),
      driverDomains:drivers.map(field=>({field:field.name,kind:field.kind,values:clone(domain(field))}))},
    suite:{filename:'native-suite.json',bytes:Buffer.byteLength(suiteText),sha256:sha(suiteText),canonicalSha256:digest(suite)},
    original:{specificationFilename:'approved-specification.json',specificationBytes:Buffer.byteLength(specificationText),
      specificationFileSha256:sha(specificationText),specificationSha256:spec.specificationSha256,
      inputId:input.inputId,inputHashes:clone(input.hashes),rulesSha256:digest(basis.rules),
      approvalHash:basis.review.approvalHash,approval:clone(basis.review),
      profile:clone(spec.profile),currentProfile:clone(spec.currentProfile),coverage:clone(coverage),
      actor:clone(provenance.actor),reviewProvenance:clone(provenance),
      sourceCapture:source===null?null:{id:source.id,recordingSha256:digest(source),provenance:clone(source.provenance)}},
    assertions:assertionMap,
    originallyUnchecked:clone(provenance.dispositions),
    reviewedButUnexported:basis.rules.filter(rule=>rule.property==='required').map(rule=>({rule:clone(rule),reason:'requiredness-depends-on-actual-visibility'})),
    warnings:clone(warnings)};
  const sidecar={...payload,sidecarSha256:digest(payload)},sidecarText=bounded(sidecar,'Native sidecar');
  return {suite,sidecar,specificationText,suiteText,sidecarText};
}
/** Exact bytes are intentional: alternate serialization requires a new export. */
export function verifyNativeVisibilityExport(specificationText,suiteText,sidecarText){
  parseArtifactJson(suiteText,{limit:NATIVE_FILE_LIMIT});
  parseArtifactJson(sidecarText,{limit:NATIVE_FILE_LIMIT});
  const expected=createNativeVisibilityExport(specificationText);
  if(suiteText!==expected.suiteText||sidecarText!==expected.sidecarText)fail('Native handoff differs from deterministic regeneration or exact original bindings');
  return {verified:true,profile:NATIVE_PROFILE,specificationFileSha256:sha(specificationText),
    suiteSha256:sha(suiteText),sidecarSha256:expected.sidecar.sidecarSha256,...clone(expected.sidecar.scope)};
}
/** Reuse the complete fixed recheck contract, not a second context approximation.
 * This performs the existing finite recheck as well as the native visibility run.
 * No caller-supplied options or execution hooks are accepted or forwarded.
 */
export async function runVerifiedNativeVisibility(specificationText,suiteText,sidecarText,formText){
  const verification=verifyNativeVisibilityExport(specificationText,suiteText,sidecarText);
  if(typeof formText!=='string'||Buffer.byteLength(formText)>NEW_INPUT_LIMITS.formBytes)fail('Replacement form exceeds its byte limit');
  const spec=importCurrentSpecification(specificationText);
  const recheck=recheckCurrentSpecification(spec,formText);
  const suite=parseArtifactJson(suiteText,{limit:NATIVE_FILE_LIMIT});
  const result=await runSurveyTests(JSON.parse(formText),suite);
  const {stateCount,assertionCount}=verification,s=result.summary;
  if(!s||s.total!==stateCount||s.checks!==assertionCount||s.errored!==0||s.skipped!==0||s.canceled!==0||s.warnings!==0||
    !['passed','failed'].includes(result.status)||result.tests.length!==stateCount||result.issues.length)fail('Native runner did not execute the complete visibility suite without errors');
  let observedChecks=0,failedChecks=0,failedTests=0;
  for(let index=0;index<suite.tests.length;index++){
    const expected=suite.tests[index],actual=result.tests[index];
    if(actual.name!==expected.name||actual.steps.length!==expected.steps.length||actual.issues.length)fail('Native test structure mismatch');
    for(let step=0;step<expected.steps.length-1;step++){
      const assigned=actual.steps[step];
      if(assigned.command!=='set'||assigned.status!=='passed'||assigned.checks.length||assigned.issues.length)fail('Native set did not accept an exact declared driver assignment');
    }
    const checks=actual.steps.at(-1);
    if(checks.command!=='expect'||checks.issues.length||checks.checks.length!==Object.keys(expected.steps.at(-1).expect).length)fail('Native assertion structure mismatch');
    let testFailed=false;
    for(const [checkIndex,[target,value]] of Object.entries(expected.steps.at(-1).expect).entries()){
      const check=checks.checks[checkIndex];
      if(check.target!==target||check.check!=='visible'||check.expected!==value.visible||typeof check.actual!=='boolean'||check.passed!==(check.actual===check.expected))fail('Native assertion identity or outcome mismatch');
      observedChecks++;if(!check.passed){failedChecks++;testFailed=true;}
    }
    if(actual.status!==(testFailed?'failed':'passed'))fail('Native test status mismatch');
    if(testFailed)failedTests++;
  }
  if(observedChecks!==assertionCount||failedChecks!==s.failedChecks||failedTests!==s.failed||s.passed!==stateCount-failedTests||result.status!==(failedChecks?'failed':'passed'))fail('Native summary mismatch');
  const payload={kind:'formrehearsal-verified-native-visibility-result-v1',verification,
    context:{admission:'existing-current-recheck-contract',attestation:'not-user-attested',originalInputId:recheck.computation.originalInputId,
      inputId:recheck.computation.inputId,formHashes:clone(recheck.computation.hashes),recheckResultSha256:recheck.resultSha256,
      claim:'Context verified with the unchanged recheck contract. The result below covers native visibility only; original approval does not attest the replacement.'},
    nativeResult:result,warnings:clone(warnings)};
  const output={...payload,resultSha256:digest(payload)};bounded(output,'Native result');return output;
}
