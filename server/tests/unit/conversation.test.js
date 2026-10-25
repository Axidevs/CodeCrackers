const { test } = require("node:test");
const assert = require("node:assert/strict");
const mlTriageService = require("../../src/services/mlTriage.service");
const caregiverMatchingService = require("../../src/services/caregiverMatching.service");
const { runPipeline } = require("../../src/services/pipeline.service");

async function withStubbedTriage(callback) {
  const originalPredictTriage = mlTriageService.predictTriage;
  const originalMatchCaregivers = caregiverMatchingService.matchCaregivers;
  let mlCalls = 0;

  mlTriageService.predictTriage = async () => {
    mlCalls += 1;
    return {
      care_type: "gp_teleconsult",
      urgency: "routine",
      confidence: 0.8,
      reasoning: "A clinician can review the reported symptoms.",
      source: "test"
    };
  };
  caregiverMatchingService.matchCaregivers = () => [];

  try {
    await callback(() => mlCalls);
  } finally {
    mlTriageService.predictTriage = originalPredictTriage;
    caregiverMatchingService.matchCaregivers = originalMatchCaregivers;
  }
}

function createConversation() {
  const history = [];

  return {
    async send(user_input) {
      const result = await runPipeline({
        user_input,
        language: "english",
        conversation_history: history
      });
      history.push({ role: "user", content: user_input });
      if (result.decision.follow_up_question) {
        history.push({
          role: "assistant",
          content: result.decision.follow_up_question,
          is_question: true
        });
      }
      return result;
    }
  };
}

test("different symptom presentations receive different relevant first questions", async () => {
  await withStubbedTriage(async () => {
    const headache = await createConversation().send("I have a headache");
    const fever = await createConversation().send("I have a fever");

    assert.equal(headache.decision.follow_up_question, "How long have these symptoms been present?");
    assert.equal(
      fever.decision.follow_up_question,
      "Are you or the patient experiencing any breathing difficulty or chest pain?"
    );
  });
});

test("answers change the next question based on information supplied", async () => {
  await withStubbedTriage(async () => {
    const noDetails = createConversation();
    await noDetails.send("I have a fever");
    const unansweredDuration = await noDetails.send("No");
    assert.equal(unansweredDuration.decision.follow_up_question, "How long have these symptoms been present?");

    const durationProvided = createConversation();
    await durationProvided.send("I have a fever");
    const next = await durationProvided.send("No breathing difficulty or chest pain; fever for 2 days");
    assert.equal(
      next.decision.follow_up_question,
      "Is the fever very high (above 102°F) or accompanied by shivering?"
    );
  });
});

test("insufficient duration information does not trigger a model conclusion", async () => {
  await withStubbedTriage(async (getMlCalls) => {
    const conversation = createConversation();
    await conversation.send("I have a headache");
    const result = await conversation.send("I don't know");

    assert.equal(getMlCalls(), 0);
    assert.equal(result.trace.branch, "insufficient_information");
    assert.equal(result.decision.follow_up_question, null);
    assert.equal(result.decision.care_type, "gp_teleconsult");
    assert.match(result.decision.reasoning, /not enough information/i);
    assert.match(result.decision.reasoning, /No diagnosis has been made/);
    assert.deepEqual(result.decision.matched_caregivers, []);
  });
});

test("prior answers are retained and already answered questions are not repeated", async () => {
  await withStubbedTriage(async (getMlCalls) => {
    const conversation = createConversation();
    const first = await conversation.send("I have a fever");
    assert.equal(first.decision.follow_up_question, "Are you or the patient experiencing any breathing difficulty or chest pain?");

    const second = await conversation.send("No breathing difficulty or chest pain; fever for 2 days");
    assert.equal(second.decision.follow_up_question, "Is the fever very high (above 102°F) or accompanied by shivering?");

    const final = await conversation.send("High fever with chills");
    assert.equal(final.trace.branch, "final");
    assert.equal(final.decision.follow_up_question, null);
    assert.equal(getMlCalls(), 1);
  });
});

test("affirmative answer to an urgent-symptom check triggers emergency guidance immediately", async () => {
  await withStubbedTriage(async (getMlCalls) => {
    const conversation = createConversation();
    await conversation.send("I have a fever");
    const result = await conversation.send("Yes");

    assert.equal(result.trace.branch, "emergency");
    assert.equal(result.decision.care_type, "emergency_referral");
    assert.equal(result.decision.urgency, "immediate");
    assert.equal(result.decision.emergency_action.call, "112");
    assert.equal(getMlCalls(), 0);
  });
});

test("sudden severe headache is escalated by the safety gate without follow-up", async () => {
  await withStubbedTriage(async (getMlCalls) => {
    const result = await runPipeline({
      user_input: "I have a sudden severe headache",
      language: "english"
    });

    assert.equal(result.trace.branch, "emergency");
    assert.deepEqual(result.decision.red_flags, ["sudden_severe_headache"]);
    assert.equal(result.decision.emergency_action.call, "112");
    assert.equal(getMlCalls(), 0);
  });
});

test("triage model is called only after the symptom-specific information is collected", async () => {
  await withStubbedTriage(async (getMlCalls) => {
    const conversation = createConversation();
    const first = await conversation.send("I have a headache");
    assert.equal(first.decision.follow_up_question, "How long have these symptoms been present?");
    assert.equal(getMlCalls(), 0);

    const second = await conversation.send("Since yesterday");
    assert.equal(
      second.decision.follow_up_question,
      "Did the headache start suddenly and severely, or come with new weakness, confusion, vision changes, or trouble speaking?"
    );
    assert.equal(getMlCalls(), 0);

    const third = await conversation.send("No");
    assert.equal(third.decision.follow_up_question, "How severe is the headache, from mild to severe or 0 to 10?");
    assert.equal(getMlCalls(), 0);

    const final = await conversation.send("Mild, 3 out of 10");
    assert.equal(final.trace.branch, "final");
    assert.equal(final.decision.follow_up_question, null);
    assert.equal(final.decision.care_type, "gp_teleconsult");
    assert.match(final.decision.reasoning, /not a confirmed diagnosis/i);
    assert.equal(getMlCalls(), 1);
  });
});
