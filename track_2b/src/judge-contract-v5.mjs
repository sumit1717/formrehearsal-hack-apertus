/** Fixed quote-v3 wire contract with allowlisted prompt revisions. No network or credential reads. */
import * as historical from './judge-contract.mjs';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {digest} from './core.mjs';
import {publicFamilyInput} from './apertus.mjs';
import {parseQuoteExtraction,QUOTE_EXTRACTION_VERSION} from './quote-extraction.mjs';
import {inputIdValid} from './new-input.mjs';

export const JUDGE_MODELS=Object.freeze(['swiss-ai/Apertus-v1.5-8B','swiss-ai/Apertus-v1.5-70B']);
export const JUDGE_FAMILIES=Object.freeze(['garden-tool-shed','audio-cart','pottery-cart']);
export const JUDGE_SOURCE_CLAIM='Locally captured response; source and model authenticity are unverified. Hashes bind supplied evidence, not semantic correctness. No independent human gold.';
export const sha=text=>createHash('sha256').update(text).digest('hex');
export const DEFAULT_JUDGE_PROMPT_REVISION='extraction-v3';
export const JUDGE_PROMPT_REVISIONS=Object.freeze(['extraction-v3','extraction-v4','extraction-v5']);
// Closed local files and exact system-text hashes. This is not a path override.
const prompts=Object.freeze({
  'extraction-v3':Object.freeze({file:'../prompts/extraction-v3.txt',sha256:'8eeb76de4158b8dd12475d8d4b6fafba6144d1d52560d2fd0bf9d1806fdc91ce'}),
  'extraction-v5':Object.freeze({file:'../prompts/extraction-v5.txt',sha256:'55d67b7b6540c37287f90d94041c8cc462f8a5b428f776c8fef39da3df04a444'}),
  'extraction-v4':Object.freeze({file:'../prompts/extraction-v4.txt',sha256:'3fb112c9de51305bddc5c9c914a7a7f3c733bf167ca0daf6ca6638f651861b89'}),
});
export function judgePrompt(revision=DEFAULT_JUDGE_PROMPT_REVISION) {
  if(revision!=='extraction-v5')return historical.judgePrompt(revision);
  if(typeof revision!=='string'||!Object.hasOwn(prompts,revision))throw new TypeError('Invalid extraction prompt revision');
  const selected=prompts[revision],prompt=readFileSync(new URL(selected.file,import.meta.url),'utf8').trim();
  if(sha(prompt)!==selected.sha256)throw new TypeError('Extraction prompt hash mismatch');
  return Object.freeze({revision,prompt,promptSha256:selected.sha256});
}
const adapterSha256=sha(readFileSync(new URL('./quote-extraction.mjs',import.meta.url)));
// Historical export intentionally remains the exact v3 prompt hash.
export const JUDGE_PROMPT_SHA256=prompts[DEFAULT_JUDGE_PROMPT_REVISION].sha256;
export const JUDGE_ADAPTER_SHA256=adapterSha256;
export const requestIdValid=id=>typeof id==='string'&&id.length===36&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
const fail=()=>{throw new TypeError('Invalid live source provenance');};
export function judgeRequest(family,model,maxOutputTokens,promptRevision=DEFAULT_JUDGE_PROMPT_REVISION) {
  if(promptRevision!=='extraction-v5')return historical.judgeRequest(family,model,maxOutputTokens,promptRevision);
  const {prompt}=judgePrompt(promptRevision);
  if((!JUDGE_FAMILIES.includes(family?.id)&&!inputIdValid(family?.id))||!JUDGE_MODELS.includes(model)||!Number.isSafeInteger(maxOutputTokens)||maxOutputTokens<1||maxOutputTokens>8192)fail();
  const input=publicFamilyInput(family);
  // Preserve the neutral IDs used by the three original v3 recorded requests.
  input.id=inputIdValid(family.id)?'policy-new':`policy-${String(JUDGE_FAMILIES.indexOf(family.id)+1).padStart(3,'0')}`;
  return {model,messages:[{role:'system',content:prompt},{role:'user',content:JSON.stringify({input})}],temperature:0,max_tokens:maxOutputTokens,stream:false};
}
export function judgeSource({family,requestId,request,response,endpoint,kind,now,promptRevision=DEFAULT_JUDGE_PROMPT_REVISION}) {
  if(promptRevision!=='extraction-v5')return historical.judgeSource({family,requestId,request,response,endpoint,kind,now,promptRevision});
  const selected=judgePrompt(promptRevision);
  if(digest(request)!==digest(judgeRequest(family,request.model,request.max_tokens,selected.revision)))fail();
  return {id:`live-${requestId}`,familyId:family.id,rawFinalText:response.content,provenance:{
    kind,contractVersion:QUOTE_EXTRACTION_VERSION,...(selected.revision===DEFAULT_JUDGE_PROMPT_REVISION?{}:{promptRevision:selected.revision}),requestId,model:request.model,returnedModel:response.returnedModel,mode:'ordinary',date:new Date(now).toISOString(),
    endpointSha256:sha(endpoint),requestConfig:{temperature:0,max_tokens:request.max_tokens,stream:false},requestSha256:digest(request),
    promptSha256:selected.promptSha256,adapterSha256,policySha256:sha(family.policy),schemaSha256:digest(family.fields),
    rawFinalTextSha256:sha(response.content),responseSha256:digest({model:response.returnedModel,content:response.content,usage:response.usage}),
    responseHashScope:'canonical model, final content and usage projection',usage:response.usage,claim:JUDGE_SOURCE_CLAIM,
  }};
}
/** Self-contained replay validates consistency only; it cannot authenticate a provider. */
export function validateJudgeSource(source,family) {
  if(source?.provenance?.promptRevision!=='extraction-v5')return historical.validateJudgeSource(source,family);
  if(!exact(source,['id','familyId','rawFinalText','provenance'])||source.familyId!==family.id||(!JUDGE_FAMILIES.includes(family.id)&&!inputIdValid(family.id))||typeof source.rawFinalText!=='string'||Buffer.byteLength(source.rawFinalText)>65536)fail();
  const p=source.provenance;
  const revised=!!p&&Object.hasOwn(p,'promptRevision');
  if(revised&&!['extraction-v4','extraction-v5'].includes(p.promptRevision))fail();
  if(!exact(p,['kind','contractVersion',...(revised?['promptRevision']:[]),'requestId','model','returnedModel','mode','date','endpointSha256','requestConfig','requestSha256','promptSha256','adapterSha256','policySha256','schemaSha256','rawFinalTextSha256','responseSha256','responseHashScope','usage','claim']))fail();
  if(!['live-provider-response','local-mock-transport'].includes(p.kind)||!requestIdValid(p.requestId)||source.id!==`live-${p.requestId}`||p.contractVersion!==QUOTE_EXTRACTION_VERSION||!JUDGE_MODELS.includes(p.model)||p.returnedModel!==p.model||p.mode!=='ordinary'||p.claim!==JUDGE_SOURCE_CLAIM)fail();
  if(typeof p.date!=='string'||!Number.isFinite(Date.parse(p.date))||new Date(p.date).toISOString()!==p.date||typeof p.endpointSha256!=='string'||p.endpointSha256.length!==64||! /^[a-f0-9]{64}$/.test(p.endpointSha256))fail();
  if(!exact(p.requestConfig,['temperature','max_tokens','stream'])||p.requestConfig.temperature!==0||p.requestConfig.stream!==false)fail();
  const selected=judgePrompt(revised?p.promptRevision:DEFAULT_JUDGE_PROMPT_REVISION);
  const request=judgeRequest(family,p.model,p.requestConfig.max_tokens,selected.revision);
  if(p.requestSha256!==digest(request)||p.promptSha256!==selected.promptSha256||p.adapterSha256!==adapterSha256||p.policySha256!==sha(family.policy)||p.schemaSha256!==digest(family.fields)||p.rawFinalTextSha256!==sha(source.rawFinalText))fail();
  const u=p.usage;
  if(!exact(u,['promptTokens','completionTokens','totalTokens'])||Object.values(u).some(v=>!Number.isSafeInteger(v)||v<0)||u.totalTokens!==u.promptTokens+u.completionTokens||u.completionTokens>request.max_tokens)fail();
  if(p.responseHashScope!=='canonical model, final content and usage projection'||p.responseSha256!==digest({model:p.returnedModel,content:source.rawFinalText,usage:u}))fail();
  return parseQuoteExtraction(source.rawFinalText,{family});
}
