import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadCorpus,root} from './benchmark.mjs';
import {createApplicationComputationRunner} from './policy-impact-runner.mjs';
import {compareReviewedPolicy} from './policy-impact-request.mjs';
import {POLICY_IMPACT_BODY_LIMIT} from './policy-impact-protocol.mjs';
import {createReviewStore,loadRecordings,REVIEW_BODY_LIMIT} from './recorded-review.mjs';
import {createJudgeBridge} from './judge-live-v5.mjs';
import {createInputStore} from './input-store.mjs';
import {loadHistoricalR5Source} from './historical-recording-r5.mjs';
const historicalR5Source=await loadHistoricalR5Source();
const bundledRecordings=await loadRecordings({includeSynthetic:true});

const staticFiles={
  '/':['public/index.html','text/html; charset=utf-8'],
  '/app.js':['public/app.js','text/javascript; charset=utf-8'],
  '/lifecycle.js':['public/lifecycle.js','text/javascript; charset=utf-8'],
  '/policy-impact.js':['public/policy-impact.js','text/javascript; charset=utf-8'],
  '/recheck.js':['public/recheck.js','text/javascript; charset=utf-8'],
  '/review.js':['public/review.js','text/javascript; charset=utf-8'],
  '/equipment-practice.json':['public/equipment-practice.json','application/json; charset=utf-8'],
  '/reference.js':['public/reference.js','text/javascript; charset=utf-8'],
  '/style.css':['public/style.css','text/css; charset=utf-8'],
};
const json=(res,status,body)=>{
  if(res.destroyed||res.writableEnded)return;
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify(body));
};

const requestError=(message,status)=>{const error=new Error(message);error.status=status;throw error;};
function checkLocalRequest(req,mutation=false) {
  const port=req.socket.localPort;
  const hosts=[`127.0.0.1:${port}`,`localhost:${port}`,`[::1]:${port}`];
  if(!hosts.includes(req.headers.host))requestError('Local Host required',403);
  if(mutation&&(req.headers.origin!==`http://${req.headers.host}` || (req.headers['sec-fetch-site']&&req.headers['sec-fetch-site']!=='same-origin')))requestError('Same-origin review request required',403);
}
// Browser resource isolation, not client authentication. Headerless local CLI
// requests remain supported; browsers must not spend local compute cross-origin.
function checkComputationRead(req) {
  if(req.headers.origin!==undefined&&req.headers.origin!==`http://${req.headers.host}`
    ||req.headers['sec-fetch-site']!==undefined&&!['same-origin','none'].includes(req.headers['sec-fetch-site']))
    requestError('Same-origin computation request required',403);
}
async function readJsonBody(req,limit=REVIEW_BODY_LIMIT) {
  if(req.headers['content-type']?.split(';')[0].trim().toLowerCase()!=='application/json')requestError('Expected application/json',415);
  if(req.headers['content-length']!==undefined&&(!/^\d+$/.test(req.headers['content-length'])||Number(req.headers['content-length'])>limit))requestError('Review request body too large',413);
  let size=0;const chunks=[];
  // An inactivity timeout alone can be kept alive indefinitely by byte drips.
  // Incomplete bodies lose the connection; no mutation has been admitted yet.
  const abortBody=()=>req.destroy(),deadline=setTimeout(abortBody,5000);
  req.setTimeout(5000,abortBody);
  try{for await(const chunk of req){size+=chunk.length;if(size>limit)requestError('Review request body too large',413);chunks.push(chunk);}}
  finally{clearTimeout(deadline);req.off('timeout',abortBody);if(req.socket)req.setTimeout(0);}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(Buffer.concat(chunks)));}catch{requestError('Malformed JSON body',400);}
}
/** Local review sessions; live inference requires configured startup and an explicit POST. */
export function createDemoServer(corpus,{recordings=bundledRecordings,liveEnv={},testFetchImpl,reviewSimulation=!!testFetchImpl,computationOptions}={}) {
  const computations=createApplicationComputationRunner(computationOptions);
  const cache=new Map(),reviews=createReviewStore(corpus,recordings,{simulation:reviewSimulation,computationRunner:computations,historicalR5Source}),inputs=createInputStore();
  const live=createJudgeBridge({corpus,reviews,inputs,env:liveEnv,testFetchImpl});
  async function referenceComputation(payload,res){
    const job=computations.start(payload);
    // A reference result has one HTTP owner and no recoverable review session.
    // Never cancel a reviewed job or another request's occupied capacity.
    const abandon=()=>{if(!res.writableEnded)void job.cancel('cancelled').catch(()=>{});};
    res.once('close',abandon);
    if(res.destroyed)abandon();
    try{return await job.promise;}finally{res.off('close',abandon);}
  }
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    try {
      const url=new URL(req.url,'http://localhost');
      checkLocalRequest(req);
      if(req.method==='GET'&&url.pathname==='/api/health'){json(res,200,{status:'ok'});return;}
      if(req.method==='GET'&&url.pathname==='/api/lifecycle'){json(res,200,{inputs:inputs.lifecycle(),reviews:reviews.lifecycle(),pendingInputIds:live.pendingInputIds()});return;}
      if(req.method==='POST'&&url.pathname==='/api/input/release'){
        checkLocalRequest(req,true);json(res,200,inputs.release(await readJsonBody(req)));return;
      }
      if(req.method==='POST'&&url.pathname==='/api/input/validate') {
        checkLocalRequest(req,true);const input=inputs.validate(await readJsonBody(req));
        const lease=inputs.lifecycle().entries.find(entry=>entry.inputId===input.inputId);
        res.setHeader('X-FormRehearsal-Input-Lease',lease.leaseId);
        res.setHeader('X-FormRehearsal-Input-Lease-Epoch',lease.leaseEpoch);
        res.setHeader('X-FormRehearsal-Input-Lease-Revision',String(lease.leaseRevision));
        json(res,200,input);return;
      }
      if(req.method==='GET'&&url.pathname==='/api/live/config'){json(res,200,live.config());return;}
      if(req.method==='POST'&&url.pathname.startsWith('/api/live/')) {
        checkLocalRequest(req,true);
        const action=url.pathname.slice('/api/live/'.length);
        if(!['extract','state','cancel'].includes(action)){json(res,404,{error:'Unknown live action'});return;}
        const output=await live[action](await readJsonBody(req));json(res,200,output);return;
      }
      if(req.method==='POST'&&url.pathname==='/api/review/policy-impact') {
        checkLocalRequest(req,true);
        const body=await readJsonBody(req,POLICY_IMPACT_BODY_LIMIT);
        json(res,200,await compareReviewedPolicy({reviews,computations,body,response:res}));return;
      }
      if(req.method==='POST'&&url.pathname.startsWith('/api/review/')) {
        checkLocalRequest(req,true);
        const action=url.pathname.slice('/api/review/'.length);
        if(!['state','release','start','manual-start','draft','approve','analyze','replay','cancel-computation','export','export-specification','recheck','export-recheck'].includes(action)){json(res,404,{error:'Unknown review action'});return;}
        const body=await readJsonBody(req),output=await (action==='manual-start'?reviews.startManual(body,inputs.get(body.inputId))
          :action==='recheck'?reviews.recheckAsync(body):action==='analyze'?reviews.analyzeAsync(body):action==='replay'?reviews.replayAsync(body):reviews[action](body));
        if(action==='export')res.setHeader('Content-Disposition',`attachment; filename="${output.familyId}-${output.variant}-reviewed-witness.json"`);
        if(action==='export-specification')res.setHeader('Content-Disposition','attachment; filename="formrehearsal-approved-specification.json"');
        if(action==='export-recheck')res.setHeader('Content-Disposition','attachment; filename="formrehearsal-recheck-result.json"');
        json(res,200,output);return;
      }
      if(req.method!=='GET') {json(res,405,{error:'Method not supported for this local route'});return;}
      if(url.pathname==='/api/recordings'){json(res,200,reviews.list());return;}
      if(staticFiles[url.pathname]) {
        const [path,mime]=staticFiles[url.pathname];
        const content=await readFile(root+path);
        res.writeHead(200,{'Content-Type':mime});res.end(content);return;
      }
      if(url.pathname==='/api/families') {
        json(res,200,corpus.map(({id,title,split,wordingStyle,policy,fields,intendedRules,mutation})=>({id,title,split,wordingStyle,policy,fields,intendedRules,mutation})));
        return;
      }
      if(['/api/analyze','/api/replay','/api/export'].includes(url.pathname)) {
        checkComputationRead(req);
        const f=corpus.find(x=>x.id===url.searchParams.get('family'));
        const variant=url.searchParams.get('variant')??'mutant';
        if(!f||!['clean','mutant'].includes(variant)) {json(res,400,{error:'Unknown family or variant'});return;}
        const key=`${f.id}/${variant}`;
        if(!cache.has(key))cache.set(key,(await referenceComputation({operation:'reference-analysis',family:f,survey:f.forms[variant]},res)).report);
        const report=cache.get(key);
        if(url.pathname==='/api/analyze') {json(res,200,{report,survey:f.forms[variant]});return;}
        const n=Number(url.searchParams.get('finding')??0);
        if(!Number.isInteger(n)||!report.findings[n]) {json(res,400,{error:'Unknown finding'});return;}
        if(url.pathname==='/api/replay') {
          const result=await referenceComputation({operation:'replay',family:f,survey:f.forms[variant],rules:f.intendedRules.rules,finding:report.findings[n]},res);
          json(res,200,result.replay);return;
        }
        res.setHeader('Content-Disposition',`attachment; filename="${f.id}-${variant}-witness.json"`);
        json(res,200,{version:1,familyId:f.id,variant,finding:report.findings[n]});return;
      }
      json(res,404,{error:'Not found'});
    } catch(e) {json(res,e.status??400,{error:e.message});}
  });
  // The final close event waits for open HTTP responses; stop computation at
  // the close request so those responses can finish with explicit errors.
  const close=server.close.bind(server);
  server.close=(...args)=>{void computations.close();return close(...args);};
  server.on('close',()=>{void computations.close();});
  return server;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const port=Number(process.env.PORT??4177),host=process.env.HOST??'127.0.0.1';
  const server=createDemoServer(await loadCorpus(),{liveEnv:process.env,reviewSimulation:process.env.FORMREHEARSAL_REVIEW_SIMULATION==='1'});
  server.listen(port,host,()=>console.log(`FormRehearsal private local demo: http://${host}:${server.address().port} (live inference only when configured and explicitly requested)`));
}
