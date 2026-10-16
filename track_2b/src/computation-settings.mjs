/** Scheduling limits, not a hard RSS cap or hostile-code security sandbox. */
export const COMPUTATION_DEADLINE_MS=60_000;
export const COMPUTATION_INPUT_BYTES=2*1024*1024;
export const COMPUTATION_OUTPUT_BYTES=8*1024*1024;
export const COMPUTATION_EXEC_ARGV=Object.freeze(['--max-old-space-size=768','--max-semi-space-size=8','--stack-size=4096']);
export const COMPUTATION_HEAP_CEILING=816*1024*1024;
export const COMPUTATION_OPERATIONS=Object.freeze(['review-analysis','reference-analysis','replay','specification-recheck']);
export const COMPUTATION_ERRORS=Object.freeze({
  cancelled:{status:409,message:'Computation cancelled; no new result was committed'},
  timeout:{status:504,message:'Computation incomplete: the 60-second execution budget was exceeded'},
  'worker-failed':{status:503,message:'Computation incomplete: the isolated worker could not finish'},
  'invalid-result':{status:503,message:'Computation incomplete: no complete matching worker result was received'},
  stale:{status:409,message:'Computation discarded because the review changed or expired'},
  shutdown:{status:503,message:'Computation incomplete: the local server is closing'},
});
export function computationError(reason){
  const value=COMPUTATION_ERRORS[reason]??COMPUTATION_ERRORS['worker-failed'];
  return Object.assign(new Error(value.message),{status:value.status,computationReason:Object.hasOwn(COMPUTATION_ERRORS,reason)?reason:'worker-failed'});
}
