/**
 * CURA Triage Controller
 * Handles official scoring endpoint and extended UI triage endpoint with trace.
 */

const { runPipeline } = require("../services/pipeline.service");
const { EMERGENCY_PROTOCOL } = require("../config/safetyRules");

/**
 * Official Triage Endpoint: POST /api/triage
 * Strictly conforms to the official CAI Problem Statement JSON Schema (Page 4).
 */
async function handleOfficialTriage(req, res, next) {
  try {
    const { decision } = await runPipeline(req.body);

    // Filter matched caregivers to official output shape
    const formattedCaregivers = (decision.matched_caregivers || []).map((cg) => ({
      caregiver_id: cg.caregiver_id,
      score: cg.score,
      reason: cg.reason
    }));

    const responsePayload = {
      follow_up_question: decision.follow_up_question,
      care_type: decision.care_type,
      urgency: decision.urgency,
      red_flags: decision.red_flags,
      reasoning: decision.reasoning,
      matched_caregivers: formattedCaregivers
    };

    if (decision.emergency_action) {
      responsePayload.emergency_action = decision.emergency_action;
    }

    return res.status(200).json(responsePayload);
  } catch (err) {
    next(err);
  }
}

/**
 * UI Triage Endpoint: POST /api/ui/triage
 * Returns official decision along with extended metadata and trace for frontend display.
 */
async function handleUiTriage(req, res, next) {
  try {
    const { decision, trace } = await runPipeline(req.body);

    return res.status(200).json({
      success: true,
      decision,
      trace
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Emergency Escalation Endpoint: POST /api/emergency/escalate
 * Direct emergency assistance route that returns 112 guidance and immediate triage steps.
 */
async function handleEmergencyEscalate(req, res, next) {
  try {
    const { red_flags, patient_location, notes } = req.body;

    return res.status(200).json({
      success: true,
      emergency: true,
      care_type: "emergency_referral",
      urgency: "immediate",
      red_flags: red_flags || ["user_initiated_escalation"],
      emergency_action: {
        primary_number: EMERGENCY_PROTOCOL.primary_number,
        ambulance_number: EMERGENCY_PROTOCOL.ambulance_number,
        instructions: EMERGENCY_PROTOCOL.steps
      },
      patient_location: patient_location || null,
      message: "Emergency escalation active. Contact emergency services immediately."
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  handleOfficialTriage,
  handleUiTriage,
  handleEmergencyEscalate
};
