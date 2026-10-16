import {parentPort,workerData} from 'node:worker_threads';
import {getHeapStatistics} from 'node:v8';
import {COMPUTATION_HEAP_CEILING,COMPUTATION_OUTPUT_BYTES} from './computation-settings.mjs';
import {runPolicyImpactTask} from './policy-impact-task.mjs';
if(getHeapStatistics().heap_size_limit>COMPUTATION_HEAP_CEILING)throw new Error('Unexpected computation heap limit');
const result=runPolicyImpactTask(workerData);
if(Buffer.byteLength(JSON.stringify(result))>COMPUTATION_OUTPUT_BYTES)throw new Error('Computation output limit');
parentPort.postMessage(result);parentPort.close();
