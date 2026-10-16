# Proposed configuration example

Documentation only. Nothing below was executed. These snippets assume an authorized operator has already prepared the pinned runtime, local model snapshot, private networking, TLS certificate and existing credentials. Placeholder domains and paths are not working infrastructure. Check CLI support in the exact chosen image before launch.

## Inference host

Inside the prepared Apertus-compatible vLLM environment, the following is a proposed invocation. Mount the complete recorded checkpoint at `APERTUS_MODEL_DIR`, with matching tokenizer/configuration. Choose context length, tensor parallelism and memory fraction from the actual hardware and measured tokenized request length plus permitted output. No values are guessed here.

```sh
# Existing authorized secret is supplied by the operator's secret mechanism:
# VLLM_API_KEY (never written here or passed as a literal CLI argument).
test -n "${VLLM_API_KEY:?Existing inference credential must be injected}"

export HF_HUB_OFFLINE=1 HF_HUB_DISABLE_TELEMETRY=1
export VLLM_NO_USAGE_STATS=1 VLLM_DO_NOT_TRACK=1

vllm serve "${APERTUS_MODEL_DIR:?Complete pinned local snapshot required}" \
  --served-model-name swiss-ai/Apertus-v1.5-8B \
  --host "${APERTUS_PRIVATE_BIND_IP:?Internal interface address required}" \
  --port 8443 \
  --ssl-certfile "${APERTUS_TLS_CERT_FILE:?Mounted certificate chain required}" \
  --ssl-keyfile "${APERTUS_TLS_KEY_FILE:?Mounted private key required}" \
  --chat-template-content-format string \
  --default-chat-template-kwargs '{"enable_thinking":false}' \
  --tensor-parallel-size "${APERTUS_TENSOR_PARALLEL:?Validated GPU configuration required}" \
  --gpu-memory-utilization "${APERTUS_GPU_MEMORY_FRACTION:?Validated fraction required}" \
  --max-model-len "${APERTUS_CONTEXT_TOKENS:?Validated prompt plus output capacity required}" \
  --disable-uvicorn-access-log
```

If containerized, that bind address must exist inside the container, and the operator must explicitly map only the intended private interface/port. Do not use host networking or expose all interfaces just to fix a binding error. TLS private keys remain on the inference side; the app only receives the public CA chain when required. No `--trust-remote-code`, tool parser, thinking parser or automatic-tool flag is proposed.

The inspected Swiss AI vLLM commit supports TLS files, `VLLM_API_KEY` authentication and default chat-template kwargs. Its authentication middleware protects selected API prefixes, not every service route. Network restrictions remain necessary; bearer configuration alone is not comprehensive service security. [Pinned API implementation](https://github.com/swiss-ai/vllm/blob/a601a9d998ddeb488f0c17e8512874b116aa7658/vllm/entrypoints/openai/api_server.py), [pinned authentication middleware](https://github.com/swiss-ai/vllm/blob/a601a9d998ddeb488f0c17e8512874b116aa7658/vllm/entrypoints/serve/utils/server_utils.py)

## Internal CA when required

Complete this optional setup before the app startup block below. `make run` runs in the foreground; changing the host environment after it starts does not reconfigure its existing container or Node process. Any required restart is a deliberate new operation and resets process-local budgets.

Prefer an endpoint whose certificate validates under the app's current trust configuration. If the organization's existing PKI needs an additional CA, have its authorized operator review the CA and mount only that public certificate file read-only, readable by UID 1000. For example, this can be added through the existing Make option:

```sh
export DOCKER_RUN_OPTIONS='--mount type=bind,src=/operator-approved/formrehearsal-ca.pem,dst=/run/formrehearsal-ca.pem,readonly -e NODE_EXTRA_CA_CERTS=/run/formrehearsal-ca.pem'
```

The literal path must be replaced with an approved existing absolute file path; the example assumes no spaces in it. This extends trust for inheriting Node processes in this container and is loaded at process startup; it does not change host/system trust. Node warns for a missing or malformed CA file and can otherwise continue, so the operator must verify the actual TLS connection rather than treat startup or absence of a hard error as proof the CA loaded. It is not a certificate installation or a request to approve one. Never set `NODE_TLS_REJECT_UNAUTHORIZED=0`; the app rejects it. The current Makefile does not forward `NODE_EXTRA_CA_CERTS` automatically, so the explicit `-e` and mount are essential. [Node 24.21 documentation](https://github.com/nodejs/node/blob/v24.21.0/doc/api/cli.md#node_extra_ca_certsfile)

## App host

Set nonsecret runtime configuration for the exact candidate. Replace the reserved `.example` domain with the verified internal certificate name before any operation. The service must answer directly at `/v1/chat/completions`; redirects are rejected.

```sh
export LLM_NAME=swiss-ai/Apertus-v1.5-8B
export LLM_BASE_URL=https://apertus.inference.example:8443/v1
export LLM_MODE=ordinary
export LLM_EXTRACTION_PROMPT_REVISION=extraction-v3

# One explicit attempt for the first separately authorized acceptance run.
export LLM_MAX_CALLS=1
export LLM_MAX_OUTPUT_TOKENS=2048
export LLM_MAX_TOTAL_OUTPUT_TOKENS=2048
export LLM_TIMEOUT_MS=30000
export LLM_MAX_REQUEST_BYTES=16384
export LLM_MAX_RESPONSE_BYTES=65536
export LLM_MAX_REPORTED_TOTAL_TOKENS=30000

# LLM_API_KEY is injected through the existing approved secret mechanism.
# No real key, dummy key or credential-export command belongs in this example.
test -n "${LLM_API_KEY:?Existing endpoint credential must be injected}"
make run
```

The example uses existing source-supported limits, not measured inference performance. A 30-second timeout may be too short for the selected host; a timeout is recorded as a failed attempt. Any changed limit or new attempt must be deliberate and authorized. No automatic retry is provided. Cancel marks the review cancelled but does not abort its in-flight provider request; work and usage can continue until completion or timeout, and a local timeout does not prove provider-side termination. Per-process counters reset at restart and are not a monetary cap. The response must include nonnegative integer `prompt_tokens`, `completion_tokens` and `total_tokens`, with consistent totals.

`make run` reads exported variables and forwards their names into the container; it does not automatically read a `.env` file. It builds first and therefore is not an offline-install recipe. Keep the source's default runtime restrictions. This candidate's root Makefile delegates to `track_2b/Makefile`.

