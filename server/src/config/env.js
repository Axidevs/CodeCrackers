const path = require("path");
require("dotenv").config();

const env = {
  PORT: parseInt(process.env.PORT, 10) || 5001,
  NODE_ENV: process.env.NODE_ENV || "development",
  CORS_ORIGINS: (process.env.CORS_ORIGINS || "http://localhost:3000,http://127.0.0.1:3000").split(",").map((origin) => origin.trim()).filter(Boolean),
  SMS_PROVIDER: process.env.SMS_PROVIDER || "",
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID || "",
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN || "",
  TWILIO_VERIFY_SERVICE_SID: process.env.TWILIO_VERIFY_SERVICE_SID || "",
  AUTH_STORE_PATH: process.env.AUTH_STORE_PATH || path.join(__dirname, "../data/auth_store.json"),
  OTP_TTL_SECONDS: parseInt(process.env.OTP_TTL_SECONDS, 10) || 300,
  OTP_REQUEST_LIMIT: parseInt(process.env.OTP_REQUEST_LIMIT, 10) || 3,
  OTP_REQUEST_WINDOW_SECONDS: parseInt(process.env.OTP_REQUEST_WINDOW_SECONDS, 10) || 900,
  OTP_VERIFY_ATTEMPT_LIMIT: parseInt(process.env.OTP_VERIFY_ATTEMPT_LIMIT, 10) || 5,
  AUTH_SESSION_TTL_DAYS: parseInt(process.env.AUTH_SESSION_TTL_DAYS, 10) || 30,
  ML_SERVICE_URL: process.env.ML_SERVICE_URL || "http://localhost:8000/predict",
  ML_SERVICE_TIMEOUT_MS: parseInt(process.env.ML_SERVICE_TIMEOUT_MS, 10) || 2000,
  EMERGENCY_NUMBER: process.env.EMERGENCY_NUMBER || "112",
  AMBULANCE_NUMBER: process.env.AMBULANCE_NUMBER || "108",
  DATASET_PATH: process.env.DATASET_PATH || path.join(__dirname, "../../data/caregivers.csv"),
  BOOKINGS_OVERLAY_PATH: process.env.BOOKINGS_OVERLAY_PATH || path.join(__dirname, "../data/bookings_overlay.json"),
  BOOKINGS_AFFECT_AVAILABILITY: process.env.BOOKINGS_AFFECT_AVAILABILITY !== "false",
  DEFAULT_LOCATION: {
    lat: 28.545,
    lng: 77.272,
    city: "New Delhi"
  }
};

module.exports = env;
