"""
Pytest suite for CareCompass ML inference module.

Tests:
- Model loads and predicts non-empty input
- Predicted label in allowed care-type labels
- Red flag takes emergency branch, classifier not called
- Empty/invalid input rejected
- Repeated predictions reuse loaded model (cache)
"""
import pytest
from unittest.mock import Mock, patch
from pathlib import Path
import sys

# Add project root to path
PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from ml.inference import (
    build_triage_response,
    load_pipeline,
    detect_red_flags,
    predict_care_type,
    is_model_loaded,
    clear_pipeline_cache,
    TriagePrediction,
    MODEL_PATH,
)
from data.preprocess import RED_FLAGS_VOCAB, CARE_TYPES


class TestModelLoading:
    """Test model loading and caching."""

    def test_model_artifact_exists(self):
        """Model file exists at expected path."""
        assert MODEL_PATH.exists(), f"Model not found at {MODEL_PATH}"

    def test_load_pipeline_returns_pipeline(self):
        """load_pipeline returns a sklearn Pipeline."""
        pipeline = load_pipeline()
        assert pipeline is not None
        assert hasattr(pipeline, "predict")
        assert hasattr(pipeline, "predict_proba")
        assert "tfidf" in pipeline.named_steps
        assert "clf" in pipeline.named_steps

    def test_load_pipeline_caches(self):
        """Second call returns cached pipeline (same object)."""
        pipeline1 = load_pipeline()
        pipeline2 = load_pipeline()
        assert pipeline1 is pipeline2  # same object

    def test_is_model_loaded_after_load(self):
        """is_model_loaded returns True after first load."""
        clear_pipeline_cache()
        assert not is_model_loaded()
        load_pipeline()
        assert is_model_loaded()

    def test_clear_pipeline_cache(self):
        """clear_pipeline_cache resets cache."""
        load_pipeline()
        assert is_model_loaded()
        clear_pipeline_cache()
        assert not is_model_loaded()


class TestRedFlagDetection:
    """Test authoritative red-flag detection using RED_FLAGS_VOCAB."""

    def test_detect_red_flags_empty_input(self):
        """Empty input returns no red flags."""
        assert detect_red_flags("") == []
        assert detect_red_flags(None) == []  # handled gracefully

    def test_detect_red_flags_chest_pain(self):
        """Detects chest_pain from 'chest pain'."""
        flags = detect_red_flags("chest pain")
        assert "chest_pain" in flags

    def test_detect_red_flags_breathlessness(self):
        """Detects breathlessness."""
        flags = detect_red_flags("shortness of breath breathlessness")
        assert "breathlessness" in flags

    def test_detect_red_flags_severe_bleeding(self):
        """Detects severe_bleeding from 'severe bleeding'."""
        flags = detect_red_flags("severe bleeding")
        assert "severe_bleeding" in flags

    def test_detect_red_flags_stroke_symptoms(self):
        """Detects stroke_symptoms."""
        flags = detect_red_flags("stroke symptoms")
        assert "stroke_symptoms" in flags

    def test_detect_red_flags_unconsciousness(self):
        """Detects unconsciousness."""
        flags = detect_red_flags("patient is unconsciousness")
        assert "unconsciousness" in flags

    def test_detect_red_flags_seizure(self):
        """Detects seizure."""
        flags = detect_red_flags("seizure attack")
        assert "seizure" in flags

    def test_detect_red_flags_multiple(self):
        """Detects multiple red flags."""
        flags = detect_red_flags("chest pain and breathlessness")
        assert "chest_pain" in flags
        assert "breathlessness" in flags

    def test_detect_red_flags_case_insensitive(self):
        """Detection is case-insensitive."""
        assert "chest_pain" in detect_red_flags("CHEST PAIN")
        assert "chest_pain" in detect_red_flags("Chest Pain")

    def test_detect_red_flags_no_false_positive_on_partial(self):
        """Does not falsely detect on partial words (e.g., 'pain' alone)."""
        # 'pain' is not in vocab; 'chest_pain' is
        flags = detect_red_flags("just some pain")
        assert "chest_pain" not in flags

    def test_detect_red_flags_only_authoritative_vocab(self):
        """Only returns flags from RED_FLAGS_VOCAB."""
        flags = detect_red_flags("chest pain and severe bleeding and unknown_flag")
        for flag in flags:
            assert flag in RED_FLAGS_VOCAB

    @pytest.mark.parametrize(
        ("text", "expected_flag"),
        [
            ("chest pain", "chest_pain"),
            ("breathlessness", "breathlessness"),
            ("unconsciousness", "unconsciousness"),
            ("severe bleeding", "severe_bleeding"),
            ("stroke symptoms", "stroke_symptoms"),
            ("seizure", "seizure"),
            ("high fever infant", "high_fever_infant"),
            ("suicidal ideation", "suicidal_ideation"),
            ("severe dehydration", "severe_dehydration"),
        ],
    )
    def test_detects_each_documented_red_flag_phrase(self, text, expected_flag):
        assert expected_flag in detect_red_flags(text)

    def test_detects_documented_hinglish_emergency_phrase(self):
        flags = detect_red_flags("papa ko severe chest pain hai saans nahi aa rahi")
        assert "chest_pain" in flags

    def test_detects_documented_hindi_emergency_phrase(self):
        flags = detect_red_flags("पापा को तेज सीने में दर्द है और सांस नहीं आ रही")
        assert "chest_pain" in flags
        assert "breathlessness" in flags

    @pytest.mark.parametrize(
        ("text", "expected_flag"),
        [
            ("shortness of breath", "breathlessness"),
            ("can't breathe", "breathlessness"),
            ("accident ke baad bleeding ruk nahi rahi", "severe_bleeding"),
            ("खून नहीं रुक रहा", "severe_bleeding"),
            ("wo achanak gir gaye response nahi de rahe", "unconsciousness"),
            ("वो अचानक गिर गए और जवाब नहीं दे रहे", "unconsciousness"),
            ("स्ट्रोक के लक्षण", "stroke_symptoms"),
            ("दौरा", "seizure"),
            ("शिशु को तेज बुखार", "high_fever_infant"),
            ("आत्महत्या के विचार", "suicidal_ideation"),
            ("गंभीर निर्जलीकरण", "severe_dehydration"),
        ],
    )
    def test_detects_dataset_evidenced_or_literal_hindi_aliases(self, text, expected_flag):
        assert expected_flag in detect_red_flags(text)

    def test_not_only_is_not_treated_as_negation(self):
        assert "chest_pain" in detect_red_flags(
            "not only chest pain but also dizziness"
        )

    @pytest.mark.parametrize(
        "text",
        [
            "no chest pain",
            "denies chest pain",
            "chest pain nahi ho raha",
            "सीने में दर्द नहीं है",
            "history of seizure",
            "had seizure last year",
            "पहले दौरा",
        ],
    )
    def test_excludes_clear_negated_or_historical_mentions(self, text):
        assert detect_red_flags(text) == []


class TestPrediction:
    """Test safety-first prediction function."""

    def setup_method(self):
        """Clear cache before each test."""
        clear_pipeline_cache()

    def test_predict_non_empty_input(self):
        """Non-empty input returns TriagePrediction."""
        result = predict_care_type("mild fever")
        assert isinstance(result, TriagePrediction)
        assert result.care_type in CARE_TYPES
        assert result.red_flags == []
        assert result.is_emergency is False
        assert result.source == "model"
        assert result.model_confidence is not None
        assert 0.0 <= result.model_confidence <= 1.0

    def test_predicted_label_in_allowed_care_types(self):
        """Predicted care_type is always from CARE_TYPES (excluding None)."""
        allowed = [c for c in CARE_TYPES if c is not None]
        for _ in range(10):
            result = predict_care_type("some symptoms here")
            assert result.care_type in allowed

    def test_red_flag_triggers_emergency_branch(self):
        """Red flag triggers emergency_112 and bypasses classifier."""
        result = predict_care_type("chest pain")
        assert result.care_type == "emergency_112"
        assert result.is_emergency is True
        assert result.source == "red_flag"
        assert result.model_confidence is None
        assert "chest_pain" in result.red_flags

    def test_red_flag_prevents_classifier_call(self):
        """When red flag detected, classifier predict() is not called."""
        with patch("ml.inference.load_pipeline") as mock_load:
            mock_pipeline = Mock()
            mock_pipeline.predict.return_value = ["home_nursing"]
            mock_pipeline.predict_proba.return_value = [[0.1, 0.8, 0.05, 0.03, 0.02]]
            mock_load.return_value = mock_pipeline

            result = predict_care_type("chest pain")

            # Classifier should NOT be called for emergency
            mock_pipeline.predict.assert_not_called()
            mock_pipeline.predict_proba.assert_not_called()

    def test_breathlessness_red_flag(self):
        """breathlessness triggers emergency."""
        result = predict_care_type("breathlessness")
        assert result.care_type == "emergency_112"
        assert result.source == "red_flag"

    def test_multiple_red_flags(self):
        """Multiple red flags all reported."""
        result = predict_care_type("chest pain and breathlessness")
        assert result.care_type == "emergency_112"
        assert "chest_pain" in result.red_flags
        assert "breathlessness" in result.red_flags

    def test_empty_input_rejected(self):
        """Empty string raises ValueError."""
        with pytest.raises(ValueError, match="non-empty"):
            predict_care_type("")

    def test_whitespace_only_rejected(self):
        """Whitespace-only input raises ValueError."""
        with pytest.raises(ValueError, match="non-empty"):
            predict_care_type("   ")

    def test_none_input_rejected(self):
        """None input raises ValueError or returns no flags."""
        # detect_red_flags handles None gracefully
        assert detect_red_flags(None) == []
        # predict_care_type should raise for None
        with pytest.raises((ValueError, AttributeError)):
            predict_care_type(None)


class TestModelReuse:
    """Test that repeated predictions reuse loaded model."""

    def setup_method(self):
        clear_pipeline_cache()

    def test_repeated_predictions_reuse_model(self):
        """Multiple predictions don't reload model."""
        clear_pipeline_cache()
        assert not is_model_loaded()

        predict_care_type("test input 1")
        assert is_model_loaded()

        predict_care_type("test input 2")
        assert is_model_loaded()

        # Cache should still be same
        pipeline = load_pipeline()
        assert is_model_loaded()


class TestIntegration:
    """Integration-style tests with real model."""

    def setup_method(self):
        clear_pipeline_cache()

    def test_real_model_loads_and_predicts(self):
        """Integration: real model loads and produces valid output."""
        result = predict_care_type("need doctor consultation")
        assert result.care_type in CARE_TYPES
        assert result.care_type != "emergency_112"  # no red flags in input
        assert result.source == "model"
        assert 0.0 < result.model_confidence <= 1.0

    def test_real_model_emergency_override(self):
        """Integration: real model not called for emergency."""
        result = predict_care_type("chest pain")
        assert result.care_type == "emergency_112"
        assert result.source == "red_flag"

    def test_hindi_hinglish_inputs(self):
        """Hindi/Hinglish inputs work (model trained on multilingual data)."""
        # These may or may not have red flags, but should not crash
        for text in [
            "papa ko bukhar hai",
            "doctor chahiye",
            "injection lagwana hai",
        ]:
            result = predict_care_type(text)
            assert result.care_type in CARE_TYPES
            assert result.source in ("model", "red_flag")

    def test_response_builder_emergency_invariant(self):
        response = build_triage_response("chest pain")
        assert response["care_type"] == "emergency_112"
        assert response["urgency"] == "emergency"
        assert response["red_flags"] == ["chest_pain"]
        assert response["matched_caregivers"] == []
        assert response["follow_up_question"] is None

    @pytest.mark.parametrize(
        "text",
        [
            "chest pain",
            "breathlessness",
            "unconsciousness",
            "severe bleeding",
            "stroke symptoms",
            "seizure",
            "high fever infant",
            "suicidal ideation",
            "severe dehydration",
            "papa ko severe chest pain hai saans nahi aa rahi",
            "पापा को तेज सीने में दर्द है और सांस नहीं आ रही",
        ],
    )
    def test_all_supported_red_flags_keep_emergency_response(self, text):
        response = build_triage_response(text)
        assert response["care_type"] == "emergency_112"
        assert response["urgency"] == "emergency"
        assert response["matched_caregivers"] == []

    @pytest.mark.parametrize(
        "text",
        [
            "no chest pain",
            "denies chest pain",
            "chest pain nahi ho raha",
            "सीने में दर्द नहीं है",
            "history of seizure",
            "had seizure last year",
            "पहले दौरा",
        ],
    )
    def test_negated_and_historical_mentions_do_not_trigger_override(self, text):
        model = Mock()
        model.predict.return_value = ["teleconsultation"]
        model.predict_proba.return_value = [[0.1, 0.1, 0.1, 0.1, 0.6]]
        with patch("ml.inference.load_pipeline", return_value=model):
            result = predict_care_type(text)
        assert result.source == "model"
        assert result.is_emergency is False

    def test_response_builder_followup_contract(self):
        response = build_triage_response("doctor chahiye")
        assert response["follow_up_question"]
        assert response["care_type"] is None
        assert response["urgency"] is None

    @pytest.mark.parametrize(
        "text",
        [
            "I need help",
            "help chahiye",
            "मदद चाहिए",
            "डॉक्टर चाहिए",
            "hello koi hai?",
            "I want to book something for my mother",
        ],
    )
    def test_response_builder_follows_dataset_underspecified_examples(self, text):
        response = build_triage_response(text)
        assert response["follow_up_question"]
        assert response["care_type"] is None
        assert response["urgency"] is None

    @pytest.mark.parametrize(
        "text",
        [
            "no chest pain",
            "denies chest pain",
            "chest pain nahi ho raha",
            "history of seizure",
            "had seizure last year",
        ],
    )
    def test_response_builder_clarifies_negated_or_historical_flags(self, text):
        response = build_triage_response(text)
        assert response["follow_up_question"]
        assert response["care_type"] is None
        assert response["urgency"] is None
        assert response["red_flags"] == []
        assert response["matched_caregivers"] == []

    def test_response_builder_does_not_invent_non_emergency_policy(self):
        prediction = TriagePrediction(
            care_type="teleconsultation",
            red_flags=[],
            is_emergency=False,
            source="model",
            model_confidence=0.8,
        )
        with patch("ml.inference.predict_care_type", return_value=prediction):
            response = build_triage_response("need a doctor consultation")
        assert response["care_type"] == "teleconsultation"
        assert response["urgency"] is None
        assert response["matched_caregivers"] == []
        assert "urgency policy is unresolved" in response["reasoning"]
        assert "not integrated into this response" in response["reasoning"]

    def test_response_builder_preserves_model_emergency(self):
        prediction = TriagePrediction(
            care_type="emergency_112",
            red_flags=[],
            is_emergency=False,
            source="model",
            model_confidence=0.8,
        )
        with patch("ml.inference.predict_care_type", return_value=prediction):
            response = build_triage_response("a model emergency prediction")
        assert response["care_type"] == "emergency_112"
        assert response["urgency"] == "emergency"
        assert response["matched_caregivers"] == []


if __name__ == "__main__":
    pytest.main([__file__, "-v"])