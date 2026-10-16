/** Active volatile input leases. Current content admission is independently gated.
 * Its old store export is retained only for fingerprinted artifact/historical
 * compatibility; current server and integration consumers use this module.
 */
import {randomUUID} from 'node:crypto';
import {inputIdValid,NEW_INPUT_LIMITS} from './new-input.mjs';
import {validateCurrentInput} from './current-admission.mjs';

const fail=(message,status=400)=>{const error=new Error(message);error.status=status;throw error;};

export function createInputStore({now=()=>Date.now()}={}) {
  const entries=new Map(),leaseEpoch=randomUUID();let leaseRevision=0;
  const prune=timestamp=>{for(const [id,entry] of entries)if(timestamp-entry.lastValidatedAt>=NEW_INPUT_LIMITS.ttlMs)entries.delete(id);};
  return Object.freeze({
    validate(body){
      // Invalid input must neither admit an identity nor renew its lease.
      const input=validateCurrentInput(body),timestamp=now();
      prune(timestamp);
      if(!entries.has(input.inputId)&&entries.size>=NEW_INPUT_LIMITS.inputs)fail('Validated input limit reached (16); release an input in Local session capacity or wait for expiry',429);
      entries.set(input.inputId,{input,lastValidatedAt:timestamp,leaseId:randomUUID(),leaseRevision:++leaseRevision});
      return structuredClone(input);
    },
    lifecycle(){
      const timestamp=now();prune(timestamp);
      return {serverNow:timestamp,limit:NEW_INPUT_LIMITS.inputs,used:entries.size,entries:[...entries].map(([inputId,entry])=>({
        inputId,leaseId:entry.leaseId,leaseEpoch,leaseRevision:entry.leaseRevision,lastValidatedAt:entry.lastValidatedAt,expiresAt:entry.lastValidatedAt+NEW_INPUT_LIMITS.ttlMs,
        remainingMs:Math.max(0,entry.lastValidatedAt+NEW_INPUT_LIMITS.ttlMs-timestamp)}))};
    },
    release(body){
      if(!body||Object.keys(body).sort().join(',')!=='inputId,leaseId'||!inputIdValid(body.inputId)||typeof body.leaseId!=='string')fail('Malformed input release');
      prune(now());const entry=entries.get(body.inputId);
      if(!entry)fail('Validated input expired or was released',410);
      if(entry.leaseId!==body.leaseId)fail('Input lease changed; refresh capacity before releasing',409);
      entries.delete(body.inputId);return {released:true,inputId:body.inputId,leaseId:entry.leaseId,leaseEpoch,leaseRevision:entry.leaseRevision};
    },
    get(id){
      if(!inputIdValid(id))fail('Invalid input ID');
      prune(now());
      const entry=entries.get(id);
      if(!entry)fail('Validated input expired or is unknown; validate the exact inputs again',410);
      return structuredClone(entry.input);
    },
  });
}
