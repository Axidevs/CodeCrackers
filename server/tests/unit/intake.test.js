const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { processIntake } = require("../../src/services/intake.service");

describe("Follow-up question selection", () => {
  test("selects a relevant duration question for headache and does not repeat it", () => {
    const first = processIntake({ user_input: "I have a headache", language: "english" });
    assert.equal(first.follow_up_question, "How long have these symptoms been present?");

    const second = processIntake({
      user_input: "No",
      language: "english",
      conversation_history: [
        { role: "user", content: "I have a headache" },
        { role: "assistant", content: first.follow_up_question, is_question: true }
      ]
    });
    assert.equal(second.follow_up_question, null);
    assert.equal(second.is_ready_for_triage, false);
    assert.equal(second.has_unresolved_question, true);
  });

  test("moves to fever severity after the breathing check and duration are answered", () => {
    const first = processIntake({ user_input: "I have fever", language: "english" });
    assert.equal(first.follow_up_question, "Are you or the patient experiencing any breathing difficulty or chest pain?");

    const second = processIntake({
      user_input: "No breathing difficulty or chest pain, fever for 3 days",
      language: "english",
      conversation_history: [
        { role: "user", content: "I have fever" },
        { role: "assistant", content: first.follow_up_question, is_question: true }
      ]
    });
    assert.equal(second.follow_up_question, "Is the fever very high (above 102°F) or accompanied by shivering?");
    assert.equal(second.is_ready_for_triage, false);
    assert.deepEqual(second.symptoms, ["fever"]);
  });
});
