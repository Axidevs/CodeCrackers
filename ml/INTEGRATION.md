# CURA Python ML service integration

The Express backend calls a small Python HTTP service that delegates to the existing
`ml.inference.build_triage_response` implementation and the saved care-type model. The service uses
Python's standard-library `http.server`; it adds no web-framework dependency. The backend retains
ownership of request validation, its deterministic Safety Gate, conversation intake, and caregiver
matching.

## Endpoints

### `GET /health`

Loads the care-type artifact through the cached inference loader and returns readiness:

```json
{ "success": true, "service": "cura-ml", "status": "healthy" }
```

When the artifact cannot load, the endpoint returns HTTP `503` with a generic `ML_MODEL_UNAVAILABLE`
error. No filesystem paths or traceback are returned.

### `POST /predict`

The current Express adapter sends:

```json
{
  "text": "I have had a headache for two days",
  "language": "english",
  "symptoms": ["headache"],
  "duration": "two days"
}
```

`text` is required, must be non-blank, and is limited to 10,000 characters. `language` is one of
`auto`, `hindi`, `english`, or `hinglish`; `symptoms` is an array of strings; and `duration` is a
string or null. The current trained model consumes only the consolidated `text`; the other fields
are accepted to preserve the existing backend transport contract and are not additional model
features.

Successful responses use the existing Python inference response shape:

```json
{
  "follow_up_question": null,
  "care_type": "teleconsultation",
  "urgency": null,
  "red_flags": [],
  "reasoning": "Care type was predicted by the existing model...",
  "matched_caregivers": []
}
```

The response is the result of `build_triage_response(text)`. It has no confidence field. The Python
module does not contain a separate urgency classifier on this branch: ordinary cases therefore
return null urgency, and only emergency dispositions return `emergency`. Do not interpret null as a
routine-urgency prediction.

Invalid JSON returns HTTP `400`; invalid or missing fields return `422`; unsupported media types
return `415`; oversized bodies return `413`; and model/inference failures return a generic `503`.
Responses do not expose exception messages, stack traces, or artifact paths. Logs include only
failure categories and exception types, not symptom text.

## Express integration and taxonomy bridge

`server/src/services/mlTriage.service.js` posts the existing `text`, `language`, `symptoms`, and
`duration` fields to `ML_SERVICE_URL`, applies `ML_SERVICE_TIMEOUT_MS`, validates the response, and
throws a structured error on network, timeout, upstream, or schema failures. There is no production
mock/rule-based fallback. Express returns its normal structured error envelope with HTTP `503` when
the service is unavailable.

The Python dataset labels and backend taxonomy are not identical. The adapter maps the labels with
direct equivalents: `home_nursing` to `nurse_visit`, `teleconsultation` to `gp_teleconsult`,
`paramedic_home_visit` unchanged, and `emergency_112` to `emergency_referral`. Python urgency
`emergency` maps to backend `immediate`; `same_day` is unchanged; `scheduled` maps to backend
`routine`; null remains null. `lab_test_home` has no equivalent in the current Express taxonomy, so
the adapter reports a structured `502 UNSUPPORTED_ML_CARE_TYPE` rather than mislabeling it.

After a valid non-emergency result, the existing Express pipeline performs its own caregiver
matching. A Python follow-up response bypasses matching. Emergency decisions from either the
deterministic Safety Gate or ML response bypass matching and preserve emergency guidance. The ML
adapter does not pass through Python caregiver matches.

## Dependencies and local startup

The runtime dependencies are pinned in `ml/requirements.txt` to the versions used by the saved
artifact environment. From the repository root, create and prepare a Python environment:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r ml\requirements.txt
```

Start the Python service in one terminal:

```powershell
.\.venv\Scripts\python.exe -m ml.service
```

Optional Python settings are `CURA_ML_HOST` (default `127.0.0.1`) and `CURA_ML_PORT` (default
`8000`). Start Express in a second terminal:

```powershell
cd server
npm ci
npm run dev
```

`ML_SERVICE_URL` defaults to `http://localhost:8000/predict`; `ML_SERVICE_TIMEOUT_MS` defaults to
`2000`. For Docker Compose, the Python service binds to `0.0.0.0` inside its container and Express
uses `http://ml-service:8000/predict`.

Health and prediction smoke checks:

```powershell
Invoke-RestMethod http://localhost:8000/health
Invoke-RestMethod -Method Post -Uri http://localhost:8000/predict -ContentType 'application/json' -Body '{"text":"I have had a headache for two days","language":"english","symptoms":["headache"],"duration":"two days"}'
Invoke-RestMethod -Method Post -Uri http://localhost:5001/api/triage -ContentType 'application/json' -Body '{"user_input":"I have had a headache for two days","language":"english"}'
```

## Tests

From the repository root, with Python test dependencies installed:

```powershell
.\.venv\Scripts\python.exe -m pytest tests -q
```

For Express:

```powershell
cd server
npm test
```

Python service tests exercise HTTP validation, health/readiness, safe failures, repeated requests, and
the real saved-model response. Express tests cover success, timeout, connection errors, non-2xx
responses, malformed data, response validation, and emergency/follow-up bypass behavior. The API
integration-test fixture is deliberately test-only; the manual end-to-end check must use the running
Python service.

## Limitations

- The training examples and caregiver roster are synthetic and are not clinical ground truth or
  clinically validated.
- The emergency detector remains the existing limited phrase-based Python logic; the backend's
  independent deterministic Safety Gate runs first and remains authoritative.
- There is no separate urgency model in this branch. Ordinary ML urgency is unavailable and remains
  null.
- The backend taxonomy has no `lab_test_home` value; such an ML result is rejected rather than mapped
  to a different service.
- The care-type artifact and TF-IDF preprocessing must stay compatible with the pinned scikit-learn
  runtime.
