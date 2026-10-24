const { test } = require("node:test");
const assert = require("node:assert/strict");
const mlTriageService = require("../../src/services/mlTriage.service");
const caregiverMatchingService = require("../../src/services/caregiverMatching.service");
const { runPipeline } = require("../../src/services/pipeline.service");

test("emergency pipeline decisions bypass ML triage and caregiver matching", async () => {
  const originalPredictTriage = mlTriageService.predictTriage;
  const originalMatchCaregivers = caregiverMatchingService.matchCaregivers;
  let mlCalls = 0;
  let matchingCalls = 0;

  mlTriageService.predictTriage = async () => {
    mlCalls += 1;
    return { care_type: "gp_teleconsult", urgency: "routine" };
  };
  caregiverMatchingService.matchCaregivers = () => {
    matchingCalls += 1;
    return [];
  };

  try {
    const { decision, trace } = await runPipeline({
      user_input: "Patient is unconscious and unresponsive",
      language: "english"
    });
    assert.equal(trace.branch, "emergency");
    assert.equal(decision.care_type, "emergency_referral");
    assert.equal(decision.urgency, "immediate");
    assert.deepEqual(decision.matched_caregivers, []);
    assert.equal(mlCalls, 0);
    assert.equal(matchingCalls, 0);
  } finally {
    mlTriageService.predictTriage = originalPredictTriage;
    caregiverMatchingService.matchCaregivers = originalMatchCaregivers;
  }
});