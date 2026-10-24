/**
 * CURA Triage & Emergency Routes
 */

const express = require("express");
const router = express.Router();
const { handleOfficialTriage, handleUiTriage, handleEmergencyEscalate } = require("../controllers/triage.controller");
const { validateBody } = require("../middleware/validate");
const { TriageRequestSchema, EmergencyEscalationSchema } = require("../utils/schemas");

// Official CAI Triage Endpoint
router.post("/triage", validateBody(TriageRequestSchema), handleOfficialTriage);

// UI Triage Endpoint with Debug Trace
router.post("/ui/triage", validateBody(TriageRequestSchema), handleUiTriage);

// Emergency Escalation Endpoint
router.post("/emergency/escalate", validateBody(EmergencyEscalationSchema), handleEmergencyEscalate);

module.exports = router;
