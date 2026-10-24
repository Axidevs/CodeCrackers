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
    try {
      if (fs.existsSync(this.overlayPath)) {
        const raw = fs.readFileSync(this.overlayPath, "utf-8");
        this.bookings = JSON.parse(raw);
        this.bookedSlots = new Set(this.bookings.map((b) => b.slot_id));
      } else {
        this.bookings = [];
        this.bookedSlots = new Set();
        this.saveStore();
      }
    } catch (err) {
      console.warn("Could not read booking overlay, initializing empty store:", err.message);
      this.bookings = [];
      this.bookedSlots = new Set();
    }
  }

  /**
   * Persists bookings to disk
   */
  saveStore() {
    try {
      const dir = path.dirname(this.overlayPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.overlayPath, JSON.stringify(this.bookings, null, 2), "utf-8");
    } catch (err) {
      console.error("Failed to save booking overlay to disk:", err.message);
    }
  }

  /**
   * Returns whether a slot is currently booked
   * @param {string} slotId
   */
  isSlotBooked(slotId) {
    if (!env.BOOKINGS_AFFECT_AVAILABILITY) {
      return false;
    }
    return this.bookedSlots.has(slotId);
  }

  /**
   * Creates a demo booking
   * @param {object} bookingData
   */
  createBooking({ caregiver_id, slot_id, caregiver_name, slot_time, patient_name, notes }) {
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

    this.bookings.push(newBooking);
    this.bookedSlots.add(slot_id);
    this.saveStore();

    return {
      success: true,
      booking: newBooking,
      notice: "Demo booking confirmed (Prototype only - not a real clinical appointment)"
    };
  }

  /**
   * Returns all active bookings
   */
  getAllBookings() {
    return [...this.bookings];
  }

  /**
   * Resets all demo bookings (restores original availability)
   */
  resetStore() {
    this.bookings = [];
    this.bookedSlots.clear();
    this.saveStore();
    return {
      success: true,
      message: "All demo bookings cleared. Original caregiver slot availability restored."
    };
  }
}

// Singleton instance
const bookingService = new BookingService();
module.exports = bookingService;
