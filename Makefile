.DEFAULT_GOAL := run
.PHONY: run demo check-public
run demo:
	$(MAKE) -C track_2b $@
check-public:
	python3 checks/check_public_source_v1.py .
