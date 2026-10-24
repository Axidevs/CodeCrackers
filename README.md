# CURA (CareCompass)

> **AI-Powered Care Navigation and Caregiver Matching**  
> Hack IIITD · Centre for Artificial Intelligence (CAI), IIIT-Delhi  
> Track: AI for Healthcare Access

CURA is an intelligent healthcare navigation prototype that receives patient queries in Hindi, English, or Hinglish and helps determine:
1. **What care fits**: Paramedic home visit, nurse, GP teleconsult, specialist consult, or emergency referral.
2. **How urgent it is**: Routine, same-day, or immediate.
3. **Emergency safety gate**: Independent deterministic safety layer flagging emergencies (with 112 guidance).
4. **Who should go**: Best available caregiver by role, skill, availability, distance, and language.

---

## Repository Structure

```
CURA/
├── docker-compose.yml       # Docker compose orchestration
├── README.md                # Project README
├── cura/                    # Next.js 16 frontend (React 19)
│   ├── app/                  # App Router entry point
│   ├── components/           # CURA UI and screen flow
│   ├── lib/cura-service.ts   # Typed backend API client
│   └── tests/                # API client tests
└── server/                  # CURA Express backend (Member 3)
    ├── Dockerfile           # Backend container
    ├── package.json
    ├── .env.example
    ├── src/
    │   ├── server.js        # Server bootstrap
    │   ├── app.js           # Express app & route mounting
    │   ├── config/          # Taxonomy, safety rules, questions, weights
    │   ├── controllers/     # Triage, caregiver & booking controllers
    │   ├── data/            # Caregivers dataset & overlay
    │   ├── middleware/      # Validation & error handling
    │   ├── routes/          # REST API endpoints
    │   ├── services/        # Safety gate, intake, matching, ML bridge
    │   └── utils/           # Normalizer, distance, schemas, CSV parser
    └── tests/
        ├── unit/            # Safety gate & matching tests
        └── integration/     # End-to-end API integration tests
```

The Python inference service and saved model live under `ml/`. See
[`ml/INTEGRATION.md`](ml/INTEGRATION.md) for its HTTP contract, dependency versions, and limitations.

---

## Quickstart

### Running the Python ML Service Locally
Create an environment and install the artifact-compatible runtime dependencies:
```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r ml\requirements.txt
.\.venv\Scripts\python.exe -m ml.service
```
The Python service listens on `http://localhost:8000` by default.

### Running the Backend Locally
Start the Python ML service in another terminal first, then run:
```bash
cd server
npm ci
npm run dev
```
The server will run on port `5001`.

### Running the Complete Application Locally

Use three terminals. Start the Python ML service, the backend, and the frontend:

Terminal 1:
```powershell
.\.venv\Scripts\python.exe -m ml.service
```

Terminal 2:
```bash
cd server
npm install
npm run dev
```

Terminal 3:
```bash
cd cura
corepack pnpm install --frozen-lockfile
cp .env.example .env.local
corepack pnpm dev
```

The frontend development fallback uses `http://localhost:5001`. For a deployed frontend, set `NEXT_PUBLIC_CURA_API_URL` to the backend origin at build/deploy time. This value is public and must not contain secrets. Express currently enables CORS for all origins.

### Running Tests
```bash
cd server
npm test
```

Frontend API client tests:
```bash
cd cura
corepack pnpm test
```

## Frontend and Backend Contract

The Next.js App Router renders the existing client-side CURA screen flow. Its centralized service is `cura/lib/cura-service.ts`; it uses native `fetch`, typed backend response contracts, structured HTTP errors, and a network-unavailable error. No medical recommendation fallback is used.

| Method and path | Request | Success response | Important errors |
| --- | --- | --- | --- |
| `GET /api/health` | No body | `{ success, service, status, timestamp }` | Standard `{ success:false, error:{code,message} }` |
| `POST /api/triage` | `{ user_input, language?, location?, conversation_history? }` | Decision fields directly: `follow_up_question`, `care_type`, `urgency`, `red_flags`, `reasoning`, `matched_caregivers`; emergency decisions also include `emergency_action` | `422` validation error; standard error envelope |
| `POST /api/ui/triage` | Same as official triage | `{ success:true, decision, trace }`; confidence may be present in trace | `422` validation error; standard error envelope |
| `GET /api/caregivers` | Optional `role` and `language` query parameters | `{ success:true, count, caregivers }` with active records and `availability_slots` | Standard error envelope |
| `GET /api/caregivers/:id` | Caregiver ID path segment | `{ success:true, caregiver }` | `404 NOT_FOUND`; standard error envelope |
| `POST /api/booking` | `{ caregiver_id, slot_id, patient_name?, notes? }` | `201 { success:true, booking, notice }` | `422` validation, `404` unknown caregiver/slot, `409` duplicate, `500 BOOKING_PERSISTENCE_FAILED` |
| `POST /api/emergency/escalate` | `{ red_flags?, patient_location?, notes? }` | `{ success:true, emergency:true, care_type, urgency, red_flags, emergency_action, patient_location, message }` | `422` validation; standard error envelope |

Triage requires trimmed `user_input` of 1 to 2000 characters. Optional `language` is one of `auto`, `hindi`, `english`, or `hinglish`; `location` is nullable latitude/longitude within geographic bounds. Booking requires non-empty caregiver and slot IDs. All Zod body validation failures use HTTP `422`. API errors use `{ success:false, error:{code,message} }` and may include `details` for validation errors.

## Integrated User Flow and Limitations

The intake sends symptoms to `/api/ui/triage`; its actual decision drives follow-up, emergency, and recommendation screens. Follow-up answers are sent with conversation history. Caregiver recommendations come from triage matches joined to active profiles from `/api/caregivers`; booking uses the selected backend slot ID. Emergency shortcut escalation calls `/api/emergency/escalate`; symptom-triggered emergency decisions display the Safety Gate's returned `emergency_action` and do not show caregiver matches or booking controls.

CSV caregiver slots provide a time window without a calendar date, so the UI displays only the backend-provided time range. Emergency protocol values and language come only from the backend response. Demo booking persistence is JSON-file based: duplicate protection is within one Node process, not distributed across processes, and persistence across restart depends on durable writable storage. The frontend API client is tested with Node's built-in test runner; browser end-to-end testing is not currently configured.

### Docker
```bash
docker compose up --build
```

---

## Team Ownership

- **Member 1 (AI/ML & Safety)**: Model development, feature engineering, and hidden test predictions.
- **Member 2 (Frontend & UX)**: React UI, Elder Mode, voice recognition, and demo experience.
- **Member 3 (Backend Engineer)**: Backend API architecture, safety gate, caregiver matching, demo booking, integration bridge, and Docker deployment.
