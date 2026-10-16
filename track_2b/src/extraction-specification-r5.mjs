/** Additive closed r5 facade. The original dispatcher and validators are byte
 * exact and keep ownership of every old profile. Mixed families fail closed.
 */
import * as existing from './extraction-specification.mjs';
import * as historical from './historical-specification-r5.mjs';
import {HISTORICAL_R5_KIND,HISTORICAL_R5_PROFILE,HISTORICAL_R5_CURRENT_PROFILE} from './historical-recording-r5.mjs';
import {parseArtifactJson,SPECIFICATION_FILE_LIMIT,RECHECK_RESULT_FILE_LIMIT} from './specification-io.mjs';
export {prepareHistoricalR5Recheck,assembleHistoricalR5Recheck} from './historical-specification-r5.mjs';
const snapshot=(value,limit)=>parseArtifactJson(JSON.stringify(value,null,2),{limit});
const fail=()=>{const error=new Error('Unsupported or mixed historical r5 specification profiles');error.status=400;throw error;};
const source=basis=>basis?.kind==='independent-authored-input-v5'?basis.priorRecording:basis?.recording;
export function isHistoricalR5Specification(spec){
  return spec?.version===2&&spec.profile?.kind===HISTORICAL_R5_PROFILE&&spec.currentProfile?.kind===HISTORICAL_R5_CURRENT_PROFILE
    &&spec.reviewBasis?.kind==='reviewed-input-v4'&&source(spec.reviewBasis)?.provenance?.kind===HISTORICAL_R5_KIND;
}
function adapter(spec){
  if(isHistoricalR5Specification(spec))return historical;
  if(spec?.profile?.kind===HISTORICAL_R5_PROFILE||spec?.currentProfile?.kind===HISTORICAL_R5_CURRENT_PROFILE||source(spec?.reviewBasis)?.provenance?.kind===HISTORICAL_R5_KIND)fail();
  return existing;
}
export function createCurrentApprovedSpecification(reviewBasis){
  const basis=structuredClone(reviewBasis);
  return (source(basis)?.provenance?.kind===HISTORICAL_R5_KIND?historical:existing).createCurrentApprovedSpecification(basis);
}
export function validateCurrentSpecification(value){const spec=snapshot(value,SPECIFICATION_FILE_LIMIT);return adapter(spec).validateCurrentSpecification(spec);}
export function importCurrentSpecification(text){const spec=parseArtifactJson(text);return adapter(spec).validateCurrentSpecification(spec).specification;}
export function recheckCurrentSpecification(value,formText){const spec=snapshot(value,SPECIFICATION_FILE_LIMIT);return adapter(spec).recheckCurrentSpecification(spec,formText);}
export function verifyCurrentRecheckResult(value){const result=snapshot(value,RECHECK_RESULT_FILE_LIMIT);return adapter(result?.specification).verifyCurrentRecheckResult(result);}
export function importCurrentRecheckResult(text){const result=parseArtifactJson(text,{limit:RECHECK_RESULT_FILE_LIMIT});adapter(result?.specification).verifyCurrentRecheckResult(result);return result;}
