"""Tests for the dependency-free Python inference HTTP service."""
from __future__ import annotations

import json
from contextlib import contextmanager
from threading import Thread
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest

from ml.inference import build_triage_response, clear_pipeline_cache, load_pipeline
from ml.service import create_server


@contextmanager
def running_server(inference_function=build_triage_response, model_loader=load_pipeline):
    server = create_server(
        "127.0.0.1",
        0,
        inference_function=inference_function,
        model_loader=model_loader,
    )
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def response_payload(**overrides):
    result = {
        "follow_up_question": None,
        "care_type": "teleconsultation",
        "urgency": None,
        "red_flags": [],
        "reasoning": "Synthetic inference response.",
        "matched_caregivers": [],
    }
    result.update(overrides)
    return result


def post_json(url, payload):
    request = Request(
        f"{url}/predict",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=3) as response:
            return response.status, json.load(response)
    except HTTPError as error:
        return error.code, json.load(error)


def test_health_endpoint_loads_model_and_returns_readiness():
    calls = []
    with running_server(lambda _text: response_payload(), lambda: calls.append("load")) as url:
        with urlopen(f"{url}/health", timeout=3) as response:
            assert response.status == 200
            assert json.load(response) == {
                "success": True,
                "service": "cura-ml",
                "status": "healthy",
            }
        with urlopen(f"{url}/health", timeout=3):
            pass
    assert calls == ["load"]


def test_health_endpoint_hides_model_loading_failure():
    def fail_loading():
        raise FileNotFoundError("private model path")

    with running_server(lambda _text: response_payload(), fail_loading) as url:
        request = Request(f"{url}/health")
        with pytest.raises(HTTPError) as error:
            urlopen(request, timeout=3)
        assert error.value.code == 503
        body = json.load(error.value)
        assert body["error"]["code"] == "ML_MODEL_UNAVAILABLE"
        assert "private" not in json.dumps(body)


def test_predict_uses_inference_function_and_returns_documented_response():
    received = []
    with running_server(
        lambda text: received.append(text) or response_payload(),
    ) as url:
        status, body = post_json(
            url,
            {
                "text": "I have fever and body pain.",
                "language": "english",
                "symptoms": ["fever"],
                "duration": "two days",
            },
        )
    assert status == 200
    assert received == ["I have fever and body pain."]
    assert body == response_payload()


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"text": ""},
        {"text": "   "},
        {"text": 123},
        {"text": "fever", "language": "unknown"},
        {"text": "fever", "symptoms": "fever"},
        {"text": "fever", "duration": 2},
        [],
    ],
)
def test_predict_rejects_missing_or_malformed_fields(payload):
    with running_server(lambda _text: response_payload()) as url:
        status, body = post_json(url, payload)
    assert status == 422
    assert body["error"]["code"] == "INVALID_ML_REQUEST"


def test_predict_rejects_malformed_json():
    with running_server(lambda _text: response_payload()) as url:
        request = Request(
            f"{url}/predict",
            data=b"{not-json",
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with pytest.raises(HTTPError) as error:
            urlopen(request, timeout=3)
    assert error.value.code == 400
    body = json.load(error.value)
    assert body["error"]["code"] == "INVALID_ML_REQUEST"


def test_inference_failure_is_reported_without_internal_details():
    def fail_inference(_text):
        raise RuntimeError("private exception with user payload")

    with running_server(fail_inference) as url:
        status, body = post_json(url, {"text": "fever"})
    assert status == 503
    assert body["error"]["code"] == "ML_INFERENCE_UNAVAILABLE"
    assert "private" not in json.dumps(body)


def test_invalid_inference_schema_is_not_returned_as_success():
    with running_server(lambda _text: {"care_type": "fabricated"}) as url:
        status, body = post_json(url, {"text": "fever"})
    assert status == 503
    assert body["error"]["code"] == "ML_INFERENCE_UNAVAILABLE"


def test_multiple_requests_use_the_injected_inference_each_time():
    received = []
    with running_server(
        lambda text: received.append(text) or response_payload(),
    ) as url:
        first = post_json(url, {"text": "fever"})
        second = post_json(url, {"text": "headache"})
    assert first[0] == second[0] == 200
    assert received == ["fever", "headache"]


def test_actual_inference_response_schema_and_model_loading():
    clear_pipeline_cache()
    with running_server() as url:
        with urlopen(f"{url}/health", timeout=10) as health:
            assert health.status == 200
        status, body = post_json(url, {"text": "need doctor consultation"})
    assert status == 200
    assert set(body) == {
        "follow_up_question",
        "care_type",
        "urgency",
        "red_flags",
        "reasoning",
        "matched_caregivers",
    }
    assert body["care_type"] in {
        "paramedic_home_visit",
        "home_nursing",
        "lab_test_home",
        "teleconsultation",
        "emergency_112",
    }
    assert body["urgency"] is None
