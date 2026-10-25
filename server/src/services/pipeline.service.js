/**
 * CURA Unified Decision Pipeline Engine
 * Implements the core pipeline: Intake -> Safety Gate -> ML Triage -> Caregiver Matching.
 * As defined in Strategy Document §7.1 and §11.5:
 * Single authoritative pipeline serving official API, UI triage, and batch evaluations.
 */

const { CARE_TYPES, URGENCIES } = require("../config/taxonomy");
const { processIntake } = require("./intake.service");
const { evaluateSafety } = require("./safetyGate.service");
const mlTriageService = require("./mlTriage.service");
const caregiverMatchingService = require("./caregiverMatching.service");
const { hasHealthConcernInConversation } = require("../utils/healthInput");

const INVALID_HEALTH_INPUT_MESSAGE = "Please describe a health concern or symptom so CURA can assist you. You can describe what you or someone else is experiencing in English, Hindi, or Hinglish.";
const CARE_PATHWAY_LABELS = {
  [CARE_TYPES.PARAMEDIC_HOME_VISIT]: "a paramedic home visit",
  [CARE_TYPES.NURSE_VISIT]: "a nursing visit",
  [CARE_TYPES.GP_TELECONSULT]: "a general physician teleconsultation",
  [CARE_TYPES.SPECIALIST_CONSULT]: "a specialist consultation",
  [CARE_TYPES.EMERGENCY_REFERRAL]: "emergency evaluation"
};

/**
 * Runs the end-to-end CURA navigation pipeline
 *
 * @param {object} request
 * @param {string} request.user_input - Current message
 * @param {string} [request.language] - Language hint
 * @param {object} [request.location] - { lat, lng }
 * @param {Array<object>} [request.conversation_history] - Multi-turn messages
 * @returns {Promise<object>} { decision, trace }
 */
async function runPipeline(request) {
  const startTime = Date.now();
  const requestId = `req_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

  const userInput = request.user_input || "";
  const conversationHistory = request.conversation_history || [];

  if (!hasHealthConcernInConversation(userInput, conversationHistory)) {
    const error = new Error(INVALID_HEALTH_INPUT_MESSAGE);
    error.statusCode = 400;
    error.code = "INVALID_HEALTH_INPUT";
    throw error;
  }

  // Step 1: Pre-scan for emergency to know if follow-up should be suppressed
  const initialSafety = evaluateSafety(userInput);

  // Step 2: Smart Intake & Conversation Context Consolidation
  const intake = processIntake({
    user_input: userInput,
    language: request.language,
    conversation_history: conversationHistory,
    has_emergency_red_flag: initialSafety.is_emergency
  });

  // Step 3: Full Independent Deterministic Safety Gate Evaluation
  // Evaluate each turn independently so a later denial cannot erase a prior red flag.
  const safetyText = intake.affirmative_headache_warning
    ? `${intake.full_text} sudden severe headache`
    : intake.affirmative_breathing_or_chest_check
      ? `${intake.full_text} severe shortness of breath`
      : intake.full_text;
  const userMessages = [
    ...conversationHistory.filter((message) => message.role === "user").map((message) => message.content),
    userInput
  ];
  const turnSafetyResults = userMessages.map((message) => evaluateSafety(message)).filter((result) => result.is_emergency);
  if (intake.affirmative_headache_warning) {
    turnSafetyResults.push(evaluateSafety("sudden severe headache"));
  }
  if (intake.affirmative_breathing_or_chest_check) {
    turnSafetyResults.push(evaluateSafety("severe shortness of breath"));
  }
  const safetyResult = turnSafetyResults.length > 0
    ? {
      ...turnSafetyResults[0],
      red_flags: [...new Set(turnSafetyResults.flatMap((result) => result.red_flags))]
    }
    : evaluateSafety(safetyText);

  // BRANCH A: Emergency Red Flag Triggered
  if (safetyResult.is_emergency) {
    const latencyMs = Date.now() - startTime;
    const decision = {
      follow_up_question: null,
      care_type: CARE_TYPES.EMERGENCY_REFERRAL,
      urgency: URGENCIES.IMMEDIATE,
      red_flags: safetyResult.red_flags,
      reasoning: safetyResult.reasoning,
      emergency_action: safetyResult.emergency_action,
      matched_caregivers: [] // Emergency cases strictly bypass routine caregiver matching
    };

    const trace = {
      request_id: requestId,
      branch: "emergency",
      latency_ms: latencyMs,
      language: intake.language,
      safety_state: safetyResult.state,
      red_flags: safetyResult.red_flags,
      source: "safety_gate_rules"
    };

    return { decision, trace };
  }

  // BRANCH B: Disambiguation Follow-Up Question
  if (intake.follow_up_question) {
    const latencyMs = Date.now() - startTime;
    const decision = {
      follow_up_question: intake.follow_up_question,
      care_type: null,
      urgency: null,
      red_flags: [],
      reasoning: "Clarification requested to determine optimal care level and urgency.",
      matched_caregivers: []
    };

    const trace = {
      request_id: requestId,
      branch: "follow_up",
      latency_ms: latencyMs,
      language: intake.language,
      safety_state: safetyResult.state,
      questions_asked: intake.questions_asked_count + 1,
      source: "intake_disambiguation"
    };

    return { decision, trace };
  }

  if (!intake.is_ready_for_triage) {
    const latencyMs = Date.now() - startTime;
    return {
      decision: {
        follow_up_question: null,
        care_type: null,
        urgency: null,
        red_flags: [],
        reasoning: "There is not enough consistent information to safely determine an appropriate care pathway. No diagnosis or caregiver recommendation has been made. Please seek evaluation from a qualified healthcare professional; if symptoms become severe or urgent, contact local emergency services.",
        matched_caregivers: []
      },
      trace: {
        request_id: requestId,
        branch: "insufficient_information",
        latency_ms: latencyMs,
        language: intake.language,
        source: "intake_safety_gate"
      }
    };
  }

  // BRANCH C: Final Care Triage & Caregiver Matching
  const triageResult = await mlTriageService.predictTriage({
    text: intake.full_text,
    language: intake.language,
    symptoms: intake.symptoms,
    duration: intake.duration
  });

  // Perform explainable caregiver matching
  const matchedCaregivers = caregiverMatchingService.matchCaregivers({
    care_type: triageResult.care_type,
    urgency: triageResult.urgency,
    user_location: request.location,
    require_service_location: request.require_service_location,
    language: intake.language
  });

  const latencyMs = Date.now() - startTime;
  const decision = {
    follow_up_question: null,
    care_type: triageResult.care_type,
    urgency: triageResult.urgency,
    red_flags: [],
    reasoning: `Based on the information provided, the suggested next step is ${CARE_PATHWAY_LABELS[triageResult.care_type] || "evaluation by a healthcare professional"}. This is care-navigation guidance, not a confirmed diagnosis; a qualified healthcare professional can assess the symptoms.`,
    matched_caregivers: matchedCaregivers
  };

  const trace = {
    request_id: requestId,
    branch: "final",
    latency_ms: latencyMs,
    language: intake.language,
    confidence: triageResult.confidence,
    ml_source: triageResult.source,
    matches_count: matchedCaregivers.length
  };

  return { decision, trace };
}

module.exports = {
  runPipeline
};
