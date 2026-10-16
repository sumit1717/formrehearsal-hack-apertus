/** Bounded local liveness only. No model, credentials, state mutation or logs. */
import {request} from 'node:http';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export function probeHealth({port=4177,timeoutMs=2000}={}) {
  if(!Number.isSafeInteger(port)||port<1||port>65535||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>2000)return Promise.resolve(false);
  return new Promise(resolveResult=>{
    let req,timer,finished=false;
    const finish=healthy=>{if(finished)return;finished=true;clearTimeout(timer);req?.destroy();resolveResult(healthy);};
    timer=setTimeout(()=>finish(false),timeoutMs);
    try {
      req=request({hostname:'127.0.0.1',port,path:'/api/health',method:'GET',agent:false,maxHeaderSize:2048},res=>{
        res.on('error',()=>finish(false));res.on('aborted',()=>finish(false));
        if(res.statusCode!==200||!/^application\/json(?:\s*;|$)/i.test(res.headers['content-type']??'')){finish(false);return;}
        let bytes=0,body='';res.setEncoding('utf8');
        res.on('data',chunk=>{bytes+=Buffer.byteLength(chunk);if(bytes>64){finish(false);return;}body+=chunk;});
        res.on('end',()=>finish(body==='{"status":"ok"}'));
      });
      req.on('error',()=>finish(false));req.end();
    } catch {finish(false);}
  });
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  process.exitCode=await probeHealth({port:Number(process.env.PORT??4177)})?0:1;
}
