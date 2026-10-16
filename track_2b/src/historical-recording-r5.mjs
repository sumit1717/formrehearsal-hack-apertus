/** One closed historical capture. This is not a live-source adapter and never
 * creates a request, UUID, endpoint, timestamp or provider-authentication claim.
 * The exact retained request/envelope/content and input remain historical bytes;
 * quote normalization and admission below are explicitly current derivations.
 */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {digest} from './core.mjs';
import {publicFamilyInput} from './apertus.mjs';
import {validateCurrentInput} from './current-admission.mjs';
import {parseQuoteExtraction,QUOTE_EXTRACTION_VERSION} from './quote-extraction.mjs';
import {parseArtifactJson} from './specification-io.mjs';

export const HISTORICAL_R5_KIND='historical-apertus-input-recording-r5-v1';
export const HISTORICAL_R5_ID='r5-sparse-candidate';
export const HISTORICAL_R5_PROFILE='strict-historical-r5-sparse-predicates-v1';
export const HISTORICAL_R5_CURRENT_PROFILE='current-historical-r5-sparse-predicates-v1';
const fail=message=>{const error=new Error(message);error.status=400;throw error;};
const sha=value=>createHash('sha256').update(value).digest('hex');
const pack=new URL('../data/recordings/r5-sparse-candidate/',import.meta.url);
// Closed paths and externally verified byte hashes. Callers cannot add a record,
// supply a path, replace a pin, select a parser or substitute authored evidence.
const pins=Object.freeze({
  'app-input.json':'fde4654919089854c1f0c2baa28b22b42771cab98efd055fc58393b91fff82cd',
  'capture-receipt.json':'9bac7393244a56f152c8fb75c292ef15ef8621b05a392e7d9132a4cfd9276edf',
  'derived-provenance.json':'9ef89962a2fc6ac36e3d4b559b90b43e2d9afbe32923c7f41949bc37fb1c4414',
  'derived-record.json':'7e5bb3932cf52c0d6fc0211e111e9d4e5edca9c5acc275483085484cb9b805dd',
  'extraction-v5.txt':'29a8143e09cb936acba071df635852331185c467cff04f6b3ecaae1d0acebedd',
  'original-assistant-content.txt':'f9f5221b248bc224b265f6ed90797fc7266bed7c0dccb1cbcf04a6b647295947',
  'original-envelope.json':'f949c9055dd77e514a9cc4d9a70810608b24d4cc29fe949787391c6530247669',
  'plain_response_stop68_v3.py':'58dfacf86e1f1eda221cb034570065bcdd6c6bef2acb88a8fe1ce1da3c088ca6',
  'request.json':'1369fa270afb7390c7bef55a18c140dc694533d50318f0d81ea8af16b111bb5c',
});
const tuple=Object.freeze({repository:'sumit1717/doru-formrehearsal',runId:38087160778,runAttempt:1,
  sourceCommit:'4986838beeddafbc7cb92c77511fa397e7b01192',sourceTree:'cf1c81d1b4194fb8df0cc108109ea2a2df46014f',
  artifactId:11681908673,artifactZipSha256:'812e0b09748e944092094cf98e1dae4dc717b0582df8e6111e9559c1c33c87f9',
  batchId:'formrehearsal-development-20261009-d1-C-2B-pair-r5',requestId:'D-2B-CANDIDATE-r5'});
const MODEL='swiss-ai/Apertus-v1.5-70B';
const PROMPT_SHA='55d67b7b6540c37287f90d94041c8cc462f8a5b428f776c8fef39da3df04a444';

function retainedEvidence(){
  return Object.fromEntries(Object.entries(pins).map(([name,expected])=>{
    const bytes=readFileSync(new URL(name,pack));
    if(sha(bytes)!==expected)fail(`Historical r5 evidence hash mismatch: ${name}`);
    const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    return [name,text];
  }));
}
/** Profile closure includes every retained pack byte, using fixed paths only. */
export function historicalR5EvidenceProfile(){
  retainedEvidence();
  return Object.fromEntries(Object.entries(pins).map(([name,value])=>[`data/recordings/r5-sparse-candidate/${name}`,value]));
}

function source(){
  const evidence=retainedEvidence(),rawInputs=parseArtifactJson(evidence['app-input.json']);
  const suppliedInput=validateCurrentInput(rawInputs),family=suppliedInput.family;
  const request=parseArtifactJson(evidence['request.json']),envelope=parseArtifactJson(evidence['original-envelope.json']);
  const rawFinalText=evidence['original-assistant-content.txt'];
  const systemPrompt=evidence['extraction-v5.txt'].trim();
  const publicInput=publicFamilyInput(family);publicInput.id='policy-new';
  const expectedRequest={model:MODEL,messages:[{role:'system',content:systemPrompt},{role:'user',content:JSON.stringify({input:publicInput})}],temperature:0,max_tokens:1024,stream:false};
  if(sha(systemPrompt)!==PROMPT_SHA||digest(request)!==digest(expectedRequest))fail('Historical r5 request, prompt or original input mismatch');
  // The exact pinned stop68 envelope is admitted only for this historical tuple.
  // Ordinary live validation is deliberately not invoked or loosened.
  if(envelope.model!==MODEL||envelope.choices.length!==1||envelope.choices[0].index!==0
    ||envelope.choices[0].finish_reason!=='stop'||envelope.choices[0].stop_reason!==68
    ||envelope.choices[0].message.role!=='assistant'||envelope.choices[0].message.content!==rawFinalText
    ||digest(envelope.usage)!==digest({prompt_tokens:1291,total_tokens:1322,completion_tokens:31,prompt_tokens_details:{cached_tokens:0,multimodal_tokens:null}}))fail('Historical r5 envelope mismatch');
  const receipt=parseArtifactJson(evidence['capture-receipt.json']);
  const historical=parseArtifactJson(evidence['derived-provenance.json']);
  if(receipt.request_id!==tuple.requestId||receipt.batch_id!==tuple.batchId||receipt.wire_sha256!==pins['request.json']
    ||receipt.capture.sha256!==pins['original-envelope.json']||receipt.capture.parser_sha256!==pins['plain_response_stop68_v3.py']
    ||receipt.origin!=='live_cscs_host_declared_capture_not_independent_provider_authentication'
    ||historical.answer_eligible!==false||historical.human_gold!==false||historical.adjudication!=='unadjudicated')fail('Historical r5 receipt mismatch');
  const originalParsed=parseQuoteExtraction(rawFinalText,{family});
  if(originalParsed.status!=='valid'||originalParsed.rawResult.rules.length!==1
    ||digest(originalParsed.rawResult.rules[0])!==digest({field:'route_check',property:'visible',condition:true,quote:'Always show route_check.'}))fail('Historical r5 candidate normalization mismatch');
  const recording={id:HISTORICAL_R5_ID,familyId:family.id,rawFinalText,provenance:{
    kind:HISTORICAL_R5_KIND,contractVersion:QUOTE_EXTRACTION_VERSION,...tuple,
    runUrl:'https://github.com/sumit1717/doru-formrehearsal/actions/runs/38087160778',
    model:MODEL,returnedModel:MODEL,promptRevision:'extraction-v5',promptSha256:PROMPT_SHA,
    requestSha256:pins['request.json'],rawFinalTextSha256:pins['original-assistant-content.txt'],envelopeSha256:pins['original-envelope.json'],
    originalInputFileSha256:pins['app-input.json'],policySha256:sha(family.policy),schemaSha256:digest(family.fields),
    historicalParser:{profile:'formrehearsal-plain-response-stop68-v3',sha256:pins['plain_response_stop68_v3.py'],stopReason:68},
    historicalStatus:'development-valid-unadjudicated',answerEligible:false,humanGold:false,formalCCredit:0,formalSCredit:0,
    providerOrigin:'host-declared, not independently authenticated',
    historicalComparison:'Candidate-only match on one exposed AI-authored case and two calls; invalid control and earlier failures remain preserved.',
    usage:{promptTokens:1291,completionTokens:31,totalTokens:1322},
    claim:'Genuine retained historical host-declared Apertus capture; provider origin is not independently authenticated. Current local normalization and review do not change historical adjudication, establish policy truth, or provide human gold.',
  },evidence};
  return {family,forms:{supplied:suppliedInput.survey},suppliedInput,recording,originalParsed};
}

/** Exact embedded evidence, complete provenance and original input must match
 * the sole local allowlist entry. Hashes alone are not provider authentication.
 */
export function validateHistoricalR5Source(recording,familyOrInput){
  const expected=source();
  if(!familyOrInput||digest(familyOrInput)!==digest(familyOrInput.rawInputs?expected.suppliedInput:expected.family))fail('Historical r5 original supplied input mismatch');
  if(digest(recording)!==digest(expected.recording))fail('Historical r5 source, tuple or embedded evidence mismatch');
  return expected.originalParsed;
}
export async function loadHistoricalR5Source(){return structuredClone(source());}
