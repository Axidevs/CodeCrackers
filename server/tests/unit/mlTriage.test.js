const { test } = require("node:test");
const assert = require("node:assert/strict");
const env = require("../../src/config/env");
const {
  MlServiceError,
  predictTriage,
  runFallbackMockPredictor
} = require("../../src/services/mlTriage.service");

function pythonResponse(overrides = {}) {
  return {
    follow_up_question: null,
    care_type: "teleconsultation",
    urgency: null,
    red_flags: [],
    reasoning: "Python model inference.",
    matched_caregivers: [],
    ...overrides
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

test("sends the existing intake fields and maps a valid Python response", async () => {
  const originalUrl = env.ML_SERVICE_URL;
  env.ML_SERVICE_URL = "http://ml-service.test/predict";
  let request;
  try {
    const result = await predictTriage(
      {
        text: "headache for two days",
        language: "english",
        symptoms: ["headache"],
        duration: "two days"
      },
      {
        fetchImpl: async (url, options) => {
          request = { url, options };
          return jsonResponse(pythonResponse());
        }
      }
    );
    assert.equal(request.url, env.ML_SERVICE_URL);
    assert.deepEqual(JSON.parse(request.options.body), {
      text: "headache for two days",
      language: "english",
      symptoms: ["headache"],
      duration: "two days"
    });
    assert.equal(result.care_type, "gp_teleconsult");
    assert.equal(result.urgency, null);
    assert.equal(result.reasoning, "Python model inference.");
    assert.equal(result.source, "ml_service");
    assert.equal(Object.hasOwn(result, "confidence"), false);
  } finally {
    env.ML_SERVICE_URL = originalUrl;
  }
});

test("maps only documented equivalent taxonomies and preserves emergency disposition", async () => {
  const cases = [
    ["home_nursing", "nurse_visit"],
    ["paramedic_home_visit", "paramedic_home_visit"],
    ["teleconsultation", "gp_teleconsult"]
  ];
  for (const [pythonCareType, backendCareType] of cases) {
    const result = await predictTriage(
      { text: "valid symptom" },
      { fetchImpl: async () => jsonResponse(pythonResponse({ care_type: pythonCareType })) }
    );
    assert.equal(result.care_type, backendCareType);
  }

  const emergency = await predictTriage(
    { text: "valid symptom" },
    {
      fetchImpl: async () =>
        jsonResponse(
          pythonResponse({
            care_type: "emergency_112",
            urgency: "emergency",
            red_flags: ["chest_pain"]
          })
        )
    }
  );
  assert.equal(emergency.care_type, "emergency_referral");
  assert.equal(emergency.urgency, "immediate");
  assert.deepEqual(emergency.red_flags, ["chest_pain"]);
});

test("preserves a Python follow-up response without assigning triage fields", async () => {
  const result = await predictTriage(
    { text: "underspecified request" },
    {
      fetchImpl: async () =>
        jsonResponse(
          pythonResponse({
            follow_up_question: "What is the main concern?",
            care_type: null
          })
        )
    }
  );
  assert.equal(result.follow_up_question, "What is the main concern?");
  assert.equal(result.care_type, null);
  assert.equal(result.urgency, null);
});

test("rejects a valid Python care type that the backend cannot represent", async () => {
  await assert.rejects(
    predictTriage(
      { text: "valid symptom" },
      { fetchImpl: async () => jsonResponse(pythonResponse({ care_type: "lab_test_home" })) }
    ),
    (error) =>
      error instanceof MlServiceError &&
      error.statusCode === 502 &&
      error.code === "UNSUPPORTED_ML_CARE_TYPE"
  );
});

test("connection failure becomes a structured service-unavailable error", async () => {
  await assert.rejects(
    predictTriage(
      { text: "fever" },
      { fetchImpl: async () => { throw new TypeError("private URL details"); } }
    ),
    (error) =>
      error instanceof MlServiceError &&
      error.statusCode === 503 &&
      error.code === "ML_SERVICE_UNAVAILABLE" &&
      !error.message.includes("private")
  );
});

test("timeout aborts the Python request and returns a structured 503", async () => {
  await assert.rejects(
    predictTriage(
      { text: "fever" },
      {
        timeoutMs: 5,
        fetchImpl: (_url, { signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
          })
      }
    ),
    (error) =>
      error instanceof MlServiceError &&
      error.statusCode === 503 &&
      error.code === "ML_SERVICE_TIMEOUT"
  );
});

test("timeout also covers reading the Python response body", async () => {
  await assert.rejects(
    predictTriage(
      { text: "fever" },
      {
        timeoutMs: 5,
        fetchImpl: async (_url, { signal }) => ({
          ok: true,
          json: () =>
            new Promise((_resolve, reject) => {
              signal.addEventListener("abort", () => {
                reject(new DOMException("aborted", "AbortError"));
              });
            })
        })
      }
    ),
    (error) =>
      error instanceof MlServiceError &&
      error.statusCode === 503 &&
      error.code === "ML_SERVICE_TIMEOUT"
  );
});

test("non-2xx Python responses become structured service errors", async () => {
  await assert.rejects(
    predictTriage(
      { text: "fever" },
      { fetchImpl: async () => new Response("private upstream details", { status: 500 }) }
    ),
    (error) =>
      error.statusCode === 503 &&
      error.code === "ML_SERVICE_UNAVAILABLE" &&
      !error.message.includes("private")
  );
});

test("malformed JSON and unsupported prediction schemas are rejected", async () => {
  for (const fetchImpl of [
    async () => new Response("not-json", { status: 200 }),
    async () => jsonResponse({ care_type: "invented" })
  ]) {
    await assert.rejects(
      predictTriage({ text: "fever" }, { fetchImpl }),
      (error) =>
        error instanceof MlServiceError &&
        error.statusCode === 502 &&
        error.code === "ML_SERVICE_INVALID_RESPONSE"
    );
  }
});

test("malformed emergency data and Python caregiver matches are rejected", async () => {
  for (const invalid of [
    { care_type: "emergency_112", urgency: null },
    { red_flags: ["chest_pain"] },
    { matched_caregivers: [{ caregiver_id: "CG_01" }] }
  ]) {
    await assert.rejects(
      predictTriage(
        { text: "fever" },
        { fetchImpl: async () => jsonResponse(pythonResponse(invalid)) }
      ),
      (error) => error.code === "ML_SERVICE_INVALID_RESPONSE"
    );
  }
});

test("does not expose a production fallback predictor", () => {
  assert.equal(runFallbackMockPredictor, undefined);
});
