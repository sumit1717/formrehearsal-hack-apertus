# Single-user loopback application. No implicit credential reads or installs on host.
IMAGE ?= formrehearsal:judge-staging
DOCKER_RUNTIME_OPTIONS ?= --init --read-only --cap-drop ALL --security-opt no-new-privileges --pids-limit 128 --memory 2g --cpus 1 --env NODE_OPTIONS=--max-old-space-size=1024 --tmpfs /tmp:rw,noexec,nosuid,size=16m,mode=1777 --tmpfs /app/artifacts:rw,noexec,nosuid,size=16m,uid=1000,gid=1000
DOCKER_RUN_OPTIONS ?=
.PHONY: run demo
run:
	docker build -t $(IMAGE) .
	docker run --rm -p 127.0.0.1:4177:4177 $(DOCKER_RUNTIME_OPTIONS) $(DOCKER_RUN_OPTIONS) \
	  -e LLM_NAME -e LLM_BASE_URL -e LLM_API_KEY -e LLM_MODE -e LLM_EXTRACTION_PROMPT_REVISION \
	  -e LLM_MAX_CALLS -e LLM_MAX_OUTPUT_TOKENS -e LLM_MAX_TOTAL_OUTPUT_TOKENS \
	  -e LLM_TIMEOUT_MS -e LLM_MAX_REQUEST_BYTES -e LLM_MAX_RESPONSE_BYTES \
	  -e LLM_MAX_REPORTED_TOTAL_TOKENS $(IMAGE)
demo:
	docker build -t $(IMAGE) .
	docker run --rm --network none $(DOCKER_RUNTIME_OPTIONS) $(IMAGE) node examples/delivery-review/reproduce.mjs /app/artifacts/delivery-demo
