import {createHash} from 'node:crypto';
import {recheckCurrentSpecification,validateCurrentSpecification} from './extraction-specification.mjs';
import {validateCurrentInput} from './current-admission.mjs';
import {parentPort,workerData} from 'node:worker_threads';
import {getHeapStatistics} from 'node:v8';
import {analyze,replay} from './core.mjs';
import {analyzeReviewWithCoverage} from './current-review-analysis-v1.mjs';
import {currentReviewExecutionDescriptor} from './current-review-execution-v1.mjs';
import {COMPUTATION_HEAP_CEILING,COMPUTATION_OUTPUT_BYTES} from './computation-settings.mjs';

// This fixed module receives data only. It never evaluates source supplied by a
// caller, imports caller-selected modules, or reads provider configuration.
if(getHeapStatistics().heap_size_limit>COMPUTATION_HEAP_CEILING)throw new Error('Unexpected computation heap limit');
const {operation,family,survey,rules,options,finding}=workerData;
let result;
if(operation==='review-analysis'){
  result={...analyzeReviewWithCoverage(family,survey,rules,options),executionDescriptor:currentReviewExecutionDescriptor()};
}else if(operation==='reference-analysis')result={report:analyze(family,survey)};
else if(operation==='replay')result={replay:replay(family,survey,rules,finding)};
else if(operation==='specification-recheck'){
  // Original spec failures are incomplete work, never replacement validation.
  validateCurrentSpecification(workerData.specification);
  let admission=false;
  try{
    // Frozen core validation errors predate HTTP status properties. This narrow
    // preflight phase classifies ordinary validation Error objects as invalid;
    // range/resource faults and unexpected computation errors remain incomplete.
    validateCurrentInput({...workerData.specification.reviewBasis.suppliedInput.rawInputs,formText:workerData.formText});
    admission=true;
    result={status:'complete',result:recheckCurrentSpecification(workerData.specification,workerData.formText)};
  }
  catch(error){
    if(error.constructor!==Error||admission&&error.status!==400)throw error;
    result={status:'invalid',specificationSha256:workerData.specification.specificationSha256,
      formTextSha256:createHash('sha256').update(workerData.formText).digest('hex'),
      error:String(error.message).slice(0,1000)};
  }
}else throw new Error('Unknown computation');
if(Buffer.byteLength(JSON.stringify(result))>COMPUTATION_OUTPUT_BYTES)throw new Error('Computation output limit');
parentPort.postMessage(result);
parentPort.close();
