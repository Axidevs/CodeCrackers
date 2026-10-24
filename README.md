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
    │   └── utils/           # Normalizer, distance, schemas
    └── tests/
        ├── unit/            # Safety gate & matching tests
        └── integration/     # End-to-end API integration tests
```

---

## Quickstart

### Running the Backend Locally
```bash
cd server
npm install
npm run dev
```
The server will run on port `5001`.

### Running Tests
```bash
cd server
npm test
```

### Docker
```bash
docker compose up --build
```

---

## Team Ownership

- **Member 1 (AI/ML & Safety)**: Model development, feature engineering, and hidden test predictions.
- **Member 2 (Frontend & UX)**: React UI, Elder Mode, voice recognition, and demo experience.
- **Member 3 (Backend Engineer)**: Backend API architecture, safety gate, caregiver matching, demo booking, integration bridge, and Docker deployment.
