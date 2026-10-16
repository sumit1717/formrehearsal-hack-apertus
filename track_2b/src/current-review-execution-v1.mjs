/** Local execution provenance, separate from frozen approved specifications.
 * Fixed inventory only: external descriptors cannot select files or adapters.
 * This is an immutable-release consistency check, not loaded-byte attestation:
 * it trusts the local filesystem/module loader against concurrent mutation.
 */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Version} from 'survey-core';
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const releaseDescriptor={kind:'current-review-native-row-reuse',version:1,
    implementation:Object.fromEntries(['current-review-analysis-v1.mjs','current-review-execution-v1.mjs','core.mjs','computation-task.mjs']
      .map(name=>[name,hash(new URL(name,import.meta.url))])),
    dependencies:Object.fromEntries(['survey-core','survey-core/linter'].map(name=>[name,hash(new URL(import.meta.resolve(name)))])),
    engine:{name:'survey-core',version:Version}};
// Capture this process release once; callers cannot mutate the retained value.
export function currentReviewExecutionDescriptor(){return structuredClone(releaseDescriptor);}

