const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const app = require("../../src/app");
const bookingService = require("../../src/services/booking.service");
const { authService } = require("../../src/services/auth.service");

let server;
let baseUrl;
let temporaryDirectory;
let originalBookingStore;
let originalAuthStore;

before(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "cura-api-auth-test-"));
  originalBookingStore = { path: bookingService.overlayPath, bookings: bookingService.bookings, bookedSlots: bookingService.bookedSlots };
  originalAuthStore = {
    path: authService.storePath,
    store: authService.store,
    nodeEnv: authService.nodeEnv,
    smsProvider: authService.smsProvider
  };
  bookingService.overlayPath = path.join(temporaryDirectory, "bookings.json");
  bookingService.bookings = [];
  bookingService.bookedSlots = new Set();
  authService.storePath = path.join(temporaryDirectory, "auth.json");
  authService.store = { users: [], sessions: [] };
  authService.nodeEnv = "development";
  authService.smsProvider = "development";
  authService.otpStates.clear();
  authService.rateLimits.clear();
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
  bookingService.overlayPath = originalBookingStore.path;
  bookingService.bookings = originalBookingStore.bookings;
  bookingService.bookedSlots = originalBookingStore.bookedSlots;
  authService.storePath = originalAuthStore.path;
  authService.store = originalAuthStore.store;
  authService.nodeEnv = originalAuthStore.nodeEnv;
  authService.smsProvider = originalAuthStore.smsProvider;
  authService.otpStates.clear();
  authService.rateLimits.clear();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

async function signIn(phone) {
  const request = await fetch(`${baseUrl}/api/auth/otp/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone })
  });
  assert.equal(request.status, 200);
  const requestBody = await request.json();
  assert.equal(requestBody.delivery_mode, "development");
  const response = await fetch(`${baseUrl}/api/auth/otp/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, code: requestBody.development_otp })
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("set-cookie").includes("HttpOnly"), true);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(Object.hasOwn(body, "token"), false);
  assert.equal(Object.hasOwn(body.user, "user_id"), false);
  assert.equal(Object.hasOwn(body.user, "created_at"), false);
  return response.headers.get("set-cookie").split(";")[0];
}

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
          user_input: "papa ko do din se bukhar hai aur khansi bhi hai, saans lene me koi dikkat nahi aur chest pain nahi hai, bukhar halka hai",
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
      assert.equal(Object.hasOwn(body, "emergency_action"), false);
      assert.ok(typeof body.reasoning === "string" && body.reasoning.length > 0);
      assert.ok(Array.isArray(body.matched_caregivers));
      assert.ok(body.matched_caregivers.length > 0);

      const topCaregiver = body.matched_caregivers[0];
      assert.ok(topCaregiver.caregiver_id);
      assert.ok(typeof topCaregiver.score === "number");
      assert.ok(typeof topCaregiver.reason === "string");
    });

    test("EMERGENCY SAFETY GATE: triggers emergency referral and BYPASSES caregiver matching", async () => {
      const bookingsBefore = bookingService.getAllBookings().length;
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
      assert.equal(body.emergency_action.ambulance, "108");
      assert.ok(body.emergency_action.guidance);
      assert.ok(Array.isArray(body.emergency_action.steps));
      assert.equal(bookingService.getAllBookings().length, bookingsBefore);
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

    test("rejects meaningless symptom input with a structured 400 response", async () => {
      for (const user_input of ["2+2", "hello", "asdfghjkl", "ieoepep", "123456", "!!!@@@", "   ", "What is the weather tomorrow?", "What is fever?", "Does fever cause cough?"]) {
        const response = await fetch(`${baseUrl}/api/triage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_input, language: "auto" })
        });
        const body = await response.json();
        assert.equal(response.status, 400, user_input);
        assert.equal(body.success, false);
        assert.equal(body.error.code, "INVALID_HEALTH_INPUT");
        assert.match(body.error.message, /describe a health concern or symptom/i);
      }
    });

    test("rejects meaningless input through the UI triage endpoint too", async () => {
      const response = await fetch(`${baseUrl}/api/ui/triage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_input: "2+2", language: "english" })
      });
      const body = await response.json();
      assert.equal(response.status, 400);
      assert.equal(body.success, false);
      assert.equal(body.error.code, "INVALID_HEALTH_INPUT");
    });

    test("UI triage rejects meaningless input through its direct API route", async () => {
      for (const user_input of ["2+2", "hello", "asdfghjkl", "ieoepep", "123456", "!!!@@@", "   "]) {
        const response = await fetch(`${baseUrl}/api/ui/triage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_input, language: "english" })
        });
        const body = await response.json();
        assert.equal(response.status, 400, user_input);
        assert.equal(body.error.code, "INVALID_HEALTH_INPUT");
      }
    });

    test("accepts a short follow-up answer when prior conversation contains a concern", async () => {
      const response = await fetch(`${baseUrl}/api/triage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_input: "No",
          language: "english",
          conversation_history: [
            { role: "user", content: "I have a headache" },
            { role: "assistant", content: "How long have these symptoms been present?", is_question: true }
          ]
        })
      });
      assert.equal(response.status, 200);
    });
  });

  describe("POST /api/ui/triage (Extended UI Endpoint)", () => {
    test("keeps the UI response envelope and does not conclude when a required answer is missing", async () => {
      const firstResponse = await fetch(`${baseUrl}/api/ui/triage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_input: "I have a headache", language: "english" })
      });
      const firstBody = await firstResponse.json();
      assert.equal(firstResponse.status, 200);
      assert.equal(firstBody.success, true);
      assert.equal(firstBody.trace.branch, "follow_up");
      assert.equal(firstBody.decision.follow_up_question, "How long have these symptoms been present?");

      const secondResponse = await fetch(`${baseUrl}/api/ui/triage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_input: "No",
          language: "english",
          conversation_history: [
            { role: "user", content: "I have a headache" },
            { role: "assistant", content: firstBody.decision.follow_up_question, is_question: true }
          ]
        })
      });
      const secondBody = await secondResponse.json();
      assert.equal(secondResponse.status, 200);
      assert.equal(secondBody.success, true);
      assert.equal(secondBody.trace.branch, "insufficient_information");
      assert.equal(secondBody.decision.care_type, "gp_teleconsult");
      assert.match(secondBody.decision.reasoning, /No diagnosis has been made/);
      assert.deepEqual(secondBody.decision.matched_caregivers, []);
    });

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

    test("emergency decisions retain the UI decision and trace envelope", async () => {
      const response = await fetch(`${baseUrl}/api/ui/triage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_input: "Patient is unconscious", language: "english" })
      });
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.success, true);
      assert.equal(body.decision.care_type, "emergency_referral");
      assert.equal(body.decision.emergency_action.call, "112");
      assert.equal(body.trace.branch, "emergency");
    });
  });

  describe("Caregiver & Booking APIs", () => {
    test("GET /api/caregivers returns available profiles and supports role filtering", async () => {
      const allResponse = await fetch(`${baseUrl}/api/caregivers`);
      const allBody = await allResponse.json();
      assert.equal(allResponse.status, 200);
      assert.equal(allBody.count, 52);

      const res = await fetch(`${baseUrl}/api/caregivers?role=medic`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.success, true);
      assert.ok(body.count > 0);
      assert.equal(body.count, 23);
      for (const cg of body.caregivers) {
        assert.equal(cg.role, "medic");
        assert.equal(cg.active, true);
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

    test("concurrent duplicate booking requests produce one confirmation and one conflict", async () => {
      const caregiverResponse = await fetch(`${baseUrl}/api/caregivers/CG_014`);
      const caregiverBody = await caregiverResponse.json();
      const slot = caregiverBody.caregiver.availability_slots.find((item) => !item.is_booked);
      assert.ok(slot);

      const makeRequest = () => fetch(`${baseUrl}/api/booking`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caregiver_id: "CG_014", slot_id: slot.slot_id })
      });
      const responses = await Promise.all([makeRequest(), makeRequest()]);

      assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
      await fetch(`${baseUrl}/api/demo/reset`, { method: "POST" });
    });

    test("booking persistence failure returns a structured error without confirming", async () => {
      const caregiverResponse = await fetch(`${baseUrl}/api/caregivers/CG_014`);
      const caregiverBody = await caregiverResponse.json();
      const slot = caregiverBody.caregiver.availability_slots.find((item) => !item.is_booked);
      const originalOverlayPath = bookingService.overlayPath;
      const directoryPath = fs.mkdtempSync(path.join(os.tmpdir(), "cura-booking-error-"));

      try {
        bookingService.overlayPath = directoryPath;
        const response = await fetch(`${baseUrl}/api/booking`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ caregiver_id: "CG_014", slot_id: slot.slot_id })
        });
        const body = await response.json();
        assert.equal(response.status, 500);
        assert.equal(body.success, false);
        assert.equal(body.error.code, "BOOKING_PERSISTENCE_FAILED");
        assert.equal(bookingService.isSlotBooked(slot.slot_id), false);
      } finally {
        bookingService.overlayPath = originalOverlayPath;
        fs.rmSync(directoryPath, { recursive: true, force: true });
      }
    });
  });

  describe("phone authentication and private booking history", () => {
    test("credentialed browser requests use the configured origin and reject untrusted mutations", async () => {
      const allowed = await fetch(`${baseUrl}/api/auth/me`, { headers: { Origin: "http://localhost:3000" } });
      assert.equal(allowed.headers.get("access-control-allow-origin"), "http://localhost:3000");
      assert.equal(allowed.headers.get("access-control-allow-credentials"), "true");

      const denied = await fetch(`${baseUrl}/api/auth/logout`, {
        method: "POST",
        headers: { Origin: "https://untrusted.example" }
      });
      assert.equal(denied.status, 403);
    });

    test("booking history is unavailable without a signed-in session", async () => {
      const response = await fetch(`${baseUrl}/api/bookings/me`);
      const body = await response.json();
      assert.equal(response.status, 401);
      assert.equal(body.error.code, "AUTHENTICATION_REQUIRED");
    });

    test("verified users see only their own bookings and guest bookings stay unowned", async () => {
      const userACookie = await signIn("9876543210");
      const userBCookie = await signIn("9876543211");
      const userAResponse = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: userACookie } });
      const userA = (await userAResponse.json()).user;
      assert.equal(userA.phone, "+919876543210");
      assert.equal(Object.hasOwn(userA, "user_id"), false);

      const directoryResponse = await fetch(`${baseUrl}/api/caregivers`);
      const caregivers = (await directoryResponse.json()).caregivers;
      const bookingCandidates = caregivers.flatMap((caregiver) => caregiver.availability_slots
        .filter((slot) => !slot.is_booked)
        .map((slot) => ({ caregiver, slot }))).slice(0, 3);
      assert.equal(bookingCandidates.length, 3);

      const userABookingIds = [];
      for (const { caregiver, slot } of bookingCandidates.slice(0, 2)) {
        const created = await fetch(`${baseUrl}/api/booking`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: userACookie },
          body: JSON.stringify({ caregiver_id: caregiver.caregiver_id, slot_id: slot.slot_id, user_id: "attacker-selected-owner" })
        });
        assert.equal(created.status, 201);
        const createdBody = await created.json();
        assert.equal(Object.hasOwn(createdBody.booking, "user_id"), false);
        userABookingIds.push(createdBody.booking.booking_id);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      const guestBooking = await fetch(`${baseUrl}/api/booking`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caregiver_id: bookingCandidates[2].caregiver.caregiver_id, slot_id: bookingCandidates[2].slot.slot_id })
      });
      assert.equal(guestBooking.status, 201);

      const userAHistoryResponse = await fetch(`${baseUrl}/api/bookings/me`, { headers: { Cookie: userACookie } });
      const userAHistory = await userAHistoryResponse.json();
      assert.equal(userAHistoryResponse.status, 200);
      assert.equal(userAHistory.bookings.length, 2);
      assert.equal(userAHistory.bookings[0].caregiver_name, bookingCandidates[1].caregiver.name);
      assert.equal(userAHistory.bookings[0].service, bookingCandidates[1].caregiver.role);
      assert.ok(userAHistory.bookings[0].booking_id);
      assert.deepEqual(userAHistory.bookings.map((booking) => booking.booking_id), userABookingIds.reverse());

      const userBHistory = await fetch(`${baseUrl}/api/bookings/me?user_id=some-other-account`, {
        headers: { Cookie: userBCookie }
      });
      assert.deepEqual((await userBHistory.json()).bookings, []);

      const logoutResponse = await fetch(`${baseUrl}/api/auth/logout`, { method: "POST", headers: { Cookie: userACookie } });
      assert.equal(logoutResponse.status, 200);
      const afterLogout = await fetch(`${baseUrl}/api/bookings/me`, { headers: { Cookie: userACookie } });
      assert.equal(afterLogout.status, 401);
    });

    test("new accounts receive an empty booking history", async () => {
      const cookie = await signIn("9876543212");
      const response = await fetch(`${baseUrl}/api/bookings/me`, { headers: { Cookie: cookie } });
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).bookings, []);
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
