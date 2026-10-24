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

/**
 * Runs the end-to-end CURA navigation pipeline
 *
 * @param {object} request
 * @param {string} request.user_input - Current message
 * @param {string} [request.language] - Language hint
 * @param {object} [request.location] - { lat, lng }
 * @param {Array<object>} [request.conversation_history] - Multi-turn messages
 * @param {boolean} [force_final=false] - If true, bypasses follow-up questions
 * @returns {Promise<object>} { decision, trace }
 */
async function runPipeline(request, force_final = false) {
  const startTime = Date.now();
  const requestId = `req_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

  const userInput = request.user_input || "";
  const conversationHistory = request.conversation_history || [];

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
  // Evaluates complete conversation context
  const safetyResult = evaluateSafety(intake.full_text);

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
  if (!force_final && intake.follow_up_question) {
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
    language: intake.language
  });

  const latencyMs = Date.now() - startTime;
  const decision = {
    follow_up_question: null,
    care_type: triageResult.care_type,
    urgency: triageResult.urgency,
    red_flags: [],
    reasoning: triageResult.reasoning,
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
