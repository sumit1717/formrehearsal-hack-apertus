/** Closed profile dispatcher. Historical code and its source fingerprints remain unchanged. */
import * as historical from './current-specification.mjs';
import * as sparse from './current-specification-v5.mjs';
import {parseArtifactJson,SPECIFICATION_FILE_LIMIT,RECHECK_RESULT_FILE_LIMIT} from './specification-io.mjs';
const snapshot=(value,limit)=>parseArtifactJson(JSON.stringify(value,null,2),{limit});
const fail=()=>{const error=new Error('Unsupported or mixed specification profiles; use the matching release or review and export again');error.status=400;throw error;};
const source=basis=>basis?.kind==='independent-authored-input-v5'?basis.priorRecording:basis?.recording;
function adapter(spec){
  const v5=source(spec?.reviewBasis)?.provenance?.promptRevision==='extraction-v5';
  if(spec?.version===2&&spec.profile?.kind==='strict-sparse-extraction-v5-predicates-v1'&&spec.currentProfile?.kind==='current-sparse-extraction-v5-predicates-v1'&&v5)return sparse;
  if(!v5&&spec?.profile?.kind==='strict-supplied-finite-predicates-v1'&&(spec.version===1||spec.version===2&&spec.currentProfile?.kind==='current-supplied-finite-predicates-v1'))return historical;
  fail();
}
export function createCurrentApprovedSpecification(reviewBasis){
  const basis=structuredClone(reviewBasis);
  return (source(basis)?.provenance?.promptRevision==='extraction-v5'?sparse:historical).createCurrentApprovedSpecification(basis);
}
export function validateCurrentSpecification(value){const spec=snapshot(value,SPECIFICATION_FILE_LIMIT);return adapter(spec).validateCurrentSpecification(spec);}
export function importCurrentSpecification(text){const spec=parseArtifactJson(text);return adapter(spec).validateCurrentSpecification(spec).specification;}
export function recheckCurrentSpecification(value,formText){const spec=snapshot(value,SPECIFICATION_FILE_LIMIT);return adapter(spec).recheckCurrentSpecification(spec,formText);}
export function verifyCurrentRecheckResult(value){const result=snapshot(value,RECHECK_RESULT_FILE_LIMIT);return adapter(result?.specification).verifyCurrentRecheckResult(result);}
export function importCurrentRecheckResult(text){const result=parseArtifactJson(text,{limit:RECHECK_RESULT_FILE_LIMIT});adapter(result?.specification).verifyCurrentRecheckResult(result);return result;}
