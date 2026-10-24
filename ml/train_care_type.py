"""
CareCompass — Care Type Classifier Training

Trains a TF-IDF + Logistic Regression classifier to predict care_type from user_input.
Uses the existing preprocessing pipeline's train/validation/test split.
Excludes follow-up records (null labels).
"""
import json
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
)
from sklearn.pipeline import Pipeline

# Add project root to path
PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from data.preprocess import preprocess, records_to_dataframe, TriageRecord


def extract_training_data(records: list[TriageRecord]) -> tuple[list[str], list[str]]:
    """Extract user_input and care_type from records with valid labels."""
    texts = []
    labels = []
    for r in records:
        if r.has_valid_labels and r.care_type is not None:
            texts.append(r.user_input)
            labels.append(r.care_type)
    return texts, labels


def train_care_type_classifier(
    train_texts: list[str],
    train_labels: list[str],
    val_texts: list[str] = None,
    val_labels: list[str] = None,
) -> Pipeline:
    """Train TF-IDF + Logistic Regression pipeline."""
    # TF-IDF vectorizer: unigrams + bigrams, min_df=2, sublinear_tf
    tfidf = TfidfVectorizer(
        ngram_range=(1, 2),
        min_df=2,
        max_df=0.95,
        sublinear_tf=True,
        strip_accents="unicode",
    )

    # Logistic Regression with balanced class weights
    clf = LogisticRegression(
        class_weight="balanced",
        max_iter=1000,
        random_state=42,
        n_jobs=-1,
        solver="lbfgs",
    )

    pipeline = Pipeline([
        ("tfidf", tfidf),
        ("clf", clf),
    ])

    print(f"[INFO] Training on {len(train_texts)} samples...")
    pipeline.fit(train_texts, train_labels)

    if val_texts and val_labels:
        val_preds = pipeline.predict(val_texts)
        val_acc = accuracy_score(val_labels, val_preds)
        val_f1 = f1_score(val_labels, val_preds, average="macro")
        print(f"[INFO] Validation accuracy: {val_acc:.4f}")
        print(f"[INFO] Validation macro-F1: {val_f1:.4f}")

    return pipeline


def evaluate_on_test(pipeline: Pipeline, test_texts: list[str], test_labels: list[str], output_dir: Path) -> dict:
    """Evaluate on test set and save metrics."""
    preds = pipeline.predict(test_texts)

    # Overall metrics
    accuracy = accuracy_score(test_labels, preds)
    macro_f1 = f1_score(test_labels, preds, average="macro")
    weighted_f1 = f1_score(test_labels, preds, average="weighted")

    # Per-class metrics
    report = classification_report(test_labels, preds, output_dict=True, zero_division=0)

    # Confusion matrix
    labels = sorted(set(test_labels) | set(preds))
    cm = confusion_matrix(test_labels, preds, labels=labels)

    # Save metrics
    metrics = {
        "test_accuracy": accuracy,
        "test_macro_f1": macro_f1,
        "test_weighted_f1": weighted_f1,
        "per_class": report,
        "confusion_matrix": {
            "labels": labels,
            "matrix": cm.tolist(),
        },
        "n_test_samples": len(test_texts),
    }

    metrics_path = output_dir / "care_type_test_metrics.json"
    with open(metrics_path, "w") as f:
        json.dump(metrics, f, indent=2)

    # Save confusion matrix as CSV for readability
    cm_df = pd.DataFrame(cm, index=labels, columns=labels)
    cm_path = output_dir / "care_type_confusion_matrix.csv"
    cm_df.to_csv(cm_path)

    print(f"\n=== TEST RESULTS ===")
    print(f"Accuracy:  {accuracy:.4f}")
    print(f"Macro-F1:  {macro_f1:.4f}")
    print(f"Weighted-F1: {weighted_f1:.4f}")
    print(f"\nPer-class metrics:")
    for cls in labels:
        if cls in report:
            print(f"  {cls}: precision={report[cls]['precision']:.4f}, recall={report[cls]['recall']:.4f}, f1={report[cls]['f1-score']:.4f}, support={report[cls]['support']}")
    print(f"\nConfusion matrix saved to: {cm_path}")
    print(f"Metrics saved to: {metrics_path}")

    return metrics


def smoke_test(pipeline: Pipeline) -> None:
    """Run smoke test with example inputs."""
    test_inputs = [
        "papa ko do din se bukhar hai aur khansi bhi",
        "doctor prescribed injection can someone come home",
        "mild acidity want to consult doctor",
        "grandmother has bedsore needs dressing",
        "accident ke baad bleeding ruk nahi rahi",
        "book full body checkup home collection",
        "need wound dressing after surgery",
        "chest pain ho raha hai",
    ]

    print("\n=== SMOKE TEST ===")
    for text in test_inputs:
        pred = pipeline.predict([text])[0]
        proba = pipeline.predict_proba([text])[0]
        max_prob = max(proba)
        print(f"  Input: {text[:60]:60s} -> {pred} (confidence: {max_prob:.3f})")


def main():
    print("=== CareCompass Care Type Classifier Training ===\n")

    # Run preprocessing to get splits
    result = preprocess(random_seed=42)

    # Extract training data (excludes follow-up records automatically via has_valid_labels)
    train_texts, train_labels = extract_training_data(result.train)
    val_texts, val_labels = extract_training_data(result.val)
    test_texts, test_labels = extract_training_data(result.test)

    print(f"Training samples:   {len(train_texts)}")
    print(f"Validation samples: {len(val_texts)}")
    print(f"Test samples:       {len(test_texts)}")
    print(f"Follow-up excluded: {len(result.followup)}")
    print(f"Classes: {sorted(set(train_labels))}")

    # Train
    pipeline = train_care_type_classifier(train_texts, train_labels, val_texts, val_labels)

    # Evaluate on test
    output_dir = PROJECT_ROOT / "ml" / "reports"
    metrics = evaluate_on_test(pipeline, test_texts, test_labels, output_dir)

    # Save model
    model_path = PROJECT_ROOT / "ml" / "models" / "care_type_pipeline.joblib"
    joblib.dump(pipeline, model_path)
    print(f"\nModel saved to: {model_path}")

    # Smoke test
    smoke_test(pipeline)

    print("\n=== TRAINING COMPLETE ===")
    return metrics


if __name__ == "__main__":
    main()