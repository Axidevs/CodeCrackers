"""
Verify equivalence between Dataset 1 (JSONL) and Dataset 2 (CSV).
Detects duplicate IDs, compares all relevant fields including caregiver matches and scores.
Handles nulls, numeric values, list ordering, and CSV serialization carefully.
Reports malformed records and parsing errors explicitly.
Saves findings to data/inspection_report.md
"""
import json
import pandas as pd
from pathlib import Path
from collections import Counter

PROJECT_ROOT = Path(__file__).parent.parent
DATA_DIR = PROJECT_ROOT / "data"

JSONL_PATH = DATA_DIR / "Dataset 1.jsonl"
CSV_PATH = DATA_DIR / "Dataset 2.csv"
REPORT_PATH = DATA_DIR / "inspection_report.md"


def load_jsonl(path):
    """Load JSONL file, return list of parsed objects. Reports parse errors without dropping."""
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
                errors.append({"line": i + 1, "error": str(e), "preview": line[:200]})
    return records, errors


def load_csv(path):
    """Load CSV file with error handling."""
    try:
        df = pd.read_csv(path)
        return df, []
    except Exception as e:
        return pd.DataFrame(), [{"error": f"CSV load failed: {e}"}]


def check_duplicate_ids(records, source_name):
    """Check for duplicate IDs within a dataset."""
    id_counts = Counter(r["id"] for r in records if "id" in r)
    duplicates = {id_: count for id_, count in id_counts.items() if count > 1}
    return duplicates


def _normalize_numeric_string(s: str) -> str:
    """Normalize a string that might represent a number."""
    s = s.strip()
    if not s:
        return ""
    try:
        fval = float(s)
        if fval == int(fval):
            return str(int(fval))
        return str(fval)
    except ValueError:
        return s


def normalize_for_compare(val):
    """Normalize a value for comparison across JSONL and CSV.
    Handles lists (JSONL) and semicolon-separated strings (CSV) uniformly by sorting.
    Numeric values are normalized to avoid 28 vs 28.0 mismatches.
    """
    if val is None:
        return ""
    if isinstance(val, float) and pd.isna(val):
        return ""
    # Normalize numeric types: convert to float then format consistently
    if isinstance(val, (int, float)) and not isinstance(val, bool):
        # Use float to normalize 28 and 28.0 to same representation
        # Format without trailing .0 for whole numbers
        fval = float(val)
        if fval == int(fval):
            return str(int(fval))
        return str(fval)
    if isinstance(val, list):
        # Sort for consistent comparison of lists (e.g., red_flags, matched_caregiver_ids)
        return ";".join(sorted(str(v) for v in val))
    if isinstance(val, str):
        # Handle semicolon-separated strings from CSV
        if ";" in val:
            parts = [_normalize_numeric_string(p) for p in val.split(";") if p.strip()]
            return ";".join(sorted(parts))
        # Also normalize bare numeric strings
        return _normalize_numeric_string(val)
    return str(val).strip()


def compare_records(jsonl_records, csv_df, jsonl_errors, csv_errors):
    """Compare records by ID and return detailed mismatches."""
    # Build ID-indexed dicts, but first check for duplicates
    jsonl_dupes = check_duplicate_ids(jsonl_records, "JSONL")
    csv_dupes = check_duplicate_ids(csv_df.to_dict("records"), "CSV")

    jsonl_by_id = {}
    for r in jsonl_records:
        if "id" in r:
            if r["id"] in jsonl_by_id:
                # Keep first, but this shouldn't happen if no duplicates
                pass
            else:
                jsonl_by_id[r["id"]] = r

    csv_by_id = {}
    for _, row in csv_df.iterrows():
        rid = row["id"]
        if rid in csv_by_id:
            pass
        else:
            csv_by_id[rid] = row

    jsonl_ids = set(jsonl_by_id.keys())
    csv_ids = set(csv_by_id.keys())

    only_in_jsonl = sorted(jsonl_ids - csv_ids)
    only_in_csv = sorted(csv_ids - jsonl_ids)
    common_ids = sorted(jsonl_ids & csv_ids)

    # Define fields to compare with extractors
    fields_to_compare = [
        # Request fields
        ("user_input", lambda j, c: j["request"]["user_input"], lambda j, c: c["user_input"]),
        ("detected_language", lambda j, c: j["detected_language"], lambda j, c: c["detected_language"]),
        ("lat", lambda j, c: j["request"]["location"]["lat"], lambda j, c: c["lat"]),
        ("lng", lambda j, c: j["request"]["location"]["lng"], lambda j, c: c["lng"]),
        # Response fields
        ("care_type", lambda j, c: j["response"]["care_type"], lambda j, c: c["care_type"]),
        ("urgency", lambda j, c: j["response"]["urgency"], lambda j, c: c["urgency"]),
        ("red_flags", lambda j, c: j["response"]["red_flags"], lambda j, c: str(c["red_flags"]).split(";") if pd.notna(c["red_flags"]) and str(c["red_flags"]).strip() else []),
        ("follow_up_question", lambda j, c: j["response"]["follow_up_question"], lambda j, c: c["follow_up_question"] if pd.notna(c["follow_up_question"]) else None),
        ("reasoning", lambda j, c: j["response"]["reasoning"], lambda j, c: c["reasoning"]),
        # Caregiver match fields (JSONL has nested, CSV has flattened)
        ("matched_caregiver_ids", lambda j, c: [m["caregiver_id"] for m in j["response"]["matched_caregivers"]], lambda j, c: str(c["matched_caregiver_ids"]).split(";") if pd.notna(c["matched_caregiver_ids"]) and str(c["matched_caregiver_ids"]).strip() else []),
        ("top_score", lambda j, c: j["response"]["matched_caregivers"][0]["score"] if j["response"]["matched_caregivers"] else None, lambda j, c: c["top_score"] if pd.notna(c["top_score"]) else None),
    ]

    mismatches = []
    comparison_errors = []

    for rid in common_ids:
        j_rec = jsonl_by_id[rid]
        c_rec = csv_by_id[rid]
        for field_name, j_getter, c_getter in fields_to_compare:
            try:
                j_val = j_getter(j_rec, c_rec)
                c_val = c_getter(j_rec, c_rec)
                j_norm = normalize_for_compare(j_val)
                c_norm = normalize_for_compare(c_val)
                if j_norm != c_norm:
                    mismatches.append({
                        "id": rid,
                        "field": field_name,
                        "jsonl": j_norm[:500],
                        "csv": c_norm[:500],
                    })
            except Exception as e:
                comparison_errors.append({
                    "id": rid,
                    "field": field_name,
                    "error": str(e),
                })

    return {
        "jsonl_count": len(jsonl_records),
        "csv_count": len(csv_df),
        "jsonl_unique_ids": len(jsonl_ids),
        "csv_unique_ids": len(csv_ids),
        "jsonl_duplicates": jsonl_dupes,
        "csv_duplicates": csv_dupes,
        "only_in_jsonl": only_in_jsonl,
        "only_in_csv": only_in_csv,
        "common_ids_count": len(common_ids),
        "mismatches": mismatches,
        "comparison_errors": comparison_errors,
        "jsonl_parse_errors": jsonl_errors,
        "csv_parse_errors": csv_errors,
    }


def generate_report(results):
    lines = []
    lines.append("# Dataset 1 vs Dataset 2 Equivalence Report")
    lines.append("")
    lines.append(f"**Generated:** {pd.Timestamp.now().isoformat()}")
    lines.append("")

    # Summary
    lines.append("## Summary")
    lines.append("")
    lines.append(f"- Dataset 1 (JSONL) records parsed: **{results['jsonl_count']}**")
    lines.append(f"- Dataset 2 (CSV) records parsed: **{results['csv_count']}**")
    lines.append(f"- Dataset 1 unique IDs: **{results['jsonl_unique_ids']}**")
    lines.append(f"- Dataset 2 unique IDs: **{results['csv_unique_ids']}**")
    lines.append(f"- Common IDs: **{results['common_ids_count']}**")
    lines.append(f"- IDs only in JSONL: **{len(results['only_in_jsonl'])}**")
    lines.append(f"- IDs only in CSV: **{len(results['only_in_csv'])}**")
    lines.append(f"- JSONL duplicate IDs: **{len(results['jsonl_duplicates'])}**")
    lines.append(f"- CSV duplicate IDs: **{len(results['csv_duplicates'])}**")
    lines.append(f"- Field mismatches: **{len(results['mismatches'])}**")
    lines.append(f"- Comparison errors: **{len(results['comparison_errors'])}**")
    lines.append(f"- JSONL parse errors: **{len(results['jsonl_parse_errors'])}**")
    lines.append(f"- CSV parse errors: **{len(results['csv_parse_errors'])}**")
    lines.append("")

    # Parse errors
    if results["jsonl_parse_errors"]:
        lines.append("## JSONL Parse Errors")
        lines.append("")
        lines.append("| Line | Error | Preview |")
        lines.append("|------|-------|---------|")
        for e in results["jsonl_parse_errors"]:
            preview = e["preview"].replace("|", "\\|")
            lines.append(f"| {e['line']} | {e['error']} | {preview} |")
        lines.append("")

    if results["csv_parse_errors"]:
        lines.append("## CSV Parse Errors")
        lines.append("")
        for e in results["csv_parse_errors"]:
            lines.append(f"- {e['error']}")
        lines.append("")

    # Duplicates
    if results["jsonl_duplicates"]:
        lines.append("## Duplicate IDs in JSONL")
        lines.append("")
        for id_, count in results["jsonl_duplicates"].items():
            lines.append(f"- `{id_}` appears {count} times")
        lines.append("")

    if results["csv_duplicates"]:
        lines.append("## Duplicate IDs in CSV")
        lines.append("")
        for id_, count in results["csv_duplicates"].items():
            lines.append(f"- `{id_}` appears {count} times")
        lines.append("")

    # ID mismatches
    if results["only_in_jsonl"]:
        lines.append("## IDs Only in JSONL")
        lines.append("")
        for rid in results["only_in_jsonl"]:
            lines.append(f"- `{rid}`")
        lines.append("")

    if results["only_in_csv"]:
        lines.append("## IDs Only in CSV")
        lines.append("")
        for rid in results["only_in_csv"]:
            lines.append(f"- `{rid}`")
        lines.append("")

    # Comparison errors
    if results["comparison_errors"]:
        lines.append("## Comparison Errors")
        lines.append("")
        lines.append("| ID | Field | Error |")
        lines.append("|----|-------|-------|")
        for e in results["comparison_errors"]:
            lines.append(f"| {e['id']} | {e['field']} | {e['error']} |")
        lines.append("")

    # Field mismatches
    if results["mismatches"]:
        lines.append("## Field Mismatches")
        lines.append("")
        lines.append("| ID | Field | JSONL Value | CSV Value |")
        lines.append("|----|-------|-------------|-----------|")
        for m in results["mismatches"]:
            j = m["jsonl"].replace("|", "\\|")
            c = m["csv"].replace("|", "\\|")
            lines.append(f"| {m['id']} | {m['field']} | {j} | {c} |")
        lines.append("")
    else:
        lines.append("## Field Mismatches")
        lines.append("")
        lines.append("**None found.** All common records match on all compared fields.")
        lines.append("")

    # Conclusion
    lines.append("## Conclusion")
    lines.append("")
    all_clean = (
        len(results["only_in_jsonl"]) == 0 and
        len(results["only_in_csv"]) == 0 and
        len(results["mismatches"]) == 0 and
        len(results["comparison_errors"]) == 0 and
        len(results["jsonl_parse_errors"]) == 0 and
        len(results["csv_parse_errors"]) == 0 and
        len(results["jsonl_duplicates"]) == 0 and
        len(results["csv_duplicates"]) == 0
    )
    if all_clean:
        lines.append("✅ **Datasets are fully equivalent.** Dataset 2 (CSV) is a flattened representation of Dataset 1 (JSONL). All IDs unique, all fields match, no parse errors. Use either for training, but do not combine them.")
    else:
        lines.append("⚠️ **Datasets are NOT fully equivalent.** See details above. Investigate before using.")
        lines.append("")
        if results["jsonl_parse_errors"] or results["csv_parse_errors"]:
            lines.append("- Parse errors detected — some records could not be read.")
        if results["jsonl_duplicates"] or results["csv_duplicates"]:
            lines.append("- Duplicate IDs found — data integrity issue.")
        if results["only_in_jsonl"] or results["only_in_csv"]:
            lines.append("- ID mismatch — records present in one dataset but not the other.")
        if results["mismatches"]:
            lines.append("- Field value mismatches — same ID, different data.")
        if results["comparison_errors"]:
            lines.append("- Comparison errors — could not compare some fields.")
    lines.append("")

    return "\n".join(lines)


def main():
    print("Loading Dataset 1 (JSONL)...")
    jsonl_records, jsonl_errors = load_jsonl(JSONL_PATH)
    print(f"  Loaded {len(jsonl_records)} records, {len(jsonl_errors)} parse errors")

    print("Loading Dataset 2 (CSV)...")
    csv_df, csv_errors = load_csv(CSV_PATH)
    print(f"  Loaded {len(csv_df)} records, {len(csv_errors)} parse errors")

    print("Comparing...")
    results = compare_records(jsonl_records, csv_df, jsonl_errors, csv_errors)

    print(f"  JSONL unique IDs: {results['jsonl_unique_ids']}")
    print(f"  CSV unique IDs: {results['csv_unique_ids']}")
    print(f"  Common IDs: {results['common_ids_count']}")
    print(f"  JSONL duplicates: {len(results['jsonl_duplicates'])}")
    print(f"  CSV duplicates: {len(results['csv_duplicates'])}")
    print(f"  Only in JSONL: {len(results['only_in_jsonl'])}")
    print(f"  Only in CSV: {len(results['only_in_csv'])}")
    print(f"  Field mismatches: {len(results['mismatches'])}")
    print(f"  Comparison errors: {len(results['comparison_errors'])}")

    print("Generating report...")
    report = generate_report(results)
    REPORT_PATH.write_text(report, encoding="utf-8")
    print(f"  Report saved to {REPORT_PATH}")

    return results


if __name__ == "__main__":
    main()