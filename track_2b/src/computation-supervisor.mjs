// Keep this event loop free of checker imports/work. Its deadline and IPC
// disconnect handler remain responsive even while the task thread is busy.
import {Worker} from 'node:worker_threads';
import {getHeapStatistics} from 'node:v8';
import {COMPUTATION_DEADLINE_MS,COMPUTATION_INPUT_BYTES,COMPUTATION_OUTPUT_BYTES,COMPUTATION_HEAP_CEILING,COMPUTATION_OPERATIONS} from './computation-settings.mjs';
let accepted=false,successfulDisconnect=false,finished=false,task,result,messages=0;
let deadline=performance.now()+COMPUTATION_DEADLINE_MS;
const stop=(code=1)=>{if(finished)return;finished=true;process.exit(code);};
let timer=setTimeout(()=>stop(124),COMPUTATION_DEADLINE_MS);
process.on('disconnect',()=>{if(!successfulDisconnect)stop();});
process.on('uncaughtException',()=>stop());
process.on('unhandledRejection',()=>stop());
if(!process.send||getHeapStatistics().heap_size_limit>COMPUTATION_HEAP_CEILING)stop();
process.on('message',message=>{
  if(accepted||finished||!message||message.version!==1||!Number.isFinite(message.remainingMs)||message.remainingMs<=0||message.remainingMs>COMPUTATION_DEADLINE_MS
    ||!COMPUTATION_OPERATIONS.includes(message.payload?.operation)||Buffer.byteLength(JSON.stringify(message))>COMPUTATION_INPUT_BYTES) return stop();
  accepted=true;
  deadline=Math.min(deadline,performance.now()+message.remainingMs);
  clearTimeout(timer);timer=setTimeout(()=>stop(124),Math.max(1,deadline-performance.now()));
  task=new Worker(new URL('./computation-task.mjs',import.meta.url),{workerData:message.payload,env:{},execArgv:[],
    resourceLimits:{maxOldGenerationSizeMb:768,maxYoungGenerationSizeMb:16,stackSizeMb:4},stdout:true,stderr:true});
  task.stdout.resume();task.stderr.resume();
  task.on('message',value=>{
    if(finished||++messages!==1||performance.now()>=deadline||Buffer.byteLength(JSON.stringify(value))>COMPUTATION_OUTPUT_BYTES)return stop();
    result=value;
  });
  task.on('messageerror',()=>stop());task.on('error',error=>stop(error.code==='ERR_WORKER_OUT_OF_MEMORY'?125:1));
  task.on('exit',code=>{
    if(finished)return;
    if(code!==0||messages!==1||!result||performance.now()>=deadline)return stop(performance.now()>=deadline?124:1);
    process.send({version:1,operation:message.payload.operation,result},error=>{
      if(error||!process.connected||performance.now()>=deadline)return stop(performance.now()>=deadline?124:1);
      successfulDisconnect=true;finished=true;clearTimeout(timer);process.disconnect();
    });
  });
});
