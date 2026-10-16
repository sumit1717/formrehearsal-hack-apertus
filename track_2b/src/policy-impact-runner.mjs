/** Additive isolated comparison and one shared admission slot. No provider environment. */
import {fork} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createComputationRunner} from './computation-runner.mjs';
import {assertPolicyImpactPayload,assertPolicyImpactResponse} from './policy-impact-protocol.mjs';
import {COMPUTATION_DEADLINE_MS,COMPUTATION_EXEC_ARGV,computationError} from './computation-settings.mjs';
const busy=()=>Object.assign(new Error('Another computation is running; no new computation was started'),{status:429});
export function createPolicyImpactRunner({timeoutMs=COMPUTATION_DEADLINE_MS,forkImpl=fork}={}){
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>COMPUTATION_DEADLINE_MS||typeof forkImpl!=='function')throw new Error('Invalid comparison runner setup');
  let active=null,closed=false;
  return {
    start(input){
      if(closed)throw computationError('shutdown');if(active)throw busy();
      const payload=structuredClone(input);assertPolicyImpactPayload(payload);
      const job={id:randomUUID(),started:performance.now(),child:null,result:null,messages:0,exited:false,reason:null};
      let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});promise.catch(()=>{});active=job;
      const stop=reason=>{if(!job.exited){job.reason??=reason;try{job.child?.kill('SIGKILL');}catch{/* Capacity remains occupied until confirmed process close. */}}return promise;};
      job.cancel=stop;
      const finish=(code,signal)=>{
        if(job.exited)return;job.exited=true;clearTimeout(job.timer);if(active===job)active=null;
        if(performance.now()-job.started>=timeoutMs||code===124)job.reason??='timeout';
        if(job.reason)return reject(computationError(job.reason));
        if(code!==0||signal!==null||job.messages!==1||!job.result)return reject(computationError('worker-failed'));
        resolve(job.result);
      };
      try{
        // Same empty environment allowlist and fixed heap args as the existing
        // runner. No NODE_OPTIONS, tokens, endpoint or provider configuration.
        // A kernel network-denial boundary is inherited across this fork. The
        // strict offline JS guard blocks real forks in in-process test runs.
        job.child=forkImpl(fileURLToPath(new URL('./policy-impact-supervisor.mjs',import.meta.url)),[],{
          env:{},execArgv:[...COMPUTATION_EXEC_ARGV],stdio:['ignore','ignore','ignore','ipc'],serialization:'json',windowsHide:true,
        });
        job.child.on('message',message=>{
          if(job.exited||job.reason)return;
          if(performance.now()-job.started>=timeoutMs){stop('timeout');return;}
          try{
            if(++job.messages!==1||!message||Object.keys(message).sort().join(',')!=='operation,result,version'||message.version!==1||message.operation!=='policy-impact')throw computationError('invalid-result');
            assertPolicyImpactResponse(payload,message.result);job.result=structuredClone(message.result);
          }catch{stop('invalid-result');}
        });
        job.child.on('error',()=>stop('worker-failed'));
        job.child.on('disconnect',()=>{if(!job.exited&&job.messages!==1)stop('worker-failed');});
        job.child.once('close',finish);
        job.timer=setTimeout(()=>stop('timeout'),Math.max(1,timeoutMs-(performance.now()-job.started)));
        job.child.send({version:1,remainingMs:Math.max(1,timeoutMs-(performance.now()-job.started)),payload},error=>{if(error)stop('worker-failed');});
      }catch{
        if(job.child)stop('worker-failed');else{job.exited=true;active=null;reject(computationError('worker-failed'));}
      }
      return Object.freeze({id:job.id,promise,timeoutMs,cancel:(reason='cancelled')=>stop(reason)});
    },
    close(){closed=true;return active?active.cancel('shutdown').catch(()=>{}):Promise.resolve();},
    get busy(){return active!==null;},
  };
}
/** Existing jobs keep their unchanged runner. Neither lane may bypass capacity. */
export function createApplicationComputationRunner(options){
  const original=createComputationRunner(options),impact=createPolicyImpactRunner(options);let closed=false;
  return {
    start(payload){if(closed)throw computationError('shutdown');if(original.busy||impact.busy)throw busy();return (payload?.operation==='policy-impact'?impact:original).start(payload);},
    close(){closed=true;return Promise.all([original.close(),impact.close()]);},
    get busy(){return original.busy||impact.busy;},
  };
}
