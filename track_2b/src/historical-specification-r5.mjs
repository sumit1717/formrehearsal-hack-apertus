/** Additive closed r5 portable artifacts. Neither original captures nor frozen
 * profile validators are changed. These unsigned local consistency claims do
 * not authenticate reviewers, the provider, or the historical execution.
 */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Version} from 'survey-core';
import {digest,LIMITS} from './core.mjs';
import {NEW_INPUT_LIMITS} from './new-input.mjs';
import {validateCurrentInput,CURRENT_ADMISSION_MODE} from './current-admission.mjs';
import {parseQuoteExtraction} from './quote-extraction.mjs';
import {exactKeys,validateFinalSnapshot,coverageSummary} from './review-provenance.mjs';
import {inputHashes,assertV4Approval} from './review-approval.mjs';
import {parseArtifactJson,SPECIFICATION_FILE_LIMIT,RECHECK_RESULT_FILE_LIMIT} from './specification-io.mjs';
import {assertComputationResult} from './computation-runner.mjs';
import {analyzeReviewWithCoverage} from './current-review-analysis-v1.mjs';
import {currentReviewExecutionDescriptor} from './current-review-execution-v1.mjs';
import {HISTORICAL_R5_KIND,HISTORICAL_R5_PROFILE,HISTORICAL_R5_CURRENT_PROFILE,
  validateHistoricalR5Source,historicalR5EvidenceProfile} from './historical-recording-r5.mjs';

export const SPECIFICATION_KIND='formrehearsal-approved-specification';
export const RECHECK_KIND='formrehearsal-recheck-result';
const fail=message=>{const error=new Error(message);error.status=400;throw error;};
const sha=value=>createHash('sha256').update(value).digest('hex');
const copy=value=>structuredClone(value);
const portable=(value,limit)=>parseArtifactJson(JSON.stringify(value,null,2),{limit});
// Complete fixed local semantic closure, including the untouched dispatch path
// loaded by the fixed worker. No caller-supplied module, engine or path exists.
const semanticFiles=[
  'core.mjs','new-input.mjs','current-admission.mjs','apertus.mjs','quote-extraction.mjs',
  'review-provenance.mjs','review-approval.mjs','specification-io.mjs',
  'historical-recording-r5.mjs','historical-specification-r5.mjs','extraction-specification-r5.mjs',
  'current-review-analysis-v1.mjs','current-review-execution-v1.mjs',
  'computation-runner.mjs','computation-settings.mjs','computation-supervisor.mjs','computation-task.mjs',
  'extraction-specification.mjs','current-specification.mjs','current-specification-v5.mjs',
  'approved-specification.mjs','approved-specification-v5.mjs','judge-contract.mjs','judge-contract-v5.mjs',
  'manual-specification.mjs','manual-prior-v5.mjs',
];
const promptFiles=['extraction.txt','direct.txt','extraction-v3.txt','extraction-v4.txt','extraction-v5.txt'];
export function historicalR5SpecificationProfile(){
  if(Version!=='3.1.2')fail('Unsupported installed SurveyJS version; expected 3.1.2');
  const implementation=Object.fromEntries(semanticFiles.map(name=>[name,sha(readFileSync(new URL(name,import.meta.url)))]));
  for(const name of promptFiles)implementation[`prompts/${name}`]=sha(readFileSync(new URL(`../prompts/${name}`,import.meta.url)));
  for(const name of ['survey-core','survey-core/linter'])implementation[name]=sha(readFileSync(new URL(import.meta.resolve(name))));
  return {kind:HISTORICAL_R5_PROFILE,engine:{name:'survey-core',version:Version},
    sourceKind:HISTORICAL_R5_KIND,driverKinds:['boolean'],targetKinds:['boolean'],
    assignments:'complete-in-domain-in-field-order',requiredness:'only-when-target-actually-visible',
    missingDriverAnswers:'not-covered',targetAnswers:'not-enumerated',uncheckedSlots:'unknown',
    compatibility:'identical-policy-drivers-and-form-context-except-target-logic',
    limits:{...LIMITS,states:NEW_INPUT_LIMITS.states},implementation,evidence:historicalR5EvidenceProfile()};
}
export function historicalR5CurrentProfile(){
  return {kind:HISTORICAL_R5_CURRENT_PROFILE,admission:CURRENT_ADMISSION_MODE,
    expressions:'bounded-existing-parser-and-native-unknown-function-rejection;no-added-unary-bang-or-functions',
    predicates:'one-original-route-check-visible-true-predicate;three-unchecked-slots',
    comparison:'exact-expected-observed-boolean-equality',requiredness:'only-when-target-actually-visible',
    execution:currentReviewExecutionDescriptor(),
    claim:'Current local review and recheck release, separate from the retained historical capture and parser. Original review revision remains in reviewBasis.review.draftRevision.'};
}
function validateBasis(basis){
  exactKeys(basis,['kind','suppliedInput','draftText','rules','review','recording','extraction','reviewProvenance']);
  if(basis.kind!=='reviewed-input-v4')fail('Historical r5 requires the exact reviewed-input-v4 basis');
  const input=validateCurrentInput(basis.suppliedInput?.rawInputs);
  if(digest(input)!==digest(basis.suppliedInput))fail('Historical r5 original input mismatch');
  const original=validateHistoricalR5Source(basis.recording,input);
  if(typeof basis.draftText!=='string'||Buffer.byteLength(basis.draftText)>65536)fail('Invalid historical r5 draft');
  const parsed=parseQuoteExtraction(basis.draftText,{family:input.family});
  if(parsed.status!=='valid'||digest(parsed.normalizedResult.rules)!==digest(basis.rules))fail('Historical r5 rules differ from reviewed draft');
  if(basis.draftText!==basis.recording.rawFinalText||digest(basis.rules)!==digest(original.normalizedResult.rules))fail('Historical r5 is closed to its exact original one-rule draft; authored additions or changes require a separate review journey');
  if(digest(basis.extraction)!==digest({contractVersion:parsed.contractVersion,normalization:parsed.normalization}))fail('Historical r5 extraction normalization mismatch');
  const provenance=validateFinalSnapshot(input.family,original,parsed,basis.recording,basis.reviewProvenance);
  const hashes={...inputHashes(input.family,input.survey,basis.rules,basis.draftText,basis.recording,input),reviewProvenanceSha256:digest(provenance)};
  assertV4Approval(basis.review,hashes,provenance);
  if(basis.review.edited!==false)fail('Historical r5 edit attribution mismatch');
  const coverage=coverageSummary(provenance);
  if(coverage.present!==1||coverage.unchecked.length!==3||coverage.unresolved.length)fail('Historical r5 requires explicit dispositions for three unchecked slots');
  return {input,coverage};
}
function validated(spec){
  exactKeys(spec,['kind','version','profile','currentProfile','reviewBasis','specificationSha256']);
  if(spec.kind!==SPECIFICATION_KIND||spec.version!==2)fail('Unsupported historical r5 specification format');
  const {specificationSha256,...payload}=spec;
  if(specificationSha256!==digest(payload))fail('Specification digest mismatch');
  if(digest(spec.profile)!==digest(historicalR5SpecificationProfile()))fail('Historical r5 specification profile or installed implementation mismatch');
  if(digest(spec.currentProfile)!==digest(historicalR5CurrentProfile()))fail('Historical r5 current execution profile mismatch');
  return {specification:spec,...validateBasis(spec.reviewBasis)};
}
export function validateCurrentSpecification(value){return validated(portable(value,SPECIFICATION_FILE_LIMIT));}
export function createCurrentApprovedSpecification(reviewBasis){
  const basis=copy(reviewBasis);validateBasis(basis);
  const payload={kind:SPECIFICATION_KIND,version:2,profile:historicalR5SpecificationProfile(),currentProfile:historicalR5CurrentProfile(),reviewBasis:basis};
  return validateCurrentSpecification({...payload,specificationSha256:digest(payload)}).specification;
}
export function importCurrentSpecification(text){return validated(parseArtifactJson(text)).specification;}

function context(input){
  const form=copy(input.survey),elements=form.pages?.[0]?.elements??form.elements;
  const targets=new Set(input.family.fields.filter(field=>field.role==='target').map(field=>field.name));
  for(const question of elements)if(targets.has(question.name))for(const key of ['visibleIf','requiredIf','visible','isRequired'])delete question[key];
  return form;
}
function prepare(original,formText){
  const input=validateCurrentInput({...original.input.rawInputs,formText});
  if(digest(input.family.fields)!==digest(original.input.family.fields)||digest(context(input))!==digest(context(original.input)))fail('Changed form context requires a new review; only target visibleIf, requiredIf, visible and isRequired may change');
  return {input,payload:{operation:'review-analysis',family:input.family,survey:input.survey,rules:copy(original.specification.reviewBasis.rules),
    options:{origin:'approved-specification-recheck',reviewStatus:'not-user-attested'}}};
}
/** The server submits only this data to the existing fixed isolated worker. */
export function prepareHistoricalR5Recheck(specification,formText){return prepare(validateCurrentSpecification(specification),formText);}
function assemble(original,formText,prepared,workerResult){
  assertComputationResult(prepared.payload,workerResult);
  const {specification:spec,input:previous,coverage}=original,{input}=prepared,report=workerResult.report;
  if(report.engine.version!==spec.profile.engine.version||report.statesChecked!==input.states)fail('Historical r5 computation profile mismatch');
  const computation={origin:'approved-specification-recheck',attestation:'not-user-attested',
    claim:'Fresh finite computation against the original approved predicates. Original approval does not attest this replacement form or establish policy truth. Unchecked slots remain unknown.',
    specificationSha256:spec.specificationSha256,originalInputId:previous.inputId,inputId:input.inputId,
    hashes:copy(input.hashes),rulesSha256:digest(spec.reviewBasis.rules),profile:copy(spec.profile),coverage:copy(coverage),
    statesChecked:report.statesChecked,findings:copy(report.findings),
    status:report.findings.length?'discrepancies':'no-discrepancies-partial',analysisExitCode:report.findings.length?1:3};
  const payload={kind:RECHECK_KIND,version:2,currentProfile:historicalR5CurrentProfile(),specification:spec,formText,computation};
  return portable({...payload,resultSha256:digest(payload)},RECHECK_RESULT_FILE_LIMIT);
}
/** Complete transport validation, including exact release and fresh input
 * binding, precedes result assembly. The fixed worker is the execution trust
 * boundary; the portable verifier below independently recomputes semantics.
 */
export function assembleHistoricalR5Recheck(specification,formText,workerResult){
  const original=validateCurrentSpecification(specification),prepared=prepare(original,formText);
  return assemble(original,formText,prepared,workerResult);
}
function recheck(original,formText){
  const prepared=prepare(original,formText),{family,survey,rules,options}=prepared.payload;
  const result={...analyzeReviewWithCoverage(family,survey,rules,options),executionDescriptor:currentReviewExecutionDescriptor()};
  return assemble(original,formText,prepared,result);
}
export function recheckCurrentSpecification(specification,formText){return recheck(validateCurrentSpecification(specification),formText);}
export function verifyCurrentRecheckResult(value){
  const result=portable(value,RECHECK_RESULT_FILE_LIMIT);
  exactKeys(result,['kind','version','currentProfile','specification','formText','computation','resultSha256']);
  if(result.kind!==RECHECK_KIND||result.version!==2)fail('Unsupported historical r5 recheck result format');
  const {resultSha256,...payload}=result;
  if(resultSha256!==digest(payload))fail('Recheck result digest mismatch');
  if(digest(result.currentProfile)!==digest(historicalR5CurrentProfile()))fail('Historical r5 current result profile mismatch');
  const expected=recheck(validateCurrentSpecification(result.specification),result.formText);
  if(digest(expected)!==digest(result))fail('Recheck result differs from complete local recomputation');
  return {verified:true,resultSha256,analysisExitCode:expected.computation.analysisExitCode,status:expected.computation.status,
    attestation:'not-user-attested',verificationScope:'closed-historical-r5-evidence-and-current-local-recomputation',
    currentAdmission:'replacement-validated',originalAdmission:'current-validated',providerOrigin:'host-declared-not-independently-authenticated'};
}
export function importCurrentRecheckResult(text){
  const result=parseArtifactJson(text,{limit:RECHECK_RESULT_FILE_LIMIT});verifyCurrentRecheckResult(result);return result;
}
