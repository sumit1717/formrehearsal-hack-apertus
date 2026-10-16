"""Prospective, explicit Apertus stop-token metadata profile; never a fallback.

This additive parser leaves the historical v1/v2 parsers and frozen r4 selection
unchanged. A new reviewed runtime must select and hash-bind this PROFILE before
any new request. Importing it does not change an existing parser or ledger.
"""
from dataclasses import dataclass, field

import runner as v1

PROFILE = 'formrehearsal-plain-response-stop68-v3'
PARENT_NULL_PARSER_SHA256 = 'b06222d24c251105bf8a8412b278892fe5aa5e212a912a1fd6c1fa67ab1d79a1'
# Exactly the observed Apertus assistant-end marker, not arbitrary token IDs.
APERTUS_ASSISTANT_END_TOKEN_ID = 68
# Prospective source/approval inventories must bind this unchanged dependency too.
PARENT_RUNNER_SHA256 = 'fcf6c35a94efe40920584e78e71a09b3b5e8708f1eb38eda50501eda1ee7b029'
NULL_ENVELOPE_FIELDS = frozenset({
    'prompt_logprobs', 'prompt_token_ids', 'prompt_text', 'kv_transfer_params', 'metrics',
})
NULL_CHOICE_FIELDS = frozenset({'token_ids', 'routed_experts'})


@dataclass(frozen=True)
class Parsed(v1.Parsed):
    parser_profile: str = field(default=PROFILE, init=False)


def parse_plain_response(raw: bytes, unit: v1.Unit) -> Parsed:
    """Parse unchanged bytes with one exact, model-bound stop-reason exception.

    Only absent/null or integer 68 is admitted for choices[0].stop_reason.
    All other v2 structural checks remain. No field/content repair, provider
    authentication, scoring, usage reconciliation or ledger write occurs here.
    """
    envelope = v1.strict_json(raw, unit.response_byte_cap)
    v1.require(type(envelope) is dict and set(envelope).issubset({
        'id', 'object', 'created', 'model', 'choices', 'usage', 'system_fingerprint', 'service_tier',
    } | NULL_ENVELOPE_FIELDS) and
        all(envelope.get(name) is None for name in NULL_ENVELOPE_FIELDS) and
        envelope.get('object', 'chat.completion') == 'chat.completion', 'envelope_shape')
    v1.require(envelope.get('model') == v1.MODEL, 'model_mismatch')
    choices = envelope.get('choices')
    v1.require(type(choices) is list and len(choices) == 1 and type(choices[0]) is dict, 'choice_count')
    choice = choices[0]
    v1.require(set(choice).issubset({'index', 'finish_reason', 'message', 'logprobs', 'stop_reason'} | NULL_CHOICE_FIELDS) and
        all(choice.get(name) is None for name in NULL_CHOICE_FIELDS) and
        choice.get('logprobs') is None, 'unexpected_choice_fields')
    stop_reason = choice.get('stop_reason')
    v1.require(stop_reason is None or (type(stop_reason) is int and
        stop_reason == APERTUS_ASSISTANT_END_TOKEN_ID), 'unexpected_stop_reason')
    v1.require(type(choice.get('index')) is int and choice['index'] == 0 and choice.get('finish_reason') == 'stop', 'finish_or_index')
    message = choice.get('message')
    v1.require(type(message) is dict and message.get('role') == 'assistant' and type(message.get('content')) is str, 'plain_content')
    nullable_fields = {'refusal', 'function_call', 'annotations', 'audio', 'reasoning', 'reasoning_content'}
    v1.require(set(message).issubset({'role', 'content', 'tool_calls'} | nullable_fields) and
        all(message.get(name) is None for name in nullable_fields) and
        (message.get('tool_calls') is None or message.get('tool_calls') == []), 'unexpected_message_fields')
    content = message['content'].encode('utf-8')
    v1.require(len(content) <= unit.response_byte_cap and not v1.SENSITIVE.search(content), 'unsafe_content')
    usage = envelope.get('usage')
    v1.require(type(usage) is dict and all(v1.integer(usage.get(name)) for name in ('prompt_tokens', 'completion_tokens', 'total_tokens')), 'missing_usage')
    prompt, completion, total = (usage[name] for name in ('prompt_tokens', 'completion_tokens', 'total_tokens'))
    v1.require(prompt + completion == total and completion <= unit.output_tokens, 'usage_mismatch_or_cap')
    # Details are not added again; total already includes them. strict_json rejects
    # nonfinite numbers throughout the entire envelope, including unused details.
    return Parsed(content, prompt, completion, total)
