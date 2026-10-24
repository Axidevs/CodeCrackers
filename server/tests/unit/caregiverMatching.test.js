const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { matchCaregivers } = require("../../src/services/caregiverMatching.service");
const bookingService = require("../../src/services/booking.service");

describe("Caregiver Matching Engine Tests", () => {
  beforeEach(() => {
    bookingService.resetStore();
  });

  test("matches paramedic for paramedic_home_visit", () => {
    const results = matchCaregivers({
      care_type: "paramedic_home_visit",
      urgency: "same_day",
      user_location: { lat: 28.54, lng: 77.27 },
      language: "hindi"
    });

    assert.ok(results.length > 0, "Should return at least one paramedic");
    const top = results[0];
    assert.equal(top.role, "paramedic");
    assert.ok(top.score > 0.5, "Score should be positive");
    assert.ok(typeof top.reason === "string" && top.reason.length > 0, "Reason must be present");
    assert.ok(top.reason.includes("free at"), "Reason should include availability");
  });

  test("matches GP for gp_teleconsult", () => {
    const results = matchCaregivers({
      care_type: "gp_teleconsult",
      urgency: "routine",
      language: "english"
    });

    assert.ok(results.length > 0, "Should return GP matches");
    const top = results[0];
    assert.equal(top.role, "gp");
    assert.ok(top.reason.includes("teleconsult"));
  });

  test("EMERGENCY MUST NEVER receive routine caregiver matches", () => {
    const results = matchCaregivers({
      care_type: "emergency_referral",
      urgency: "immediate",
      user_location: { lat: 28.54, lng: 77.27 }
    });

    assert.deepEqual(results, [], "Emergency must return strictly empty caregivers list");
  });

  test("returns empty list honestly when care type has no matching roles", () => {
    const results = matchCaregivers({
      care_type: "unsupported_care_type",
      urgency: "routine"
    });

    assert.deepEqual(results, [], "Unsupported role must return empty list");
  });

  test("booking a slot prevents double booking and updates available matches", () => {
    // 1. Initial match for paramedic
    const results = matchCaregivers({
      care_type: "paramedic_home_visit",
      urgency: "same_day",
      user_location: { lat: 28.54, lng: 77.27 }
    });
    const top = results[0];
    const slotId = top.earliest_slot.slot_id;

    // 2. Book this slot
    bookingService.createBooking({
      caregiver_id: top.caregiver_id,
      slot_id: slotId,
      caregiver_name: top.name,
      patient_name: "Test Patient"
    });

    // 3. Second booking attempt for same slot should fail with 409
    assert.throws(
      () => {
        bookingService.createBooking({
          caregiver_id: top.caregiver_id,
          slot_id: slotId
        });
      },
      (err) => err.statusCode === 409
    );

    // 4. Re-run match: that specific slot should no longer be earliest
    const updatedResults = matchCaregivers({
      care_type: "paramedic_home_visit",
      urgency: "same_day",
      user_location: { lat: 28.54, lng: 77.27 }
    });
    const updatedTop = updatedResults.find((c) => c.caregiver_id === top.caregiver_id);
    if (updatedTop) {
      assert.notEqual(updatedTop.earliest_slot.slot_id, slotId, "Booked slot should no longer be offered");
    }
  });
});
