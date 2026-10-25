/**
 * Central API Router Aggregator
 */

const express = require("express");
const router = express.Router();

const healthRoutes = require("./health.routes");
const triageRoutes = require("./triage.routes");
const caregiverRoutes = require("./caregiver.routes");
const authRoutes = require("./auth.routes");

router.use("/", healthRoutes);
router.use("/", triageRoutes);
router.use("/", caregiverRoutes);
router.use("/", authRoutes);

module.exports = router;
