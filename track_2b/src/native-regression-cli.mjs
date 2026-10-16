#!/usr/bin/env node
/** Fresh local files only. Receipt is written last; no overwrite or network. */
import {mkdir,lstat,open} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
import {readBoundedLocalText,parseArtifactJson,SPECIFICATION_FILE_LIMIT} from './specification-io.mjs';
import {NEW_INPUT_LIMITS} from './new-input.mjs';
import {createNativeVisibilityExport,verifyNativeVisibilityExport,runVerifiedNativeVisibility,nativeJson,NATIVE_FILE_LIMIT} from './native-regression-export.mjs';
const sha=text=>createHash('sha256').update(text).digest('hex');
const fail=message=>{throw new Error(message);};
function local(value){if(typeof value!=='string'||!value||value.startsWith('-')||/^[a-z][a-z0-9+.-]*:/i.test(value)||value.includes('\0'))fail('Use explicit local paths');return resolve(value);}
async function noSymlinkParents(value){
  for(let at=resolve(value);;at=dirname(at)){
    const info=await lstat(at);if(!info.isDirectory()||info.isSymbolicLink())fail('Use existing regular local directories without symlinks');
    if(dirname(at)===at)break;
  }
}
async function read(path,limit){const file=local(path);await noSymlinkParents(dirname(file));return readBoundedLocalText(file,limit);}
async function writeFresh(output,files,kind){
  const directory=local(output);await noSymlinkParents(dirname(directory));
  // Prepare bounded output in memory before creating anything.
  const manifest={};
  for(const [name,text] of Object.entries(files)){
    const limit=name==='approved-specification.json'?SPECIFICATION_FILE_LIMIT:NATIVE_FILE_LIMIT;
    if(Buffer.byteLength(text)>limit)fail('Output exceeds its byte limit');
    manifest[name]={bytes:Buffer.byteLength(text),sha256:sha(text)};
  }
  await mkdir(directory,{mode:0o700});
  const write=async(name,text)=>{const file=await open(join(directory,name),'wx',0o600);try{await file.writeFile(text,'utf8');await file.sync();}finally{await file.close();}};
  for(const [name,text] of Object.entries(files))await write(name,text);
  const receipt={kind,files:manifest,complete:true};await write('receipt.json',nativeJson(receipt));
  return {outputDirectory:directory,...receipt};
}
async function bundle(directory){
  const root=local(directory);await noSymlinkParents(root);
  const texts=await Promise.all([read(join(root,'approved-specification.json'),SPECIFICATION_FILE_LIMIT),read(join(root,'native-suite.json'),NATIVE_FILE_LIMIT),read(join(root,'native-sidecar.json'),NATIVE_FILE_LIMIT)]);
  const receiptText=await read(join(root,'receipt.json'),16384);parseArtifactJson(receiptText,{limit:16384});
  const names=['approved-specification.json','native-suite.json','native-sidecar.json'];
  const expected={kind:'formrehearsal-native-visibility-export-receipt-v1',files:Object.fromEntries(names.map((name,i)=>[name,{bytes:Buffer.byteLength(texts[i]),sha256:sha(texts[i])}])),complete:true};
  if(receiptText!==nativeJson(expected))fail('Missing or inconsistent completed export receipt');
  return texts;
}
try{
  const [command,...args]=process.argv.slice(2);let output;
  if(command==='export'&&args.length===2){
    const exported=createNativeVisibilityExport(await read(args[0],SPECIFICATION_FILE_LIMIT));
    output=await writeFresh(args[1],{'approved-specification.json':exported.specificationText,'native-suite.json':exported.suiteText,'native-sidecar.json':exported.sidecarText},'formrehearsal-native-visibility-export-receipt-v1');
  }else if(command==='verify'&&args.length===1){
    output=verifyNativeVisibilityExport(...await bundle(args[0]));
  }else if(command==='run'&&args.length===3){
    const result=await runVerifiedNativeVisibility(...await bundle(args[0]),await read(args[1],NEW_INPUT_LIMITS.formBytes));
    output=await writeFresh(args[2],{'native-result.json':nativeJson(result)},'formrehearsal-native-visibility-run-receipt-v1');
    output.nativeStatus=result.nativeResult.status;output.summary=result.nativeResult.summary;
    process.exitCode=result.nativeResult.summary.failedChecks?1:0;
  }else fail('Usage: node src/native-regression-cli.mjs export SPECIFICATION FRESH_DIRECTORY | verify EXPORT_DIRECTORY | run EXPORT_DIRECTORY FORM FRESH_RESULT_DIRECTORY');
  process.stdout.write(nativeJson(output));
}catch(error){process.stderr.write(`Native visibility handoff failed: ${error.message}\n`);process.exitCode=2;}
