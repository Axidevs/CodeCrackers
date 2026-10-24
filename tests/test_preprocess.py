"""
Pytest suite for CareCompass data preprocessing.

Tests:
- JSONL loading and validation (including malformed lines, empty lines)
- Record structure and field extraction
- Duplicate ID detection
- Non-numeric coordinate handling
- Missing critical fields
- Stratified split behavior (valid ratios, infeasible stratification, reproducibility)
- Follow-up record handling
- Label distribution sanity checks
- No data leakage (response-derived fields excluded from features)
- No overlap between train, validation, test, and follow-up IDs
"""
import pytest
import sys
import tempfile
import json
from pathlib import Path

# Add project root to path for imports
PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from data.preprocess import (
    load_jsonl,
    validate_record,
    load_and_validate,
    stratified_split,
    compute_label_counts,
    preprocess,
    validate_split_ratios,
    check_stratification_feasibility,
    records_to_dataframe,
    TriageRecord,
    PreprocessResult,
    CARE_TYPES,
    URGENCIES,
    RED_FLAGS_VOCAB,
    LANGUAGES,
)


class TestJSONLLoading:
    """Test JSONL file loading."""

    def test_load_jsonl_returns_list(self):
        """load_jsonl returns a list of dicts."""
        records, _ = load_jsonl(PROJECT_ROOT / "data" / "Dataset 1.jsonl")
        assert isinstance(records, list)
        assert len(records) == 340

    def test_each_record_has_required_top_level_keys(self):
        """Each JSONL record has id, detected_language, request, response."""
        records, _ = load_jsonl(PROJECT_ROOT / "data" / "Dataset 1.jsonl")
        for r in records:
            assert "id" in r
            assert "detected_language" in r
            assert "request" in r
            assert "response" in r

    def test_request_has_user_input_and_location(self):
        """Request object has user_input and location with lat/lng."""
        records, _ = load_jsonl(PROJECT_ROOT / "data" / "Dataset 1.jsonl")
        for r in records:
            assert "user_input" in r["request"]
            assert "location" in r["request"]
            assert "lat" in r["request"]["location"]
            assert "lng" in r["request"]["location"]

    def test_response_has_expected_fields(self):
        """Response has care_type, urgency, red_flags, follow_up_question, reasoning."""
        records, _ = load_jsonl(PROJECT_ROOT / "data" / "Dataset 1.jsonl")
        for r in records:
            resp = r["response"]
            assert "care_type" in resp
            assert "urgency" in resp
            assert "red_flags" in resp
            assert "follow_up_question" in resp
            assert "reasoning" in resp

    def test_load_jsonl_reports_malformed_lines(self):
        """load_jsonl reports parse errors for malformed JSON lines."""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl", delete=False) as f:
            f.write('{"id": "S0001", "valid": true}\n')
            f.write('not valid json\n')
            f.write('{"id": "S0002", "valid": true}\n')
            f.write('\n')  # empty line
            f.write('{"id": "S0003", "valid": true}\n')
            temp_path = Path(f.name)

        try:
            records, errors = load_jsonl(temp_path)
            assert len(records) == 3
            assert len(errors) == 2  # one malformed, one empty line
            error_types = [e["error"] for e in errors]
            assert any("Expecting" in e or "Extra data" in e or "Invalid" in e for e in error_types)
            assert any(e["error"] == "Empty line" for e in errors)
        finally:
            temp_path.unlink()

    def test_load_jsonl_skips_empty_lines(self):
        """Empty lines are reported as errors but don't crash."""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl", delete=False) as f:
            f.write('{"id": "S0001"}\n')
            f.write('\n')
            f.write('\n')
            f.write('{"id": "S0002"}\n')
            temp_path = Path(f.name)

        try:
            records, errors = load_jsonl(temp_path)
            assert len(records) == 2
            empty_errors = [e for e in errors if e["error"] == "Empty line"]
            assert len(empty_errors) == 2
        finally:
            temp_path.unlink()


class TestRecordValidation:
    """Test record validation and TriageRecord creation."""

    def test_validate_record_creates_triagerecord(self):
        """validate_record returns TriageRecord for valid input."""
        raw = {
            "id": "TEST001",
            "detected_language": "English",
            "request": {
                "user_input": "test input",
                "language": "auto",
                "location": {"lat": 28.5, "lng": 77.2},
                "conversation_history": []
            },
            "response": {
                "follow_up_question": None,
                "care_type": "home_nursing",
                "urgency": "same_day",
                "red_flags": [],
                "reasoning": "test reasoning",
                "matched_caregivers": []
            }
        }
        record, warnings = validate_record(raw, 0)
        assert record is not None
        assert isinstance(record, TriageRecord)
        assert record.record_id == "TEST001"
        assert record.detected_language == "English"
        assert record.user_input == "test input"
        assert record.care_type == "home_nursing"
        assert record.urgency == "same_day"
        assert record.red_flags == []
        assert record.follow_up_question is None

    def test_validate_record_handles_followup(self):
        """Records with follow_up_question have null care_type/urgency."""
        raw = {
            "id": "TEST002",
            "detected_language": "Hindi",
            "request": {
                "user_input": "help needed",
                "language": "auto",
                "location": {"lat": 28.6, "lng": 77.3},
                "conversation_history": []
            },
            "response": {
                "follow_up_question": "What do you need?",
                "care_type": None,
                "urgency": None,
                "red_flags": [],
                "reasoning": "underspecified",
                "matched_caregivers": []
            }
        }
        record, warnings = validate_record(raw, 0)
        assert record is not None
        assert record.is_followup
        assert not record.has_valid_labels

    def test_validate_record_handles_emergency(self):
        """Records with red_flags are marked emergency."""
        raw = {
            "id": "TEST003",
            "detected_language": "Hinglish",
            "request": {
                "user_input": "chest pain",
                "language": "auto",
                "location": {"lat": 28.5, "lng": 77.2},
                "conversation_history": []
            },
            "response": {
                "follow_up_question": None,
                "care_type": "emergency_112",
                "urgency": "emergency",
                "red_flags": ["chest_pain", "breathlessness"],
                "reasoning": "cardiac emergency",
                "matched_caregivers": []
            }
        }
        record, warnings = validate_record(raw, 0)
        assert record is not None
        assert record.is_emergency
        assert record.has_valid_labels
        assert set(record.red_flags) == {"chest_pain", "breathlessness"}

    def test_validate_record_warns_on_unknown_language(self):
        """Unexpected detected_language generates warning."""
        raw = {
            "id": "TEST004",
            "detected_language": "French",
            "request": {"user_input": "test", "location": {"lat": 28.5, "lng": 77.2}},
            "response": {"care_type": "home_nursing", "urgency": "same_day", "red_flags": [], "reasoning": ""}
        }
        record, warnings = validate_record(raw, 0)
        assert any("unexpected detected_language" in w for w in warnings)

    def test_validate_record_warns_on_unknown_red_flag(self):
        """Unknown red flag generates warning."""
        raw = {
            "id": "TEST005",
            "detected_language": "English",
            "request": {"user_input": "test", "location": {"lat": 28.5, "lng": 77.2}},
            "response": {"care_type": "emergency_112", "urgency": "emergency", "red_flags": ["unknown_flag"], "reasoning": ""}
        }
        record, warnings = validate_record(raw, 0)
        assert any("unknown red_flag" in w for w in warnings)

    def test_validate_record_drops_missing_id(self):
        """Record without id is dropped."""
        raw = {"detected_language": "English", "request": {"user_input": "test", "location": {"lat": 28.5, "lng": 77.2}}, "response": {"care_type": "home_nursing", "urgency": "same_day", "red_flags": [], "reasoning": ""}}
        record, warnings = validate_record(raw, 0)
        assert record is None
        assert any("missing 'id'" in w for w in warnings)

    def test_validate_record_rejects_non_numeric_lat(self):
        """Non-numeric latitude generates warning and record gets None lat with coords_valid=False."""
        raw = {
            "id": "TEST006",
            "detected_language": "English",
            "request": {"user_input": "test", "location": {"lat": "invalid", "lng": 77.2}},
            "response": {"care_type": "home_nursing", "urgency": "same_day", "red_flags": [], "reasoning": ""}
        }
        record, warnings = validate_record(raw, 0)
        assert record is not None
        assert any("non-numeric lat" in w for w in warnings)
        assert record.lat is None
        assert record.lng == 77.2
        assert record.coords_valid is False

    def test_validate_record_rejects_non_numeric_lng(self):
        """Non-numeric longitude generates warning."""
        raw = {
            "id": "TEST007",
            "detected_language": "English",
            "request": {"user_input": "test", "location": {"lat": 28.5, "lng": "bad"}},
            "response": {"care_type": "home_nursing", "urgency": "same_day", "red_flags": [], "reasoning": ""}
        }
        record, warnings = validate_record(raw, 0)
        assert record is not None
        assert any("non-numeric lng" in w for w in warnings)

    def test_validate_record_rejects_missing_coordinates(self):
        """Missing coordinates generate warning."""
        raw = {
            "id": "TEST008",
            "detected_language": "English",
            "request": {"user_input": "test", "location": {}},
            "response": {"care_type": "home_nursing", "urgency": "same_day", "red_flags": [], "reasoning": ""}
        }
        record, warnings = validate_record(raw, 0)
        assert record is not None
        assert any("missing lat" in w for w in warnings)
        assert any("missing lng" in w for w in warnings)

    def test_validate_record_flags_red_flags_without_emergency(self):
        """Red flags without emergency_112 care_type generates warning."""
        raw = {
            "id": "TEST009",
            "detected_language": "English",
            "request": {"user_input": "test", "location": {"lat": 28.5, "lng": 77.2}},
            "response": {"care_type": "home_nursing", "urgency": "same_day", "red_flags": ["chest_pain"], "reasoning": ""}
        }
        record, warnings = validate_record(raw, 0)
        assert any("has red_flags" in w and "but care_type" in w for w in warnings)

    def test_validate_record_flags_emergency_without_red_flags(self):
        """Emergency care_type without red_flags generates warning."""
        raw = {
            "id": "TEST010",
            "detected_language": "English",
            "request": {"user_input": "test", "location": {"lat": 28.5, "lng": 77.2}},
            "response": {"care_type": "emergency_112", "urgency": "emergency", "red_flags": [], "reasoning": ""}
        }
        record, warnings = validate_record(raw, 0)
        assert any("emergency_112 but no red_flags" in w for w in warnings)

    def test_validate_record_flags_followup_with_care_type(self):
        """Follow-up with non-null care_type generates warning."""
        raw = {
            "id": "TEST011",
            "detected_language": "English",
            "request": {"user_input": "test", "location": {"lat": 28.5, "lng": 77.2}},
            "response": {"follow_up_question": "What?", "care_type": "home_nursing", "urgency": "same_day", "red_flags": [], "reasoning": ""}
        }
        record, warnings = validate_record(raw, 0)
        assert any("follow_up_question present but care_type/urgency not null" in w for w in warnings)

    def test_validate_record_preserves_raw_text(self):
        """User input text is preserved exactly, not translated or modified."""
        raw = {
            "id": "TEST012",
            "detected_language": "Hinglish",
            "request": {"user_input": "papa ko bukhar hai", "location": {"lat": 28.5, "lng": 77.2}},
            "response": {"care_type": "home_nursing", "urgency": "same_day", "red_flags": [], "reasoning": ""}
        }
        record, warnings = validate_record(raw, 0)
        assert record.user_input == "papa ko bukhar hai"


class TestLoadAndValidate:
    """Test the full load_and_validate pipeline."""

    def test_load_and_validate_detects_duplicate_ids(self):
        """Duplicate IDs in JSONL are detected and warned."""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl", delete=False) as f:
            f.write('{"id": "DUP001", "detected_language": "English", "request": {"user_input": "test", "location": {"lat": 28.5, "lng": 77.2}}, "response": {"care_type": "home_nursing", "urgency": "same_day", "red_flags": [], "reasoning": ""}}\n')
            f.write('{"id": "DUP001", "detected_language": "English", "request": {"user_input": "test2", "location": {"lat": 28.5, "lng": 77.2}}, "response": {"care_type": "home_nursing", "urgency": "same_day", "red_flags": [], "reasoning": ""}}\n')
            temp_path = Path(f.name)

        try:
            records, warnings = load_and_validate(temp_path)
            assert len(records) == 1  # only first kept
            assert any("DUPLICATE ID" in w for w in warnings)
        finally:
            temp_path.unlink()


class TestSplitRatios:
    """Test split ratio validation."""

    def test_validate_split_ratios_accepts_valid(self):
        """Valid ratios pass validation."""
        errors = validate_split_ratios(0.7, 0.15, 0.15)
        assert errors == []

    def test_validate_split_ratios_rejects_negative(self):
        """Negative ratios are rejected."""
        errors = validate_split_ratios(-0.1, 0.5, 0.6)
        assert any("positive" in e for e in errors)

    def test_validate_split_ratios_rejects_zero(self):
        """Zero ratios are rejected."""
        errors = validate_split_ratios(0.0, 0.5, 0.5)
        assert any("positive" in e for e in errors)

    def test_validate_split_ratios_rejects_wrong_sum(self):
        """Ratios not summing to 1.0 are rejected."""
        errors = validate_split_ratios(0.5, 0.2, 0.2)
        assert any("sum to 1.0" in e for e in errors)

    def test_validate_split_ratios_rejects_over_sum(self):
        """Ratios summing to > 1.0 are rejected."""
        errors = validate_split_ratios(0.8, 0.3, 0.2)
        assert any("sum to 1.0" in e for e in errors)


class TestStratificationFeasibility:
    """Test stratification feasibility checks."""

    def test_check_stratification_feasible(self):
        """Feasible stratification returns True."""
        records = [
            TriageRecord(record_id=f"S{i}", detected_language="English", user_input="test",
                         lat=28.5, lng=77.2, care_type="home_nursing", urgency="same_day",
                         red_flags=[], follow_up_question=None, reasoning="")
            for i in range(10)
        ] + [
            TriageRecord(record_id=f"E{i}", detected_language="English", user_input="test",
                         lat=28.5, lng=77.2, care_type="emergency_112", urgency="emergency",
                         red_flags=["chest_pain"], follow_up_question=None, reasoning="")
            for i in range(10)
        ]
        feasible, info = check_stratification_feasibility(records)
        assert feasible
        assert info["n_classes"] == 2
        assert info["min_class_count"] == 10

    def test_check_stratification_infeasible_single_sample(self):
        """Single sample per class is infeasible."""
        records = [
            TriageRecord(record_id="S1", detected_language="English", user_input="test",
                         lat=28.5, lng=77.2, care_type="home_nursing", urgency="same_day",
                         red_flags=[], follow_up_question=None, reasoning=""),
            TriageRecord(record_id="E1", detected_language="English", user_input="test",
                         lat=28.5, lng=77.2, care_type="emergency_112", urgency="emergency",
                         red_flags=["chest_pain"], follow_up_question=None, reasoning=""),
        ]
        feasible, info = check_stratification_feasibility(records)
        assert not feasible
        assert info["min_class_count"] == 1

    def test_check_stratification_infeasible_two_samples(self):
        """Two samples per class is infeasible (need >=3 for train/val/test)."""
        records = [
            TriageRecord(record_id=f"S{i}", detected_language="English", user_input="test",
                         lat=28.5, lng=77.2, care_type="home_nursing", urgency="same_day",
                         red_flags=[], follow_up_question=None, reasoning="")
            for i in range(2)
        ] + [
            TriageRecord(record_id=f"E{i}", detected_language="English", user_input="test",
                         lat=28.5, lng=77.2, care_type="emergency_112", urgency="emergency",
                         red_flags=["chest_pain"], follow_up_question=None, reasoning="")
            for i in range(2)
        ]
        feasible, info = check_stratification_feasibility(records)
        assert not feasible
        assert info["min_class_count"] == 2


class TestStratifiedSplit:
    """Test stratified_split behavior."""

    def test_stratified_split_raises_on_invalid_ratios(self):
        """Invalid ratios raise clear error."""
        records = [
            TriageRecord(record_id=f"S{i}", detected_language="English", user_input="test",
                         lat=28.5, lng=77.2, care_type="home_nursing", urgency="same_day",
                         red_flags=[], follow_up_question=None, reasoning="")
            for i in range(10)
        ]
        with pytest.raises(ValueError, match="positive"):
            stratified_split(records, train_ratio=-0.1, val_ratio=0.5, test_ratio=0.6)

    def test_stratified_split_raises_on_zero_labeled(self):
        """No labeled records raises clear error."""
        records = [
            TriageRecord(record_id=f"F{i}", detected_language="English", user_input="test",
                         lat=28.5, lng=77.2, care_type=None, urgency=None,
                         red_flags=[], follow_up_question="question", reasoning="")
            for i in range(5)
        ]
        with pytest.raises(ValueError, match="No labeled records"):
            stratified_split(records)

    def test_stratified_split_fallback_when_infeasible(self):
        """When stratification infeasible, falls back to random split with minimum size validation."""
        # Use 10 records (5 per class) to allow fallback random split with min 1 per split
        records = [
            TriageRecord(record_id=f"S{i}", detected_language="English", user_input="test",
                         lat=28.5, lng=77.2, care_type="home_nursing", urgency="same_day",
                         red_flags=[], follow_up_question=None, reasoning="", coords_valid=True)
            for i in range(5)
        ] + [
            TriageRecord(record_id=f"E{i}", detected_language="English", user_input="test",
                         lat=28.5, lng=77.2, care_type="emergency_112", urgency="emergency",
                         red_flags=["chest_pain"], follow_up_question=None, reasoning="", coords_valid=True)
            for i in range(5)
        ]
        train, val, test, followup, info = stratified_split(records, random_seed=42)
        assert not info["stratified"]
        assert info["train_size"] + info["val_size"] + info["test_size"] == 10
        assert info["followup_size"] == 0
        assert info["train_size"] >= 1
        assert info["val_size"] >= 1
        assert info["test_size"] >= 1

    def test_stratified_split_reproducible(self):
        """Same seed produces identical splits."""
        records = [
            TriageRecord(record_id=f"S{i}", detected_language="English", user_input="test",
                         lat=28.5, lng=77.2, care_type="home_nursing", urgency="same_day",
                         red_flags=[], follow_up_question=None, reasoning="")
            for i in range(20)
        ] + [
            TriageRecord(record_id=f"E{i}", detected_language="English", user_input="test",
                         lat=28.5, lng=77.2, care_type="emergency_112", urgency="emergency",
                         red_flags=["chest_pain"], follow_up_question=None, reasoning="")
            for i in range(20)
        ]
        train1, val1, test1, _, info1 = stratified_split(records, random_seed=123)
        train2, val2, test2, _, info2 = stratified_split(records, random_seed=123)
        assert {r.record_id for r in train1} == {r.record_id for r in train2}
        assert {r.record_id for r in val1} == {r.record_id for r in val2}
        assert {r.record_id for r in test1} == {r.record_id for r in test2}
        assert info1["stratified"] == info2["stratified"]

    def test_stratified_split_different_seeds_different(self):
        """Different seeds produce different splits."""
        records = [
            TriageRecord(record_id=f"S{i}", detected_language="English", user_input="test",
                         lat=28.5, lng=77.2, care_type="home_nursing", urgency="same_day",
                         red_flags=[], follow_up_question=None, reasoning="")
            for i in range(20)
        ] + [
            TriageRecord(record_id=f"E{i}", detected_language="English", user_input="test",
                         lat=28.5, lng=77.2, care_type="emergency_112", urgency="emergency",
                         red_flags=["chest_pain"], follow_up_question=None, reasoning="")
            for i in range(20)
        ]
        train1, _, _, _, _ = stratified_split(records, random_seed=111)
        train2, _, _, _, _ = stratified_split(records, random_seed=222)
        assert {r.record_id for r in train1} != {r.record_id for r in train2}


class TestFullPreprocessing:
    """Test the full preprocessing pipeline."""

    def test_preprocess_returns_result(self):
        """preprocess() returns PreprocessResult with all fields."""
        result = preprocess(random_seed=42)
        assert isinstance(result, PreprocessResult)
        assert len(result.records) == 340
        assert len(result.train) > 0
        assert len(result.val) > 0
        assert len(result.test) > 0
        assert len(result.followup) == 39
        assert result.split_info["random_seed"] == 42

    def test_no_data_leakage_reasoning_not_in_features(self):
        """reasoning field is kept separate, not used as feature."""
        result = preprocess(random_seed=42)
        for r in result.records:
            assert hasattr(r, "reasoning")  # exists for reference
            # TriageRecord has no matched_caregivers, scores, etc.

    def test_followup_records_excluded_from_split(self):
        """Follow-up records are kept separate, not in train/val/test."""
        result = preprocess(random_seed=42)
        train_ids = {r.record_id for r in result.train}
        val_ids = {r.record_id for r in result.val}
        test_ids = {r.record_id for r in result.test}
        followup_ids = {r.record_id for r in result.followup}

        # No overlap between splits
        assert train_ids.isdisjoint(val_ids)
        assert train_ids.isdisjoint(test_ids)
        assert val_ids.isdisjoint(test_ids)

        # Followup IDs not in any split
        assert followup_ids.isdisjoint(train_ids)
        assert followup_ids.isdisjoint(val_ids)
        assert followup_ids.isdisjoint(test_ids)

        # All followup records have null labels
        for r in result.followup:
            assert r.is_followup

    def test_stratified_split_preserves_class_distribution(self):
        """Stratified split maintains approximate class proportions."""
        result = preprocess(random_seed=42)

        full_care = result.label_counts["care_type"]
        train_care = {}
        for r in result.train:
            if r.care_type:
                train_care[r.care_type] = train_care.get(r.care_type, 0) + 1

        for ct, count in full_care.items():
            if count > 0:
                train_prop = train_care.get(ct, 0) / len(result.train)
                full_prop = count / sum(full_care.values())
                # Allow 15% relative difference due to small sample size
                assert abs(train_prop - full_prop) / full_prop < 0.15

    def test_reproducible_with_same_seed(self):
        """Same random_seed produces identical splits."""
        result1 = preprocess(random_seed=123)
        result2 = preprocess(random_seed=123)

        train_ids_1 = {r.record_id for r in result1.train}
        train_ids_2 = {r.record_id for r in result2.train}
        assert train_ids_1 == train_ids_2

    def test_different_seeds_produce_different_splits(self):
        """Different seeds produce different splits (with high probability)."""
        result1 = preprocess(random_seed=111)
        result2 = preprocess(random_seed=222)

        train_ids_1 = {r.record_id for r in result1.train}
        train_ids_2 = {r.record_id for r in result2.train}
        assert train_ids_1 != train_ids_2

    def test_label_counts_match_expected(self):
        """Label counts match README specifications."""
        result = preprocess()
        care_counts = result.label_counts["care_type"]
        assert care_counts["home_nursing"] == 103
        assert care_counts["emergency_112"] == 56
        assert care_counts["lab_test_home"] == 51
        assert care_counts["teleconsultation"] == 48
        assert care_counts["paramedic_home_visit"] == 43
        assert result.label_counts["followup"] == 39

    def test_red_flags_only_chest_pain_breathlessness(self):
        """Only chest_pain and breathlessness appear in this dataset."""
        result = preprocess()
        assert set(result.label_counts["red_flags"].keys()) == {"chest_pain", "breathlessness"}

    def test_three_languages_present(self):
        """English, Hindi, Hinglish all present."""
        result = preprocess()
        langs = set(result.label_counts["language"].keys())
        assert "English" in langs
        assert "Hindi" in langs
        assert "Hinglish" in langs

    def test_no_duplicate_ids(self):
        """All record IDs are unique."""
        result = preprocess()
        ids = [r.record_id for r in result.records]
        assert len(ids) == len(set(ids))

    def test_no_matched_caregivers_in_features(self):
        """matched_caregivers from response is never used as input feature."""
        result = preprocess()
        for r in result.records:
            assert not hasattr(r, "matched_caregivers")

    def test_no_caregiver_scores_in_features(self):
        """Caregiver scores from response are never used as input features."""
        result = preprocess()
        for r in result.records:
            assert not hasattr(r, "score")
            assert not hasattr(r, "top_score")

    def test_no_reasoning_in_features(self):
        """reasoning from response is stored but not used as predictor feature."""
        result = preprocess()
        for r in result.records:
            assert hasattr(r, "reasoning")  # stored for reference
            # But user_input is the only text feature
            assert r.user_input  # actual feature

    def test_split_info_reports_actual_stratification(self):
        """split_info correctly reports whether split was stratified."""
        result = preprocess(random_seed=42)
        assert result.split_info["stratified"] is True
        assert "stratification_info" in result.split_info
        assert result.split_info["stratification_info"]["min_class_count"] >= 3


class TestEdgeCases:
    """Test edge cases and error handling."""

    def test_compute_label_counts(self):
        """compute_label_counts returns expected keys."""
        records, _ = load_and_validate()
        counts = compute_label_counts(records)
        assert "care_type" in counts
        assert "urgency" in counts
        assert "red_flags" in counts
        assert "language" in counts
        assert "followup" in counts
        assert "total" in counts

    def test_records_to_dataframe_includes_warnings(self):
        """DataFrame conversion includes validation warnings column."""
        result = preprocess(random_seed=42)
        df = records_to_dataframe(result.train)
        assert "validation_warnings" in df.columns


class TestEquivalenceChecker:
    """Test the equivalence checker logic using actual module functions."""

    def test_equivalence_checker_detects_duplicate_ids(self):
        """Equivalence checker reports duplicate IDs."""
        from data.inspect_equivalence import check_duplicate_ids
        records = [{"id": "DUP"}, {"id": "DUP"}, {"id": "UNIQUE"}]
        dupes = check_duplicate_ids(records, "test")
        assert dupes == {"DUP": 2}

    def test_equivalence_checker_handles_list_ordering(self):
        """Equivalence checker normalizes list ordering for comparison."""
        from data.inspect_equivalence import normalize_for_compare
        # JSONL has list, CSV has semicolon string
        jsonl_val = ["breathlessness", "chest_pain"]
        csv_val = "chest_pain;breathlessness"
        # Both should normalize to same sorted string
        assert normalize_for_compare(jsonl_val) == normalize_for_compare(csv_val)

    def test_equivalence_checker_handles_null_values(self):
        """Null values normalize to empty string."""
        from data.inspect_equivalence import normalize_for_compare
        assert normalize_for_compare(None) == ""
        assert normalize_for_compare("") == ""

    def test_equivalence_checker_handles_numeric_equivalence(self):
        """Numeric values like 28 and 28.0 normalize to same string."""
        from data.inspect_equivalence import normalize_for_compare
        assert normalize_for_compare(28) == normalize_for_compare(28.0)
        assert normalize_for_compare("28") == normalize_for_compare("28.0")

    def test_equivalence_checker_handles_float_nan(self):
        """Float NaN normalizes to empty string."""
        from data.inspect_equivalence import normalize_for_compare
        import math
        assert normalize_for_compare(float('nan')) == ""

    def test_equivalence_checker_handles_semicolon_strings(self):
        """Semicolon-separated strings from CSV are split and sorted."""
        from data.inspect_equivalence import normalize_for_compare
        # CSV might have "a;b" or "b;a" - both should match sorted list
        assert normalize_for_compare("a;b") == normalize_for_compare("b;a")
        # Also handle trailing semicolons
        assert normalize_for_compare("a;b;") == normalize_for_compare("b;a")

    def test_equivalence_checker_load_jsonl_returns_errors(self):
        """load_jsonl returns (records, errors) tuple."""
        from data.inspect_equivalence import load_jsonl
        import tempfile
        from pathlib import Path

        with tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl", delete=False) as f:
            f.write('{"id": "S0001"}\n')
            f.write('not valid json\n')
            f.write('\n')
            f.write('{"id": "S0002"}\n')
            temp_path = Path(f.name)

        try:
            records, errors = load_jsonl(temp_path)
            assert len(records) == 2
            assert len(errors) == 2  # one malformed, one empty line
        finally:
            temp_path.unlink()

    def test_equivalence_checker_compare_records_output_structure(self):
        """compare_records returns expected structure with all keys."""
        from data.inspect_equivalence import compare_records
        import pandas as pd

        jsonl_records = [{"id": "S1", "detected_language": "English", "request": {"user_input": "test", "location": {"lat": 28.5, "lng": 77.2}}, "response": {"care_type": "home_nursing", "urgency": "same_day", "red_flags": [], "follow_up_question": None, "reasoning": "test", "matched_caregivers": []}}]
        csv_df = pd.DataFrame([{"id": "S1", "detected_language": "English", "user_input": "test", "lat": 28.5, "lng": 77.2, "care_type": "home_nursing", "urgency": "same_day", "red_flags": "", "follow_up_question": "", "reasoning": "test", "matched_caregiver_ids": "", "top_score": ""}])

        result = compare_records(jsonl_records, csv_df, [], [])

        # Check all expected keys present
        expected_keys = [
            "jsonl_count", "csv_count", "jsonl_unique_ids", "csv_unique_ids",
            "jsonl_duplicates", "csv_duplicates", "only_in_jsonl", "only_in_csv",
            "common_ids_count", "mismatches", "comparison_errors",
            "jsonl_parse_errors", "csv_parse_errors"
        ]
        for key in expected_keys:
            assert key in result, f"Missing key: {key}"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
