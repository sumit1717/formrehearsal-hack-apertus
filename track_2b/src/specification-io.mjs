/** Bounded untrusted artifact/file input. No provider, credentials or network. */
import {open,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
export const SPECIFICATION_FILE_LIMIT=1048576;
export const RECHECK_RESULT_FILE_LIMIT=4194304;
export const ARTIFACT_LIMITS=Object.freeze({depth:64,nodes:65536});
const fail=message=>{const e=new Error(message);e.status=400;throw e;};
const reserved=new Set(['__proto__','constructor','prototype']);
const badControl=/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
const opaquePaths=[
 ['reviewBasis','recording','rawFinalText'],['reviewBasis','priorRecording','rawFinalText'],
 ['specification','reviewBasis','recording','rawFinalText'],['specification','reviewBasis','priorRecording','rawFinalText'],
];
const opaque=path=>opaquePaths.some(expected=>expected.length===path.length&&expected.every((part,i)=>part===path[i]));
/** Reject ambiguity and structural overload before JSON.parse. Preserve opaque failed evidence. */
export function parseArtifactJson(raw,{limit=SPECIFICATION_FILE_LIMIT}={}) {
  if(typeof raw!=='string'||Buffer.byteLength(raw)>limit)fail('Artifact exceeds its byte limit');
  if(raw.charCodeAt(0)===0xfeff)fail('Artifact BOM is unsupported');
  let at=0,nodes=0;
  const ws=()=>{while(/[ \r\n\t]/.test(raw[at]??'!'))at++;};
  const string=(path,key=false)=>{
    const start=at++;let escaped=false;
    while(at<raw.length){
      const ch=raw[at++];
      if(ch==='"'&&!escaped){
        let value;try{value=JSON.parse(raw.slice(start,at));}catch{fail('Malformed artifact string');}
        if((key||!opaque(path))&&(!value.isWellFormed()||badControl.test(value)))fail('Malformed artifact control text');
        if(key&&(reserved.has(value)||value.length>512))fail('Unsupported artifact object key');
        return value;
      }
      if(ch==='\\'&&!escaped)escaped=true;else escaped=false;
    }
    fail('Unterminated artifact string');
  };
  const value=(path,depth)=>{
    if(depth>ARTIFACT_LIMITS.depth||++nodes>ARTIFACT_LIMITS.nodes)fail('Artifact exceeds its structural limits');
    ws();const ch=raw[at];
    if(ch==='"'){string(path);return;}
    if(ch==='{'||ch==='['){
      const object=ch==='{',end=object?'}':']',seen=new Set();let index=0;at++;ws();
      if(raw[at]===end){at++;return;}
      for(;;){
        let key=index++;
        if(object){if(raw[at]!=='"')fail('Artifact object keys must be quoted');key=string(path,true);if(seen.has(key))fail('Duplicate artifact object key');seen.add(key);ws();if(raw[at++]!==':')fail('Malformed artifact object');}
        value([...path,key],depth+1);ws();if(raw[at]===end){at++;return;}if(raw[at++]!==',')fail('Malformed artifact separator');ws();
      }
    }
    const token=/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(raw.slice(at));
    if(!token)fail('Malformed artifact JSON');
    if(!['true','false','null'].includes(token[0])&&!Number.isFinite(Number(token[0])))fail('Non-finite artifact number');
    at+=token[0].length;
  };
  value([],0);ws();if(at!==raw.length)fail('Artifact has trailing content');
  try{return JSON.parse(raw);}catch{fail('Malformed artifact JSON');}
}
export async function readBoundedLocalText(path,limit) {
  if(typeof path!=='string'||!path||/^[a-z][a-z0-9+.-]*:/i.test(path)||path.includes('\0'))fail('Use a local regular file path');
  let file;
  try{
    const before=await lstat(path);if(!before.isFile()||before.isSymbolicLink())fail('Input must be a regular file');
    if(before.size>limit)fail('Input exceeds its byte limit');
    file=await open(path,constants.O_RDONLY|(constants.O_NONBLOCK??0)|(constants.O_NOFOLLOW??0));
    const info=await file.stat();if(!info.isFile()||info.size>limit)fail('Input must be a bounded regular file');
    const chunks=[];let total=0;
    for(;;){
      const buffer=Buffer.alloc(Math.min(65536,limit+1-total));
      const {bytesRead}=await file.read(buffer,0,buffer.length,null);if(!bytesRead)break;
      total+=bytesRead;if(total>limit)fail('Input exceeds its byte limit');chunks.push(buffer.subarray(0,bytesRead));
    }
    const bytes=Buffer.concat(chunks,total);
    if(bytes.length>=3&&bytes[0]===0xef&&bytes[1]===0xbb&&bytes[2]===0xbf)fail('Input BOM is unsupported');
    try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{fail('Input must be valid UTF-8');}
  }catch(error){if(error?.status===400)throw error;fail('Unable to read the local input file');}
  finally{await file?.close();}
}
