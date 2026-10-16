#!/usr/bin/env node
/** Explicit local artifact files only. No provider, credentials or live request. */
import {readBoundedLocalText,SPECIFICATION_FILE_LIMIT,RECHECK_RESULT_FILE_LIMIT,parseArtifactJson} from './specification-io.mjs';
import {importCurrentSpecification,recheckCurrentSpecification,verifyCurrentRecheckResult} from './extraction-specification-r5.mjs';
import {NEW_INPUT_LIMITS} from './new-input.mjs';
const [command,...args]=process.argv.slice(2);
try{
  if(command==='recheck'&&args.length===2&&!args.some(path=>path.startsWith('-'))){
    const spec=importCurrentSpecification(await readBoundedLocalText(args[0],SPECIFICATION_FILE_LIMIT));
    const result=recheckCurrentSpecification(spec,await readBoundedLocalText(args[1],NEW_INPUT_LIMITS.formBytes));
    process.stdout.write(JSON.stringify(result,null,2)+'\n');process.exitCode=result.computation.analysisExitCode;
  }else if(command==='verify-result'&&args.length===1&&!args[0].startsWith('-')){
    const result=parseArtifactJson(await readBoundedLocalText(args[0],RECHECK_RESULT_FILE_LIMIT),{limit:RECHECK_RESULT_FILE_LIMIT});
    process.stdout.write(JSON.stringify(verifyCurrentRecheckResult(result),null,2)+'\n');
  }else throw new Error('Usage: node src/spec-cli-r5.mjs recheck SPEC_FILE FORM_FILE | verify-result RESULT_FILE');
}catch(error){process.stderr.write(`Specification check failed: ${error.message}\n`);process.exitCode=2;}
