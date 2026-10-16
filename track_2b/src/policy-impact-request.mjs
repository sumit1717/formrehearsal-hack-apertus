/** Request-owned comparison. No persistent job, result, approval or recovery token. */
import {digest} from './core.mjs';
import {preparePolicyImpactPayload,assertPolicyImpactResponse} from './policy-impact-protocol.mjs';
import {computationError} from './computation-settings.mjs';
const fail=message=>{throw Object.assign(new Error(message),{status:400});};
export async function compareReviewedPolicy({reviews,computations,body,response}){
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).sort().join(',')!=='approvalHash,expectedRevision,oldSpecificationText,sessionId')fail('Expected the current approved review and prior specification text only');
  if(response.destroyed||response.writableEnded)throw computationError('cancelled');
  const pin={sessionId:body.sessionId,expectedRevision:body.expectedRevision,approvalHash:body.approvalHash};
  // The established store owns all current approval and revision validation.
  const specification=reviews['export-specification'](pin);
  const payload=preparePolicyImpactPayload(body.oldSpecificationText,specification);
  const job=computations.start(payload);
  const abandon=()=>{if(!response.writableEnded)void job.cancel('cancelled').catch(()=>{});};
  response.once('close',abandon);if(response.destroyed)abandon();
  try{
    const envelope=await job.promise;
    if(response.destroyed||response.writableEnded)throw computationError('cancelled');
    // Edits, release, expiry or another operation can never lend fresh authority
    // to the captured new-policy approval, even if computation already finished.
    const current=reviews['export-specification'](pin);
    if(digest(current)!==digest(specification))throw computationError('stale');
    assertPolicyImpactResponse(payload,envelope);
    const expiresAt=reviews.lifecycle().entries.find(entry=>entry.sessionId===pin.sessionId)?.expiresAt;
    if(!Number.isFinite(expiresAt))throw computationError('stale');
    return {sessionId:pin.sessionId,revision:pin.expectedRevision,approvalHash:pin.approvalHash,sourceExpiresAt:expiresAt,...envelope};
  }finally{response.off('close',abandon);}
}
