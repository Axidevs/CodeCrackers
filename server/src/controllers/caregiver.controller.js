/**
 * CURA Caregiver & Booking Controller
 */

const caregiverDataService = require("../services/caregiverData.service");
const bookingService = require("../services/booking.service");

/**
 * GET /api/caregivers
 * Returns read-only list of available caregivers (with filters)
 */
function getCaregivers(req, res, next) {
  try {
    const { role, language } = req.query;
    let caregivers = caregiverDataService.getAll();

    if (role) {
      caregivers = caregivers.filter((c) => (c.role || "").toLowerCase() === role.toLowerCase());
    }

    if (language) {
      caregivers = caregivers.filter((c) =>
        (c.languages || []).some((l) => l.toLowerCase() === language.toLowerCase())
      );
    }

    // Annotate with current booked status for slots
    const sanitized = caregivers.map((c) => ({
      ...c,
      availability_slots: (c.availability_slots || []).map((slot) => ({
        ...slot,
        is_booked: !bookingService.isSlotAvailable(slot.slot_id)
      }))
    }));

    return res.status(200).json({
      success: true,
      count: sanitized.length,
      caregivers: sanitized
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/caregivers/:id
 * Returns single caregiver profile by ID
 */
function getCaregiverById(req, res, next) {
  try {
    const { id } = req.params;
    const caregiver = caregiverDataService.getById(id);

    if (!caregiver) {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: `Caregiver with ID '${id}' not found` }
      });
    }

    return res.status(200).json({
      success: true,
      caregiver: {
        ...caregiver,
        availability_slots: (caregiver.availability_slots || []).map((slot) => ({
          ...slot,
          is_booked: !bookingService.isSlotAvailable(slot.slot_id)
        }))
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/booking
 * Creates a demo slot booking with concurrency / double-booking check
 */
function createBooking(req, res, next) {
  try {
    const { caregiver_id, slot_id, caregiver_name, slot_time, patient_name, notes } = req.body;

    // Verify caregiver exists
    const caregiver = caregiverDataService.getById(caregiver_id);
    if (!caregiver) {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: `Caregiver with ID '${caregiver_id}' not found` }
      });
    }

    // Verify slot exists for this caregiver
    const slot = (caregiver.availability_slots || []).find((s) => s.slot_id === slot_id);
    if (!slot) {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: `Slot '${slot_id}' does not belong to caregiver '${caregiver_id}'` }
      });
    }

    const result = bookingService.createBooking({
      caregiver_id,
      slot_id,
      caregiver_name: caregiver_name || caregiver.name,
      slot_time: slot_time || [slot.date, slot.time].filter(Boolean).join(" "),
      patient_name,
      notes
    });

    return res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/demo/reset
 * Resets demo booking overlay (restores initial slot availability)
 */
function resetDemoBookings(req, res, next) {
  try {
    const result = bookingService.resetStore();
    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getCaregivers,
  getCaregiverById,
  createBooking,
  resetDemoBookings
};
