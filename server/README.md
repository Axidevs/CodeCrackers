# CURA Backend Service

**CareCompass: AI-Powered Care Navigation & Caregiver Matching**
Department: Centre for Artificial Intelligence (CAI), IIIT-Delhi

CURA is a healthcare navigation backend engine that processes patient messages in Hindi, English, or Hinglish, determines the appropriate care level and urgency, enforces an independent deterministic emergency safety layer, and matches eligible caregivers with evidence-based reasoning.

---

## Architecture Overview

```
                      +-----------------------------+
                      |   Incoming Patient Message  |
                      |  (Hindi, English, Hinglish) |
                      +--------------+--------------+
                                     |
                                     v
                      +-----------------------------+
                      |       Smart Intake          |
                      |  - Text & Script Normalizer |
                      |  - Multi-Turn History Merge |
                      |  - Question Disambiguation  |
                      +--------------+--------------+
                                     |
                                     v
                      +-----------------------------+
                      |   Emergency Safety Gate     |   YES (Red Flag)
                      |  - Deterministic Rules      | -----------------> [Emergency Referral]
                      |  - Preceding/Post Negation  |                    - Urgency: immediate
                      |  - Inverse Ability Patterns |                    - Action: Call 112
                      +--------------+--------------+                    - Bypass Caregivers
                                     | NO (Safe)
                                     v
                      +-----------------------------+
                      |      AI / ML Triage         |
                      |  - Member 1 Microservice    |
                      |  - Resilient Mock Fallback  |
                      +--------------+--------------+
                                     |
                                     v
                      +-----------------------------+
                      |   Caregiver Matcher Engine  |
                      |  - Role & Skill Eligibility |
                      |  - Availability & Booking   |
                      |  - Haversine Distance Score |
                      |  - Language & Rating Match  |
                      +--------------+--------------+
                                     |
                                     v
                      +-----------------------------+
                      |    Official JSON Response   |
                      +-----------------------------+
```

---

## Teammate Integration Guide

### 1. Integration for Member 1 (AI/ML Engineer)

The backend provides an adapter (`src/services/mlTriage.service.js`) that queries your Python ML service.

- **Configured Endpoint**: `POST ${ML_SERVICE_URL}` (Default: `http://localhost:8000/predict`)
- **Timeout**: 2000 ms (configurable via `ML_SERVICE_TIMEOUT_MS`).
- **Resilience**: If your service is offline, starting up, or times out, the backend automatically uses an internal deterministic mock predictor without crashing.

#### Request Payload sent by Backend to ML:
```json
{
  "text": "papa ko do din se bukhar hai aur khansi bhi hai",
  "language": "hinglish",
  "symptoms": ["fever", "cough"],
  "duration": "2 din"
}
```

#### Expected Response Payload from ML:
```json
{
  "care_type": "paramedic_home_visit",
  "urgency": "same_day",
  "confidence": 0.92,
  "reasoning": "Fever with cough for 2 days, no respiratory distress reported"
}
```

*Permitted `care_type` values*: `paramedic_home_visit`, `nurse_visit`, `gp_teleconsult`, `specialist_consult`, `emergency_referral`.
*Permitted `urgency` values*: `routine`, `same_day`, `immediate`.

---

### 2. Integration for Member 2 (Frontend Engineer)

#### Endpoint 1: Official Triage API
- **Route**: `POST /api/triage`
- **Request Format**:
```json
{
  "user_input": "papa ko do din se bukhar hai aur khansi bhi hai",
  "language": "auto",
  "location": { "lat": 28.54, "lng": 77.27 },
  "conversation_history": []
}
```

#### Responses:

**A. Disambiguation (Follow-up question)**
```json
{
  "follow_up_question": "Kya saans lene me koi takleef ya seene me dard ho raha hai?",
  "care_type": null,
  "urgency": null,
  "red_flags": [],
  "reasoning": "Clarification requested to determine optimal care level and urgency.",
  "matched_caregivers": []
}
```

**B. Emergency Detected (Safety Gate Triggered)**
```json
{
  "follow_up_question": null,
  "care_type": "emergency_referral",
  "urgency": "immediate",
  "red_flags": ["chest_pain"],
  "reasoning": "Severe chest pain or cardiac distress reported. Immediate emergency response required.",
  "emergency_action": {
    "call": "112",
    "ambulance": "108",
    "guidance": "Immediate medical attention required. Please call 112 or visit the nearest emergency department.",
    "steps": [
      "Call 112 immediately for emergency medical assistance.",
      "Do not give any food or liquid if patient is having difficulty breathing or swallowing.",
      "Keep the patient in a comfortable position, loosen tight clothing, and stay with them.",
      "If available, arrange immediate transit to the nearest hospital emergency department."
    ]
  },
  "matched_caregivers": []
}
```
Emergency decisions are returned by the deterministic Safety Gate before the ML adapter or caregiver matcher runs. The `emergency_action` field is included on `POST /api/triage` only when an emergency is detected; routine, follow-up, and UI triage response shapes remain unchanged.

**C. Final Decision with Matched Caregivers**
```json
{
  "follow_up_question": null,
  "care_type": "paramedic_home_visit",
  "urgency": "same_day",
  "red_flags": [],
  "reasoning": "Symptoms reported: fever, cough; duration: 2 din; no acute breathing distress reported. Suitable for home attendance and vital checks by a paramedic today.",
  "matched_caregivers": [
    {
      "caregiver_id": "CG_014",
      "score": 0.94,
      "reason": "Hindi-speaking, 0.6 km away, free at 16:00"
    }
  ]
}
```

#### Endpoint 2: UI Triage (with Audit Trace)
- **Route**: `POST /api/ui/triage`
- Same input payload as above. Returns `{ success: true, decision, trace }` where `trace` contains `latency_ms`, `branch`, `safety_state`, `confidence`, and `source`. Ideal for the Evaluation Lab!

#### Endpoint 3: Demo Booking
- **Route**: `POST /api/booking`
- **Request**:
```json
{
  "caregiver_id": "CG_014",
  "slot_id": "CG_014_0800",
  "patient_name": "Ramesh Kumar"
}
```
- **Response**: `201 Created` with booking confirmation. If slot was already booked, returns `409 Conflict`.

#### Endpoint 4: Reset Demo Bookings
- **Route**: `POST /api/demo/reset`
- Clears the booking overlay and restores all initial caregiver slots to available.

#### Endpoint 5: Caregivers Directory
- **Route**: `GET /api/caregivers` (optional filters: `?role=paramedic&language=hindi`)
- **Route**: `GET /api/caregivers/:id`

#### Endpoint 6: Emergency Escalation
- **Route**: `POST /api/emergency/escalate`

---

## Local Setup & Testing

### 1. Install & Run
```bash
cd server
npm install
npm run dev
```

### 2. Run Automated Tests
```bash
npm test
```
The test suite covers:
- Positive emergency detection in English, Hindi, and Hinglish.
- Negation handling ("seene me dard nahi hai").
- Inverse negation ("saans nahi le pa raha", "hosh me nahi hai").
- Caregiver eligibility filters, ranking, and Haversine distance.
- Demo booking concurrency and double-booking prevention.
- End-to-end API integration tests.

### 3. Docker Deployment
```bash
docker compose up --build
```
The backend container runs on port `5001` with an automated health check on `/api/health`.

### Booking Persistence Limitations

Demo bookings are stored in a local JSON overlay. Writes use atomic file replacement, and a failed write returns a structured server error instead of confirming the booking. Duplicate protection is serialized within a single Node.js process only. Separate processes or replicas do not share a lock or transactional store, so this JSON implementation does not guarantee cross-process booking uniqueness. The overlay must be on writable durable storage to survive restarts; ephemeral container filesystems may lose bookings when the container is replaced.

### Caregiver Dataset

`server/data/caregivers.csv` is the default caregiver source. It is validated during startup; malformed rows or missing required headers stop startup rather than generating replacement profiles. Inactive rows are retained in the loaded dataset but omitted from normal caregiver listings and matching. Semicolon-separated languages and skills are parsed as lists, and blank tiers remain `null`. CSV availability provides a daily `free_from`/`free_until` window but no calendar date, so the API exposes an undated window and does not infer a date. Dataset roles are retained: `doctor` can match GP teleconsultation and `medic` can match the existing paramedic-home-visit role; `phlebotomist` currently has no matching care type in the existing taxonomy.
