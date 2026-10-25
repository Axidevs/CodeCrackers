const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { matchCaregivers } = require("../../src/services/caregiverMatching.service");
const bookingService = require("../../src/services/booking.service");
const caregiverDataService = require("../../src/services/caregiverData.service");
const matchingConfig = require("../../src/config/matchingWeights");

let temporaryBookingStore;
let originalBookingStore;

describe("Caregiver Matching Engine Tests", () => {
  beforeEach(() => {
    temporaryBookingStore = fs.mkdtempSync(path.join(os.tmpdir(), "cura-matching-suite-"));
    originalBookingStore = {
      path: bookingService.overlayPath,
      bookings: bookingService.bookings,
      bookedSlots: bookingService.bookedSlots
    };
    bookingService.overlayPath = path.join(temporaryBookingStore, "bookings.json");
    bookingService.bookings = [];
    bookingService.bookedSlots = new Set();
    bookingService.resetStore();
  });

  afterEach(() => {
    bookingService.overlayPath = originalBookingStore.path;
    bookingService.bookings = originalBookingStore.bookings;
    bookingService.bookedSlots = originalBookingStore.bookedSlots;
    fs.rmSync(temporaryBookingStore, { recursive: true, force: true });
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
    assert.equal(top.role, "medic");
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
    assert.equal(top.role, "doctor");
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

  test("requires confirmed coordinates before showing signed-in in-person service matches", () => {
    const withoutLocation = matchCaregivers({
      care_type: "paramedic_home_visit",
      urgency: "routine",
      require_service_location: true
    });
    const withLocation = matchCaregivers({
      care_type: "paramedic_home_visit",
      urgency: "routine",
      user_location: { lat: 28.54, lng: 77.27 },
      require_service_location: true
    });

    assert.deepEqual(withoutLocation, []);
    assert.ok(withLocation.length > 0);
  });

  test("enforces configured maximum distance and caregiver service radius", () => {
    const originalGetAll = caregiverDataService.getAll;
    caregiverDataService.getAll = () => [
      makeCaregiver({ caregiver_id: "near", location: { lat: 28.54, lng: 77.27 }, service_radius_km: 2 }),
      makeCaregiver({ caregiver_id: "outside-radius", location: { lat: 28.54, lng: 77.31 }, service_radius_km: 1 })
    ];
    try {
      const matches = matchCaregivers({
        care_type: "paramedic_home_visit",
        urgency: "routine",
        user_location: { lat: 28.54, lng: 77.27 },
        language: "hindi"
      });
      assert.deepEqual(matches.map((match) => match.caregiver_id), ["near"]);
    } finally {
      caregiverDataService.getAll = originalGetAll;
    }
  });

  test("enforces the configured global maximum distance even when caregiver radius is larger", () => {
    const originalGetAll = caregiverDataService.getAll;
    caregiverDataService.getAll = () => [makeCaregiver({
      caregiver_id: "beyond-global-limit",
      location: { lat: 28.54, lng: 77.6 },
      service_radius_km: 100
    })];
    try {
      const matches = matchCaregivers({
        care_type: "paramedic_home_visit",
        urgency: "routine",
        user_location: { lat: 28.54, lng: 77.27 }
      });
      assert.deepEqual(matches, []);
    } finally {
      caregiverDataService.getAll = originalGetAll;
    }
  });

  test("enforces the configured minimum score", () => {
    const originalMinimum = matchingConfig.MIN_MATCH_SCORE;
    matchingConfig.MIN_MATCH_SCORE = 1;
    try {
      const matches = matchCaregivers({ care_type: "paramedic_home_visit", urgency: "routine" });
      assert.deepEqual(matches, []);
    } finally {
      matchingConfig.MIN_MATCH_SCORE = originalMinimum;
    }
  });

  test("sorts dated availability chronologically before choosing a slot", () => {
    const originalGetAll = caregiverDataService.getAll;
    caregiverDataService.getAll = () => [makeCaregiver({
      caregiver_id: "dated",
      role: "doctor",
      availability_slots: [
        { slot_id: "later", date: "2026-10-25", time: "09:00", status: "available" },
        { slot_id: "early", date: "2026-10-24", time: "17:00", status: "available" },
        { slot_id: "early-time", date: "2026-10-24", time: "09:00", status: "available" }
      ]
    })];
    try {
      const matches = matchCaregivers({ care_type: "gp_teleconsult", urgency: "routine" });
      assert.equal(matches[0].earliest_slot.slot_id, "early-time");
    } finally {
      caregiverDataService.getAll = originalGetAll;
    }
  });

  test("excludes inactive and invalid-coordinate caregivers and honors all required skills", () => {
    const originalGetAll = caregiverDataService.getAll;
    caregiverDataService.getAll = () => [
      makeCaregiver({ caregiver_id: "inactive", active: false }),
      makeCaregiver({ caregiver_id: "invalid-coordinates", location: { lat: 200, lng: 77 } }),
      makeCaregiver({ caregiver_id: "missing-skill", skills: ["vitals_monitoring"] })
    ];
    try {
      const matches = matchCaregivers({
        care_type: "paramedic_home_visit",
        urgency: "routine",
        user_location: { lat: 28.54, lng: 77.27 },
        required_skills: ["vitals_monitoring", "wound_dressing"]
      });
      assert.deepEqual(matches, []);
    } finally {
      caregiverDataService.getAll = originalGetAll;
    }
  });

  test("reports language mismatch in the grounded match reason", () => {
    const originalGetAll = caregiverDataService.getAll;
    caregiverDataService.getAll = () => [makeCaregiver({ languages: ["Tamil"] })];
    try {
      const matches = matchCaregivers({ care_type: "paramedic_home_visit", urgency: "routine", language: "english" });
      assert.equal(matches.length, 1);
      assert.match(matches[0].reason, /No english language match/);
    } finally {
      caregiverDataService.getAll = originalGetAll;
    }
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

function makeCaregiver(overrides = {}) {
  return {
    caregiver_id: "test-caregiver",
    name: "Test Caregiver",
    role: "medic",
    skills: ["vitals_monitoring", "wound_dressing"],
    location: { lat: 28.54, lng: 77.27 },
    service_radius_km: 15,
    availability_slots: [{ slot_id: "test-slot", date: "2026-10-24", time: "10:00", status: "available" }],
    languages: ["Hindi", "English"],
    rating: 4.5,
    active: true,
    ...overrides
  };
}
