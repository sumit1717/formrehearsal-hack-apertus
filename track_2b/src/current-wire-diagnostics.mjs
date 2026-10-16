/** Optional current-session observations. Never changes parsing, admission or stored evidence. */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {isProxy} from 'node:util/types';
import {LIMITS, validateCondition} from './core.mjs';

const KIND='current-wire-rejection-detail';
const CODES=Object.freeze({'missing-rules-member':true,'root-shape':true,'rule-shape':true,'duplicate-slot':true,
  'unsupported-rule-property':true,'unsupported-condition-operator':true,
  'condition-driver-not-declared':true,'condition-value-outside-domain':true});
// Exact fixed errors from the fingerprinted core, never arbitrary exception text.
const CONDITION_ERRORS=Object.freeze({
  'Unsupported operator':'unsupported-condition-operator',
  'Conditions may reference only independent driver fields':'condition-driver-not-declared',
  'Equality value outside finite domain':'condition-value-outside-domain',
  'Condition value outside declared domain':'condition-value-outside-domain',
});
// The guard order, fixed condition errors and public wire-ID mapping require these exact sources.
const SOURCE_HASHES=Object.freeze({
  './core.mjs':'ee9140d07e2b44f4b45cd8113a861dba35a01e278a217bfb66b8a7aab0e807b3',
  './quote-extraction.mjs':'8418ffa79e7ac003aa9368cd6ea5a0e5cd86a0d2ce5e2551711647ab8c5fa2d4',
  './apertus.mjs':'157ee0c5322540af183bc4b40aadf2b45cc6e3f637d80b3c0abbde4f44c07614',
});
let capability;
function hasKnownCapability() {
  if(capability!==undefined)return capability;
  capability=false;
  try {
    capability=Object.entries(SOURCE_HASHES).every(([path,expected])=>
      createHash('sha256').update(readFileSync(new URL(path,import.meta.url))).digest('hex')===expected);
  } catch { /* Optional detail stays unavailable, including on subsequent snapshots. */ }
  return capability;
}
const unavailable=revision=>({kind:KIND,version:1,revision,state:'unavailable',code:null});
const plain=value=>value!==null&&typeof value==='object'&&!isProxy(value)&&!Array.isArray(value)
  &&[Object.prototype,null].includes(Object.getPrototypeOf(value));
function dataMember(value,key) {
  if(isProxy(value)||!plain(value))throw new TypeError();
  const descriptor=Object.getOwnPropertyDescriptor(value,key);
  if(!descriptor)return undefined;
  if(!descriptor.enumerable||!Object.hasOwn(descriptor,'value'))throw new TypeError();
  return descriptor.value;
}
const text=(value,max)=>typeof value==='string'&&!!value.trim()&&value.length<=max;
const wireInvalid=parsed=>dataMember(parsed,'contractVersion')==='quote-extraction-v3'&&dataMember(parsed,'status')==='invalid'
  &&dataMember(parsed,'strictJsonValid')===true&&dataMember(parsed,'wireSchemaValid')===false&&dataMember(parsed,'error')==='invalid-wire-schema';

// A comma-bearing key can collide with the adapter's sorted-keys-joined-with-commas
// comparison. Do not replace that ambiguity with a stricter structural diagnosis.
function members(value,names) {
  if(!plain(value))return 'different';
  const keys=Object.keys(value);
  if(keys.some(key=>key.includes(',')))return 'ambiguous';
  return keys.length===names.length&&keys.every(key=>names.includes(key))?'same':'different';
}
// Optional observation accepts bounded plain data only. Accessors/proxies cannot
// impersonate a fixed validator error; hostile or oversized graphs stay unavailable.
function boundedData(value) {
  const pending=[{value,depth:0}],seen=new Set();let nodes=0,characters=0;
  while(pending.length){
    const {value,depth}=pending.pop();
    if(++nodes>65536||depth>64)throw new TypeError();
    if(typeof value==='string'){if((characters+=value.length)>1000000)throw new TypeError();continue;}
    if(value===null||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))continue;
    if(typeof value!=='object'||isProxy(value)||seen.has(value))throw new TypeError();
    seen.add(value);
    const array=Array.isArray(value);
    if(array?Object.getPrototypeOf(value)!==Array.prototype:!plain(value))throw new TypeError();
    if(array&&value.length>65536)throw new TypeError();
    const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(descriptors);
    if(array&&(keys.length!==value.length+1||keys.some(key=>key!=='length'
      &&(typeof key!=='string'||!Number.isInteger(Number(key))||String(Number(key))!==key||Number(key)<0||Number(key)>=value.length))))throw new TypeError();
    if(nodes+pending.length+keys.length>65536)throw new TypeError();
    for(const key of keys){
      const descriptor=descriptors[key];
      if(typeof key!=='string'||!Object.hasOwn(descriptor,'value')
        ||!descriptor.enumerable&&!(array&&key==='length'))throw new TypeError();
      if((characters+=key.length)>1000000)throw new TypeError();
      pending.push({value:descriptor.value,depth:depth+1});
    }
  }
}
function conditionPrefix(condition,family) {
  // Frozen adapter order: contract validation precedes the separate node walk.
  try { validateCondition(condition,family); }
  catch(error) {
    if(error instanceof Error&&Object.hasOwn(CONDITION_ERRORS,error.message))return CONDITION_ERRORS[error.message];
    throw error;
  }
  let nodes=0;
  const walk=node=>{
    if(++nodes>256)throw new TypeError();
    if(typeof node==='boolean')return;
    if(!plain(node))throw new TypeError();
    if(node.op==='all'||node.op==='any')node.args.forEach(walk);
    else if(node.op==='not')walk(node.arg);
  };
  walk(condition);
  return null;
}
function firstClassifiedBarrier(result,family) {
  const abstain=result?.status==='abstain',expected=abstain?['status','reason','rules']:['status','rules'];
  const rootMembers=members(result,expected);
  if(rootMembers==='ambiguous')return null;
  if(rootMembers==='different')return members(result,expected.filter(key=>key!=='rules'))==='same'
    ?'missing-rules-member':'root-shape';
  if(abstain){
    if(!text(result.reason,2000))return null;
    if(!Array.isArray(result.rules)||result.rules.length)return null;
    return null;
  }
  if(result.status!=='ok'||!Array.isArray(result.rules)||!result.rules.length||result.rules.length>LIMITS.rules)return null;
  const seen=new Set();
  for(const rule of result.rules){
    const ruleMembers=members(rule,['field','property','condition','quote']);
    if(ruleMembers==='ambiguous')return null;
    if(ruleMembers==='different')return 'rule-shape';
    // Admitted family names are the public wire IDs; no remapping or new admission.
    if(!family.fields.some(field=>field.name===rule.field&&field.role==='target'))return null;
    if(!['visible','required'].includes(rule.property))return 'unsupported-rule-property';
    const key=`${rule.field}/${rule.property}`;
    if(seen.has(key))return 'duplicate-slot';
    if(!text(rule.quote,LIMITS.policyLength))return null;
    seen.add(key);
    const conditionCode=conditionPrefix(rule.condition,family);
    if(conditionCode!==null)return conditionCode;
  }
  return null;
}
function observeWireRejection(parsed,family,revision) {
  const rawResult=dataMember(parsed,'rawResult');
  boundedData(rawResult);boundedData(family);
  const code=firstClassifiedBarrier(rawResult,family);
  return code===null?unavailable(revision):{kind:KIND,version:1,revision,state:'observed',code};
}
function sanitizeDiagnostic(value,revision) {
  if(!plain(value))return unavailable(revision);
  const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(descriptors);
  const names=['kind','version','revision','state','code'];
  if(keys.length!==names.length||keys.some(key=>typeof key!=='string'||!names.includes(key)
    ||!descriptors[key].enumerable||!Object.hasOwn(descriptors[key],'value')))return unavailable(revision);
  const values=Object.fromEntries(names.map(key=>[key,descriptors[key].value]));
  if(values.kind!==KIND||values.version!==1||values.revision!==revision)return unavailable(revision);
  if(values.state==='unavailable'&&values.code===null)return unavailable(revision);
  if(values.state!=='observed'||typeof values.code!=='string'||!Object.hasOwn(CODES,values.code))return unavailable(revision);
  // Only fresh plain primitives may reach the store's structuredClone after spend.
  return {kind:KIND,version:1,revision,state:'observed',code:values.code};
}

/** Server-owned session only. Ineligible sessions have no diagnostic sibling. */
export function currentWireValidationDiagnostic(session) {
  let revision,originalParsed;
  try {
    const recording=dataMember(session,'recording'),provenance=dataMember(recording,'provenance');
    const rawFinalText=dataMember(recording,'rawFinalText');
    originalParsed=dataMember(session,'originalParsed');
    revision=dataMember(session,'revision');
    if(!dataMember(session,'suppliedInput')||dataMember(session,'kind')==='independent-manual'||dataMember(session,'state')!=='invalid'
      ||!['live-provider-response','local-mock-transport'].includes(dataMember(provenance,'kind'))
      ||dataMember(provenance,'contractVersion')!=='quote-extraction-v3'
      ||typeof rawFinalText!=='string'||dataMember(session,'draftText')!==rawFinalText
      ||!wireInvalid(originalParsed)||!wireInvalid(dataMember(session,'parsed'))
      ||!Number.isSafeInteger(revision)||revision<0)return null;
  } catch { return null; }
  try {
    if(!hasKnownCapability())return unavailable(revision);
    return sanitizeDiagnostic(observeWireRejection(originalParsed,dataMember(session,'family'),revision),revision);
  } catch { return unavailable(revision); }
}
