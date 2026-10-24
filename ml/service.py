"""Dependency-free HTTP service for the existing CareCompass inference module."""
from __future__ import annotations

import json
import logging
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock
from typing import Callable

PROJECT_ROOT = Path(__file__).parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from data.preprocess import CARE_TYPES, URGENCIES
from ml.inference import build_triage_response, load_pipeline

LOGGER = logging.getLogger("cura.ml.service")
MAX_BODY_BYTES = 64 * 1024
MAX_TEXT_LENGTH = 10_000
SUPPORTED_LANGUAGES = {"auto", "hindi", "english", "hinglish"}
RESPONSE_FIELDS = {
    "follow_up_question",
    "care_type",
    "urgency",
    "red_flags",
    "reasoning",
    "matched_caregivers",
}


class InvalidRequest(ValueError):
    """Request body does not match the ML service input contract."""


def _validate_request(payload: object) -> str:
    if not isinstance(payload, dict):
        raise InvalidRequest("JSON body must be an object")

    text = payload.get("text")
    if not isinstance(text, str) or not text.strip():
        raise InvalidRequest("'text' must be a non-empty string")
    if len(text) > MAX_TEXT_LENGTH:
        raise InvalidRequest(f"'text' must not exceed {MAX_TEXT_LENGTH} characters")

    language = payload.get("language", "auto")
    if not isinstance(language, str) or language.casefold() not in SUPPORTED_LANGUAGES:
        raise InvalidRequest("'language' must be auto, hindi, english, or hinglish")

    symptoms = payload.get("symptoms", [])
    if not isinstance(symptoms, list) or any(not isinstance(item, str) for item in symptoms):
        raise InvalidRequest("'symptoms' must be an array of strings")

    duration = payload.get("duration")
    if duration is not None and not isinstance(duration, str):
        raise InvalidRequest("'duration' must be a string or null")

    return text.strip()


def _valid_response(response: object) -> bool:
    if not isinstance(response, dict) or set(response) != RESPONSE_FIELDS:
        return False
    if response["follow_up_question"] is not None and not isinstance(
        response["follow_up_question"], str
    ):
        return False
    if response["care_type"] not in CARE_TYPES:
        return False
    if response["urgency"] not in URGENCIES:
        return False
    if (
        not isinstance(response["red_flags"], list)
        or any(not isinstance(flag, str) for flag in response["red_flags"])
        or not isinstance(response["reasoning"], str)
        or not isinstance(response["matched_caregivers"], list)
    ):
        return False

    if response["care_type"] is None:
        return response["follow_up_question"] is not None and response["urgency"] is None
    if response["follow_up_question"] is not None:
        return False
    if response["red_flags"] and response["care_type"] != "emergency_112":
        return False
    if response["care_type"] == "emergency_112":
        return response["urgency"] == "emergency" and not response["matched_caregivers"]
    return not response["red_flags"] and response["urgency"] != "emergency"


def create_handler(
    inference_function: Callable[[str], dict[str, object]] = build_triage_response,
    model_loader: Callable[[], object] = load_pipeline,
) -> type[BaseHTTPRequestHandler]:
    """Build a handler with injectable inference dependencies for isolated tests."""
    model_lock = Lock()
    model_loaded = False

    def ensure_model_loaded() -> None:
        nonlocal model_loaded
        if model_loaded:
            return
        with model_lock:
            if not model_loaded:
                model_loader()
                model_loaded = True

    class InferenceHandler(BaseHTTPRequestHandler):
        def _send_json(self, status: int, payload: dict[str, object]) -> None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:
            if self.path != "/health":
                self._send_json(404, {"error": {"code": "NOT_FOUND", "message": "Not found"}})
                return
            try:
                ensure_model_loaded()
            except Exception as error:
                LOGGER.error("ML readiness check failed (%s)", type(error).__name__)
                self._send_json(
                    503,
                    {
                        "success": False,
                        "error": {
                            "code": "ML_MODEL_UNAVAILABLE",
                            "message": "The ML model is unavailable.",
                        },
                    },
                )
                return
            self._send_json(
                200,
                {"success": True, "service": "cura-ml", "status": "healthy"},
            )

        def do_POST(self) -> None:
            if self.path != "/predict":
                self._send_json(404, {"error": {"code": "NOT_FOUND", "message": "Not found"}})
                return
            if self.headers.get_content_type() != "application/json":
                self._send_json(
                    415,
                    {
                        "success": False,
                        "error": {
                            "code": "UNSUPPORTED_MEDIA_TYPE",
                            "message": "Content-Type must be application/json.",
                        },
                    },
                )
                return

            try:
                body_length = int(self.headers.get("Content-Length", ""))
            except ValueError:
                body_length = -1
            if body_length < 0:
                self._send_json(
                    400,
                    {
                        "success": False,
                        "error": {"code": "INVALID_CONTENT_LENGTH", "message": "Invalid request body."},
                    },
                )
                return
            if body_length > MAX_BODY_BYTES:
                self._send_json(
                    413,
                    {
                        "success": False,
                        "error": {"code": "REQUEST_TOO_LARGE", "message": "Request body is too large."},
                    },
                )
                return

            try:
                payload = json.loads(self.rfile.read(body_length))
                text = _validate_request(payload)
            except (json.JSONDecodeError, InvalidRequest, UnicodeDecodeError) as error:
                self._send_json(
                    422 if not isinstance(error, json.JSONDecodeError) else 400,
                    {
                        "success": False,
                        "error": {
                            "code": "INVALID_ML_REQUEST",
                            "message": str(error) if isinstance(error, InvalidRequest) else "Request body must be valid JSON.",
                        },
                    },
                )
                return

            try:
                result = inference_function(text)
                if not _valid_response(result):
                    raise ValueError("Inference returned a response outside the supported schema")
            except Exception as error:
                LOGGER.error("ML inference failed (%s)", type(error).__name__)
                self._send_json(
                    503,
                    {
                        "success": False,
                        "error": {
                            "code": "ML_INFERENCE_UNAVAILABLE",
                            "message": "The ML inference service is temporarily unavailable.",
                        },
                    },
                )
                return

            self._send_json(200, result)

        def log_message(self, format: str, *args: object) -> None:
            LOGGER.info("HTTP request %s", format % args)

    return InferenceHandler


def create_server(
    host: str = "127.0.0.1",
    port: int = 8000,
    inference_function: Callable[[str], dict[str, object]] = build_triage_response,
    model_loader: Callable[[], object] = load_pipeline,
) -> ThreadingHTTPServer:
    return ThreadingHTTPServer(
        (host, port),
        create_handler(inference_function, model_loader),
    )


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    host = os.environ.get("CURA_ML_HOST", "127.0.0.1")
    port = int(os.environ.get("CURA_ML_PORT", "8000"))
    server = create_server(host, port)
    LOGGER.info("CURA ML service listening on %s:%s", host, port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        LOGGER.info("CURA ML service stopping")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
