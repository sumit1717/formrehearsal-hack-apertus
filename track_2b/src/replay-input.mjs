/** Current CLI JSON boundary only; no change to frozen replay or artifact hashes. */
export const REPLAY_JSON_LIMITS=Object.freeze({bytes:1048576,depth:64,nodes:65536});
const fail=message=>{throw new Error(message);};

/** Preserve every valid JSON string, including opaque failed model evidence.
 * Interpretation and provenance remain the responsibility of replayBundle.
 */
export function parseReplayJson(raw) {
  if(typeof raw!=='string'||Buffer.byteLength(raw)>REPLAY_JSON_LIMITS.bytes)fail('Replay bundle exceeds byte limit');
  if(raw.charCodeAt(0)===0xfeff)fail('Replay input BOM is unsupported');
  let at=0,nodes=0;
  const ws=()=>{while(/[ \r\n\t]/.test(raw[at]??'!'))at++;};
  const string=()=>{
    const start=at++;let escaped=false;
    while(at<raw.length){
      const ch=raw[at++];
      if(ch==='"'&&!escaped){
        try{return JSON.parse(raw.slice(start,at));}catch{fail('Malformed replay JSON');}
      }
      if(ch==='\\'&&!escaped)escaped=true;else escaped=false;
    }
    fail('Malformed replay JSON');
  };
  const value=depth=>{
    if(depth>REPLAY_JSON_LIMITS.depth||++nodes>REPLAY_JSON_LIMITS.nodes)fail('Replay bundle exceeds structural limits');
    ws();const ch=raw[at];
    if(ch==='"'){string();return;}
    if(ch==='{'||ch==='['){
      const object=ch==='{',end=object?'}':']',seen=new Set();at++;ws();
      if(raw[at]===end){at++;return;}
      for(;;){
        if(object){
          if(raw[at]!=='"')fail('Malformed replay JSON');
          const key=string();if(seen.has(key))fail('Duplicate replay object key');seen.add(key);
          ws();if(raw[at++]!==':')fail('Malformed replay JSON');
        }
        value(depth+1);ws();if(raw[at]===end){at++;return;}
        if(raw[at++]!==',')fail('Malformed replay JSON');ws();
      }
    }
    const token=/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(raw.slice(at));
    if(!token)fail('Malformed replay JSON');
    if(!['true','false','null'].includes(token[0])&&!Number.isFinite(Number(token[0])))fail('Non-finite replay number');
    at+=token[0].length;
  };
  value(0);ws();if(at!==raw.length)fail('Malformed replay JSON');
  try{return JSON.parse(raw);}catch{fail('Malformed replay JSON');}
}
