/** Optional local judge bridge. Only an explicit POST can invoke the bounded transport. */
import {readRunnerConfig,createBoundedTransport} from './model-runner.mjs';
import {JUDGE_MODELS,JUDGE_FAMILIES,judgeRequest,judgeSource,requestIdValid,judgePrompt} from './judge-contract-v5.mjs';
import {digest} from './core.mjs';
import {inputIdValid} from './new-input.mjs';
import {validateCurrentInput} from './current-admission.mjs';

const DEFAULTS=Object.freeze({maxCalls:3,maxOutputTokens:2048,maxTotalOutputTokens:6144,timeoutMs:30000,maxRequestBytes:16384,maxResponseBytes:65536,maxReportedTotalTokens:30000});
const ENV_LIMITS=Object.freeze({maxCalls:'LLM_MAX_CALLS',maxOutputTokens:'LLM_MAX_OUTPUT_TOKENS',maxTotalOutputTokens:'LLM_MAX_TOTAL_OUTPUT_TOKENS',timeoutMs:'LLM_TIMEOUT_MS',maxRequestBytes:'LLM_MAX_REQUEST_BYTES',maxResponseBytes:'LLM_MAX_RESPONSE_BYTES',maxReportedTotalTokens:'LLM_MAX_REPORTED_TOTAL_TOKENS'});
const MAXIMUMS={maxCalls:10,maxOutputTokens:8192,maxTotalOutputTokens:81920,timeoutMs:120000,maxRequestBytes:100000,maxResponseBytes:65536,maxReportedTotalTokens:1000000};
const claim='Explicit requests use your configured provider account and budget (CSCS when configured). These per-process call, reserved-output and post-response reported-token limits are not a provider-enforced currency cap. Restart resets this local budget. No automatic retry, repair or fallback.';
const fail=(message,status=400)=>{const e=new Error(message);e.status=status;throw e;};
const exact=(value,names)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==[...names].sort().join(','))fail('Malformed live request');};
function startup(env) {
  // Validate the trusted selector and pinned bytes before reading any credential.
  let selectedPrompt;
  try {selectedPrompt=judgePrompt(env.LLM_EXTRACTION_PROMPT_REVISION);}
  catch {return {reason:'Live extraction is disabled: invalid extraction prompt revision or prompt hash.'};}
  const names=['LLM_NAME','LLM_BASE_URL','LLM_API_KEY'];
  if(names.every(k=>env[k]===undefined||env[k]===''))return {reason:'Live extraction is disabled. Set LLM_NAME, LLM_BASE_URL and LLM_API_KEY at server startup to enable it.'};
  if(names.some(k=>typeof env[k]!=='string'||!env[k]))return {reason:'Live extraction is disabled: all three LLM_NAME, LLM_BASE_URL and LLM_API_KEY values are required.'};
  if(!JUDGE_MODELS.includes(env.LLM_NAME))return {reason:'Live extraction is disabled: only ordinary swiss-ai/Apertus-v1.5-8B and swiss-ai/Apertus-v1.5-70B are supported. Thinking and unknown aliases are unverified.'};
  if(env.LLM_MODE!==undefined&&env.LLM_MODE!=='ordinary')return {reason:'Live extraction is disabled: LLM_MODE conflicts with the ordinary-only contract.'};
  if(env.NODE_TLS_REJECT_UNAUTHORIZED==='0')return {reason:'Live extraction is disabled: validated TLS is required.'};
  if(env.LLM_API_KEY.length<8||env.LLM_API_KEY.length>4096||/[\s\x00-\x1f\x7f]/.test(env.LLM_API_KEY))return {reason:'Live extraction is disabled: invalid runtime credential format.'};
  try {
    if(!/^https:\/\/[^\x00-\x20\x7f]+$/i.test(env.LLM_BASE_URL))throw new Error();
    const limits={...DEFAULTS};
    for(const [name,key] of Object.entries(ENV_LIMITS))if(env[key]!==undefined) {
      if(typeof env[key]!=='string'||!/^[1-9]\d*$/.test(env[key]))throw new Error();
      limits[name]=Number(env[key]);
    }
    for(const [name,value] of Object.entries(limits))if(!Number.isSafeInteger(value)||value<1||value>MAXIMUMS[name])throw new Error();
    if(limits.maxTotalOutputTokens<limits.maxOutputTokens)throw new Error();
    const {maxReportedTotalTokens,...runnerLimits}=limits;
    const config=readRunnerConfig({}, {...runnerLimits,model:env.LLM_NAME,mode:'ordinary',baseUrl:env.LLM_BASE_URL});
    // Reject credential overlap before and after URL case/path normalization.
    const secret=env.LLM_API_KEY.toLowerCase();
    if([env.LLM_BASE_URL,config.endpoint,config.model].some(value=>value.toLowerCase().includes(secret)))throw new Error();
    return {config,limits,maxReportedTotalTokens,apiKey:env.LLM_API_KEY,selectedPrompt};
  } catch {return {reason:'Live extraction is disabled: invalid HTTPS destination or finite budget configuration.'};}
}
/** Injected fetch is a test-only function argument, never an env setting or browser option. */
export function createJudgeBridge({corpus,reviews,inputs,env={},testFetchImpl,now=()=>Date.now()}={}) {
  const frozen=startup(env),entries=new Map();
  const families=corpus.filter(f=>JUDGE_FAMILIES.includes(f.id));
  const enabled=!!frozen.config;
  const transport=enabled?createBoundedTransport({config:frozen.config,allowedEndpoint:frozen.config.endpoint,allowedModel:frozen.config.model,apiKey:frozen.apiKey,fetchImpl:testFetchImpl??globalThis.fetch}):null;
  const kind=testFetchImpl?'local-mock-transport':'live-provider-response';
  let busy=false,stopReason=null,reportedTotalTokens=0;
  function publicConfig(){return {enabled,reason:frozen.reason??null,model:enabled?frozen.config.model:null,promptRevision:enabled?frozen.selectedPrompt.revision:null,promptSha256:enabled?frozen.selectedPrompt.promptSha256:null,endpoint:enabled?frozen.config.endpoint:null,limits:enabled?{...frozen.limits}:null,budget:{...(transport?.stats()??{attempts:0,reservedOutputTokens:0}),reportedTotalTokens,stopReason},families:families.map(({id,title})=>({id,title})),claim};}
  function result(entry) {
    const base={requestId:entry.requestId,status:entry.status,config:publicConfig()};
    if(entry.status==='failed')base.error=entry.error;
    if(entry.status==='complete')base.snapshot=reviews.state({sessionId:entry.sessionId});
    return base;
  }
  function find(body){exact(body,['requestId']);if(!requestIdValid(body.requestId))fail('Invalid live request ID');const entry=entries.get(body.requestId);if(!entry)fail('Unknown live request ID; no request was repeated',404);return entry;}
  return Object.freeze({
    config:publicConfig,
    pendingInputIds:()=>[...entries.values()].filter(entry=>entry.status==='pending'&&entry.inputId).map(entry=>entry.inputId),
    state:body=>result(find(body)),
    cancel(body){const entry=find(body);entry.status='cancelled';reviews.releaseLiveSession(entry.reservation);delete entry.reservation;delete entry.sessionId;return result(entry);},
    async extract(body) {
      const supplied=!!body&&Object.hasOwn(body,'inputId');
      exact(body,supplied?['requestId','inputId']:['requestId','familyId','variant']);
      if(!requestIdValid(body.requestId)||(supplied?!inputIdValid(body.inputId):!['clean','mutant'].includes(body.variant)))fail('Invalid live request ID or input selection');
      if(!enabled)fail('Live extraction is disabled; inspect the startup configuration',503);
      const binding=digest(supplied?{inputId:body.inputId}:{familyId:body.familyId,variant:body.variant}),existing=entries.get(body.requestId);
      if(existing){if(existing.binding!==binding)fail('Live request ID conflicts with its original inputs',409);return result(existing);}
      let input=null;
      if(supplied){
        const resolved=structuredClone(inputs?.get(body.inputId));
        if(!resolved)fail('Unknown validated input');
        input=validateCurrentInput(resolved.rawInputs);
        if(input.inputId!==body.inputId||digest(input)!==digest(resolved))fail('Supplied input binding mismatch; validate the exact inputs again');
      }
      const family=supplied?input?.family:families.find(f=>f.id===body.familyId);if(!family)fail(supplied?'Unknown validated input':'Unknown bundled live family');
      if(busy)fail('Another live extraction is pending; no request was sent',409);
      const stats=transport.stats();
      if(stopReason||stats.attempts>=frozen.limits.maxCalls||stats.reservedOutputTokens+frozen.limits.maxOutputTokens>frozen.limits.maxTotalOutputTokens)fail('Live process budget stopped or exhausted; no request was sent',429);
      const request=judgeRequest(family,frozen.config.model,frozen.config.maxOutputTokens,frozen.selectedPrompt.revision);
      if(Buffer.byteLength(JSON.stringify(request))>frozen.limits.maxRequestBytes)fail('Extraction request exceeds the configured byte limit; shorten the policy or labels',413);
      if(JSON.stringify(request).includes(frozen.apiKey))fail('Unsafe credential overlap in extraction inputs',400);
      // Reserve local result capacity atomically before spending provider budget.
      // Recorded-review starts share this capacity while transport is pending.
      const entry={requestId:body.requestId,binding,...(supplied?{inputId:body.inputId}:{}),status:'pending',reservation:reviews.reserveLiveSession()};entries.set(body.requestId,entry);busy=true;
      try {
        const response=await transport.complete(request);
        if(response.status!=='received') {
          // Every uncertain or invalid transport/accounting result stops further spend.
          stopReason=response.error;entry.error=response.error;
          if(entry.status!=='cancelled')entry.status='failed';
        } else if(!response.usage) {
          stopReason='missing-provider-usage';entry.error=stopReason;
          if(entry.status!=='cancelled')entry.status='failed';
        } else {
          reportedTotalTokens+=response.usage.totalTokens;
          if(!Number.isSafeInteger(reportedTotalTokens)||reportedTotalTokens>frozen.maxReportedTotalTokens) {
            stopReason='reported-total-token-limit-exceeded';entry.error=stopReason;
            if(entry.status!=='cancelled')entry.status='failed';
          } else if(entry.status!=='cancelled') {
            const source=judgeSource({family,requestId:body.requestId,request,response,endpoint:frozen.config.endpoint,kind,now:now(),promptRevision:frozen.selectedPrompt.revision});
            const snapshot=reviews.startLive(source,supplied?'supplied':body.variant,input,entry.reservation);entry.sessionId=snapshot.sessionId;entry.status='complete';
          }
          if(reportedTotalTokens>=frozen.maxReportedTotalTokens)stopReason??='reported-total-token-threshold-reached';
        }
      } catch {stopReason='live-result-rejected';entry.error=stopReason;if(entry.status!=='cancelled')entry.status='failed';}
      finally {reviews.releaseLiveSession(entry.reservation);delete entry.reservation;busy=false;}
      return result(entry);
    },
  });
}
