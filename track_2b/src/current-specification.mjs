/** Current-admission specifications/results; frozen v1 artifacts remain historical.
 * These are unsigned deterministic claims, never authenticated review evidence.
 */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {digest} from './core.mjs';
import {exactKeys} from './review-provenance.mjs';
import {validateCurrentInput,CURRENT_ADMISSION_MODE} from './current-admission.mjs';
import {parseArtifactJson,SPECIFICATION_FILE_LIMIT,RECHECK_RESULT_FILE_LIMIT} from './specification-io.mjs';
import {
  SPECIFICATION_KIND,RECHECK_KIND,specificationProfile,
  createApprovedSpecification,recheckSpecification,validateSpecification,
  importSpecification,importRecheckResult,verifyRecheckResult,
} from './approved-specification.mjs';
const fail=message=>{const error=new Error(message);error.status=400;throw error;};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
// Fixed local modules only. No descriptor can choose an adapter, runtime or path.
export function currentSpecificationProfile(){
  return {kind:'current-supplied-finite-predicates-v1',admission:CURRENT_ADMISSION_MODE,
    expressions:'bounded-existing-parser-and-native-unknown-function-rejection;no-added-unary-bang-or-functions',
    predicates:'typed-boolean-and-choice-equality;boolean-constants;all-any-not;no-numeric-drivers',
    comparison:'exact-expected-observed-boolean-equality',requiredness:'only-when-target-actually-visible',
    implementation:Object.fromEntries(['current-admission.mjs','current-specification.mjs']
      .map(name=>[name,sha(readFileSync(new URL(name,import.meta.url)))]))};
}
const snapshot=(value,limit)=>parseArtifactJson(JSON.stringify(value,null,2),{limit});
function currentProfile(profile){
  if(digest(profile)!==digest(currentSpecificationProfile()))fail('Current admission profile or installed implementation mismatch');
}
/** Validate the entire external descriptor before constructing the fixed v1 adapter. */
function validated(spec){
  if(Buffer.byteLength(JSON.stringify(spec,null,2)??'')>SPECIFICATION_FILE_LIMIT)fail('Artifact exceeds its byte limit');
  if(spec?.version===1)return {...validateSpecification(spec),adapter:spec};
  exactKeys(spec,['kind','version','profile','currentProfile','reviewBasis','specificationSha256']);
  if(spec.kind!==SPECIFICATION_KIND||spec.version!==2)fail('Unsupported specification format');
  const {specificationSha256,...payload}=spec;
  if(specificationSha256!==digest(payload))fail('Specification digest mismatch');
  if(digest(spec.profile)!==digest(specificationProfile()))fail('Specification profile or installed implementation mismatch');
  currentProfile(spec.currentProfile);
  const adapter=createApprovedSpecification(spec.reviewBasis),original=validateSpecification(adapter);
  validateCurrentInput(original.input.rawInputs);
  return {...original,specification:spec,adapter};
}
export function validateCurrentSpecification(value){
  const {adapter,...result}=validated(snapshot(value,SPECIFICATION_FILE_LIMIT));return result;
}
export function importCurrentSpecification(text){
  return validated(parseArtifactJson(text)).specification;
}
export function createCurrentApprovedSpecification(reviewBasis){
  // Capture caller getters once. All later reads are from this owned clone.
  const basis=structuredClone(reviewBasis),adapter=createApprovedSpecification(basis);
  validateCurrentInput(adapter.reviewBasis.suppliedInput.rawInputs);
  const payload={kind:SPECIFICATION_KIND,version:2,profile:adapter.profile,
    currentProfile:currentSpecificationProfile(),reviewBasis:adapter.reviewBasis};
  return snapshot({...payload,specificationSha256:digest(payload)},SPECIFICATION_FILE_LIMIT);
}
function recheck(original,formText){
  validateCurrentInput({...original.input.rawInputs,formText});
  const historical=recheckSpecification(original.adapter,formText);
  // Only this binding changes: all finite computation semantics remain frozen.
  const computation={...historical.computation,specificationSha256:original.specification.specificationSha256};
  const payload={kind:RECHECK_KIND,version:2,currentProfile:currentSpecificationProfile(),
    specification:original.specification,formText,computation};
  return snapshot({...payload,resultSha256:digest(payload)},RECHECK_RESULT_FILE_LIMIT);
}
export function recheckCurrentSpecification(specification,formText){
  return recheck(validated(snapshot(specification,SPECIFICATION_FILE_LIMIT)),formText);
}
function verified(result){
  if(result?.version===1)return verifyHistoricalRecheckResult(result);
  exactKeys(result,['kind','version','currentProfile','specification','formText','computation','resultSha256']);
  if(result.kind!==RECHECK_KIND||result.version!==2)fail('Unsupported recheck result format');
  const {resultSha256,...payload}=result;
  if(resultSha256!==digest(payload))fail('Recheck result digest mismatch');
  currentProfile(result.currentProfile);
  const expected=recheck(validated(result.specification),result.formText);
  if(digest(expected)!==digest(result))fail('Recheck result differs from complete local recomputation');
  return {verified:true,resultSha256,analysisExitCode:expected.computation.analysisExitCode,
    status:expected.computation.status,attestation:'not-user-attested',
    verificationScope:'current-admission-and-frozen-computation',currentAdmission:'replacement-validated',
    originalAdmission:result.specification.version===2?'current-validated':'historical-not-checked'};
}
export function verifyCurrentRecheckResult(value){return verified(snapshot(value,RECHECK_RESULT_FILE_LIMIT));}
export function importCurrentRecheckResult(text){
  const result=parseArtifactJson(text,{limit:RECHECK_RESULT_FILE_LIMIT});verified(result);return result;
}
export const importHistoricalSpecification=importSpecification;
export const validateHistoricalSpecification=validateSpecification;
export const importHistoricalRecheckResult=importRecheckResult;
export function verifyHistoricalRecheckResult(value) {
  return {...verifyRecheckResult(value),verificationScope:'historical-computation',currentAdmission:'not-checked'};
}
