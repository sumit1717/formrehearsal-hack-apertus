const $=id=>document.getElementById(id);let replaySequence=0,replayController=null;let families=[],family=null,variant='mutant',result=null,selected=0,request=0,controller=null;
const text=(tag,value,className)=>{const el=document.createElement(tag);el.textContent=value;if(className)el.className=className;return el;};
// Only move focus out of content that this action is about to hide or replace.
const focus = node => {if(node && node.isConnected !== false && !node.disabled && !node.hidden && !node.closest?.('[hidden]')) node.focus?.();};
function loadingFocus(message){
  const active=document.activeElement, owns=active===$('referenceRetry')||active===$('loading')||$('workspace').contains?.(active);
  $('loading').hidden=false;$('loading').className='';$('loading').textContent=message;
  if(owns)focus($('loading'));
}
function finishLoading(failed=false){
  if(document.activeElement===$('loading'))focus($(failed?'referenceRetry':'formTitle'));
  if(!failed)$('loading').hidden=true;
}
const fmt=x=>typeof x==='boolean'?(x?'yes':'no'):String(x);
const state=(property,value)=>property==='visible'?(value?'Visible':'Hidden'):(value?'Required':'Optional');
const params=()=>new URLSearchParams({family:family.id,variant,finding:selected});
async function load(){
  if(!families.length||!$('family').value)return;
  const id=++request;controller?.abort();replayController?.abort();replayController=null;controller=new AbortController();
  family=families.find(f=>f.id===$('family').value);variant=document.querySelector('[name=variant]:checked').value;selected=0;
  loadingFocus('Executing the bounded form states…');
  $('referenceRetry').hidden=true;$('referenceRetry').disabled=true;
  $('workspace').hidden=true;$('replayResult').replaceChildren();
  try{
    const r=await fetch(`/api/analyze?${params()}`,{signal:controller.signal});
    if(!r.ok)throw new Error(r.status===429?'Local computation is busy. Wait for the current check to finish, then retry this form.':'Local analysis failed');
    const data=await r.json();if(id!==request)return;
    result=data;render();$('workspace').hidden=false;finishLoading();
  }catch(e){if(e.name!=='AbortError'&&id===request){
    $('loading').textContent=e.message;$('loading').className='error';
    $('referenceRetry').textContent='Retry selected form';$('referenceRetry').hidden=false;$('referenceRetry').disabled=false;finishLoading(true);
  }}
}
function render(){$('split').textContent=family.split==='holdout'?'HELD-OUT FAMILY · ENGINE ONLY':'DEVELOPMENT FAMILY';$('formTitle').textContent=family.title;$('policy').textContent=family.policy;$('rules').textContent=JSON.stringify(family.intendedRules,null,2);$('survey').textContent=JSON.stringify(result.survey,null,2);const r=result.report;$('stateCount').textContent=r.statesChecked;$('nativeCount').textContent=r.native.errorCount+r.native.warningCount;$('findingCount').textContent=r.findings.length;$('findingHeading').textContent=r.findings.length?'A form behavior disagrees':'No discrepancy in the bounded test';$('findings').replaceChildren();
  if(!r.findings.length){const el=text('div','','clean');el.append(text('strong','Clean control passed this reference check'),text('p','Every enumerated state matched the supplied reference rules. This is not a guarantee about the original prose or unsupported form behavior.'));$('findings').append(el);}
  r.findings.forEach((f,i)=>{const card=text('div','','finding'+(selected===i?' selected':''));const button=text('button',`${f.field.replaceAll('_',' ')} · ${f.property}`);button.type='button';button.onclick=()=>{const focused=document.activeElement===button;selected=i;render();if(focused)focus($('findings').children[i]?.children[0]);};card.append(button,text('blockquote',f.source.quote));const states=text('div','','states');states.append(text('span',`Expected: ${state(f.property,f.expected)}`),text('span',`Form: ${state(f.property,f.observed)}`,'observed'));card.append(states);$('findings').append(card);});renderReplay();}
function renderReplay(){replaySequence++;replayController?.abort();replayController=null;$('replayArea').replaceChildren();$('replayResult').replaceChildren();const f=result.report.findings[selected];$('referenceReplayExplanation').textContent=f?'The minimal condition guarantees this discrepancy for every remaining in-domain answer. The complete path is replayed in SurveyJS.':'No discrepancy was found against the supplied reference rules, so no replay case is available.';if(!f){$('replayArea').append(text('p','Choose “Seeded defect” to inspect and replay its counterexample.','subtle'));return;}
  const entries=Object.entries(f.minimalAnswers);for(const [key,value] of entries)$('replayArea').append(text('span',`${key} = ${fmt(value)}`,'condition'));if(!entries.length)$('replayArea').append(text('span','All driver answers','condition'));
  $('replayArea').append(text('p',`Minimum ${entries.length} constrained answer${entries.length===1?'':'s'} · holds across ${f.guaranteedCompletions} complete states`,'subtle'));
  const list=text('ol','','path');for(const s of f.steps)list.append(text('li',`${s.field}: ${fmt(s.value)}`));$('replayArea').append(list);const button=text('button','Replay in SurveyJS','primary');button.onclick=async()=>{if(button.disabled)return;const id=request,replayId=++replaySequence;replayController?.abort();const replayRequest=new AbortController();replayController=replayRequest;const held=document.activeElement===button;$('replayResult').textContent='Replaying a fresh form instance…';if(held)focus($('replayResult'));button.disabled=true;try{const r=await fetch(`/api/replay?${params()}`,{signal:replayRequest.signal});const replay=await r.json();if(id!==request||replayId!==replaySequence)return;if(!r.ok||!replay.reproduced)throw new Error(replay.error??'Counterexample did not reproduce');const s=replay.states[f.field];$('replayResult').replaceChildren(text('div',`Reproduced. ${f.field}: ${state('visible',s.visible).toLowerCase()}, ${state('required',s.required).toLowerCase()}. Form and reference hashes match the saved witness.`,'success'));}catch(e){if(id===request&&replayId===replaySequence)$('replayResult').replaceChildren(text('p',e.message,'error'));}finally{if(replayController===replayRequest)replayController=null;button.disabled=false;if(id===request&&replayId===replaySequence&&held&&document.activeElement===$('replayResult'))focus(button);}};$('replayArea').append(button);const a=text('a','Download replay case','export');a.href=`/api/export?${params()}`;$('replayArea').append(a);}
async function bootstrap(){
  loadingFocus('Loading the local fixtures…');
  $('referenceRetry').hidden=true;$('referenceRetry').disabled=true;
  try{
    const response=await fetch('/api/families');if(!response.ok)throw new Error('Fixture loading failed');
    families=await response.json();if(!Array.isArray(families)||!families.length)throw new Error('No fixtures available');
    $('family').replaceChildren();for(const f of families){const o=text('option',f.title);o.value=f.id;$('family').append(o);}
    $('family').disabled=false;$('family').onchange=load;document.querySelectorAll('[name=variant]').forEach(el=>{el.disabled=false;el.onchange=load;});await load();
  }catch(e){
    families=[];$('family').replaceChildren();$('family').disabled=true;document.querySelectorAll('[name=variant]').forEach(el=>el.disabled=true);
    $('loading').className='error';$('loading').textContent='Could not load the local fixtures. Start the Node server and retry.';
    $('referenceRetry').textContent='Retry loading fixtures';$('referenceRetry').hidden=false;$('referenceRetry').disabled=false;finishLoading(true);
  }
}
$('referenceRetry').addEventListener('click',()=>{if(!$('referenceRetry').disabled)return families.length?load():bootstrap();});
await bootstrap();
