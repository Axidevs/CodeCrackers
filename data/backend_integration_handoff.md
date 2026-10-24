# CareCompass Backend Integration Handoff

This is an integration guide for the standalone ML components. **The backend/API is not integrated.**
The matcher and inference response builder are separate functions and must be orchestrated by the
backend developer.

## Callable interfaces

### Inference response

```python
from ml.inference import build_triage_response

def build_triage_response(user_input: str) -> dict[str, object]: ...

response = build_triage_response("papa ko bukhar hai")
```

Pass a non-empty user message. The returned response contains:

- `follow_up_question`: string or `None`
- `care_type`: care-type string or `None`
- `urgency`: string or `None`
- `red_flags`: list of strings
- `reasoning`: string
- `matched_caregivers`: list (currently always empty from this function)

The function does not accept language, coordinates, request time, or skills, and it does not call
the caregiver matcher.

### Standalone caregiver matcher

```python
from datetime import time
from pathlib import Path
from typing import Iterable

import pandas
from ml.caregiver_matching import match_caregivers

def match_caregivers(
    care_type: str | None,
    language: str | None,
    lat: float | None = None,
    lng: float | None = None,
    request_time: str | time | None = None,
    required_skills: Iterable[str] | None = None,
    caregivers: pandas.DataFrame | str | Path | None = None,
    max_results: int = 3,
) -> list[dict[str, object]]: ...
```

`caregivers=None` loads the supplied `data/Dataset 3.csv`. A `DataFrame` or CSV path may be
provided for testing or alternate rosters. The roster must contain the matching fields from
Dataset 3. Each result has exactly:

```python
{"caregiver_id": str, "score": float, "reason": str}
```

Results are ranked descending by score, with caregiver ID as a deterministic tie-breaker, and
limited to at most three. An unknown non-null care type raises `ValueError`; null care type returns
an empty list.

## Backend call flow proposal

The backend owns request parsing and should pass resolved values from its real request context:

```python
triage = build_triage_response(request.user_input)

if triage["care_type"] in {
    "paramedic_home_visit",
    "home_nursing",
    "lab_test_home",
    "teleconsultation",
}:
    triage["matched_caregivers"] = match_caregivers(
        care_type=triage["care_type"],
        language=resolved_user_language,  # one detected language token, not "auto"
        lat=request.location.lat if request.location else None,
        lng=request.location.lng if request.location else None,
        request_time=current_request_time_ist.strftime("%H:%M"),
        required_skills=known_required_skills,  # explicit tokens, or None
    )
```

This example is a proposal, not an existing backend contract. Backend code must not infer the
missing skill map or treat an arbitrary timestamp as the user's requested service time.
`resolved_user_language` should be a concrete language value matching the roster tokens. The
matcher accepts one requested language; it does not parse `"auto"` or a multi-language string.
`required_skills` must be an iterable of tokens, not a semicolon-separated string.

## Emergency and missing-input behavior

- For `care_type="emergency_112"`, the matcher returns `[]` before requiring any other inputs.
- `build_triage_response` returns emergency care type/urgency for a detected red flag and preserves
  an emergency model disposition. Its emergency responses have no caregiver matches.
- Missing/blank/`"auto"` language, missing/invalid request time, or a null care type yields no
  caregiver matches. In-person care also needs valid coordinates; missing or invalid coordinates
  yield no matches. Teleconsultation ignores coordinates and distance but still needs language and
  request time.
- Inactive caregivers are excluded. Matching uses the roster role mapping: medic for paramedic
  visits and home nursing, phlebotomist for home lab collection, and doctor for teleconsultation.
- Availability checks only whether the supplied HH:MM time lies within the roster window. Window
  endpoints are inclusive; overnight windows are excluded because their meaning is undocumented.
  This does not establish real-time availability.

## Scoring and assumptions

The documented weights are language 0.35, proximity 0.30, skills 0.20, and rating 0.15 (sum 1.0).
The prototype applies these weights with explicitly non-official component conventions:

- Language: exact case-insensitive token match, scored 1 or 0.
- Proximity: linear `1 - distance / service_radius`; outside-radius caregivers are excluded.
  Teleconsultation ignores location and receives neutral full proximity credit.
- Skills: fraction of explicitly caller-supplied tokens found in the caregiver's semicolon-delimited
  skill field. With no supplied skills the component is zero; the matcher does not infer required
  skills by care type. A skill mismatch is scored, not used as a hard exclusion.
- Rating: min-max normalization to Dataset 3's observed 3.8–5.0 range, clamped to [0, 1]. This is
  dataset-relative and is not an official interpretation of a rating scale.

Language and skill mismatches reduce score but do not independently exclude caregivers. Availability,
active status, role, and (for in-person services) service radius are eligibility filters.

## Urgency contract status

The README defines the urgency values (`emergency`, `same_day`, `scheduled`, or `null`), says
red-flag cases use `emergency`, and says insufficient-information cases have null care type and
urgency. The inference builder implements those emergency and follow-up behaviors. For other
non-emergency predictions, it currently returns `urgency=None`; no documented mapping from care
type, symptoms, or timing to `same_day` versus `scheduled` was found. Do not infer one in the
backend without a project policy decision.

## Limitations

- Synthetic roster and triage data are not clinical ground truth; this prototype is not clinically
  validated.
- The backend request/response path is not implemented or tested here.
- `build_triage_response` currently takes only free text; it does not consume location/history or
  return matcher results.
- The matcher does not infer request language, required skills, a service time, or real-time
  availability. Its assumptions above should be revisited if an official scoring/availability
  policy is supplied.
- No hidden-test CSV schema or final submission format is established by this handoff.

## Minimal backend integration test checklist

1. Ordinary non-emergency text returns the `build_triage_response` fields; confirm urgency remains
   `None` unless a policy is approved.
2. A detected red flag returns `emergency_112`, `emergency`, and `matched_caregivers=[]`; verify the
   backend never invokes home-care matching for that disposition.
3. A follow-up response has null care type/urgency and does not invoke matching.
4. For each non-emergency care type, pass an explicit resolved language, request-time HH:MM IST,
   valid location for in-person service, and required skills only when known.
5. Verify inactive, wrong-role, unavailable, and outside-radius caregivers are excluded; verify
   teleconsultation ignores location.
6. Validate result field names, score range, deterministic ranking, and empty-list behavior for
   missing context.
7. Exercise the actual backend request-to-response adapter once it exists; these standalone tests do
   not establish end-to-end integration.
