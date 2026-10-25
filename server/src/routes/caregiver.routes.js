/**
 * CURA Caregiver & Booking Routes
 */

const express = require("express");
const router = express.Router();
const {
  getCaregivers,
  getCaregiverById,
  createBooking,
  getMyBookings,
  resetDemoBookings
} = require("../controllers/caregiver.controller");
const { validateBody } = require("../middleware/validate");
const { BookingRequestSchema } = require("../utils/schemas");
const { requireAuth, loadOptionalAuth, requireTrustedOrigin } = require("../middleware/auth");

// Caregiver listing & details
router.get("/caregivers", getCaregivers);
router.get("/caregivers/:id", getCaregiverById);

// Demo booking & reset
router.get("/bookings/me", requireAuth, getMyBookings);
router.post("/booking", requireTrustedOrigin, loadOptionalAuth, validateBody(BookingRequestSchema), createBooking);
router.post("/demo/reset", resetDemoBookings);

module.exports = router;
