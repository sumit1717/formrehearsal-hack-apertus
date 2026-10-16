import {createHash} from 'node:crypto';
import {digest} from './core.mjs';
import {parseModelJson} from './apertus.mjs';
import {normalizeQuoteExtraction} from './quote-extraction.mjs';
import {validateJudgeSource} from './judge-contract.mjs';
import {exactKeys, validateActor, validateDispositions, reviewSlots, slotKey, coverageSummary} from './review-provenance.mjs';

export const MANUAL_DRAFT_VERSION='independent-rules-v1';
export const MANUAL_DRAFT_LIMIT=65536;
export const MANUAL_REVIEW_CLAIM='Local approval of independently authored predicates and explicit unchecked slots. Actor identity is unverified; this is not model extraction success, independent human gold, or proof of policy truth.';
export const MANUAL_BUNDLE_CLAIM='Replay of exact independently authored, locally approved predicates only. Unchecked slots remain unknown. Linked extraction outcomes remain unchanged; hashes and actor declarations do not authenticate identity or establish policy truth.';
const sha=text=>createHash('sha256').update(text).digest('hex');
const fail=(message,status=400)=>{const e=new Error(message);e.status=status;throw e;};
const copy=value=>structuredClone(value);
export const emptyManualDraft=()=>JSON.stringify({version:1,kind:MANUAL_DRAFT_VERSION,rules:[]},null,2);

/** Pure authored-schema validation. The transient quote envelope is not a model response. */
export function parseManualDraft(text,{family}={}) {
  const base={contractVersion:MANUAL_DRAFT_VERSION,status:'invalid',rawResult:null,normalizedResult:null,normalization:null,error:null};
  if(typeof text!=='string'||Buffer.byteLength(text)>MANUAL_DRAFT_LIMIT)return {...base,error:'Authored draft exceeds the 65536-byte limit'};
  let raw;
  try{raw=parseModelJson(text);}catch{return {...base,error:'Authored draft must be strict JSON'};}
  try{
    exactKeys(raw,['version','kind','rules']);
    if(raw.version!==1||raw.kind!==MANUAL_DRAFT_VERSION||!Array.isArray(raw.rules))fail('Invalid independent authored draft');
    if(raw.rules.length===0)return {...base,status:'empty',rawResult:copy(raw),normalizedResult:{rules:[]},error:null};
    // Preserve the provenance-hashed extraction adapter byte-for-byte.
    const normalized=normalizeQuoteExtraction({status:'ok',rules:raw.rules},{family});
    return {...base,...normalized,status:'valid',rawResult:copy(raw),error:null};
  }catch(error){return {...base,rawResult:copy(raw),error:error.code??error.message};}
}

export function validateManualPrior(family,prior) {
  if(prior===null)return null;
  exactKeys(prior,['recording','originalParsed']);
  if(prior.recording?.familyId!==family.id)fail('Manual ancestry input mismatch');
  const parsed=validateJudgeSource(prior.recording,family);
  if(!['invalid','abstain'].includes(parsed.status)||digest(parsed)!==digest(prior.originalParsed))fail('Manual ancestry must preserve the exact invalid or abstained original');
  return copy(prior);
}

export function manualProvenance(family,parsed,actor,prior,dispositions) {
  if(!['valid','empty'].includes(parsed.status))fail('Valid or empty independent draft required');
  validateActor(actor);
  if(prior?.recording.provenance.kind==='local-mock-transport'&&actor.kind!=='agent-simulation')fail('Mock ancestry must remain an agent simulation');
  const rules=parsed.rawResult.rules,resolved=validateDispositions(family,rules,dispositions);
  return {version:1,kind:'independent-authored',actor:copy(actor),priorExtractionSha256:prior===null?null:digest(prior),
    slots:reviewSlots(family).map(slot=>{
      const rule=rules.find(value=>slotKey(value)===slotKey(slot));
      return {...slot,currentRuleSha256:rule?digest(rule):null,derivation:rule?'independently-authored':'unresolved'};
    }),dispositions:resolved};
}
export function validateManualProvenance(family,parsed,prior,value) {
  exactKeys(value,['version','kind','actor','priorExtractionSha256','slots','dispositions']);
  const expected=manualProvenance(family,parsed,value.actor,prior,value.dispositions);
  if(digest(expected)!==digest(value))fail('Independent authorship provenance mismatch');
  return expected;
}
export function manualHashes(input,rules,draftText,prior,provenance) {
  return {policySha256:sha(input.family.policy),schemaSha256:digest(input.family.fields),formSha256:digest(input.survey),
    rulesSha256:digest(rules),draftSha256:sha(draftText),suppliedInputSha256:digest(input),rawInputsSha256:digest(input.rawInputs),
    priorExtractionSha256:digest(prior),manualProvenanceSha256:digest(provenance)};
}
export function assertManualApproval(approval,hashes,provenance) {
  if(!approval)fail('Explicit independent review approval required',409);
  exactKeys(approval,['kind','approvedAt','draftRevision',...Object.keys(hashes),'reviewedInterpretation','reviewedCoverage','scope','uncheckedSlots','claim','approvalHash']);
  const coverage=coverageSummary(provenance),{approvalHash,...record}=approval;
  if(approval.kind!=='local-independent-review-v1'||approval.claim!==MANUAL_REVIEW_CLAIM
    ||approval.reviewedInterpretation!==true||approval.reviewedCoverage!==true
    ||!Number.isSafeInteger(approval.draftRevision)||approval.draftRevision<0
    ||typeof approval.approvedAt!=='string'||!Number.isFinite(Date.parse(approval.approvedAt))
    ||coverage.present<1||coverage.unresolved.length||approval.scope!==(coverage.unchecked.length?'partial':'covered-slots')
    ||digest(approval.uncheckedSlots)!==digest(coverage.unchecked)||approvalHash!==digest(record)
    ||Object.entries(hashes).some(([key,value])=>approval[key]!==value))fail('Stale or invalid independent review approval',409);
}

