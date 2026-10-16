/** Pasted input validation only. No transport, evaluation of code, or remote lookup. */
import {createHash} from 'node:crypto';
import {digest,domain,validateFields,validateSurvey} from './core.mjs';
import {publicFamilyInput} from './apertus.mjs';

export const NEW_INPUT_LIMITS=Object.freeze({policyChars:12000,policyBytes:16384,formBytes:32768,driverBytes:512,states:256,jsonDepth:16,jsonNodes:2048,inputs:16,ttlMs:30*60*1000});
const fail=(message,status=400)=>{const e=new Error(message);e.status=status;throw e;};
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(v,keys)=>object(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
const sha=text=>createHash('sha256').update(text).digest('hex');
export const inputIdValid=id=>typeof id==='string'&&/^input-[a-f0-9]{64}$/.test(id);
function text(value,label,bytes){
  if(typeof value!=='string'||!value.trim()||Buffer.byteLength(value)>bytes||!value.isWellFormed()||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))fail(`${label} must be nonempty Unicode text, without control characters, at most ${bytes} UTF-8 bytes`);
}
/** Reject duplicate decoded keys and excessive nesting before constructing a form. */
export function parseFormJson(raw) {
  let at=0,nodes=0;
  const ws=()=>{while(/[ \n\r\t]/.test(raw[at]??'!'))at++;};
  const string=()=>{
    const start=at++;let escaped=false;
    while(at<raw.length){const c=raw[at++];if(c==='"'&&!escaped){let v;try{v=JSON.parse(raw.slice(start,at));}catch{fail('Form JSON has an invalid string');}if(!v.isWellFormed()||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v))fail('Form JSON strings must contain valid Unicode without control characters');return v;}if(c==='\\'&&!escaped)escaped=true;else escaped=false;}
    fail('Form JSON has an unterminated string');
  };
  const value=depth=>{
    if(depth>NEW_INPUT_LIMITS.jsonDepth||++nodes>NEW_INPUT_LIMITS.jsonNodes)fail('Form JSON exceeds the 16-level / 2048-value structural limit');
    ws();const c=raw[at];
    if(c==='"'){string();return;}
    if(c==='{'||c==='['){const obj=c==='{',end=obj?'}':']',seen=new Set();at++;ws();if(raw[at]===end){at++;return;}
      for(;;){if(obj){if(raw[at]!=='"')fail('Form JSON object keys must be quoted');const key=string();if(seen.has(key))fail(`Form JSON has a duplicate key: ${key}`);seen.add(key);if(['__proto__','constructor','prototype'].includes(key))fail('Form JSON contains a reserved object key');ws();if(raw[at++]!==':')fail('Form JSON needs a colon after each key');}value(depth+1);ws();if(raw[at]===end){at++;return;}if(raw[at++]!==',')fail('Form JSON has an invalid separator');ws();}
    }
    const match=/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(raw.slice(at));if(!match)fail('Malformed form JSON');at+=match[0].length;
  };
  value(0);ws();if(at!==raw.length)fail('Form JSON has trailing or invalid content');
  let form;try{form=JSON.parse(raw);}catch{fail('Malformed form JSON');}return form;
}

// New inputs must not infer an exact integer driver domain from numeric bounds.
// SurveyJS accepts fractions without step, and near-integers even with step:1.
export const validateNewInput=body=>validateInput(body,false);
/** Read-only compatibility for previously exported v3/v4 finite-domain witnesses.
 * Never use this for admission, extraction, or new review sessions.
 */
export const validateLegacyReplayInput=body=>validateInput(body,true);
function validateInput(body,legacyReplay) {
  if(!exact(body,['policyText','formText','driverText']))fail('Expected policyText, formText and driverText only; provider settings cannot be supplied here');
  const {policyText,formText,driverText}=body;
  text(policyText,'Policy',NEW_INPUT_LIMITS.policyBytes);if(policyText.length>NEW_INPUT_LIMITS.policyChars)fail('Policy exceeds 12000 UTF-16 characters');
  text(formText,'Form JSON',NEW_INPUT_LIMITS.formBytes);text(driverText,'Driver IDs',NEW_INPUT_LIMITS.driverBytes);
  const drivers=driverText.split(',').map(s=>s.trim());
  if(!drivers.length||drivers.length>6||drivers.some(x=>!/^[a-z][a-z0-9_]{0,50}$/.test(x))||new Set(drivers).size!==drivers.length)fail('List 1–6 unique driver IDs separated by commas; IDs use lowercase letters, digits and underscores');
  const survey=parseFormJson(formText);if(!object(survey))fail('Form JSON must be a SurveyJS object');
  if(survey.pages!==undefined&&survey.elements!==undefined)fail('Use elements or one page, not both');
  if(survey.pages!==undefined&&(!Array.isArray(survey.pages)||survey.pages.length!==1||!object(survey.pages[0])))fail('Only one SurveyJS page is supported');
  const elements=survey.pages?.[0]?.elements??survey.elements;
  if(!Array.isArray(elements)||elements.length<5||elements.length>10)fail('This contract supports 5–10 questions; use only Boolean, radiogroup or bounded integer questions');
  const fields=elements.map(q=>{
    if(!object(q))fail('Every question must be an object');
    const field={name:q.name,label:q.title??q.name,role:drivers.includes(q.name)?'driver':'target'};
    if(typeof field.label!=='string'||!field.label.trim()||field.label.length>400)fail('Question titles must be nonempty plain strings of at most 400 characters');
    if(q.type==='boolean')return {...field,kind:'boolean'};
    if(q.type==='radiogroup')return {...field,kind:'choice',values:q.choices};
    if(q.type==='text'&&q.inputType==='number'){
      if(field.role==='driver'&&!legacyReplay)fail('Numeric driver questions are unsupported: integer min/max and step:1 do not guarantee an exact integer answer domain in SurveyJS. Use Boolean or finite string-choice drivers; numeric target questions remain supported. The form was not changed');
      return {...field,kind:'integer',min:q.min,max:q.max};
    }
    fail('Only boolean, radiogroup with 2–8 string choices, and text with inputType number and finite integer min/max are supported');
  });
  if(drivers.some(name=>!fields.some(f=>f.name===name)))fail('Every listed driver ID must name a question in the supplied form');
  const rawInputs={policyText,formText,driverText},inputId=`input-${digest(rawInputs)}`;
  const family={id:inputId,title:survey.title??'Supplied policy and form',policy:policyText,fields};
  validateFields(family);
  const states=fields.filter(f=>f.role==='driver').reduce((n,f)=>n*domain(f).length,1);
  if(states>NEW_INPUT_LIMITS.states)fail(`The drivers produce ${states} combinations; the new-input limit is 256. Reduce driver domains or their count`);
  // Strict allowlists and a bounded expression parser run before SurveyJS sees data.
  validateSurvey(family,survey);
  // The frozen request adapter has tighter label/title limits than SurveyJS.
  // Enforce that same contract during local preflight, before a request is possible.
  publicFamilyInput(family);
  const hashes={policyTextSha256:sha(policyText),formTextSha256:sha(formText),driverTextSha256:sha(driverText),rawInputsSha256:digest(rawInputs),familySha256:digest(family),schemaSha256:digest(fields),formSha256:digest(survey)};
  return structuredClone({inputId,family,survey,rawInputs,hashes,states});
}

/** Immutable, bounded, volatile preflight. There is no endpoint for editing an ID. */
export function createInputStore({now=()=>Date.now()}={}) {
  const entries=new Map();
  const prune=()=>{for(const [id,e] of entries)if(now()-e.createdAt>=NEW_INPUT_LIMITS.ttlMs)entries.delete(id);};
  return Object.freeze({
    validate(body){const input=validateNewInput(body);prune();if(!entries.has(input.inputId)){if(entries.size>=NEW_INPUT_LIMITS.inputs)fail('Validated input limit reached (16); wait 30 minutes or restart the local server',429);entries.set(input.inputId,{input,createdAt:now()});}return structuredClone(input);},
    get(id){if(!inputIdValid(id))fail('Invalid input ID');prune();const entry=entries.get(id);if(!entry)fail('Validated input expired or is unknown; validate the exact inputs again',410);return structuredClone(entry.input);},
  });
}
