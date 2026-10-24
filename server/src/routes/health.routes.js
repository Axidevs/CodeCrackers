/**
 * CURA Health Check Route
 */

const express = require("express");
const router = express.Router();

router.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    service: "CURA CareCompass Backend",
    status: "healthy",
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
