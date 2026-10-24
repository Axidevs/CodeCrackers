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
  });

  test("does not repeat the breathing check when fever duration is provided", () => {
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
    assert.equal(second.follow_up_question, null);
  });
});
