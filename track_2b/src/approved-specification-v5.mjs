/** Portable original-form approval and fresh local computation are distinct. */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Version} from 'survey-core';
import {analyze,digest,LIMITS} from './core.mjs';
import {NEW_INPUT_LIMITS} from './new-input.mjs';
import {validateCurrentInput} from './current-admission.mjs';
import {validateJudgeSource} from './judge-contract-v5.mjs';
import {parseQuoteExtraction} from './quote-extraction.mjs';
import {parseManualDraft,validateManualPrior,validateManualProvenance,manualHashes,assertManualApproval} from './manual-prior-v5.mjs';
import {exactKeys,validateFinalSnapshot,coverageSummary} from './review-provenance.mjs';
import {inputHashes,assertV4Approval} from './review-approval.mjs';
import {parseArtifactJson,SPECIFICATION_FILE_LIMIT,RECHECK_RESULT_FILE_LIMIT} from './specification-io.mjs';

export const SPECIFICATION_KIND='formrehearsal-approved-specification';
export const RECHECK_KIND='formrehearsal-recheck-result';
const fail=message=>{const e=new Error(message);e.status=400;throw e;};
const copy=value=>structuredClone(value);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const semanticFiles=['core.mjs','new-input.mjs','apertus.mjs','quote-extraction.mjs','judge-contract.mjs',
  'review-provenance.mjs','manual-specification.mjs','review-approval.mjs','specification-io.mjs','approved-specification.mjs','judge-contract-v5.mjs','manual-prior-v5.mjs','approved-specification-v5.mjs','current-specification-v5.mjs','extraction-specification.mjs','current-specification.mjs','current-admission.mjs'];
/** Fixed paths only: artifacts cannot select modules or engines. */
export function specificationProfile(){
  if(Version!=='3.1.2')fail('Unsupported installed SurveyJS version; expected 3.1.2');
  const implementation=Object.fromEntries(semanticFiles.map(name=>[name,sha(readFileSync(new URL(name,import.meta.url)))]));
  for(const name of ['survey-core','survey-core/linter'])implementation[name]=sha(readFileSync(new URL(import.meta.resolve(name))));
  return {kind:'strict-sparse-extraction-v5-predicates-v1',engine:{name:'survey-core',version:Version},
    driverKinds:['boolean','string-choice'],targetKinds:['boolean','string-choice','bounded-integer'],
    assignments:'complete-in-domain-in-field-order',requiredness:'only-when-target-actually-visible',
    missingDriverAnswers:'not-covered',targetAnswers:'not-enumerated',uncheckedSlots:'unknown',
    compatibility:'identical-policy-drivers-and-form-context-except-target-logic',
    limits:{...LIMITS,states:NEW_INPUT_LIMITS.states},implementation};
}
function validateBasis(basis){
  const source=basis?.kind==='independent-authored-input-v5'?basis.priorRecording:basis?.recording;
  if(source?.provenance?.promptRevision!=='extraction-v5')fail('Sparse v5 specification requires explicit v5 source provenance');
  const manual=basis?.kind==='independent-authored-input-v5';
  if(!manual&&basis?.kind!=='reviewed-input-v4')fail('Unsupported specification review basis');
  exactKeys(basis,['kind','suppliedInput','draftText','rules','review',...(manual?['manualProvenance','priorRecording']:['recording','extraction','reviewProvenance'])]);
  const input=validateCurrentInput(basis.suppliedInput?.rawInputs);
  if(digest(input)!==digest(basis.suppliedInput))fail('Specification original input mismatch');
  let provenance;
  if(manual){
    const parsed=parseManualDraft(basis.draftText,{family:input.family});
    if(parsed.status!=='valid'||digest(parsed.normalizedResult.rules)!==digest(basis.rules))fail('Specification rules differ from independently authored draft');
    const prior=basis.priorRecording===null?null:{recording:basis.priorRecording,originalParsed:validateJudgeSource(basis.priorRecording,input.family)};
    validateManualPrior(input.family,prior);
    provenance=validateManualProvenance(input.family,parsed,prior,basis.manualProvenance);
    assertManualApproval(basis.review,manualHashes(input,basis.rules,basis.draftText,prior,provenance),provenance);
  }else{
    const original=validateJudgeSource(basis.recording,input.family);
    if(original.status!=='valid')fail('Invalid original cannot become a reviewed specification');
    if(typeof basis.draftText!=='string'||Buffer.byteLength(basis.draftText)>65536)fail('Invalid specification draft');
    const parsed=parseQuoteExtraction(basis.draftText,{family:input.family});
    if(parsed.status!=='valid'||digest(parsed.normalizedResult.rules)!==digest(basis.rules))fail('Specification rules differ from reviewed draft');
    if(digest(basis.extraction)!==digest({contractVersion:parsed.contractVersion,normalization:parsed.normalization}))fail('Specification extraction normalization mismatch');
    provenance=validateFinalSnapshot(input.family,original,parsed,basis.recording,basis.reviewProvenance);
    if(basis.recording.provenance.kind==='local-mock-transport'&&provenance.actor.kind!=='agent-simulation')fail('Mock review must remain an agent simulation');
    const hashes={...inputHashes(input.family,input.survey,basis.rules,basis.draftText,basis.recording,input),reviewProvenanceSha256:digest(provenance)};
    assertV4Approval(basis.review,hashes,provenance);
    if(basis.review.edited!==(basis.draftText!==basis.recording.rawFinalText))fail('Specification edit attribution mismatch');
  }
  return {input,coverage:coverageSummary(provenance)};
}
/** Serialize through the public parser so an offered download is importable. */
function portable(value,limit){return parseArtifactJson(JSON.stringify(value,null,2),{limit});}
export function validateSpecification(specification){
  const spec=portable(specification,SPECIFICATION_FILE_LIMIT);
  exactKeys(spec,['kind','version','profile','reviewBasis','specificationSha256']);
  if(spec.kind!==SPECIFICATION_KIND||spec.version!==1)fail('Unsupported specification format');
  const {specificationSha256,...payload}=spec;
  if(specificationSha256!==digest(payload))fail('Specification digest mismatch');
  if(digest(spec.profile)!==digest(specificationProfile()))fail('Specification profile or installed implementation mismatch; use its matching release or review and export again');
  return {specification:spec,...validateBasis(spec.reviewBasis)};
}
export function createApprovedSpecification(reviewBasis){
  const payload={kind:SPECIFICATION_KIND,version:1,profile:specificationProfile(),reviewBasis:copy(reviewBasis)};
  const spec={...payload,specificationSha256:digest(payload)};
  return validateSpecification(spec).specification;
}
export function importSpecification(text){return validateSpecification(parseArtifactJson(text)).specification;}
function context(input){
  const form=copy(input.survey),elements=form.pages?.[0]?.elements??form.elements;
  const targets=new Set(input.family.fields.filter(f=>f.role==='target').map(f=>f.name));
  for(const question of elements)if(targets.has(question.name))for(const key of ['visibleIf','requiredIf','visible','isRequired'])delete question[key];
  return form;
}
function computation(validated,formText){
  const {specification:spec,input:original,coverage}=validated;
  const input=validateCurrentInput({...original.rawInputs,formText});
  if(digest(input.family.fields)!==digest(original.family.fields)||digest(context(input))!==digest(context(original)))fail('Changed form context requires a new review; only target visibleIf, requiredIf, visible and isRequired may change');
  const rules=spec.reviewBasis.rules,report=analyze(input.family,input.survey,{rules,origin:'approved-specification-recheck',reviewStatus:'not-user-attested'});
  if(report.engine.version!==spec.profile.engine.version||report.statesChecked!==input.states)fail('Recheck computation profile mismatch');
  const status=report.findings.length?'discrepancies':coverage.unchecked.length?'no-discrepancies-partial':'no-discrepancies-covered-slots';
  return {origin:'approved-specification-recheck',attestation:'not-user-attested',
    claim:'Fresh finite computation against the original approved predicates. Original approval does not attest this replacement form or establish policy truth. Unchecked slots remain unknown.',
    specificationSha256:spec.specificationSha256,originalInputId:original.inputId,inputId:input.inputId,
    hashes:input.hashes,rulesSha256:digest(rules),profile:copy(spec.profile),coverage:copy(coverage),
    statesChecked:report.statesChecked,findings:report.findings,status,
    analysisExitCode:report.findings.length?1:coverage.unchecked.length?3:0};
}
export function recheckSpecification(specification,formText){
  const validated=validateSpecification(specification),result={kind:RECHECK_KIND,version:1,specification:validated.specification,formText,computation:computation(validated,formText)};
  return portable({...result,resultSha256:digest(result)},RECHECK_RESULT_FILE_LIMIT);
}
export function verifyRecheckResult(value){
  const result=portable(value,RECHECK_RESULT_FILE_LIMIT);
  exactKeys(result,['kind','version','specification','formText','computation','resultSha256']);
  if(result.kind!==RECHECK_KIND||result.version!==1)fail('Unsupported recheck result format');
  const {resultSha256,...payload}=result;
  if(resultSha256!==digest(payload))fail('Recheck result digest mismatch');
  const expected=computation(validateSpecification(result.specification),result.formText);
  if(digest(expected)!==digest(result.computation))fail('Recheck result differs from complete local recomputation');
  return {verified:true,resultSha256,analysisExitCode:expected.analysisExitCode,status:expected.status,attestation:'not-user-attested'};
}
export function importRecheckResult(text){
  const result=parseArtifactJson(text,{limit:RECHECK_RESULT_FILE_LIMIT});verifyRecheckResult(result);return result;
}
