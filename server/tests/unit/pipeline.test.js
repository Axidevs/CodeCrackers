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

test("ML emergency disposition preserves emergency guidance and bypasses matching", async () => {
  const originalPredictTriage = mlTriageService.predictTriage;
  const originalMatchCaregivers = caregiverMatchingService.matchCaregivers;
  let matchingCalls = 0;

  mlTriageService.predictTriage = async () => ({
    care_type: "emergency_referral",
    urgency: "immediate",
    red_flags: [],
    reasoning: "Emergency disposition from the model.",
    source: "ml_service"
  });
  caregiverMatchingService.matchCaregivers = () => {
    matchingCalls += 1;
    return [];
  };

  try {
    const { decision, trace } = await runPipeline({
      user_input: "I have a severe headache for two days",
      language: "english"
    });
    assert.equal(trace.branch, "emergency");
    assert.equal(decision.care_type, "emergency_referral");
    assert.equal(decision.urgency, "immediate");
    assert.deepEqual(decision.matched_caregivers, []);
    assert.equal(decision.emergency_action.primary_number, "112");
    assert.equal(matchingCalls, 0);
  } finally {
    mlTriageService.predictTriage = originalPredictTriage;
    caregiverMatchingService.matchCaregivers = originalMatchCaregivers;
  }
});

test("ML follow-up response bypasses caregiver matching", async () => {
  const originalPredictTriage = mlTriageService.predictTriage;
  const originalMatchCaregivers = caregiverMatchingService.matchCaregivers;
  let matchingCalls = 0;

  mlTriageService.predictTriage = async () => ({
    care_type: null,
    urgency: null,
    follow_up_question: "What is the main concern?",
    red_flags: [],
    reasoning: "More information is needed.",
    source: "ml_service"
  });
  caregiverMatchingService.matchCaregivers = () => {
    matchingCalls += 1;
    return [];
  };

  try {
    const { decision, trace } = await runPipeline({
      user_input: "I have an unusual symptom for two days",
      language: "english"
    });
    assert.equal(trace.branch, "follow_up");
    assert.equal(decision.follow_up_question, "What is the main concern?");
    assert.equal(decision.care_type, null);
    assert.equal(decision.urgency, null);
    assert.deepEqual(decision.matched_caregivers, []);
    assert.equal(matchingCalls, 0);
  } finally {
    mlTriageService.predictTriage = originalPredictTriage;
    caregiverMatchingService.matchCaregivers = originalMatchCaregivers;
  }
});

test("invalid health inputs are rejected before Python inference", async () => {
  const originalPredictTriage = mlTriageService.predictTriage;
  let mlCalls = 0;
  mlTriageService.predictTriage = async () => {
    mlCalls += 1;
    return { care_type: "gp_teleconsult", urgency: "routine" };
  };

  try {
    for (const user_input of [
      "2+2",
      "hello",
      "asdfghjkl",
      "ieoepep",
      "",
      "   ",
      "!!!@@@",
      "123456",
      "What is the weather tomorrow?"
    ]) {
      await assert.rejects(
        runPipeline({ user_input, language: "english" }),
        (error) => error.code === "INVALID_HEALTH_INPUT" && error.statusCode === 400
      );
    }
    assert.equal(mlCalls, 0);
  } finally {
    mlTriageService.predictTriage = originalPredictTriage;
  }
});