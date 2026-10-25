const { test } = require("node:test");
const assert = require("node:assert/strict");
const mlTriageService = require("../../src/services/mlTriage.service");
const caregiverMatchingService = require("../../src/services/caregiverMatching.service");
const { runPipeline } = require("../../src/services/pipeline.service");

async function withStubbedTriage(callback) {
  const originalPredictTriage = mlTriageService.predictTriage;
  const originalMatchCaregivers = caregiverMatchingService.matchCaregivers;
  let mlCalls = 0;
  let matchingCalls = 0;

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
  caregiverMatchingService.matchCaregivers = () => {
    matchingCalls += 1;
    return [];
  };

  try {
    await callback(() => mlCalls, () => matchingCalls);
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
    assert.equal(result.decision.care_type, null);
    assert.equal(result.decision.urgency, null);
    assert.match(result.decision.reasoning, /not enough consistent information/i);
    assert.match(result.decision.reasoning, /No diagnosis/i);
    assert.deepEqual(result.decision.matched_caregivers, []);
  });
});

test("contradictory severe and mild headache answers request clarification without a recommendation", async () => {
  await withStubbedTriage(async (getMlCalls) => {
    const conversation = createConversation();
    await conversation.send("I have a severe headache");
    await conversation.send("Since yesterday");
    const result = await conversation.send("No warning signs, and I don't have the headache anymore");

    assert.equal(getMlCalls(), 0);
    assert.equal(result.trace.branch, "follow_up");
    assert.equal(result.decision.care_type, null);
    assert.equal(result.decision.matched_caregivers.length, 0);
    assert.match(result.decision.follow_up_question, /described the headache as severe/i);
  });
});

test("not sure on a critical breathing question remains unknown, not no", async () => {
    await withStubbedTriage(async (getMlCalls, getMatchingCalls) => {
      const conversation = createConversation();
      await conversation.send("I have a fever");
      const result = await conversation.send("I'm not sure");

      assert.equal(getMlCalls(), 0);
      assert.equal(getMatchingCalls(), 0);
      assert.equal(result.trace.branch, "insufficient_information");
      assert.equal(result.decision.care_type, null);
      assert.equal(result.decision.urgency, null);
      assert.deepEqual(result.decision.matched_caregivers, []);
      assert.match(result.decision.reasoning, /not enough consistent information/i);
    });
  });

  test("conflicting symptom durations are clarified instead of choosing the latest silently", async () => {
    await withStubbedTriage(async (getMlCalls) => {
      const result = await runPipeline({
        user_input: "No, it has been 7 days",
        language: "english",
        conversation_history: [
          { role: "user", content: "I have a headache" },
          { role: "assistant", content: "How long have these symptoms been present?", is_question: true },
          { role: "user", content: "2 days" },
          {
            role: "assistant",
            content: "Did the headache start suddenly and severely, or come with new weakness, confusion, vision changes, or trouble speaking?",
            is_question: true
          }
        ]
      });

      assert.equal(getMlCalls(), 0);
      assert.equal(result.trace.branch, "follow_up");
      assert.match(result.decision.follow_up_question, /mentioned different symptom durations/i);
      assert.deepEqual(result.decision.matched_caregivers, []);
    });
  });

  test("a clear answer to a contradiction resumes triage using the clarification", async () => {
    await withStubbedTriage(async (getMlCalls) => {
      const conversation = createConversation();
      await conversation.send("I have a severe headache");
      await conversation.send("Since yesterday");
      const clarification = await conversation.send("No warning signs, and I don't have the headache anymore");
      assert.match(clarification.decision.follow_up_question, /described the headache as severe/i);
      const result = await conversation.send("Moderate");

      assert.equal(result.trace.branch, "final");
      assert.equal(result.decision.follow_up_question, null);
      assert.equal(getMlCalls(), 1);
    });
  });

test("unanswered critical information never reaches caregiver matching", async () => {
    await withStubbedTriage(async (getMlCalls, getMatchingCalls) => {
      const conversation = createConversation();
      await conversation.send("I have a headache");
      const result = await conversation.send("I don't know");

      assert.equal(result.trace.branch, "insufficient_information");
      assert.equal(result.decision.care_type, null);
      assert.deepEqual(result.decision.matched_caregivers, []);
      assert.equal(getMlCalls(), 0);
      assert.equal(getMatchingCalls(), 0);
    });
  });

test("red flag reported after routine answers immediately overrides clarification", async () => {
    await withStubbedTriage(async (getMlCalls, getMatchingCalls) => {
      const conversation = createConversation();
      await conversation.send("I have a fever");
      await conversation.send("No breathing difficulty or chest pain, fever for 2 days");
      const result = await conversation.send("Now I have crushing chest pain");

      assert.equal(result.trace.branch, "emergency");
      assert.equal(result.decision.care_type, "emergency_referral");
      assert.equal(result.decision.urgency, "immediate");
      assert.deepEqual(result.decision.matched_caregivers, []);
      assert.equal(getMlCalls(), 0);
      assert.equal(getMatchingCalls(), 0);
    });
  });

test("consistent complete answers still use the existing final triage flow", async () => {
    await withStubbedTriage(async (getMlCalls, getMatchingCalls) => {
      const conversation = createConversation();
      await conversation.send("I have a headache");
      await conversation.send("Since yesterday");
      await conversation.send("No sudden onset, weakness, confusion, vision, or speech changes");
      const result = await conversation.send("Mild");

      assert.equal(result.trace.branch, "final");
      assert.equal(result.decision.care_type, "gp_teleconsult");
      assert.equal(getMlCalls(), 1);
      assert.equal(getMatchingCalls(), 1);
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
