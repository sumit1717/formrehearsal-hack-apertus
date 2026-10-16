// Run against the keyless local review/fixture server on this host/container's loopback interface.
// CI feeds this file to Node over stdin so the production image stays unchanged.
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';

const port=Number(process.env.PORT??4177);
assert.ok(Number.isInteger(port)&&port>0&&port<=65535,'PORT must be a valid TCP port');
const origin=`http://127.0.0.1:${port}`;
const request=(path,options={})=>fetch(origin+path,{...options,signal:AbortSignal.timeout(3000)});
let ready=false;
for(let attempt=0;attempt<30;attempt++) {
  try {const response=await request('/');await response.arrayBuffer();ready=response.status===200;} catch {}
  if(ready)break;
  await delay(1000);
}
assert.ok(ready,'Fixture server did not become ready');
const get=async path=>{
  const response=await request(path);
  assert.equal(response.status,200,path);
  assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  return response;
};
const page=await get('/');
assert.match(page.headers.get('content-security-policy'),/connect-src 'self'/);
assert.match(await page.text(),/Offline fixture demo\. No model inference runs in this page\./);
for(const [path,type] of [['/app.js','javascript'],['/review.js','javascript'],['/recheck.js','javascript'],['/reference.js','javascript'],['/style.css','css']]) {
  const response=await get(path);
  assert.ok(response.headers.get('content-type').includes(type));
  assert.ok((await response.text()).length>0);
}
const families=await (await get('/api/families')).json();
assert.equal(families.length,12);
assert.equal(new Set(families.map(f=>f.id)).size,12);
let witnesses=0;
for(const family of families) {
  const id=encodeURIComponent(family.id);
  const clean=await (await get(`/api/analyze?family=${id}&variant=clean`)).json();
  assert.equal(clean.report.findings.length,0,`${family.id} clean control`);
  const mutant=await (await get(`/api/analyze?family=${id}&variant=mutant`)).json();
  assert.ok(mutant.report.findings.length>0,`${family.id} seeded defect`);
  assert.equal(mutant.report.provenance.modelInference,'not-run');
  for(const [index,finding] of mutant.report.findings.entries()) {
    const query=`family=${id}&variant=mutant&finding=${index}`;
    const replay=await (await get(`/api/replay?${query}`)).json();
    assert.equal(replay.reproduced,true,`${family.id} witness ${index}`);
    const response=await get(`/api/export?${query}`);
    assert.match(response.headers.get('content-disposition'),/attachment;/);
    const record=await response.json();
    assert.equal(record.familyId,family.id);
    assert.equal(record.variant,'mutant');
    assert.deepEqual(record.finding,finding);
    witnesses++;
  }
}
assert.equal(witnesses,17);
for(const [path,status,options] of [
  ['/missing',404],
  ['/api/analyze?family=missing',400],
  ['/api/analyze?family=camera-pool&variant=missing',400],
  ['/api/replay?family=camera-pool&variant=clean',400],
  ['/api/families',405,{method:'POST'}],
]) {
  const response=await request(path,options);
  assert.equal(response.status,status,path);
  await response.arrayBuffer();
}
const post=async(action,body)=>{
  const response=await request(`/api/review/${action}`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal(response.status,200,action);return response.json();
};
const recordings=await(await get('/api/recordings')).json();assert.equal(recordings.length,5);assert.equal(recordings.at(-1).id,'r5-sparse-candidate');assert.equal(recordings.at(-1).variant,'supplied');
let reviewed=await post('start',{recordingId:'garden-tool-shed-v3-recorded',variant:'mutant',actorKind:'agent-simulation',humanAttestation:false});
assert.equal(reviewed.state,'review-needed');assert.equal(reviewed.approval,null);
reviewed=await post('approve',{sessionId:reviewed.sessionId,expectedRevision:reviewed.revision,rulesSha256:reviewed.rulesSha256,reviewedInterpretation:true,reviewedCoverage:true});
const approved=()=>({sessionId:reviewed.sessionId,expectedRevision:reviewed.revision,approvalHash:reviewed.approval.approvalHash});
reviewed=await post('analyze',approved());assert.equal(reviewed.report.findings.length,1);assert.equal(reviewed.report.rulesSha256,reviewed.approval.rulesSha256);
const recordedReplay=await post('replay',{...approved(),finding:0});assert.equal(recordedReplay.replay.reproduced,true);reviewed=recordedReplay.snapshot;
const bundle=await post('export',{...approved(),finding:0});assert.equal(bundle.version,4);assert.equal(bundle.mode,'reviewed-recorded');assert.deepEqual(bundle.rules,reviewed.parsed.normalizedResult.rules);assert.equal(bundle.review.approvalHash,reviewed.approval.approvalHash);
const invalid=await post('start',{recordingId:'pottery-cart-v3-recorded',variant:'mutant',actorKind:'agent-simulation',humanAttestation:false});assert.equal(invalid.state,'invalid');assert.equal(invalid.approval,null);
// Automated attestations test mechanics only; they are not human-review evidence.
console.log(`HTTP smoke passed: ${families.length} synthetic families, 24 cases, ${witnesses} replayed/exported witnesses, assets and legacy/error routes; garden recorded approval/check/replay/v4 export and blocked pottery. No model calls.`);
