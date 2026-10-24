const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const app = require("../../src/app");

let server;
let baseUrl;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe("CURA Backend API Integration Tests", () => {
  describe("GET /api/health", () => {
    test("returns 200 and healthy status", async () => {
      const res = await fetch(`${baseUrl}/api/health`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.success, true);
      assert.equal(body.status, "healthy");
    });
  });

  describe("POST /api/triage (Official Schema Endpoint)", () => {
    test("processes routine patient case (Hindi/Hinglish) with matched caregivers", async () => {
      const res = await fetch(`${baseUrl}/api/triage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_input: "papa ko do din se bukhar hai aur khansi bhi hai, saans lene me koi dikkat nahi",
          language: "auto",
          location: { lat: 28.54, lng: 77.27 },
          conversation_history: []
        })
      });

      assert.equal(res.status, 200);
      const body = await res.json();

      // Official schema verification (PS Page 4)
      assert.equal(body.follow_up_question, null);
      assert.equal(body.care_type, "paramedic_home_visit");
      assert.equal(body.urgency, "same_day");
      assert.deepEqual(body.red_flags, []);
      assert.ok(typeof body.reasoning === "string" && body.reasoning.length > 0);
      assert.ok(Array.isArray(body.matched_caregivers));
      assert.ok(body.matched_caregivers.length > 0);

      const topCaregiver = body.matched_caregivers[0];
      assert.ok(topCaregiver.caregiver_id);
      assert.ok(typeof topCaregiver.score === "number");
      assert.ok(typeof topCaregiver.reason === "string");
    });

    test("EMERGENCY SAFETY GATE: triggers emergency referral and BYPASSES caregiver matching", async () => {
      const res = await fetch(`${baseUrl}/api/triage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_input: "mere seene me bohot tez dard ho raha hai aur saans phool rahi hai",
          language: "hinglish",
          location: { lat: 28.54, lng: 77.27 }
        })
      });

      assert.equal(res.status, 200);
      const body = await res.json();

      assert.equal(body.care_type, "emergency_referral");
      assert.equal(body.urgency, "immediate");
      assert.ok(body.red_flags.length > 0);
      assert.ok(body.red_flags.includes("chest_pain"));
      assert.deepEqual(body.matched_caregivers, [], "Emergencies MUST have empty matched_caregivers list");
      assert.equal(body.emergency_action.call, "112");
    });

    test("NEGATION SAFETY: 'chest pain nahi hai' is NOT treated as an emergency", async () => {
      const res = await fetch(`${baseUrl}/api/triage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_input: "bukhar aur khansi hai do din se lekin chest pain nahi hai aur saans theek hai",
          language: "auto"
        })
      });

      assert.equal(res.status, 200);
      const body = await res.json();
      assert.notEqual(body.care_type, "emergency_referral");
      assert.notEqual(body.urgency, "immediate");
      assert.deepEqual(body.red_flags, []);
    });

    test("DISAMBIGUATION: vague input returns targeted follow-up question", async () => {
      const res = await fetch(`${baseUrl}/api/triage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_input: "bukhar hai",
          language: "hinglish",
          conversation_history: []
        })
      });

      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(typeof body.follow_up_question === "string" && body.follow_up_question.length > 0);
      assert.equal(body.care_type, null);
    });

    test("VALIDATION: returns 422 when user_input is missing", async () => {
      const res = await fetch(`${baseUrl}/api/triage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language: "auto"
        })
      });

      assert.equal(res.status, 422);
      const body = await res.json();
      assert.equal(body.success, false);
      assert.equal(body.error.code, "VALIDATION_ERROR");
    });
  });

  describe("POST /api/ui/triage (Extended UI Endpoint)", () => {
    test("returns decision along with execution trace", async () => {
      const res = await fetch(`${baseUrl}/api/ui/triage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_input: "dadi ko ghar par nurse ki zaroorat hai wound dressing ke liye",
          language: "auto"
        })
      });

      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.success, true);
      assert.ok(body.decision);
      assert.ok(body.trace);
      assert.ok(typeof body.trace.latency_ms === "number");
    });
  });

  describe("Caregiver & Booking APIs", () => {
    test("GET /api/caregivers returns available profiles and supports role filtering", async () => {
      const res = await fetch(`${baseUrl}/api/caregivers?role=nurse`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.success, true);
      assert.ok(body.count > 0);
      for (const cg of body.caregivers) {
        assert.equal(cg.role, "nurse");
      }
    });

    test("POST /api/booking books a slot and blocks duplicate booking (409)", async () => {
      // 1. Get caregiver CG_014
      const cgRes = await fetch(`${baseUrl}/api/caregivers/CG_014`);
      assert.equal(cgRes.status, 200);
      const cgBody = await cgRes.json();
      const firstAvailableSlot = cgBody.caregiver.availability_slots.find((s) => !s.is_booked);
      assert.ok(firstAvailableSlot, "Should have a free slot");

      // 2. Book the slot
      const bookRes = await fetch(`${baseUrl}/api/booking`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caregiver_id: "CG_014",
          slot_id: firstAvailableSlot.slot_id,
          patient_name: "Aayushi",
          notes: "Demo test booking"
        })
      });
      assert.equal(bookRes.status, 201);
      const bookBody = await bookRes.json();
      assert.equal(bookBody.success, true);
      assert.equal(bookBody.booking.status, "confirmed");

      // 3. Duplicate booking attempt -> 409 Conflict
      const dupRes = await fetch(`${baseUrl}/api/booking`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caregiver_id: "CG_014",
          slot_id: firstAvailableSlot.slot_id,
          patient_name: "Second Patient"
        })
      });
      assert.equal(dupRes.status, 409);

      // 4. Reset bookings
      const resetRes = await fetch(`${baseUrl}/api/demo/reset`, { method: "POST" });
      assert.equal(resetRes.status, 200);
    });
  });

  describe("POST /api/emergency/escalate", () => {
    test("returns 112 guidance and instructions", async () => {
      const res = await fetch(`${baseUrl}/api/emergency/escalate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          red_flags: ["chest_pain"]
        })
      });

      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.emergency, true);
      assert.equal(body.emergency_action.primary_number, "112");
      assert.equal(body.emergency_action.ambulance_number, "108");
    });
  });
});
