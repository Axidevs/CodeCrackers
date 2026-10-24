import json
with open('data/Dataset 1.jsonl', encoding='utf-8') as f:
    for i, line in enumerate(f):
        if i >= 10:
            break
        d = json.loads(line)
        print('ID:', d["id"])
        print('  user_input:', d["request"]["user_input"][:80])
        print('  care_type:', d["response"]["care_type"])
        print('  urgency:', d["response"]["urgency"])
        print('  red_flags:', d["response"]["red_flags"])
        print('  follow_up:', d["response"]["follow_up_question"])
        print('  reasoning:', d["response"]["reasoning"][:80])
        mc = d["response"]["matched_caregivers"]
        print('  matched_count:', len(mc))
        if mc:
            m = mc[0]
            print('  first_match_id:', m.get("caregiver_id"))
            print('  first_match_score:', m.get("score"))
        print()