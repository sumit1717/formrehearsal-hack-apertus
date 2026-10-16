#!/usr/bin/env node
/** Explicit local file, keyless and additive. Output is RESULT_FILE.html beside its JSON. */
import {writeRecheckHandoff} from './recheck-handoff.mjs';
const args=process.argv.slice(2);
try{
  if(args.length!==1||args[0].startsWith('-'))throw new Error('Usage: node src/recheck-handoff-cli.mjs RESULT_FILE');
  process.stdout.write(JSON.stringify(await writeRecheckHandoff(args[0]),null,2)+'\n');
}catch(error){process.stderr.write(`Readable handoff failed: ${error.message}\n`);process.exitCode=2;}
