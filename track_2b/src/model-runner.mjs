/** Bounded provider transport. Offline commands never instantiate live networking. */
import { buildExtractionRequest, buildDirectRequest, parseModelJson, validateExtractionResult, validateDirectResult } from './apertus.mjs';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

export const rawTextSha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new TypeError(message); };
function integer(value, name, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(`Invalid ${name}`);
  return value;
}
const defaults = Object.freeze({ maxCalls: 36, maxOutputTokens: 2048, maxTotalOutputTokens: 73728, timeoutMs: 30000, maxRequestBytes: 100000, maxResponseBytes: 1000000 });

export function endpointFromBase(base) {
  if (typeof base !== 'string' || base.length > 2000 || base !== base.trim()) fail('Invalid LLM_BASE_URL');
  let url;
  try { url = new URL(base); } catch { fail('Invalid LLM_BASE_URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || /%|\\/.test(base)) fail('LLM_BASE_URL requires HTTPS without credentials, query, fragment or escapes');
  if (!url.hostname || url.pathname.endsWith('/chat/completions')) fail('LLM_BASE_URL must be an API base, not a completion endpoint');
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/chat/completions`;
  return url.href;
}

/** No credential is read or returned here. Offline identifiers are explicit placeholders. */
export function readRunnerConfig(env = {}, overrides = {}) {
  for (const key of Object.keys(overrides)) if (!Object.hasOwn(defaults, key) && !['model', 'mode', 'baseUrl'].includes(key)) fail('Unknown runner setting');
  const model = overrides.model ?? env.LLM_NAME ?? 'offline-unverified-placeholder';
  const mode = overrides.mode ?? 'ordinary';
  if (typeof model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(model)) fail('Invalid LLM_NAME');
  if (!['ordinary', 'thinking'].includes(mode)) fail('Mode must be ordinary or thinking');
  const baseUrl = overrides.baseUrl ?? env.LLM_BASE_URL;
  const config = { ...defaults, ...overrides, model, mode, endpoint: baseUrl === undefined ? null : endpointFromBase(baseUrl) };
  delete config.baseUrl;
  integer(config.maxCalls, 'maxCalls', 1, 100);
  integer(config.maxOutputTokens, 'maxOutputTokens', 1, 8192);
  integer(config.maxTotalOutputTokens, 'maxTotalOutputTokens', 1, 819200);
  integer(config.timeoutMs, 'timeoutMs', 1, 120000);
  integer(config.maxRequestBytes, 'maxRequestBytes', 100, 1000000);
  integer(config.maxResponseBytes, 'maxResponseBytes', 100, 1000000);
  return Object.freeze(config);
}

export function validateRunnerConfig(config) {
  const expected = [...Object.keys(defaults), 'model', 'mode', 'endpoint'];
  if (!object(config) || Object.keys(config).length !== expected.length || expected.some(k => !Object.hasOwn(config, k))) fail('Invalid runner configuration');
  const checked = readRunnerConfig({}, { ...Object.fromEntries(Object.keys(defaults).map(k => [k, config[k]])), model: config.model, mode: config.mode });
  if (config.endpoint !== null && (typeof config.endpoint !== 'string' || !config.endpoint.endsWith('/chat/completions') || endpointFromBase(config.endpoint.slice(0, -'/chat/completions'.length)) !== config.endpoint)) fail('Invalid completion endpoint');
  return Object.freeze({ ...checked, endpoint: config.endpoint });
}

export function prepareRequest({ task, family, survey, config }) {
  const input = { family, survey, model: config.model, mode: config.mode };
  const prepared = task === 'extract' ? buildExtractionRequest(input) : task === 'direct' ? buildDirectRequest(input) : fail('Unknown model task');
  const body = { ...prepared, temperature: 0, max_tokens: config.maxOutputTokens, stream: false };
  if (Buffer.byteLength(JSON.stringify(body)) > config.maxRequestBytes) fail('Request byte limit exceeded');
  return body;
}

class BoundaryError extends Error {
  constructor(code, usageDiagnostics) { super(code); this.code = code; this.usageDiagnostics = usageDiagnostics; }
}
const reject = (code, usageDiagnostics) => { throw new BoundaryError(code, usageDiagnostics); };
const usageFields = ['prompt_tokens', 'completion_tokens', 'total_tokens'];
const validTokenCount = value => Number.isSafeInteger(value) && value >= 0;
const valueType = value => value === undefined ? 'missing' : value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;

/** Structure only: constant keys/types, counts and validation booleans. Never provider names or values. */
function describeUsage(usage, maxOutputTokens) {
  const isObject = object(usage), fields = isObject ? Object.keys(usage) : [];
  const additionalTypes = { null: 0, boolean: 0, number: 0, string: 0, array: 0, object: 0 };
  for (const key of fields) if (!usageFields.includes(key)) additionalTypes[valueType(usage[key])]++;
  const requiredTypes = usageFields.map(key => isObject ? valueType(usage[key]) : 'missing');
  const validIntegers = isObject ? usageFields.filter(key => validTokenCount(usage[key])).length : 0;
  return {
    containerType: valueType(usage), fieldCount: fields.length,
    requiredTypes: { promptTokens: requiredTypes[0], completionTokens: requiredTypes[1], totalTokens: requiredTypes[2] },
    validRequiredIntegerCount: validIntegers,
    totalConsistent: validIntegers === 3 ? usage.total_tokens === usage.prompt_tokens + usage.completion_tokens : null,
    outputWithinLimit: isObject && validTokenCount(usage.completion_tokens) ? usage.completion_tokens <= maxOutputTokens : null,
    additionalFieldCount: fields.filter(key => !usageFields.includes(key)).length,
    additionalValueTypes: additionalTypes,
  };
}

/** Strict final-message boundary; reasoning/tool/streamed text is never substituted. */
export function parseCompletionEnvelope(raw, { model, maxOutputTokens = 8192 } = {}) {
  let envelope;
  try { envelope = parseModelJson(raw); } catch { reject('invalid-envelope-json'); }
  if (Object.hasOwn(envelope, 'error')) reject('provider-error');
  if (envelope.model !== model) reject('returned-model-mismatch');
  if (!Array.isArray(envelope.choices) || envelope.choices.length !== 1) reject('invalid-choices');
  const choice = envelope.choices[0];
  if (!object(choice) || choice.index !== 0) reject('invalid-choice');
  if (choice.finish_reason !== 'stop') reject(choice.finish_reason === 'length' ? 'truncated-response' : 'unsupported-finish-reason');
  const message = choice.message;
  if (!object(message) || message.role !== 'assistant' || typeof message.content !== 'string') reject('invalid-assistant-message');
  if ((message.tool_calls != null && (!Array.isArray(message.tool_calls) || message.tool_calls.length)) || message.function_call != null) reject('unexpected-tool-call');
  if (message.refusal != null) reject('provider-refusal');
  let usage = null;
  if (envelope.usage != null) {
    const u = envelope.usage;
    if (!object(u) || usageFields.some(k => !Object.hasOwn(u, k) || !validTokenCount(u[k])) || u.total_tokens !== u.prompt_tokens + u.completion_tokens) reject('invalid-usage', describeUsage(u, maxOutputTokens));
    if (u.completion_tokens > maxOutputTokens) reject('output-token-limit-exceeded', describeUsage(u, maxOutputTokens));
    // Project only the canonical totals. Nested accounting metadata is neither added nor exposed.
    usage = { promptTokens: u.prompt_tokens, completionTokens: u.completion_tokens, totalTokens: u.total_tokens };
  }
  return { content: message.content, usage, returnedModel: envelope.model,
    ...(usage === null ? { usageDiagnostics: describeUsage(envelope.usage, maxOutputTokens) } : {}) };
}

async function boundedResponseText(response, limit, signal) {
  if (signal.aborted) reject('timeout');
  if (!response.body || typeof response.body.getReader !== 'function') reject('missing-response-stream');
  const declared = response.headers?.get('content-length');
  if (declared != null && (!/^\d+$/.test(declared) || Number(declared) > limit)) reject('response-byte-limit-exceeded');
  const reader = response.body.getReader(), chunks = [];
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) reject('response-byte-limit-exceeded');
      chunks.push(value);
    }
    try { return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); }
    catch { reject('invalid-response-encoding'); }
  } finally { signal.removeEventListener('abort', cancel); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** Recognize nested JSON unicode/backslash escaping even when final JSON is malformed. */
function escapedCredentialEcho(text, apiKey) {
  let decoded = text;
  for (let pass = 0; pass < 12; pass++) {
    if (decoded.includes(apiKey)) return true;
    const escapes = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
    const unicodeDecoded = decoded.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    if (unicodeDecoded.includes(apiKey)) return true;
    const next = unicodeDecoded.replace(/\\(["\\/bfnrt])/g, (_, char) => escapes[char]);
    if (next === decoded) return false;
    decoded = next;
  }
  // Excessive nested escaping is not useful final JSON evidence; fail closed.
  return true;
}

/**
 * Transport component for explicit opt-in execution and contract tests. Requires an
 * explicit injected fetch and separately supplied allowlist, never global fetch.
 * Output-token reservation is not a currency or total-billing-token guarantee.
 */
export function createBoundedTransport({ config, allowedEndpoint, allowedModel, apiKey, fetchImpl, totalTimeoutMs } = {}) {
  config = validateRunnerConfig(config);
  if (!config?.endpoint || config.endpoint !== allowedEndpoint || config.model !== allowedModel) fail('Endpoint and model must match the explicit allowlist');
  if (typeof apiKey !== 'string' || apiKey.length < 8 || apiKey.length > 4096 || /\s/.test(apiKey)) fail('A runtime credential is required');
  if (typeof fetchImpl !== 'function') fail('An explicit transport implementation is required');
  if (totalTimeoutMs !== undefined) integer(totalTimeoutMs, 'whole-run timeout', 1, 600000);
  const operationDeadline = totalTimeoutMs === undefined ? Infinity : performance.now() + totalTimeoutMs;
  let attempts = 0, reservedOutputTokens = 0, busy = false, stopReason = null;
  const stats = () => ({ attempts, reservedOutputTokens });
  return Object.freeze({ stats, async complete(body) {
    if (stopReason) return { status: 'transport-error', error: 'transport-stopped', stopReason, ...stats() };
    if (busy) return { status: 'transport-error', error: 'concurrent-call-rejected', ...stats() };
    if (attempts >= config.maxCalls || reservedOutputTokens + config.maxOutputTokens > config.maxTotalOutputTokens) return { status: 'transport-error', error: 'call-or-output-budget-exhausted', ...stats() };
    // Rebuild the exact supported envelope; reject caller-controlled API options.
    if (!object(body) || Object.keys(body).some(k => !['model', 'messages', 'temperature', 'max_tokens', 'stream'].includes(k)) || body.model !== config.model || body.max_tokens !== config.maxOutputTokens || body.stream !== false || body.temperature !== 0 || !Array.isArray(body.messages) || body.messages.length !== 2 || body.messages.some((m, i) => !object(m) || Object.keys(m).length !== 2 || m.role !== ['system', 'user'][i] || typeof m.content !== 'string')) return { status: 'transport-error', error: 'invalid-request', ...stats() };
    const serialized = JSON.stringify(body);
    if (Buffer.byteLength(serialized) > config.maxRequestBytes) return { status: 'transport-error', error: 'request-byte-limit-exceeded', ...stats() };
    const remainingMs = Math.min(config.timeoutMs, operationDeadline - performance.now());
    if (remainingMs <= 0) { stopReason = 'whole-run-deadline-reached'; return { status: 'transport-error', error: stopReason, ...stats() }; }
    const requestDeadline = performance.now() + remainingMs;
    busy = true; attempts++; reservedOutputTokens += config.maxOutputTokens;
    const controller = new AbortController();
    let timer;
    try {
      // Arm before invoking fetch, including a synchronous injected implementation.
      const timeoutTask = new Promise((_, rejectPromise) => { timer = setTimeout(() => { stopReason = 'timeout'; controller.abort(); rejectPromise(new BoundaryError('timeout')); }, remainingMs); });
      const responseTask = (async () => {
        const response = await fetchImpl(config.endpoint, { method: 'POST', redirect: 'error', signal: controller.signal, headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` }, body: serialized });
        if (controller.signal.aborted) reject('timeout');
        if (response.redirected || (response.url && response.url !== config.endpoint)) reject('unexpected-response-endpoint');
        if (!response.ok) reject(Number.isInteger(response.status) ? `http-${response.status}` : 'http-error');
        if (!/^application\/json(?:\s*;|$)/i.test(response.headers?.get('content-type') ?? '')) reject('unexpected-content-type');
        const raw = await boundedResponseText(response, config.maxResponseBytes, controller.signal);
        const parsed = parseCompletionEnvelope(raw, { model: config.model, maxOutputTokens: config.maxOutputTokens });
        // Do not persist a credential even if a provider echoes it with JSON escapes.
        const echoesKey = value => typeof value === 'string' ? escapedCredentialEcho(value, apiKey) : value && typeof value === 'object' ? Object.entries(value).some(([key, item]) => key.includes(apiKey) || echoesKey(item)) : false;
        let finalJsonForEcho = null;
        try { finalJsonForEcho = parseModelJson(parsed.content); } catch { /* Invalid final JSON is scored separately. */ }
        if (raw.includes(apiKey) || echoesKey(JSON.parse(raw)) || echoesKey(finalJsonForEcho)) reject('credential-echo-detected');
        if (performance.now() >= requestDeadline) reject('timeout');
        return { status: 'received', ...parsed, rawEnvelope: raw, responseSha256: rawTextSha256(raw), ...stats() };
      })();
      return await Promise.race([responseTask, timeoutTask]);
    } catch (error) {
      controller.abort();
      if (error instanceof BoundaryError && ['returned-model-mismatch', 'unexpected-response-endpoint', 'output-token-limit-exceeded', 'credential-echo-detected', 'http-401', 'http-402', 'http-403'].includes(error.code)) stopReason = error.code;
      // Never copy provider text, exception messages, keys or authorization headers.
      return { status: 'transport-error', error: error instanceof BoundaryError ? error.code : 'transport-failed',
        ...(error instanceof BoundaryError && error.usageDiagnostics ? { usageDiagnostics: error.usageDiagnostics } : {}), ...stats() };
    } finally { clearTimeout(timer); busy = false; }
  } });
}

export function parseFinalResult(raw, task, { family }) {
  if (!['extract', 'direct'].includes(task)) fail('Unknown model task');
  let result;
  try { result = parseModelJson(raw); }
  catch { return { status: 'invalid', error: 'invalid-final-json', strictJsonValid: false, schemaValid: false, result: null }; }
  try {
    (task === 'extract' ? validateExtractionResult : validateDirectResult)(result, { family });
    return { status: result.status === 'abstain' ? 'abstain' : 'valid', strictJsonValid: true, schemaValid: true, result };
  } catch {
    return { status: 'invalid', error: 'invalid-final-schema', strictJsonValid: true, schemaValid: false, result: null };
  }
}
