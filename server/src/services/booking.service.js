/**
 * CURA Demo Booking Store & Overlay Service
 * Manages demo bookings and prevents slot collisions.
 * In accordance with Strategy §10.4, booked slots are removed from availability
 * and can be reset for evaluation via /api/demo/reset.
 */

const fs = require("fs");
const path = require("path");
const env = require("../config/env");

class BookingService {
  constructor() {
    this.overlayPath = env.BOOKINGS_OVERLAY_PATH;
    this.bookings = [];
    this.bookedSlots = new Set();
    this.initStore();
  }

  /**
   * Initializes or loads the booking overlay from disk
   */
  initStore() {
    if (fs.existsSync(this.overlayPath)) {
      const raw = fs.readFileSync(this.overlayPath, "utf-8");
      const bookings = JSON.parse(raw);
      if (!Array.isArray(bookings)) {
        throw new Error(`Booking overlay at ${this.overlayPath} must contain a JSON array`);
      }
      this.bookings = bookings;
      this.bookedSlots = new Set(bookings.map((booking) => booking.slot_id));
    } else {
      this.bookings = [];
      this.bookedSlots = new Set();
      this.saveStore();
    }
  }

  /**
   * Persists bookings to disk
   */
  saveStore() {
    let temporaryPath;
    try {
      const dir = path.dirname(this.overlayPath);
      fs.mkdirSync(dir, { recursive: true });
      temporaryPath = `${this.overlayPath}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(temporaryPath, JSON.stringify(this.bookings, null, 2), { encoding: "utf-8", flag: "wx" });
      fs.renameSync(temporaryPath, this.overlayPath);
    } catch (err) {
      if (temporaryPath) {
        try {
          fs.rmSync(temporaryPath, { force: true });
        } catch {}
      }
      err.code = "BOOKING_PERSISTENCE_FAILED";
      throw err;
    }
  }

  /**
   * Returns whether a slot is currently booked
   * @param {string} slotId
   */
  isSlotBooked(slotId) {
    return this.bookedSlots.has(slotId);
  }

  isSlotAvailable(slotId) {
    return !env.BOOKINGS_AFFECT_AVAILABILITY || !this.isSlotBooked(slotId);
  }

  /**
   * Creates a demo booking
   * @param {object} bookingData
   */
  createBooking({ caregiver_id, slot_id, caregiver_name, slot_time, patient_name, notes, user_id }) {
    if (this.isSlotBooked(slot_id)) {
      const error = new Error(`Slot ${slot_id} is already booked or no longer available`);
      error.statusCode = 409;
      throw error;
    }

    const bookingId = `BK_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const newBooking = {
      booking_id: bookingId,
      caregiver_id,
      caregiver_name: caregiver_name || "Caregiver",
      slot_id,
      slot_time: slot_time || "Scheduled Time",
      patient_name: patient_name || "Demo Patient",
      notes: notes || "Demo booking",
      status: "confirmed",
      booked_at: new Date().toISOString()
    };
    if (user_id) newBooking.user_id = user_id;

    const nextBookings = [...this.bookings, newBooking];
    this.persistBookings(nextBookings);
    const publicBooking = { ...newBooking };
    delete publicBooking.user_id;

    return {
      success: true,
      booking: publicBooking,
      notice: "Demo booking confirmed (Prototype only - not a real clinical appointment)"
    };
  }

  /**
   * Returns all active bookings
   */
  getAllBookings() {
    return [...this.bookings];
  }

  getBookingsForUser(userId) {
    return this.bookings
      .filter((booking) => booking.user_id === userId)
      .sort((first, second) => Date.parse(second.booked_at) - Date.parse(first.booked_at));
  }

  /**
   * Resets all demo bookings (restores original availability)
   */
  resetStore() {
    this.persistBookings([]);
    return {
      success: true,
      message: "All demo bookings cleared. Original caregiver slot availability restored."
    };
  }

  persistBookings(bookings) {
    const previousBookings = this.bookings;
    this.bookings = bookings;
    try {
      this.saveStore();
      this.bookedSlots = new Set(bookings.map((booking) => booking.slot_id));
    } catch (err) {
      this.bookings = previousBookings;
      throw err;
    }
  }
}

// Singleton instance
const bookingService = new BookingService();
module.exports = bookingService;
