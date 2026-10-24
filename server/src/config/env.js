const path = require("path");
require("dotenv").config();

const env = {
  PORT: parseInt(process.env.PORT, 10) || 5001,
  NODE_ENV: process.env.NODE_ENV || "development",
  ML_SERVICE_URL: process.env.ML_SERVICE_URL || "http://localhost:8000/predict",
  ML_SERVICE_TIMEOUT_MS: parseInt(process.env.ML_SERVICE_TIMEOUT_MS, 10) || 2000,
  EMERGENCY_NUMBER: process.env.EMERGENCY_NUMBER || "112",
  AMBULANCE_NUMBER: process.env.AMBULANCE_NUMBER || "108",
  DATASET_PATH: process.env.DATASET_PATH || path.join(__dirname, "../data/caregivers.json"),
  BOOKINGS_OVERLAY_PATH: process.env.BOOKINGS_OVERLAY_PATH || path.join(__dirname, "../data/bookings_overlay.json"),
  BOOKINGS_AFFECT_AVAILABILITY: process.env.BOOKINGS_AFFECT_AVAILABILITY !== "false",
  DEFAULT_LOCATION: {
    lat: 28.545,
    lng: 77.272,
    city: "New Delhi"
  }
};

module.exports = env;
