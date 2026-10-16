/** Shared exact v4 hash/approval checks; legacy semantics retained. */
import {createHash} from 'node:crypto';
import {digest} from './core.mjs';
import {coverageSummary,V4_REVIEW_CLAIM} from './review-provenance.mjs';
const sha=text=>createHash('sha256').update(text).digest('hex');
const fail=(message,status=400)=>{const error=new Error(message);error.status=status;throw error;};
const exact=(value,names)=>{
  if(!value||typeof value!=='object'||Array.isArray(value))fail('Malformed review request');
  const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(descriptors);
  if(keys.length!==names.length||keys.some(key=>typeof key!=='string'||!names.includes(key)||!descriptors[key].enumerable||!Object.hasOwn(descriptors[key],'value')))fail('Malformed review request');
};
export function inputHashes(family,survey,rules,draftText,recording,suppliedInput=null) {
  return {policySha256:sha(family.policy),schemaSha256:digest(family.fields),formSha256:digest(survey),rulesSha256:digest(rules),draftSha256:sha(draftText),recordingSha256:digest(recording),...(suppliedInput?{suppliedInputSha256:digest(suppliedInput),rawInputsSha256:digest(suppliedInput.rawInputs)}:{})};
}
export function assertV4Approval(approval,hashes,provenance) {
  if(!approval)fail('Explicit review approval required',409);
  exact(approval,['kind','approvedAt','draftRevision',...Object.keys(hashes),'reviewedInterpretation','reviewedCoverage','edited','scope','uncheckedSlots','claim','approvalHash']);
  const coverage=coverageSummary(provenance),{approvalHash,...record}=approval;
  if(approval.kind!=='local-review-v4'||approval.claim!==V4_REVIEW_CLAIM||approval.reviewedInterpretation!==true||approval.reviewedCoverage!==true
    ||!Number.isSafeInteger(approval.draftRevision)||approval.draftRevision<0||typeof approval.edited!=='boolean'
    ||typeof approval.approvedAt!=='string'||!Number.isFinite(Date.parse(approval.approvedAt))||coverage.unresolved.length
    ||approval.scope!==(coverage.unchecked.length?'partial':'covered-slots')||digest(approval.uncheckedSlots)!==digest(coverage.unchecked)
    ||approvalHash!==digest(record)||Object.entries(hashes).some(([key,value])=>approval[key]!==value))fail('Stale or invalid v4 review approval',409);
}
