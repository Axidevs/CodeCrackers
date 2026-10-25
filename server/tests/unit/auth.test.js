const { afterEach, test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { AuthService, normalizePhoneNumber } = require("../../src/services/auth.service");

let temporaryDirectory;

function createAuthService(options = {}) {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "cura-auth-test-"));
  return new AuthService({
    storePath: path.join(temporaryDirectory, "auth.json"),
    nodeEnv: "development",
    smsProvider: "development",
    generateOtp: () => "481205",
    ...options
  });
}

afterEach(() => {
  if (temporaryDirectory) fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = null;
});

test("normalizes Indian local phone numbers and accepts E.164 numbers", () => {
  assert.equal(normalizePhoneNumber("98765 43210"), "+919876543210");
  assert.equal(normalizePhoneNumber("+44 20 7946 0958"), "+442079460958");
  assert.throws(() => normalizePhoneNumber("12345"), (error) => error.code === "INVALID_PHONE_NUMBER");
});

test("development OTP verifies, creates a user, and persists only a hashed session", async () => {
  const service = createAuthService();
  const requested = await service.requestOtp("9876543210", "test-client");
  assert.equal(requested.delivery_mode, "development");
  assert.equal(requested.development_otp, "481205");
  assert.match(requested.message, /no SMS was sent/i);

  const verified = await service.verifyOtp("9876543210", "481205");
  assert.equal(verified.user.phone, "+919876543210");
  assert.equal(Object.hasOwn(verified.user, "user_id"), false);
  assert.ok(verified.token);
  const verifiedUserId = service.store.users[0].user_id;
  assert.equal(service.getSession(verified.token).user_id, verifiedUserId);
  const stored = JSON.parse(fs.readFileSync(service.storePath, "utf8"));
  assert.equal(stored.sessions[0].token_hash.length, 64);
  assert.equal(Object.hasOwn(stored.sessions[0], "token"), false);
  assert.equal(service.getSession("not-a-session"), null);
  const reloaded = new AuthService({ storePath: service.storePath, nodeEnv: "development", smsProvider: "development" });
  assert.equal(reloaded.getSession(verified.token).phone, verified.user.phone);
  service.logout(verified.token);
  const loginRequest = await service.requestOtp("9876543210", "test-client");
  const loggedIn = await service.verifyOtp("9876543210", loginRequest.development_otp);
  assert.equal(service.store.users.length, 1);
  assert.equal(service.store.users[0].user_id, verifiedUserId);
});

test("invalid OTPs consume the configured attempt limit", async () => {
  const service = createAuthService({ otpVerifyAttemptLimit: 2 });
  await service.requestOtp("+919876543210", "attempt-client");
  await assert.rejects(service.verifyOtp("+919876543210", "000000"), (error) => error.statusCode === 401 && error.code === "INVALID_OTP");
  await assert.rejects(service.verifyOtp("+919876543210", "000000"), (error) => error.statusCode === 401 && error.code === "INVALID_OTP");
  await assert.rejects(service.verifyOtp("+919876543210", "481205"), (error) => error.statusCode === 429 && error.code === "OTP_ATTEMPTS_EXCEEDED");
});

test("expired codes cannot be verified", async () => {
  let now = 1000;
  const service = createAuthService({ otpTtlSeconds: 1, now: () => now });
  await service.requestOtp("+919876543210", "expiry-client");
  now += 1001;
  await assert.rejects(service.verifyOtp("+919876543210", "481205"), (error) => error.statusCode === 401 && error.code === "INVALID_OTP");
});

test("OTP requests are rate-limited per phone and client", async () => {
  const service = createAuthService({ otpRequestLimit: 2 });
  await service.requestOtp("+919876543210", "limit-client");
  await service.requestOtp("+919876543210", "limit-client");
  await assert.rejects(service.requestOtp("+919876543210", "limit-client"), (error) => error.statusCode === 429);
});

test("development OTP mode is unavailable outside explicit development mode", async () => {
  const service = createAuthService({ nodeEnv: "production" });
  await assert.rejects(service.requestOtp("+919876543210", "production-client"), (error) => error.statusCode === 503);
});

test("Twilio Verify uses environment credentials and does not return an OTP", async () => {
  let request;
  const service = createAuthService({
    smsProvider: "twilio",
    twilioAccountSid: "account",
    twilioAuthToken: "secret",
    twilioVerifyServiceSid: "service",
    fetch: async (url, options) => {
      request = { url, options };
      return Response.json({ status: "pending" });
    }
  });
  const result = await service.requestOtp("+919876543210", "twilio-client");
  assert.equal(result.delivery_mode, "sms");
  assert.equal(Object.hasOwn(result, "development_otp"), false);
  assert.match(request.url, /verify\.twilio\.com/);
  assert.match(request.options.headers.Authorization, /^Basic /);
});

test("Twilio Verify checks the submitted code and creates a session only after approval", async () => {
  const requests = [];
  const service = createAuthService({
    nodeEnv: "production",
    smsProvider: "twilio",
    twilioAccountSid: "account",
    twilioAuthToken: "secret",
    twilioVerifyServiceSid: "service",
    fetch: async (url, options) => {
      requests.push({ url, options });
      return requests.length === 1
        ? Response.json({ status: "pending" })
        : Response.json({ status: "approved" });
    }
  });
  const requested = await service.requestOtp("+919876543210", "twilio-verify-client");
  assert.equal(requested.delivery_mode, "sms");
  assert.equal(Object.hasOwn(requested, "development_otp"), false);
  const verified = await service.verifyOtp("+919876543210", "123456");
  assert.equal(verified.user.phone, "+919876543210");
  assert.equal(service.getSession(verified.token).phone, "+919876543210");
  assert.match(requests[1].url, /VerificationCheck$/);
  assert.equal(requests[1].options.body.get("Code"), "123456");
});
