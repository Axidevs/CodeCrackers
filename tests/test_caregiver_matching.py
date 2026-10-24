"""Unit tests for standalone caregiver matching."""
from __future__ import annotations

import pandas as pd
import pytest

from ml.caregiver_matching import (
    DATASET_RATING_MAX,
    DATASET_RATING_MIN,
    LANGUAGE_WEIGHT,
    PROXIMITY_WEIGHT,
    RATING_WEIGHT,
    SKILL_WEIGHT,
    _haversine_km,
    match_caregivers,
)


def caregiver(
    caregiver_id: str = "CG_001",
    *,
    role: str = "medic",
    languages: str = "Hindi;English",
    skills: str = "wound_dressing;vitals_monitoring",
    lat: float = 28.5,
    lng: float = 77.2,
    radius: float = 10,
    rating: float = 5.0,
    free_from: str = "09:00",
    free_until: str = "17:00",
    active: bool = True,
) -> dict[str, object]:
    return {
        "caregiver_id": caregiver_id,
        "role": role,
        "languages": languages,
        "skills": skills,
        "base_lat": lat,
        "base_lng": lng,
        "max_radius_km": radius,
        "rating": rating,
        "free_from": free_from,
        "free_until": free_until,
        "active": active,
    }


def roster(*rows: dict[str, object]) -> pd.DataFrame:
    return pd.DataFrame(rows)


def match(rows: pd.DataFrame, **kwargs: object) -> list[dict[str, object]]:
    defaults: dict[str, object] = {
        "care_type": "home_nursing",
        "language": "Hindi",
        "lat": 28.5,
        "lng": 77.2,
        "request_time": "12:00",
        "required_skills": ["wound_dressing"],
        "caregivers": rows,
    }
    defaults.update(kwargs)
    return match_caregivers(**defaults)  # type: ignore[arg-type]


class TestCaregiverMatching:
    def test_documented_weights_sum_to_one_and_full_match_scores_one(self):
        assert (
            LANGUAGE_WEIGHT + PROXIMITY_WEIGHT + SKILL_WEIGHT + RATING_WEIGHT
        ) == pytest.approx(1.0)
        result = match(roster(caregiver()), required_skills=["wound_dressing"])
        assert result[0]["score"] == pytest.approx(1.0)

    def test_emergency_always_returns_empty_list(self):
        result = match_caregivers(
            "emergency_112",
            language=None,
            caregivers=roster(caregiver(active=True)),
        )
        assert result == []

    def test_teleconsultation_uses_doctors_and_ignores_coordinates(self):
        rows = roster(
            caregiver("near", role="doctor", lat=28.5, lng=77.2),
            caregiver("far", role="doctor", lat="invalid", lng="invalid"),
            caregiver("medic", role="medic"),
        )
        result = match(
            rows,
            care_type="teleconsultation",
            lat=None,
            lng=None,
        )
        assert [item["caregiver_id"] for item in result] == ["far", "near"]
        assert all("distance ignored" in str(item["reason"]) for item in result)

    def test_inactive_caregivers_are_never_returned(self):
        result = match(roster(caregiver(active=False)))
        assert result == []

    def test_language_match_contributes_documented_weight(self):
        matched = match(roster(caregiver(languages="Hindi")))
        unmatched = match(roster(caregiver(languages="English")))
        assert matched[0]["score"] - unmatched[0]["score"] == pytest.approx(0.35)
        assert "Language matched" in str(matched[0]["reason"])
        assert "Requested language not listed" in str(unmatched[0]["reason"])

    def test_service_radius_is_an_eligibility_limit_and_affects_proximity(self):
        result = match(
            roster(
                caregiver("outside", lat=28.6, lng=77.2, radius=1),
                caregiver("inside", lat=28.5, lng=77.2, radius=10),
            )
        )
        assert [item["caregiver_id"] for item in result] == ["inside"]

    def test_invalid_caregiver_coordinates_are_excluded_for_in_person_care(self):
        result = match(
            roster(
                caregiver("invalid", lat=91.0, lng=77.2),
                caregiver("valid", lat=28.5, lng=77.2),
            )
        )
        assert [item["caregiver_id"] for item in result] == ["valid"]

    def test_proximity_score_rewards_closer_caregivers_within_radius(self):
        result = match(
            roster(
                caregiver("near", lat=28.5, lng=77.2, radius=10),
                caregiver("far", lat=28.55, lng=77.2, radius=10),
            ),
            required_skills=[],
        )
        assert [item["caregiver_id"] for item in result] == ["near", "far"]

    def test_proximity_component_uses_documented_weight(self):
        distance = _haversine_km(28.5, 77.2, 28.51, 77.2)
        radius = 10
        result = match(
            roster(
                caregiver("near", lat=28.5, lng=77.2, radius=radius),
                caregiver("far", lat=28.51, lng=77.2, radius=radius),
            ),
            required_skills=[],
        )
        assert result[0]["score"] - result[1]["score"] == pytest.approx(
            PROXIMITY_WEIGHT * distance / radius, abs=0.0001
        )

    def test_explicit_skill_compatibility_contributes_documented_weight(self):
        matching = match(roster(caregiver(skills="wound_dressing")))
        nonmatching = match(roster(caregiver(skills="vitals_monitoring")))
        assert matching[0]["score"] - nonmatching[0]["score"] == pytest.approx(0.20)
        assert "1/1 requested skills matched" in str(matching[0]["reason"])
        assert "0/1 requested skills matched" in str(nonmatching[0]["reason"])

    def test_missing_skill_requirements_are_not_inferred(self):
        result = match(roster(caregiver()), required_skills=None)
        assert "no required skills supplied" in str(result[0]["reason"])

    def test_rating_component_uses_observed_dataset_minimum_and_maximum(self):
        high = match(roster(caregiver(rating=DATASET_RATING_MAX)))
        low = match(roster(caregiver(rating=DATASET_RATING_MIN)))
        assert high[0]["score"] - low[0]["score"] == pytest.approx(0.15)
        assert "dataset-relative rating score 1.00" in str(high[0]["reason"])
        assert "dataset-relative rating score 0.00" in str(low[0]["reason"])

    @pytest.mark.parametrize(
        "kwargs",
        [
            {"language": None},
            {"language": "auto"},
            {"request_time": None},
            {"lat": None},
            {"lng": None},
        ],
    )
    def test_missing_required_context_returns_no_in_person_matches(self, kwargs):
        assert match(roster(caregiver()), **kwargs) == []

    def test_teleconsultation_still_requires_explicit_availability_time(self):
        assert match(
            roster(caregiver(role="doctor")),
            care_type="teleconsultation",
            lat=None,
            lng=None,
            request_time=None,
        ) == []

    def test_availability_window_is_checked_at_supplied_local_time(self):
        rows = roster(caregiver(free_from="13:00", free_until="16:00"))
        assert match(rows, request_time="12:59") == []
        assert len(match(rows, request_time="13:00")) == 1
        assert len(match(rows, request_time="16:00")) == 1
        assert match(rows, request_time="16:01") == []

    def test_malformed_or_overnight_availability_is_not_assumed(self):
        malformed = roster(caregiver(free_from="unknown", free_until="17:00"))
        overnight = roster(caregiver(free_from="22:00", free_until="06:00"))
        assert match(malformed, request_time="12:00") == []
        assert match(overnight, request_time="23:00") == []
        assert match(roster(caregiver()), request_time="12:00:00") == []

    def test_results_are_ranked_deterministically_and_capped_at_three(self):
        rows = roster(
            caregiver("CG_003"),
            caregiver("CG_001"),
            caregiver("CG_002"),
            caregiver("CG_004"),
        )
        first = match(rows, max_results=99)
        second = match(rows.iloc[::-1].reset_index(drop=True))
        assert [item["caregiver_id"] for item in first] == [
            "CG_001",
            "CG_002",
            "CG_003",
        ]
        assert first == second

    def test_result_has_only_documented_fields_and_valid_score(self):
        result = match(roster(caregiver()))
        assert set(result[0]) == {"caregiver_id", "score", "reason"}
        assert 0 <= result[0]["score"] <= 1

    def test_unknown_care_type_is_reported(self):
        with pytest.raises(ValueError, match="Unsupported care_type"):
            match(roster(caregiver()), care_type="unsupported")

    def test_default_roster_loads_actual_dataset(self):
        result = match_caregivers(
            care_type="teleconsultation",
            language="Hindi",
            request_time="12:00",
        )
        assert all(item["caregiver_id"].startswith("CG_") for item in result)
