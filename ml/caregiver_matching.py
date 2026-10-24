"""Standalone caregiver matching for the synthetic CareCompass roster.

The README defines the score weights and caregiver roles, but not a rating
scale, care-type skill map, or request-time source. This module therefore:

* requires the caller to supply a language and request time;
* accepts required skills from the caller rather than inferring them;
* uses a dataset-relative rating normalization (observed range 3.8–5.0);
* gives teleconsultation full neutral proximity credit because distance is
  explicitly ignored; and
* returns no matches when required context for eligibility is unavailable.

These conventions are implementation assumptions, not official policy.
"""
from __future__ import annotations

import math
from datetime import datetime, time
from pathlib import Path
from typing import Any, Iterable

import pandas as pd

PROJECT_ROOT = Path(__file__).parent.parent
CAREGIVER_CSV_PATH = PROJECT_ROOT / "data" / "Dataset 3.csv"

LANGUAGE_WEIGHT = 0.35
PROXIMITY_WEIGHT = 0.30
SKILL_WEIGHT = 0.20
RATING_WEIGHT = 0.15

# Observed values in Dataset 3.csv. Dataset-relative min/max normalization is
# transparent and reproducible, but does not claim an official rating scale.
DATASET_RATING_MIN = 3.8
DATASET_RATING_MAX = 5.0

_REQUIRED_COLUMNS = {
    "caregiver_id",
    "role",
    "languages",
    "skills",
    "base_lat",
    "base_lng",
    "max_radius_km",
    "rating",
    "free_from",
    "free_until",
    "active",
}

# These relationships follow the README's role definitions and care-type
# descriptions; they do not define required procedure skills.
_CARE_TYPE_ROLES = {
    "paramedic_home_visit": "medic",
    "home_nursing": "medic",
    "lab_test_home": "phlebotomist",
    "teleconsultation": "doctor",
}
_EMERGENCY_CARE_TYPE = "emergency_112"
_EARTH_RADIUS_KM = 6371.0088


def _tokens(value: Any) -> set[str]:
    if not isinstance(value, str):
        return set()
    return {part.strip().casefold() for part in value.split(";") if part.strip()}


def _parse_request_time(value: str | time) -> time | None:
    if isinstance(value, time):
        if value.utcoffset() is not None:
            return None
        return value.replace(second=0, microsecond=0)
    if not isinstance(value, str):
        return None
    try:
        return datetime.strptime(value, "%H:%M").time()
    except ValueError:
        return None


def _available_at(row: pd.Series, request_time: time) -> bool:
    start = _parse_request_time(row["free_from"])
    end = _parse_request_time(row["free_until"])
    # Overnight windows are not documented; do not assume their meaning.
    return start is not None and end is not None and start <= request_time <= end


def _is_active(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().casefold() == "true"
    return False


def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    lat1_rad, lat2_rad = math.radians(lat1), math.radians(lat2)
    delta_lat = math.radians(lat2 - lat1)
    delta_lng = math.radians(lng2 - lng1)
    value = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(delta_lng / 2) ** 2
    )
    return 2 * _EARTH_RADIUS_KM * math.asin(math.sqrt(min(1.0, value)))


def _rating_score(value: Any) -> float | None:
    """Normalize against Dataset 3's observed range, not an assumed star scale."""
    try:
        rating = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(rating):
        return None
    span = DATASET_RATING_MAX - DATASET_RATING_MIN
    return min(1.0, max(0.0, (rating - DATASET_RATING_MIN) / span))


def _language_score(requested_language: str, caregiver_languages: set[str]) -> float:
    """Assume a binary score for exact language-token matches."""
    return float(requested_language in caregiver_languages)


def _skill_score(requested_skills: set[str], caregiver_skills: set[str]) -> float:
    """Assume the skill component is the fraction of requested tokens matched."""
    if not requested_skills:
        return 0.0
    return len(requested_skills & caregiver_skills) / len(requested_skills)


def _proximity_score(
    care_type: str, distance_km: float | None, radius_km: float | None
) -> float | None:
    """Implement a distance-linear score within the documented service radius.

    Linear normalization by radius is an implementation assumption; the README
    specifies that closer is better and the service radius caps eligibility.
    """
    if care_type == "teleconsultation":
        # Assumption: full neutral credit preserves the proximity weight without
        # using or penalizing distance for virtual care.
        return 1.0
    if distance_km is None or radius_km is None or radius_km <= 0:
        return None
    return max(0.0, 1.0 - distance_km / radius_km)


def _load_roster(caregivers: pd.DataFrame | str | Path | None) -> pd.DataFrame:
    if caregivers is None:
        roster = pd.read_csv(CAREGIVER_CSV_PATH)
    elif isinstance(caregivers, pd.DataFrame):
        roster = caregivers.copy()
    else:
        roster = pd.read_csv(Path(caregivers))

    missing = _REQUIRED_COLUMNS - set(roster.columns)
    if missing:
        raise ValueError(f"Caregiver roster is missing required columns: {sorted(missing)}")
    return roster


def match_caregivers(
    care_type: str | None,
    language: str | None,
    lat: float | None = None,
    lng: float | None = None,
    request_time: str | time | None = None,
    required_skills: Iterable[str] | None = None,
    caregivers: pd.DataFrame | str | Path | None = None,
    max_results: int = 3,
) -> list[dict[str, object]]:
    """Return ranked matches in the documented ``caregiver_id/score/reason`` shape.

    The caller supplies explicit request language, local request time (HH:MM
    in the README's IST context), and any
    required skill tokens. No care-type-to-skill mapping is inferred. If skills
    are omitted, their weighted component contributes zero and the reason
    states that skill requirements were not assessed.

    A missing language or request time yields no matches because the language
    score or availability eligibility cannot be established. In-person
    services also require coordinates. Teleconsultation ignores coordinates
    and service radius, but still checks active status and the supplied time.
    """
    if care_type == _EMERGENCY_CARE_TYPE:
        return []
    if care_type is None:
        return []
    if care_type not in _CARE_TYPE_ROLES:
        raise ValueError(f"Unsupported care_type: {care_type}")
    if not isinstance(language, str) or not language.strip():
        return []
    requested_language = language.strip().casefold()
    if requested_language == "auto":
        return []

    parsed_time = _parse_request_time(request_time) if request_time is not None else None
    if parsed_time is None:
        return []

    is_virtual = care_type == "teleconsultation"
    if not is_virtual and (lat is None or lng is None):
        return []
    request_lat: float | None = None
    request_lng: float | None = None
    if not is_virtual:
        try:
            request_lat = float(lat) if lat is not None else None
            request_lng = float(lng) if lng is not None else None
        except (TypeError, ValueError):
            return []
        if (
            request_lat is None
            or request_lng is None
            or not math.isfinite(request_lat)
            or not math.isfinite(request_lng)
            or not -90 <= request_lat <= 90
            or not -180 <= request_lng <= 180
        ):
            return []

    if isinstance(required_skills, str):
        raise ValueError("required_skills must be an iterable of skill tokens, not a string")
    requested_skills = {
        str(skill).strip().casefold()
        for skill in (required_skills or ())
        if str(skill).strip()
    }
    roster = _load_roster(caregivers)
    expected_role = _CARE_TYPE_ROLES[care_type]
    ranked: list[tuple[float, str, dict[str, object]]] = []

    for _, row in roster.iterrows():
        if not _is_active(row["active"]) or str(row["role"]).casefold() != expected_role:
            continue
        if not _available_at(row, parsed_time):
            continue

        caregiver_languages = _tokens(row["languages"])
        language_score = _language_score(requested_language, caregiver_languages)
        caregiver_skills = _tokens(row["skills"])
        skill_score = _skill_score(requested_skills, caregiver_skills)

        distance_km: float | None = None
        radius_km: float | None = None
        if not is_virtual:
            try:
                caregiver_lat = float(row["base_lat"])
                caregiver_lng = float(row["base_lng"])
                radius_km = float(row["max_radius_km"])
            except (TypeError, ValueError):
                continue
            if (
                not math.isfinite(caregiver_lat)
                or not math.isfinite(caregiver_lng)
                or not math.isfinite(radius_km)
                or not -90 <= caregiver_lat <= 90
                or not -180 <= caregiver_lng <= 180
                or radius_km <= 0
            ):
                continue
            distance_km = _haversine_km(
                request_lat, request_lng, caregiver_lat, caregiver_lng
            )
            if distance_km > radius_km:
                continue

        proximity_score = _proximity_score(care_type, distance_km, radius_km)
        rating_score = _rating_score(row["rating"])
        if proximity_score is None or rating_score is None:
            continue

        score = (
            LANGUAGE_WEIGHT * language_score
            + PROXIMITY_WEIGHT * proximity_score
            + SKILL_WEIGHT * skill_score
            + RATING_WEIGHT * rating_score
        )
        reason_parts = [
            f"{'Language matched' if language_score else 'Requested language not listed'}: {language.strip()}",
        ]
        if is_virtual:
            reason_parts.append("virtual care; distance ignored")
        else:
            reason_parts.append(
                f"{distance_km:.1f} km away within {radius_km:g} km service radius"
            )
        if requested_skills:
            reason_parts.append(
                f"{len(requested_skills & caregiver_skills)}/{len(requested_skills)} requested skills matched"
            )
        else:
            reason_parts.append("no required skills supplied; skill score not assessed")
        reason_parts.append(
            f"roster window covers {parsed_time.strftime('%H:%M')} (not real-time availability); "
            f"dataset-relative rating score {rating_score:.2f}"
        )
        result = {
            "caregiver_id": str(row["caregiver_id"]),
            "score": round(score, 4),
            "reason": "; ".join(reason_parts),
        }
        ranked.append((score, str(row["caregiver_id"]), result))

    ranked.sort(key=lambda item: (-item[0], item[1]))
    return [item[2] for item in ranked[: min(3, max(0, max_results))]]
