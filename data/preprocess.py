"""
CareCompass — Data Preprocessing Module

Loads and validates the synthetic triage dataset (Dataset 1 JSONL),
extracts features and labels, and provides reproducible stratified splits.

Does NOT:
- Use Dataset 2 (duplicate), Dataset 3 (caregiver roster), or Dataset 4 (multi-turn) as training data
- Merge datasets or invent labels
- Include target-derived fields (reasoning, matched_caregivers, scores) as features
- Overwrite original datasets
"""
from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import pandas as pd
from sklearn.model_selection import train_test_split

PROJECT_ROOT = Path(__file__).parent.parent
DATA_DIR = PROJECT_ROOT / "data"

JSONL_PATH = DATA_DIR / "Dataset 1.jsonl"

# Label enums (from README)
CARE_TYPES = [
    "paramedic_home_visit",
    "home_nursing",
    "lab_test_home",
    "teleconsultation",
    "emergency_112",
    None,  # follow-up
]

URGENCIES = [
    "emergency",
    "same_day",
    "scheduled",
    None,  # follow-up
]

RED_FLAGS_VOCAB = [
    "chest_pain",
    "breathlessness",
    "unconsciousness",
    "severe_bleeding",
    "stroke_symptoms",
    "seizure",
    "high_fever_infant",
    "suicidal_ideation",
    "severe_dehydration",
]

LANGUAGES = ["English", "Hindi", "Hinglish"]


@dataclass
class TriageRecord:
    """Single validated triage record."""
    record_id: str
    detected_language: str
    user_input: str
    lat: Optional[float]
    lng: Optional[float]
    care_type: Optional[str]
    urgency: Optional[str]
    red_flags: list[str]
    follow_up_question: Optional[str]
    reasoning: str  # kept for reference only; NOT a feature
    # Validation metadata
    validation_warnings: list[str] = field(default_factory=list)
    # Flag indicating if coordinates are valid (not None and in range)
    coords_valid: bool = True

    @property
    def has_valid_labels(self) -> bool:
        """True if care_type and urgency are non-null (i.e., not a follow-up case)."""
        return self.care_type is not None and self.urgency is not None

    @property
    def is_emergency(self) -> bool:
        return self.care_type == "emergency_112"

    @property
    def is_followup(self) -> bool:
        return self.care_type is None and self.urgency is None

    @property
    def has_valid_coords(self) -> bool:
        """True if coordinates are not None and within expected bounds."""
        return self.coords_valid and self.lat is not None and self.lng is not None


@dataclass
class PreprocessResult:
    """Result of preprocessing + splitting."""
    records: list[TriageRecord]
    train: list[TriageRecord]
    val: list[TriageRecord]
    test: list[TriageRecord]
    followup: list[TriageRecord]
    label_counts: dict
    split_info: dict


def load_jsonl(path: Path) -> tuple[list[dict], list[dict]]:
    """Load JSONL file, return list of parsed objects and errors. Reports parse errors without dropping."""
    records = []
    errors = []
    with open(path, "r", encoding="utf-8") as f:
        for i, line in enumerate(f):
            line = line.strip()
            if not line:
                errors.append({"line": i + 1, "error": "Empty line", "preview": ""})
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError as e:
                errors.append({"line": i + 1, "error": str(e), "preview": line[:100]})
    if errors:
        print(f"[WARNING] {len(errors)} JSONL parse errors in {path.name}:", file=sys.stderr)
        for e in errors[:5]:
            print(f"  Line {e['line']}: {e['error']} — {e['preview']}", file=sys.stderr)
        if len(errors) > 5:
            print(f"  ... and {len(errors) - 5} more", file=sys.stderr)
    return records, errors


def validate_coordinate(val, field_name: str, record_id: str) -> tuple[Optional[float], list[str]]:
    """Validate and convert a coordinate value. Returns (value, warnings).
    Returns (None, warnings) if invalid. Does NOT use placeholder values."""
    warnings = []
    if val is None:
        warnings.append(f"Record {record_id}: missing {field_name}")
        return None, warnings
    try:
        fval = float(val)
        # Basic sanity check for Delhi NCR bounds
        if field_name == "lat" and not (28.0 <= fval <= 29.0):
            warnings.append(f"Record {record_id}: latitude {fval} outside expected Delhi NCR range (28.0-29.0)")
        if field_name == "lng" and not (76.5 <= fval <= 78.0):
            warnings.append(f"Record {record_id}: longitude {fval} outside expected Delhi NCR range (76.5-78.0)")
        return fval, warnings
    except (ValueError, TypeError):
        warnings.append(f"Record {record_id}: non-numeric {field_name}='{val}'")
        return None, warnings


def validate_record(raw: dict, idx: int) -> tuple[Optional[TriageRecord], list[str]]:
    """
    Validate a single raw record and convert to TriageRecord.
    Returns (record, warnings). Record is None if critical fields missing.
    """
    warnings = []

    # Required fields
    record_id = raw.get("id")
    if not record_id:
        warnings.append(f"Record index {idx}: missing 'id'")
        return None, warnings

    detected_language = raw.get("detected_language")
    if detected_language not in LANGUAGES:
        warnings.append(f"Record {record_id}: unexpected detected_language='{detected_language}'")

    request = raw.get("request", {})
    user_input = request.get("user_input", "").strip()
    if not user_input:
        warnings.append(f"Record {record_id}: empty user_input")

    location = request.get("location", {})
    lat, lat_warnings = validate_coordinate(location.get("lat"), "lat", record_id)
    lng, lng_warnings = validate_coordinate(location.get("lng"), "lng", record_id)
    warnings.extend(lat_warnings)
    warnings.extend(lng_warnings)

    response = raw.get("response", {})
    care_type = response.get("care_type")
    if care_type is not None and care_type not in CARE_TYPES:
        warnings.append(f"Record {record_id}: unexpected care_type='{care_type}'")

    urgency = response.get("urgency")
    if urgency is not None and urgency not in URGENCIES:
        warnings.append(f"Record {record_id}: unexpected urgency='{urgency}'")

    red_flags = response.get("red_flags", [])
    if not isinstance(red_flags, list):
        warnings.append(f"Record {record_id}: red_flags not a list, got {type(red_flags).__name__}")
        red_flags = []
    # Validate red flag values
    for rf in red_flags:
        if rf not in RED_FLAGS_VOCAB:
            warnings.append(f"Record {record_id}: unknown red_flag='{rf}'")

    follow_up_question = response.get("follow_up_question")
    reasoning = response.get("reasoning", "")

    # Cross-check: if red_flags present, care_type should be emergency_112
    if red_flags and care_type != "emergency_112":
        warnings.append(f"Record {record_id}: has red_flags {red_flags} but care_type={care_type}")

    # Cross-check: follow_up_question non-null => care_type and urgency should be null
    if follow_up_question and (care_type is not None or urgency is not None):
        warnings.append(f"Record {record_id}: follow_up_question present but care_type/urgency not null")

    # Cross-check: emergency_112 must have red_flags and null follow_up_question
    if care_type == "emergency_112":
        if not red_flags:
            warnings.append(f"Record {record_id}: care_type=emergency_112 but no red_flags")
        if follow_up_question:
            warnings.append(f"Record {record_id}: care_type=emergency_112 but follow_up_question is present")

    # Determine if coordinates are valid
    coords_valid = lat is not None and lng is not None

    record = TriageRecord(
        record_id=record_id,
        detected_language=detected_language or "unknown",
        user_input=user_input,
        lat=lat,
        lng=lng,
        care_type=care_type,
        urgency=urgency,
        red_flags=red_flags,
        follow_up_question=follow_up_question,
        reasoning=reasoning,
        validation_warnings=warnings.copy(),
        coords_valid=coords_valid,
    )
    return record, warnings


def load_and_validate(jsonl_path: Path = JSONL_PATH) -> tuple[list[TriageRecord], list[str]]:
    """Load JSONL, validate all records, return valid records and all warnings."""
    raw_records, parse_errors = load_jsonl(jsonl_path)
    print(f"[INFO] Loaded {len(raw_records)} raw records from {jsonl_path.name}")
    if parse_errors:
        print(f"[WARNING] {len(parse_errors)} JSONL parse errors encountered", file=sys.stderr)

    valid_records = []
    all_warnings = []
    seen_ids = set()
    duplicate_ids = set()

    for idx, raw in enumerate(raw_records):
        record, warnings = validate_record(raw, idx)
        all_warnings.extend(warnings)
        if record is not None:
            if record.record_id in seen_ids:
                duplicate_ids.add(record.record_id)
                all_warnings.append(f"Record {record.record_id}: DUPLICATE ID")
            else:
                seen_ids.add(record.record_id)
                valid_records.append(record)
        else:
            all_warnings.append(f"Record index {idx}: DROPPED due to missing critical fields")

    if duplicate_ids:
        all_warnings.append(f"Duplicate IDs found: {sorted(duplicate_ids)}")

    print(f"[INFO] Valid records: {len(valid_records)} / {len(raw_records)}")
    if all_warnings:
        print(f"[WARNING] Total warnings: {len(all_warnings)}")
        for w in all_warnings[:10]:
            print(f"  - {w}")
        if len(all_warnings) > 10:
            print(f"  ... and {len(all_warnings) - 10} more")

    return valid_records, all_warnings


def validate_split_ratios(train_ratio: float, val_ratio: float, test_ratio: float) -> list[str]:
    """Validate split ratios. Returns list of errors (empty if valid)."""
    errors = []
    if train_ratio <= 0 or val_ratio <= 0 or test_ratio <= 0:
        errors.append("All split ratios must be positive")
    if abs(train_ratio + val_ratio + test_ratio - 1.0) > 1e-6:
        errors.append(f"Split ratios must sum to 1.0, got {train_ratio + val_ratio + test_ratio}")
    return errors


def check_stratification_feasibility(labeled: list[TriageRecord], min_per_class: int = 3) -> tuple[bool, dict]:
    """
    Check if stratified split is feasible.
    Returns (is_feasible, info_dict) where info_dict contains class counts and min count.
    """
    stratify_key = [f"{r.care_type}|{r.urgency}" for r in labeled]
    from collections import Counter
    class_counts = Counter(stratify_key)
    min_class_count = min(class_counts.values()) if class_counts else 0
    n_classes = len(class_counts)

    feasible = min_class_count >= min_per_class and n_classes >= 2

    return feasible, {
        "n_classes": n_classes,
        "class_counts": dict(class_counts),
        "min_class_count": min_class_count,
        "min_required": min_per_class,
    }


def stratified_split(
    records: list[TriageRecord],
    train_ratio: float = 0.7,
    val_ratio: float = 0.15,
    test_ratio: float = 0.15,
    random_seed: int = 42,
) -> tuple[list[TriageRecord], list[TriageRecord], list[TriageRecord], list[TriageRecord], dict]:
    """
    Stratified split on (care_type, urgency) for records with valid labels AND valid coordinates.
    Follow-up records (null labels) are kept separate and NOT split.
    Records with invalid coordinates are excluded from splits and reported.
    Returns (train, val, test, followup, split_info).
    """
    # Validate ratios
    ratio_errors = validate_split_ratios(train_ratio, val_ratio, test_ratio)
    if ratio_errors:
        raise ValueError("; ".join(ratio_errors))

    # Separate follow-up records
    followup = [r for r in records if r.is_followup]
    
    # Separate records with valid labels AND valid coordinates
    labeled = [r for r in records if r.has_valid_labels and r.has_valid_coords]
    invalid_coords = [r for r in records if r.has_valid_labels and not r.has_valid_coords]

    print(f"[INFO] Labeled records with valid coords: {len(labeled)}")
    print(f"[INFO] Labeled records with INVALID coords (excluded): {len(invalid_coords)}")
    print(f"[INFO] Follow-up records (excluded from split): {len(followup)}")

    if len(labeled) == 0:
        raise ValueError("No labeled records with valid coordinates available for splitting")

    # Check stratification feasibility
    feasible, strat_info = check_stratification_feasibility(labeled)
    print(f"[INFO] Stratification: {strat_info['n_classes']} classes, min class count: {strat_info['min_class_count']}")

    # Check two-stage stratified split feasibility
    # Stage 1: train vs (val+test) - need at least 2 per class for the second split
    # Stage 2: val vs test - need at least 2 per class in temp
    min_required_for_stratified = 3  # at least 3 per class for train/val/test
    if not feasible or strat_info['min_class_count'] < min_required_for_stratified:
        print(f"[WARNING] Stratified split infeasible (min class count {strat_info['min_class_count']} < {min_required_for_stratified}).")
        print(f"  Falling back to random split with minimum size validation.")
        # Random split with minimum size validation
        n = len(labeled)
        n_train = max(1, int(n * train_ratio))
        n_val = max(1, int(n * val_ratio))
        n_test = n - n_train - n_val
        if n_test < 1:
            raise ValueError(
                f"Split infeasible: {n} labeled records cannot satisfy "
                f"train={train_ratio}, val={val_ratio}, test={test_ratio} "
                f"(would need at least 1 record per split)"
            )
        indices = list(range(n))
        import random
        random.seed(random_seed)
        random.shuffle(indices)
        train_idx = indices[:n_train]
        val_idx = indices[n_train:n_train + n_val]
        test_idx = indices[n_train + n_val:]
        train = [labeled[i] for i in train_idx]
        val = [labeled[i] for i in val_idx]
        test = [labeled[i] for i in test_idx]
        stratified = False
    else:
        # Two-stage stratified split
        # First split: train vs (val+test)
        stratify_key = [f"{r.care_type}|{r.urgency}" for r in labeled]
        train, temp = train_test_split(
            labeled,
            train_size=train_ratio,
            random_state=random_seed,
            shuffle=True,
            stratify=stratify_key,
        )
        # Second split: val vs test
        temp_keys = [f"{r.care_type}|{r.urgency}" for r in temp]
        val_size = val_ratio / (val_ratio + test_ratio)
        # Validate that val and test will each have at least 1 record per class
        # Check feasibility at stage 2
        from collections import Counter
        temp_class_counts = Counter(temp_keys)
        if any(c < 2 for c in temp_class_counts.values()):
            # Not enough for stratified val/test split
            print(f"[WARNING] Second-stage stratified split infeasible. Using random split for val/test.")
            n_temp = len(temp)
            n_val = max(1, int(n_temp * val_size))
            n_test = n_temp - n_val
            if n_test < 1:
                raise ValueError("Split infeasible: second stage would produce empty test set")
            indices = list(range(n_temp))
            import random
            random.seed(random_seed)
            random.shuffle(indices)
            val_idx = indices[:n_val]
            test_idx = indices[n_val:]
            val = [temp[i] for i in val_idx]
            test = [temp[i] for i in test_idx]
            stratified = False
        else:
            val, test = train_test_split(
                temp,
                train_size=val_size,
                random_state=random_seed,
                shuffle=True,
                stratify=temp_keys,
            )
            stratified = True

    split_info = {
        "train_size": len(train),
        "val_size": len(val),
        "test_size": len(test),
        "followup_size": len(followup),
        "invalid_coords_size": len(invalid_coords),
        "total_labeled": len(labeled),
        "ratios": {"train": train_ratio, "val": val_ratio, "test": test_ratio},
        "random_seed": random_seed,
        "stratified": stratified,
        "stratification_info": strat_info,
    }

    # Report label distributions per split
    for split_name, split_records in [("train", train), ("val", val), ("test", test)]:
        care_counts = {}
        urgency_counts = {}
        for r in split_records:
            care_counts[r.care_type] = care_counts.get(r.care_type, 0) + 1
            urgency_counts[r.urgency] = urgency_counts.get(r.urgency, 0) + 1
        print(f"[INFO] {split_name} care_type: {care_counts}")
        print(f"[INFO] {split_name} urgency: {urgency_counts}")

    return train, val, test, followup, split_info


def compute_label_counts(records: list[TriageRecord]) -> dict:
    """Compute label distributions."""
    care_type_counts = {}
    urgency_counts = {}
    red_flag_counts = {}
    language_counts = {}
    followup_count = 0
    invalid_coords_count = 0

    for r in records:
        if r.is_followup:
            followup_count += 1
        else:
            care_type_counts[r.care_type] = care_type_counts.get(r.care_type, 0) + 1
            urgency_counts[r.urgency] = urgency_counts.get(r.urgency, 0) + 1
            if not r.has_valid_coords:
                invalid_coords_count += 1
        for rf in r.red_flags:
            red_flag_counts[rf] = red_flag_counts.get(rf, 0) + 1
        language_counts[r.detected_language] = language_counts.get(r.detected_language, 0) + 1

    return {
        "care_type": care_type_counts,
        "urgency": urgency_counts,
        "red_flags": red_flag_counts,
        "language": language_counts,
        "followup": followup_count,
        "invalid_coords": invalid_coords_count,
        "total": len(records),
    }


def preprocess(
    jsonl_path: Path = JSONL_PATH,
    train_ratio: float = 0.7,
    val_ratio: float = 0.15,
    test_ratio: float = 0.15,
    random_seed: int = 42,
) -> PreprocessResult:
    """
    Main preprocessing pipeline.
    Returns PreprocessResult with splits and metadata.
    """
    records, warnings = load_and_validate(jsonl_path)

    train, val, test, followup, split_info = stratified_split(
        records, train_ratio, val_ratio, test_ratio, random_seed
    )

    label_counts = compute_label_counts(records)

    return PreprocessResult(
        records=records,
        train=train,
        val=val,
        test=test,
        followup=followup,
        label_counts=label_counts,
        split_info=split_info,
    )


def records_to_dataframe(records: list[TriageRecord]) -> pd.DataFrame:
    """Convert list of TriageRecord to DataFrame for inspection/EDA."""
    rows = []
    for r in records:
        rows.append({
            "record_id": r.record_id,
            "detected_language": r.detected_language,
            "user_input": r.user_input,
            "lat": r.lat,
            "lng": r.lng,
            "coords_valid": r.coords_valid,
            "care_type": r.care_type,
            "urgency": r.urgency,
            "red_flags": ";".join(r.red_flags) if r.red_flags else "",
            "follow_up_question": r.follow_up_question or "",
            "is_emergency": r.is_emergency,
            "is_followup": r.is_followup,
            "has_valid_labels": r.has_valid_labels,
            "has_valid_coords": r.has_valid_coords,
            "validation_warnings": "; ".join(r.validation_warnings) if r.validation_warnings else "",
        })
    return pd.DataFrame(rows)


# CLI entry point for quick inspection
if __name__ == "__main__":
    result = preprocess()
    print("\n=== LABEL COUNTS ===")
    for k, v in result.label_counts.items():
        print(f"{k}: {v}")
    print("\n=== SPLIT INFO ===")
    for k, v in result.split_info.items():
        print(f"{k}: {v}")

    # Quick DataFrame view
    df = records_to_dataframe(result.train)
    print(f"\nTrain shape: {df.shape}")
    print(df.head())