# FormRehearsal on premise deployment guide

Proposed operator guide v2; source-basis review dated 14 October 2026. This guide describes a proposed route for the historical 127-file explorer-integrated source identified in [SOURCE-BINDING.json](SOURCE-BINDING.json). That binding is preserved provenance, not the current release inventory. See the [public source manifest](../../../PUBLIC_SOURCE_MANIFEST.v1.json) and [current evidence](../../../CURRENT_EVIDENCE.md) for the later package and its limits. It does not claim an installed or verified app-plus-inference deployment. No application code, model, image, certificate, credential or network setting was changed while preparing it.

## Recommended bounded arrangement

Use one organization-administered workstation for the browser and FormRehearsal, plus an organization-administered GPU inference host on its internal network. Keep the application available only at http://127.0.0.1:4177. Its server-side bridge sends explicitly requested extraction to the GPU host over authenticated, certificate-validated HTTPS. The browser never needs direct access to inference.

The exact application already has a configurable endpoint. No endpoint patch is necessary. Its ordinary Apertus 1.5 8B/70B allowlist, request bounds and final-response checks remain unchanged. Choose 8B for the initial configuration example; this is not a measured hardware-fit or quality recommendation. The [Track 2B requirement](https://github.com/HackApertus/project-template/blob/main/track_2b/README.md) includes on-premise deployment under the organization's administration.

## Evidence that exists

- Delivered v15 passed two bounded automated browser journeys on one authored example, with zero provider attempts and zero human participants.
- Its shipping addendum separately observed cached Docker startup and exact HTTP assets under constrained overrides and container-internal loopback. Ordinary host-browser reachability and cold builds were not established by that run.
- The newer 127-file candidate has static and pure-test evidence. Its changed admission module and scenario-explorer presentation have not inherited v15's native, browser or shipping-runtime pass. The endpoint, transport, server, Docker and dependency files inspected for this guide remain byte-identical to the prior 127-file documentation basis.
- Neither run establishes local Apertus inference, model usefulness, complete air-gapped operation, Swiss residency, or production security.

## Prepare the two hosts

The app host needs Docker, Make, a browser and capacity for the source's existing container limits: 2 GiB memory, one CPU and 128 PIDs. These are configured ceilings, not a measured minimum or throughput claim. Its image pins Node 24 Alpine and locks SurveyJS 3.1.2. The first build requires the Node image and npm dependency; store the resulting application image digest.

The inference host needs an accelerator and driver/CUDA stack supported by the selected Apertus-compatible runtime, enough host RAM/storage for the complete checkpoint and runtime, and measured GPU memory for weights, multimodal components, KV cache and execution overhead. Record GPU model/count/VRAM, driver, host architecture, RAM, free disk, tensor parallelism and context length. No minimum VRAM, latency, cost or concurrency is established here. Do not infer fit from the “8B” label or a weights-only calculation.

The [official model card](https://huggingface.co/swiss-ai/Apertus-v1.5-8B) recommends the Swiss AI modified vLLM/runtime image while upstream integration is in progress. Use the model-specific instructions rather than assuming generic latest vLLM is compatible. Resolve the selected amd64/arm64 image to an immutable digest; record its actual runtime/source revision. Acquire a complete checkpoint snapshot, tokenizer, configuration and chat-template files at one recorded model commit, then hash the local files. This draft supplies neither weights nor a validated image digest. Review applicable model access conditions with the owner before acquisition; no agreement or contact-data disclosure is authorized by this guide.

## Network and storage boundaries

- Browser → app: host loopback TCP 4177, HTTP. The Docker listener uses 0.0.0.0 inside its container; the Makefile publishes only host 127.0.0.1.
- App → inference: an operator-selected internal DNS name and TLS port, shown as 8443 in the example. Permit only the approved app host and administrative monitoring sources. Do not publish inference to the internet.
- Inference → weights: local read-only checkpoint directory. Runtime caches and logs need separately scoped writable locations.
- Build/acquisition traffic: approved container registries, npm and the model source before isolation. Separate those stages from inference runtime.
- Runtime: restrict egress to necessary internal DNS/time/PKI and the app's selected inference destination. Investigate telemetry, update checks, remote assets and model-cache misses. Environment switches alone are not proof of network isolation.

The app sends the fixed prompt and the policy, title, field identifiers/labels, roles, types and finite domains. Complete SurveyJS JSON and its form expressions are not sent by the live bridge. Those selected texts may still be sensitive: begin with non-sensitive synthetic inputs. App state is volatile, but exports, browser/OS storage, logs, swap, backups and administrator access need an operator retention policy. Session expiry is not secure erasure. Do not enable prompt/output logging during the acceptance run.

## Configure and operate

1. Complete the artifact and authorization checks above. Use the [configuration example](CONFIGURATION-EXAMPLE.md) for the private inference endpoint and application variables.
2. Start and validate the prepared inference service first. Its served model name must exactly equal `swiss-ai/Apertus-v1.5-8B`; use the matching ordinary 70B name only with that actual model. An alias is a routing contract, not proof of weights.
3. Have an authorized operator inject the existing endpoint credential into the app's `LLM_API_KEY` runtime environment. The inference side uses its authorized `VLLM_API_KEY`. Never place actual values in source, commands, screenshots or this document. Creating/configuring ongoing credentials needs its own approval.
4. Configure the internal inference DNS name and certificate trust. Host localhost and container localhost are different. If an internal CA is required, prepare the process-scoped public CA mount described in the example before startup; never disable certificate verification.
5. Complete the runtime environment setup and launch the app through its existing root `make run`. After launch, verify internal DNS, trusted TLS and reachability from the actual app container before extraction. Open the local app URL and inspect `/api/live/config`: enabled configuration with zero attempts is necessary, but is not an inference-readiness test.
6. Execute only the explicitly approved synthetic extraction. Inspect the untouched model result, validate it, record limitations, and separately approve an interpretation before deterministic analysis. An invalid response or abstention stays a failure/abstention. Do not repair its saved output or substitute the authored practice as a model success.
7. Finish the [acceptance checklist](ACCEPTANCE-CHECKLIST.md), retain redacted evidence and stop owned services. The result must say which checks were observed and which remain open.

## Compatibility limits

The app is single-user local software, without multi-user authentication. Its exact Host and Origin checks reject an ordinary shared HTTPS frontend. A public/shared proxy is not a deployment shortcut; supporting that would need an explicitly designed and tested authentication/origin change outside this draft. The inference endpoint requires HTTPS and bearer auth; a default unauthenticated HTTP vLLM service is incompatible.

Cancel marks the live review cancelled and prevents a returned result from being attached to that review. It does not abort the already-running provider request. The request and reported usage can continue until completion or the transport timeout; aborting a local fetch on timeout does not prove that the inference server stopped work. Do not claim immediate compute, token or billing cancellation.

The bridge permits two string-content chat messages, temperature 0, non-streaming output and a fixed token cap. It requires the exact returned model alias, one assistant content result ending with `stop`, valid usage totals and no tool call or refusal. Thinking aliases, quantized substitutes, audio/image input, structured-output experiment recipes and arbitrary model aliases are not covered. Current default extraction remains `extraction-v3`; selecting v5 does not integrate or validate another experimental recipe.

An on-premise path need not be air-gapped. To claim an air gap later, stage every image/dependency/model artifact, preserve internal app-to-inference connectivity, and verify the entire runtime has no external connection. `make demo` supplies Docker's `--network none` for a disconnected authored checker, not Apertus inference. A Swiss endpoint alone does not establish sovereign Swiss operation of the app, browser, exports, logs or backups.

Primary references and inspected code locations are in [SOURCES.md](SOURCES.md). The proposed architecture is summarized in the [final report](../../technical_report.md#target-architecture-and-dependencies); its unexecuted status remains explicit.
