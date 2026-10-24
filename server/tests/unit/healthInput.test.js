const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { isHealthConcern, hasHealthConcernInConversation } = require("../../src/utils/healthInput");

describe("Health concern input validation", () => {
  const invalidInputs = [
    "2+2",
    "hello",
    "asdfghjkl",
    "ieoepep",
    "123456",
    "!!!@@@",
    "   \t  ",
    "What is the weather tomorrow?",
    "What is fever?",
    "Does fever cause cough?",
    "How do I fix my laptop?"
  ];

  for (const input of invalidInputs) {
    test(`rejects unrelated input ${JSON.stringify(input)}`, () => {
      assert.equal(isHealthConcern(input), false);
    });
  }

  const validInputs = [
    "I have a headache",
    "I have fever since yesterday",
    "I have a fever, what should I do?",
    "Mujhe sir dard ho raha hai",
    "Mujhe kal se bukhar hai",
    "Mere pet mein bahut dard hai",
    "I am having difficulty breathing",
    "My mother is feeling dizzy",
    "I do not have fever",
    "Mujhe saans lene mein dikkat ho rahi hai",
    "I have severe chest pain.",
    "I am unable to breathe",
    "Patient is unconscious",
    "Why am I dizzy?"
  ];

  for (const input of validInputs) {
    test(`accepts health concern ${JSON.stringify(input)}`, () => {
      assert.equal(isHealthConcern(input), true);
    });
  }

  test("accepts a short follow-up answer only when prior user history has a health concern", () => {
    const history = [{ role: "user", content: "I have a headache" }];
    assert.equal(hasHealthConcernInConversation("No", history), true);
    assert.equal(hasHealthConcernInConversation("No", [{ role: "user", content: "hello" }]), false);
  });
});