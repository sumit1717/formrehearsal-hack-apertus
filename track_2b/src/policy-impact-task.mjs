/** Fixed worker computation, also callable in offline in-process tests. */
import {digest} from './core.mjs';
import {comparePolicyChange} from './policy-change-impact.mjs';
import {assertPolicyImpactPayload} from './policy-impact-protocol.mjs';
export function runPolicyImpactTask(payload){
  assertPolicyImpactPayload(payload);
  try{return {requestSha256:digest(payload),status:'complete',result:comparePolicyChange(payload.oldSpecification,payload.newSpecification,payload.formText)};}
  catch(error){
    if(error.constructor!==Error)throw error;
    return {requestSha256:digest(payload),status:'invalid',error:String(error.message).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,' ').slice(0,1000)};
  }
}
