#!/usr/bin/env node
/** Read local specifications and create one exclusive, inert HTML report. */
import {open,link,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readBoundedLocalText,parseArtifactJson,SPECIFICATION_FILE_LIMIT} from './specification-io.mjs';
import {NEW_INPUT_LIMITS} from './new-input.mjs';
import {createPolicyImpactReport} from './policy-change-report.mjs';
const usage='Usage: node src/policy-change-cli.mjs compare OLD_SPEC.json NEW_SPEC.json CURRENT_FORM.json REPORT.html\n   or: node src/policy-change-cli.mjs demo REPORT.html';
async function writeExclusive(path,html){
  if(typeof path!=='string'||!path||/^[a-z][a-z0-9+.-]*:/i.test(path)||path.includes('\0'))throw new Error('Use a local report path');
  const destination=resolve(path),temporary=join(dirname(destination),`.policy-impact-${randomUUID()}.tmp`);
  let file,created=false;
  try{
    file=await open(temporary,'wx',0o600);created=true;
    await file.writeFile(html,'utf8');await file.sync();await file.close();file=null;
    await link(temporary,destination);
  }finally{await file?.close();if(created)await unlink(temporary);}
  return destination;
}
export async function runPolicyChangeCli(args,{stdout=text=>process.stdout.write(text),stderr=text=>process.stderr.write(text)}={}){
  try{
    let inputs,output,authoredSynthetic=false;
    if(args[0]==='demo'&&args.length===2){
      const {createEquipmentDeliveryExample}=await import('../examples/policy-change/equipment-delivery.mjs');
      inputs=createEquipmentDeliveryExample();output=args[1];authoredSynthetic=true;
    }else if(args[0]==='compare'&&args.length===5){
      const [oldText,newText,formText]=await Promise.all([
        readBoundedLocalText(args[1],SPECIFICATION_FILE_LIMIT),readBoundedLocalText(args[2],SPECIFICATION_FILE_LIMIT),
        readBoundedLocalText(args[3],NEW_INPUT_LIMITS.formBytes)]);
      inputs={oldSpecification:parseArtifactJson(oldText),newSpecification:parseArtifactJson(newText),formText};output=args[4];
    }else throw new Error(usage);
    const {html,result}=createPolicyImpactReport(inputs.oldSpecification,inputs.newSpecification,inputs.formText,{authoredSynthetic});
    const outputPath=await writeExclusive(output,html),s=result.summary;
    stdout(`${s.changedScenarios} of ${s.declaredScenarios} declared scenarios change; ${s.changedScenariosNeedingFormUpdate} need a current-form update.\n${s.fullyUnchangedScenarios} fully unchanged; ${s.noKnownChangeButUnknownScenarios} have no known change but remain unresolved.\nReport: ${outputPath}\n`);
    return s.changedScenarios?1:result.unknownSlots.length?3:0;
  }catch(error){stderr(`Policy impact failed: ${error?.code==='EEXIST'?'Report already exists; choose a new output path':error.message}\n`);return 2;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))process.exitCode=await runPolicyChangeCli(process.argv.slice(2));
