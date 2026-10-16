/** Versioned v5 ancestry adapter; all authored rules/approval semantics stay historical. */
export * from './manual-specification.mjs';
import {validateManualPrior as historicalPrior} from './manual-specification.mjs';
import {validateJudgeSource} from './judge-contract-v5.mjs';
import {exactKeys} from './review-provenance.mjs';
import {digest} from './core.mjs';
export function validateManualPrior(family,prior){
  if(prior?.recording?.provenance?.promptRevision!=='extraction-v5')return historicalPrior(family,prior);
  exactKeys(prior,['recording','originalParsed']);
  const fail=message=>{const error=new Error(message);error.status=400;throw error;};
  if(prior.recording.familyId!==family.id)fail('Manual ancestry input mismatch');
  const parsed=validateJudgeSource(prior.recording,family);
  if(!['invalid','abstain'].includes(parsed.status)||digest(parsed)!==digest(prior.originalParsed))fail('Manual ancestry must preserve the exact invalid or abstained original');
  return structuredClone(prior);
}
