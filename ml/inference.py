"""
CareCompass — Safety-First ML Inference Module

Loads the saved care_type pipeline and provides a safety-first prediction function.
Red-flag detection runs BEFORE the classifier; emergencies are never overridden by the model.

This is a prototype for a hackathon synthetic dataset. Not clinically validated.
"""
from __future__ import annotations

import re
import sys
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import joblib

# Add project root to path for imports
PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from data.preprocess import RED_FLAGS_VOCAB, CARE_TYPES

# Model path relative to project root
MODEL_PATH = PROJECT_ROOT / "ml" / "models" / "care_type_pipeline.joblib"

# Internal cache for loaded pipeline
_pipeline_cache: Optional["Pipeline"] = None
_pipeline_lock = threading.Lock()

_NEGATED_OR_HISTORICAL_PREFIX = re.compile(
    r"\b(?:no|not|never|denies|denied|without|history of|past history of|previously|had)"
    r"(?:\s+[\w'-]+){0,3}\s*$"
    r"|(?:नहीं|नही|पहले|इतिहास में)(?:\s+[\w'-]+){0,3}\s*$"
)
_NEGATED_SUFFIX = re.compile(
    r"^\s*(?:(?:is|was|are|were)\s+)?"
    r"(?:not present|absent|denied|nahi|nahin|nhi|"
    r"नहीं(?:\s+(?:है|हैं|हो रहा|हो रही|था|थी|थे|रहा|रही))?|"
    r"नही(?:\s+(?:है|हैं|हो रहा|हो रही|था|थी|थे|रहा|रही))?)"
    r"(?!\w)"
)
_NOT_ONLY_PREFIX = re.compile(r"\bnot\s+only(?:\s+[\w'-]+){0,2}\s*$")
_RED_FLAG_PHRASES = {
    "chest_pain": {"सीने में दर्द"},
    "breathlessness": {"shortness of breath", "can't breathe", "cannot breathe", "सांस नहीं आ रही"},
    "unconsciousness": {
        "unresponsive",
        "not responding",
        "response nahi de rahe",
        "बेहोश",
        "जवाब नहीं दे रहे",
        "जवाब नहीं दे रहे हैं",
    },
    "severe_bleeding": {
        "bleeding that won't stop",
        "bleeding won't stop",
        "bleeding ruk nahi rahi",
        "खून नहीं रुक रहा",
        "खून नहीं रुक रहा है",
    },
    "stroke_symptoms": {"stroke signs", "स्ट्रोक के लक्षण"},
    "seizure": {"दौरा", "दौरे"},
    "high_fever_infant": {"infant with high fever", "शिशु को तेज बुखार", "नवजात को तेज बुखार"},
    "suicidal_ideation": {"suicidal thoughts", "आत्महत्या के विचार"},
    "severe_dehydration": {"गंभीर निर्जलीकरण"},
}
_INSUFFICIENT_INFORMATION_INPUTS = frozenset(
    text.casefold()
    for text in (
        "doctor chahiye",
        "डॉक्टर चाहिए",
        "मदद चाहिए",
        "help chahiye",
        "i need help",
        "hi, is anyone there?",
        "नमस्ते, कोई है?",
        "hello koi hai?",
        "i want to book something for my mother",
        "mummy ke liye kuch book karna hai",
        "माँ के लिए कुछ बुक करना है",
    )
)


def _is_negated_or_historical(text: str, start: int, end: int) -> bool:
    prefix = text[max(0, start - 60):start]
    suffix = text[end:end + 30]
    return (
        (
            _NEGATED_OR_HISTORICAL_PREFIX.search(prefix)
            and not _NOT_ONLY_PREFIX.search(prefix)
        )
        or _NEGATED_SUFFIX.match(suffix)
    )


def load_pipeline() -> "Pipeline":
    """Load the saved TF-IDF + LogisticRegression pipeline. Caches after first load."""
    global _pipeline_cache
    if _pipeline_cache is None:
        with _pipeline_lock:
            if _pipeline_cache is None:
                if not MODEL_PATH.exists():
                    raise FileNotFoundError(f"Model not found at {MODEL_PATH}. Run training first.")
                _pipeline_cache = joblib.load(MODEL_PATH)
    return _pipeline_cache


def detect_red_flags(user_input: str) -> list[str]:
    """
    Detect red-flag phrases using the controlled vocabulary.

    Clearly negated or historical mentions are excluded. This narrow context check
    is not a comprehensive multilingual safety detector.

    Returns list of detected red flags (empty if none).
    """
    if not user_input:
        return []

    text_lower = user_input.lower()
    detected: list[str] = []
    for flag in RED_FLAGS_VOCAB:
        phrases = {flag, flag.replace("_", " ")}
        phrases.update(_RED_FLAG_PHRASES.get(flag, set()))
        for phrase in phrases:
            for match in re.finditer(
                rf"(?<!\w){re.escape(phrase)}(?!\w)", text_lower
            ):
                if _is_negated_or_historical(
                    text_lower, match.start(), match.end()
                ):
                    continue
                detected.append(flag)
                break
            if flag in detected:
                break

    return detected


def _has_negated_or_historical_red_flag_mention(user_input: str) -> bool:
    text_lower = user_input.lower()
    for flag in RED_FLAGS_VOCAB:
        phrases = {flag, flag.replace("_", " ")}
        phrases.update(_RED_FLAG_PHRASES.get(flag, set()))
        for phrase in phrases:
            for match in re.finditer(
                rf"(?<!\w){re.escape(phrase)}(?!\w)", text_lower
            ):
                if _is_negated_or_historical(
                    text_lower, match.start(), match.end()
                ):
                    return True
    return False


@dataclass
class TriagePrediction:
    """Structured prediction result (prototype — not a full API response)."""
    care_type: str
    red_flags: list[str]
    is_emergency: bool
    source: str  # "red_flag" or "model"
    model_confidence: Optional[float] = None


def predict_care_type(user_input: str) -> TriagePrediction:
    """
    Safety-first care_type prediction.

    1. Validates input is non-empty.
    2. Runs authoritative red-flag detection (keyword-based on RED_FLAGS_VOCAB).
    3. If red flags detected → returns emergency_112 immediately, bypassing classifier.
    4. Otherwise predicts with saved model.

    Returns TriagePrediction with source flag indicating emergency vs model path.
    """
    if not user_input or not user_input.strip():
        raise ValueError("user_input must be a non-empty string")

    # Step 1: Red-flag safety check (authoritative, runs BEFORE model)
    red_flags = detect_red_flags(user_input)
    if red_flags:
        return TriagePrediction(
            care_type="emergency_112",
            red_flags=red_flags,
            is_emergency=True,
            source="red_flag",
            model_confidence=None,
        )

    # Step 2: Model prediction for non-emergency cases
    pipeline = load_pipeline()
    care_type = pipeline.predict([user_input.strip()])[0]

    # Validate prediction is in allowed labels
    if care_type not in CARE_TYPES:
        raise ValueError(f"Model predicted invalid care_type: {care_type}")

    # Get confidence (max class probability)
    proba = pipeline.predict_proba([user_input.strip()])[0]
    confidence = float(max(proba))

    return TriagePrediction(
        care_type=care_type,
        red_flags=[],
        is_emergency=False,
        source="model",
        model_confidence=confidence,
    )


def build_triage_response(user_input: str) -> dict[str, object]:
    """Build the documented response shape from existing inference.

    Follow-up detection is limited to underspecified examples in Dataset 1.
    Non-emergency urgency is unresolved, and caregiver matching is not integrated here.
    """
    if user_input.strip().casefold() in _INSUFFICIENT_INFORMATION_INPUTS:
        return {
            "follow_up_question": "Who is this for, and what is the main concern?",
            "care_type": None,
            "urgency": None,
            "red_flags": [],
            "reasoning": "The request does not state the main concern; clarification is needed.",
            "matched_caregivers": [],
        }

    red_flags = detect_red_flags(user_input)
    if red_flags:
        return {
            "follow_up_question": None,
            "care_type": "emergency_112",
            "urgency": "emergency",
            "red_flags": red_flags,
            "reasoning": "A red-flag phrase was detected; the emergency override takes precedence.",
            "matched_caregivers": [],
        }

    if _has_negated_or_historical_red_flag_mention(user_input):
        return {
            "follow_up_question": (
                "Is this symptom happening now, or is it only historical or not present?"
            ),
            "care_type": None,
            "urgency": None,
            "red_flags": [],
            "reasoning": (
                "A red-flag phrase appears negated or historical; clarification is needed "
                "before assigning triage."
            ),
            "matched_caregivers": [],
        }

    prediction = predict_care_type(user_input)
    if prediction.is_emergency or prediction.care_type == "emergency_112":
        return {
            "follow_up_question": None,
            "care_type": "emergency_112",
            "urgency": "emergency",
            "red_flags": [],
            "reasoning": (
                "The care-type model predicted emergency_112; "
                "the emergency disposition is preserved."
            ),
            "matched_caregivers": [],
        }

    return {
        "follow_up_question": None,
        "care_type": prediction.care_type,
        "urgency": None,
        "red_flags": prediction.red_flags,
        "reasoning": (
            "Care type was predicted by the existing model. "
            "Non-emergency urgency policy is unresolved; caregiver matching is available "
            "separately but is not integrated into this response."
        ),
        "matched_caregivers": [],
    }


def is_model_loaded() -> bool:
    """Check if pipeline is cached (for testing reuse)."""
    return _pipeline_cache is not None


def clear_pipeline_cache() -> None:
    """Clear cached pipeline (for testing)."""
    global _pipeline_cache
    _pipeline_cache = None


# Quick manual test
if __name__ == "__main__":
    test_cases = [
        "papa ko bukhar hai",
        "chest pain",
        "mild acidity",
        "accident ke baad bleeding",
        "injection at home",
        "",
    ]

    for text in test_cases:
        try:
            result = predict_care_type(text)
            print(f"Input: {text!r}")
            print(f"  care_type: {result.care_type}")
            print(f"  red_flags: {result.red_flags}")
            print(f"  is_emergency: {result.is_emergency}")
            print(f"  source: {result.source}")
            if result.model_confidence:
                print(f"  confidence: {result.model_confidence:.3f}")
        except ValueError as e:
            print(f"Input: {text!r} -> ERROR: {e}")
        print()