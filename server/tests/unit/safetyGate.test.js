const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { evaluateSafety } = require("../../src/services/safetyGate.service");

describe("Emergency Safety Gate Tests", () => {
  describe("Positive Emergency Red-Flag Detection", () => {
    test("detects chest pain in English", () => {
      const res = evaluateSafety("Patient has severe crushing chest pain since 15 minutes");
      assert.equal(res.is_emergency, true);
      assert.equal(res.state, "CONFIRMED");
      assert.ok(res.red_flags.includes("chest_pain"));
      assert.equal(res.emergency_action.call, "112");
    });

    test("detects chest pain in Hinglish (seene me dard)", () => {
      const res = evaluateSafety("Papa ko seene me bohot tez dard ho raha hai");
      assert.equal(res.is_emergency, true);
      assert.ok(res.red_flags.includes("chest_pain"));
    });

    test("detects chest pain with typos (sine me drd)", () => {
      const res = evaluateSafety("mere sine me drd hai bohot");
      assert.equal(res.is_emergency, true);
      assert.ok(res.red_flags.includes("chest_pain"));
    });

    test("detects chest pain in Devanagari", () => {
      const res = evaluateSafety("सीने में तेज दर्द हो रहा है");
      assert.equal(res.is_emergency, true);
      assert.ok(res.red_flags.includes("chest_pain"));
    });

    test("detects respiratory distress (saans phool rahi hai)", () => {
      const res = evaluateSafety("Dadi ki saans phool rahi hai aur dam ghut raha hai");
      assert.equal(res.is_emergency, true);
      assert.ok(res.red_flags.includes("severe_breathlessness"));
    });

    test("detects unconsciousness (behosh ho gaya)", () => {
      const res = evaluateSafety("Mera bhai achanak behosh ho gaya");
      assert.equal(res.is_emergency, true);
      assert.ok(res.red_flags.includes("unconsciousness_unresponsive"));
    });

    test("detects severe bleeding (khoon ki ulti)", () => {
      const res = evaluateSafety("Patient ko khoon ki ulti ho rahi hai");
      assert.equal(res.is_emergency, true);
      assert.ok(res.red_flags.includes("severe_bleeding"));
    });

    test("detects stroke symptoms (muh tedha aur lakwa)", () => {
      const res = evaluateSafety("Mother ka muh tedha ho gaya hai aur ek taraf kamzori hai");
      assert.equal(res.is_emergency, true);
      assert.ok(res.red_flags.includes("stroke_symptoms"));
    });
  });

  describe("Inverse Negation / Inability Expressions (Crucial Hindi Safety Test)", () => {
    test("detects respiratory inability: saans nahi le pa raha (MUST be an emergency)", () => {
      const res = evaluateSafety("Patient saans nahi le pa raha hai");
      assert.equal(res.is_emergency, true);
      assert.ok(res.red_flags.includes("severe_breathlessness"));
    });

    test("detects consciousness inability: hosh me nahi hai (MUST be an emergency)", () => {
      const res = evaluateSafety("Wo hosh me nahi hai bilkul bhi");
      assert.equal(res.is_emergency, true);
      assert.ok(res.red_flags.includes("unconsciousness_unresponsive"));
    });

    test("detects speech inability: bol nahi pa rahe (MUST be an emergency)", () => {
      const res = evaluateSafety("Dadaji bol nahi pa rahe hain achanak se");
      assert.equal(res.is_emergency, true);
      assert.ok(res.red_flags.includes("stroke_symptoms"));
    });
  });

  describe("Negation Handling (Suppresses false emergency alarms)", () => {
    test("suppresses emergency when chest pain is negated in English (no chest pain)", () => {
      const res = evaluateSafety("Mild cough and fever, no chest pain reported");
      assert.equal(res.is_emergency, false);
      assert.equal(res.red_flags.length, 0);
    });

    test("suppresses emergency when chest pain is negated in Hinglish (seene me dard nahi hai)", () => {
      const res = evaluateSafety("Bukhar hai do din se par seene me dard nahi hai");
      assert.equal(res.is_emergency, false);
      assert.equal(res.red_flags.length, 0);
    });

    test("suppresses emergency for 'koi takleef nahi'", () => {
      const res = evaluateSafety("Papa ko bukhar hai, saans lene me koi takleef nahi hai");
      assert.equal(res.is_emergency, false);
      assert.equal(res.red_flags.length, 0);
    });

    test("handles clause conjunction correctly: bukhar hai lekin chest pain nahi hai", () => {
      const res = evaluateSafety("Bukhar hai aur khansi hai lekin chest pain nahi hai");
      assert.equal(res.is_emergency, false);
      assert.equal(res.red_flags.length, 0);
    });
  });

  describe("Non-emergency / Routine Cases", () => {
    test("routine fever and cough is NOT an emergency", () => {
      const res = evaluateSafety("Papa ko do din se bukhar hai aur halki khansi hai");
      assert.equal(res.is_emergency, false);
      assert.equal(res.state, "NONE");
      assert.equal(res.red_flags.length, 0);
    });
  });
});
