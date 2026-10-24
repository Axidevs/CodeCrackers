import json
import pandas as pd

# Dataset 1 - JSONL
ids_1 = []
records_1 = []
with open(r'C:\Users\rakes\OneDrive\Pictures\Documents\Desktop\Cura\data\Dataset 1.jsonl', 'r', encoding='utf-8') as f:
    for line in f:
        data = json.loads(line)
        ids_1.append(data['id'])
        records_1.append(data)
print('Dataset 1 (JSONL): {} records'.format(len(ids_1)))
print('Unique IDs: {}'.format(len(set(ids_1))))
print('Sample IDs: {}...{}'.format(ids_1[:5], ids_1[-5:]))

# Check detected_language distribution
langs = [r['detected_language'] for r in records_1]
from collections import Counter
print('Language distribution: {}'.format(Counter(langs)))

# Check care_type distribution
care_types = [r['response']['care_type'] for r in records_1]
print('Care type distribution: {}'.format(Counter(care_types)))

# Check urgency distribution
urgencies = [r['response']['urgency'] for r in records_1]
print('Urgency distribution: {}'.format(Counter(urgencies)))

# Check red_flags
red_flags_all = []
for r in records_1:
    red_flags_all.extend(r['response']['red_flags'])
print('Red flags distribution: {}'.format(Counter(red_flags_all)))

# Check follow_up_question
followups = sum(1 for r in records_1 if r['response']['follow_up_question'] is not None)
print('Follow-up questions: {} out of {}'.format(followups, len(records_1)))

# Dataset 2 - CSV
df2 = pd.read_csv(r'C:\Users\rakes\OneDrive\Pictures\Documents\Desktop\Cura\data\Dataset 2.csv')
print('\nDataset 2 (CSV): {} records'.format(len(df2)))
print('Columns: {}'.format(list(df2.columns)))
print('Unique IDs: {}'.format(df2['id'].nunique()))
print('Sample IDs: {}...{}'.format(df2['id'].head(5).tolist(), df2['id'].tail(5).tolist()))

# Check overlap
ids_2 = set(df2['id'].tolist())
ids_1_set = set(ids_1)
print('\nOverlap check:')
print('  Dataset 1 IDs in Dataset 2: {}'.format(len(ids_1_set & ids_2)))
print('  Dataset 1 only: {}'.format(len(ids_1_set - ids_2)))
print('  Dataset 2 only: {}'.format(len(ids_2 - ids_1_set)))

# If they overlap completely, compare content for a few records
if len(ids_1_set & ids_2) == len(ids_1_set):
    print('\nDatasets appear to have identical IDs. Comparing content for S0001...')
    r1 = next(r for r in records_1 if r['id'] == 'S0001')
    r2 = df2[df2['id'] == 'S0001'].iloc[0]
    print('  JSONL user_input: {}'.format(r1['request']['user_input']))
    print('  CSV user_input: {}'.format(r2['user_input']))
    print('  JSONL care_type: {}'.format(r1['response']['care_type']))
    print('  CSV care_type: {}'.format(r2['care_type']))
    print('  JSONL urgency: {}'.format(r1['response']['urgency']))
    print('  CSV urgency: {}'.format(r2['urgency']))

# Dataset 3 - Caregivers CSV
df3 = pd.read_csv(r'C:\Users\rakes\OneDrive\Pictures\Documents\Desktop\Cura\data\Dataset 3.csv')
print('\nDataset 3 (Caregivers CSV): {} records'.format(len(df3)))
print('Columns: {}'.format(list(df3.columns)))
print('Roles: {}'.format(df3['role'].value_counts().to_dict()))
print('Active: {}'.format(df3['active'].value_counts().to_dict()))
print('Tiers (medics): {}'.format(df3[df3['role']=='medic']['tier'].value_counts().to_dict()))
print('Languages sample: {}'.format(df3['languages'].head(3).tolist()))
print('Skills sample: {}'.format(df3['skills'].head(3).tolist()))
print('Location ranges: lat {:.4f}-{:.4f}, lng {:.4f}-{:.4f}'.format(df3['base_lat'].min(), df3['base_lat'].max(), df3['base_lng'].min(), df3['base_lng'].max()))
print('Max radius range: {}-{} km'.format(df3['max_radius_km'].min(), df3['max_radius_km'].max()))
print('Rating range: {:.1f}-{:.1f}'.format(df3['rating'].min(), df3['rating'].max()))
print('Experience range: {}-{} years'.format(df3['experience_years'].min(), df3['experience_years'].max()))

# Dataset 4 - Multi-turn JSONL
print('\nDataset 4 (Multi-turn JSONL):')
with open(r'C:\Users\rakes\OneDrive\Pictures\Documents\Desktop\Cura\data\Dataset 4.jsonl', 'r', encoding='utf-8') as f:
    for i, line in enumerate(f):
        data = json.loads(line)
        print('  Example {}: id={}, turns={}'.format(i+1, data['id'], len(data['turns'])))
        for j, turn in enumerate(data['turns']):
            role = turn.get('role', 'assistant')
            text = turn.get('text', turn.get('follow_up_question', turn.get('care_type', 'N/A')))
            print('    Turn {}: {} - {}'.format(j+1, role, str(text)[:80]))