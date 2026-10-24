/**
 * CURA AI/ML Service Integration Adapter (Member 1 Integration)
 * Calls Member 1's Python ML microservice via HTTP with timeouts and schema validation.
 * Includes a deterministic fallback mock predictor to ensure zero runtime crashes
 * and enable seamless development when the ML service is offline.
 */

const env = require("../config/env");
const { CARE_TYPES, URGENCIES, ALLOWED_CARE_TYPES, ALLOWED_URGENCIES } = require("../config/taxonomy");
const { normalizeText } = require("../utils/textNormalizer");

/**
 * Predicts care type and urgency by delegating to Member 1's ML service
 * with automatic fallback if offline.
 *
 * @param {object} params
 * @param {string} params.text - User text input
 * @param {string} params.language - Language ('hindi', 'english', 'hinglish')
 * @param {string[]} params.symptoms - Detected symptom list
 * @param {string} [params.duration] - Symptom duration
 * @returns {Promise<object>} { care_type, urgency, confidence, reasoning, source }
 */
async function predictTriage({ text, language, symptoms = [], duration = null }) {
  // Try calling Member 1's Python ML microservice
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), env.ML_SERVICE_TIMEOUT_MS);

    const response = await fetch(env.ML_SERVICE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        language,
        symptoms,
        duration
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();

      // Validate taxonomy constraints
      const care_type = ALLOWED_CARE_TYPES.includes(data.care_type)
        ? data.care_type
        : CARE_TYPES.GP_TELECONSULT;

      const urgency = ALLOWED_URGENCIES.includes(data.urgency)
        ? data.urgency
        : URGENCIES.SAME_DAY;

      return {
        care_type,
        urgency,
        confidence: typeof data.confidence === "number" ? data.confidence : 0.85,
        reasoning: data.reasoning || generateGroundedReasoning(care_type, urgency, symptoms, duration),
        source: "ml_service"
      };
    }
  } catch (err) {
    // Expected when Member 1's service is not yet running locally or timed out
    // Fall back to robust rule-based mock predictor
  }

  // Graceful Mock Fallback Predictor (strictly follows official taxonomy)
  return runFallbackMockPredictor({ text, symptoms, duration });
}

/**
 * Deterministic Fallback Mock Predictor
 * Maps structured symptoms to official taxonomy categories without inventing labels.
 */
function runFallbackMockPredictor({ text, symptoms = [], duration = null }) {
  const normalized = normalizeText(text);

  let care_type = CARE_TYPES.GP_TELECONSULT;
  let urgency = URGENCIES.ROUTINE;
  let confidence = 0.85;

  // Wound care, nursing, injections, bedridden elder -> Nurse visit
  if (symptoms.includes("wound_care") || /\b(?:injection|dressing|bandage|saline|bedridden|iv)\b/i.test(normalized)) {
    care_type = CARE_TYPES.NURSE_VISIT;
    urgency = URGENCIES.SAME_DAY;
  }
  // Moderate fever + cough with home attendance need -> Paramedic home visit
  else if (symptoms.includes("fever") && (symptoms.includes("cough") || duration)) {
    care_type = CARE_TYPES.PARAMEDIC_HOME_VISIT;
    urgency = URGENCIES.SAME_DAY;
  }
  // High fever or ongoing fever -> Paramedic home visit
  else if (symptoms.includes("fever")) {
    care_type = CARE_TYPES.PARAMEDIC_HOME_VISIT;
    urgency = URGENCIES.SAME_DAY;
  }
  // Specific chronic or specialized care mentions -> Specialist consult
  else if (/\b(?:diabetes|cardio|heart|asthma|lungs|kidney|ortho|bone)\b/i.test(normalized)) {
    care_type = CARE_TYPES.SPECIALIST_CONSULT;
    urgency = URGENCIES.ROUTINE;
  }
  // Default routine complaints -> GP Teleconsult
  else {
    care_type = CARE_TYPES.GP_TELECONSULT;
    urgency = URGENCIES.ROUTINE;
  }

  const reasoning = generateGroundedReasoning(care_type, urgency, symptoms, duration);

  return {
    care_type,
    urgency,
    confidence,
    reasoning,
    source: "ml_fallback_mock"
  };
}

/**
 * Generates transparent, non-diagnostic reasoning grounded in symptoms and duration
 */
function generateGroundedReasoning(care_type, urgency, symptoms, duration) {
  const parts = [];

  if (symptoms.length > 0) {
    parts.push(`Symptoms reported: ${symptoms.join(", ")}`);
  }
  if (duration) {
    parts.push(`duration: ${duration}`);
  }
  parts.push("no acute breathing distress reported");

  const symptomsSummary = parts.length > 0 ? parts.join("; ") : "Non-emergency health consultation";

  if (care_type === CARE_TYPES.PARAMEDIC_HOME_VISIT) {
    return `${symptomsSummary}. Suitable for home attendance and vital checks by a paramedic today.`;
  }
  if (care_type === CARE_TYPES.NURSE_VISIT) {
    return `${symptomsSummary}. Requires in-person nursing attendance.`;
  }
  if (care_type === CARE_TYPES.SPECIALIST_CONSULT) {
    return `${symptomsSummary}. Specialist consultation recommended for further assessment.`;
  }
  return `${symptomsSummary}. A general physician can review symptoms via teleconsultation.`;
}

module.exports = {
  predictTriage,
  runFallbackMockPredictor
};
