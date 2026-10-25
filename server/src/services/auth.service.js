const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const env = require("../config/env");

const GENERIC_OTP_MESSAGE = "If this number can receive verification codes, a code has been requested.";

function serviceError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function normalizePhoneNumber(value) {
  const compact = value.normalize("NFKC").replace(/[\s().-]/g, "");
  if (/^[6-9]\d{9}$/.test(compact)) return `+91${compact}`;
  if (/^91[6-9]\d{9}$/.test(compact)) return `+${compact}`;
  if (/^\+[1-9]\d{7,14}$/.test(compact)) return compact;
  throw serviceError(422, "INVALID_PHONE_NUMBER", "Enter a valid phone number, including its country code if outside India.");
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

class AuthService {
  constructor(options = {}) {
    this.storePath = options.storePath || env.AUTH_STORE_PATH;
    this.nodeEnv = options.nodeEnv || env.NODE_ENV;
    this.smsProvider = options.smsProvider ?? env.SMS_PROVIDER;
    this.twilioAccountSid = options.twilioAccountSid ?? env.TWILIO_ACCOUNT_SID;
    this.twilioAuthToken = options.twilioAuthToken ?? env.TWILIO_AUTH_TOKEN;
    this.twilioVerifyServiceSid = options.twilioVerifyServiceSid ?? env.TWILIO_VERIFY_SERVICE_SID;
    this.otpTtlMs = (options.otpTtlSeconds || env.OTP_TTL_SECONDS) * 1000;
    this.otpRequestLimit = options.otpRequestLimit || env.OTP_REQUEST_LIMIT;
    this.otpRequestWindowMs = (options.otpRequestWindowSeconds || env.OTP_REQUEST_WINDOW_SECONDS) * 1000;
    this.otpVerifyAttemptLimit = options.otpVerifyAttemptLimit || env.OTP_VERIFY_ATTEMPT_LIMIT;
    this.sessionTtlMs = (options.sessionTtlDays || env.AUTH_SESSION_TTL_DAYS) * 24 * 60 * 60 * 1000;
    this.fetch = options.fetch || globalThis.fetch;
    this.now = options.now || Date.now;
    this.generateOtp = options.generateOtp || (() => crypto.randomInt(100000, 1000000).toString());
    this.otpStates = new Map();
    this.rateLimits = new Map();
    this.store = this.loadStore();
  }

  loadStore() {
    if (!fs.existsSync(this.storePath)) return { users: [], sessions: [] };
    const store = JSON.parse(fs.readFileSync(this.storePath, "utf-8"));
    if (!store || !Array.isArray(store.users) || !Array.isArray(store.sessions)) {
      throw new Error(`Authentication store at ${this.storePath} must contain users and sessions arrays`);
    }
    return store;
  }

  persistStore(nextStore) {
    let temporaryPath;
    try {
      fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
      temporaryPath = `${this.storePath}.${process.pid}.${this.now()}.tmp`;
      fs.writeFileSync(temporaryPath, JSON.stringify(nextStore, null, 2), { encoding: "utf-8", flag: "wx", mode: 0o600 });
      fs.renameSync(temporaryPath, this.storePath);
      this.store = nextStore;
    } catch (error) {
      if (temporaryPath) {
        try {
          fs.rmSync(temporaryPath, { force: true });
        } catch {}
      }
      throw error;
    }
  }

  consumeRateLimit(key) {
    const now = this.now();
    for (const [rateKey, rateState] of this.rateLimits) {
      if (now >= rateState.resetAt) this.rateLimits.delete(rateKey);
    }
    const current = this.rateLimits.get(key);
    if (!current || now >= current.resetAt) {
      this.rateLimits.set(key, { count: 1, resetAt: now + this.otpRequestWindowMs });
      return true;
    }
    if (current.count >= this.otpRequestLimit) return false;
    current.count += 1;
    return true;
  }

  async requestOtp(rawPhone, clientKey = "unknown") {
    const phone = normalizePhoneNumber(rawPhone);
    for (const [knownPhone, state] of this.otpStates) {
      if (this.now() - state.issuedAt >= this.otpTtlMs) this.otpStates.delete(knownPhone);
    }
    if (!this.consumeRateLimit(`phone:${phone}`) || !this.consumeRateLimit(`client:${clientKey}`)) {
      throw serviceError(429, "OTP_RATE_LIMITED", "Too many code requests. Please wait before trying again.");
    }

    let developmentOtp;
    if (this.smsProvider === "development" && this.nodeEnv === "development") {
      developmentOtp = this.generateOtp();
    } else if (this.smsProvider === "twilio") {
      await this.sendTwilioVerification(phone);
    } else {
      throw serviceError(503, "OTP_DELIVERY_UNAVAILABLE", "Phone verification is not configured for this environment.");
    }

    this.otpStates.set(phone, {
      issuedAt: this.now(),
      attempts: 0,
      otpHash: developmentOtp ? hash(developmentOtp) : null
    });
    return developmentOtp
      ? {
          success: true,
          delivery_mode: "development",
          development_otp: developmentOtp,
          message: "Development-only code generated; no SMS was sent."
        }
      : {
          success: true,
          delivery_mode: "sms",
          message: GENERIC_OTP_MESSAGE
        };
  }

  async sendTwilioVerification(phone) {
    if (!this.twilioAccountSid || !this.twilioAuthToken || !this.twilioVerifyServiceSid) {
      throw serviceError(503, "OTP_DELIVERY_UNAVAILABLE", "Phone verification is not configured for this environment.");
    }
    let response;
    try {
      response = await this.fetch(
        `https://verify.twilio.com/v2/Services/${encodeURIComponent(this.twilioVerifyServiceSid)}/Verifications`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${this.twilioAccountSid}:${this.twilioAuthToken}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: new URLSearchParams({ To: phone, Channel: "sms" }),
          signal: AbortSignal.timeout(10000)
        }
      );
    } catch {
      throw serviceError(502, "OTP_PROVIDER_UNAVAILABLE", "Verification delivery is temporarily unavailable. Please try again.");
    }
    if (!response.ok) {
      throw serviceError(502, "OTP_PROVIDER_UNAVAILABLE", "Verification delivery is temporarily unavailable. Please try again.");
    }
  }

  async verifyOtp(rawPhone, code) {
    const phone = normalizePhoneNumber(rawPhone);
    const state = this.otpStates.get(phone);
    if (!state || this.now() - state.issuedAt >= this.otpTtlMs) {
      this.otpStates.delete(phone);
      throw serviceError(401, "INVALID_OTP", "The code is invalid or expired. Request a new code and try again.");
    }
    if (state.attempts >= this.otpVerifyAttemptLimit) {
      throw serviceError(429, "OTP_ATTEMPTS_EXCEEDED", "Too many incorrect codes. Request a new code to continue.");
    }
    state.attempts += 1;

    let isValid = false;
    if (state.otpHash) {
      const expected = Buffer.from(state.otpHash, "hex");
      const supplied = Buffer.from(hash(code), "hex");
      isValid = crypto.timingSafeEqual(expected, supplied);
    } else if (this.smsProvider === "twilio") {
      isValid = await this.checkTwilioVerification(phone, code);
    }
    if (!isValid) {
      throw serviceError(401, "INVALID_OTP", "The code is invalid or expired. Request a new code and try again.");
    }
    this.otpStates.delete(phone);

    const now = this.now();
    const user = this.store.users.find((candidate) => candidate.phone === phone) || {
      user_id: crypto.randomUUID(),
      phone,
      created_at: new Date(now).toISOString()
    };
    const users = this.store.users.includes(user) ? this.store.users : [...this.store.users, user];
    const token = crypto.randomBytes(32).toString("base64url");
    const sessions = this.store.sessions.filter((session) => Date.parse(session.expires_at) > now);
    sessions.push({
      token_hash: hash(token),
      user_id: user.user_id,
      expires_at: new Date(now + this.sessionTtlMs).toISOString()
    });
    this.persistStore({ users, sessions });
    return {
      user: { phone: user.phone },
      token
    };
  }

  async checkTwilioVerification(phone, code) {
    if (!this.twilioAccountSid || !this.twilioAuthToken || !this.twilioVerifyServiceSid) {
      throw serviceError(503, "OTP_DELIVERY_UNAVAILABLE", "Phone verification is not configured for this environment.");
    }
    let response;
    try {
      response = await this.fetch(
        `https://verify.twilio.com/v2/Services/${encodeURIComponent(this.twilioVerifyServiceSid)}/VerificationCheck`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${this.twilioAccountSid}:${this.twilioAuthToken}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: new URLSearchParams({ To: phone, Code: code }),
          signal: AbortSignal.timeout(10000)
        }
      );
    } catch {
      throw serviceError(502, "OTP_PROVIDER_UNAVAILABLE", "Verification is temporarily unavailable. Please try again.");
    }
    if (!response.ok) {
      throw serviceError(502, "OTP_PROVIDER_UNAVAILABLE", "Verification is temporarily unavailable. Please try again.");
    }
    const result = await response.json();
    return result.status === "approved";
  }

  getSession(token) {
    if (!token) return null;
    const tokenHash = hash(token);
    const session = this.store.sessions.find((candidate) => candidate.token_hash === tokenHash);
    if (!session || Date.parse(session.expires_at) <= this.now()) return null;
    const user = this.store.users.find((candidate) => candidate.user_id === session.user_id);
    return user ? { user_id: user.user_id, phone: user.phone } : null;
  }

  logout(token) {
    if (!token) return;
    const tokenHash = hash(token);
    const sessions = this.store.sessions.filter((session) => session.token_hash !== tokenHash);
    if (sessions.length !== this.store.sessions.length) this.persistStore({ ...this.store, sessions });
  }
}

module.exports = {
  AuthService,
  authService: new AuthService(),
  normalizePhoneNumber,
  GENERIC_OTP_MESSAGE
};
