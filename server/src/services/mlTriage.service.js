/**
 * CURA adapter for the Python inference HTTP service.
 * Prediction failures are surfaced; production never substitutes a mock result.
 */

const env = require("../config/env");

const CARE_TYPE_MAP = {
  paramedic_home_visit: "paramedic_home_visit",
  home_nursing: "nurse_visit",
  teleconsultation: "gp_teleconsult",
  emergency_112: "emergency_referral"
};
const URGENCY_MAP = {
  emergency: "immediate",
  same_day: "same_day",
  scheduled: "routine",
  null: null
};
const PYTHON_CARE_TYPES = new Set([
  ...Object.keys(CARE_TYPE_MAP),
  "lab_test_home",
  null
]);
const PYTHON_URGENCIES = new Set(["emergency", "same_day", "scheduled", null]);

class MlServiceError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = "MlServiceError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function invalidUpstreamResponse() {
  return new MlServiceError(
    502,
    "ML_SERVICE_INVALID_RESPONSE",
    "The ML service returned an invalid response."
  );
}

function validateMlResponse(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw invalidUpstreamResponse();
  }
  const requiredFields = [
    "follow_up_question",
    "care_type",
    "urgency",
    "red_flags",
    "reasoning",
    "matched_caregivers"
  ];
  if (requiredFields.some((field) => !Object.hasOwn(data, field))) {
    throw invalidUpstreamResponse();
  }
  if (
    (data.follow_up_question !== null && typeof data.follow_up_question !== "string") ||
    !PYTHON_CARE_TYPES.has(data.care_type) ||
    !PYTHON_URGENCIES.has(data.urgency) ||
    !Array.isArray(data.red_flags) ||
    data.red_flags.some((flag) => typeof flag !== "string") ||
    typeof data.reasoning !== "string" ||
    !Array.isArray(data.matched_caregivers)
  ) {
    throw invalidUpstreamResponse();
  }

  if (data.care_type === null) {
    if (!data.follow_up_question || data.urgency !== null || data.red_flags.length > 0) {
      throw invalidUpstreamResponse();
    }
  } else if (data.follow_up_question !== null) {
    throw invalidUpstreamResponse();
  }

  if (data.red_flags.length > 0 && data.care_type !== "emergency_112") {
    throw invalidUpstreamResponse();
  }
  if (data.care_type === "emergency_112") {
    if (data.urgency !== "emergency" || data.matched_caregivers.length !== 0) {
      throw invalidUpstreamResponse();
    }
  } else if (data.urgency === "emergency") {
    throw invalidUpstreamResponse();
  }
  if (data.matched_caregivers.length !== 0) {
    throw invalidUpstreamResponse();
  }

  if (data.care_type === "lab_test_home") {
    throw new MlServiceError(
      502,
      "UNSUPPORTED_ML_CARE_TYPE",
      "The ML care type is not supported by the backend taxonomy."
    );
  }

  return {
    care_type: data.care_type === null ? null : CARE_TYPE_MAP[data.care_type],
    urgency: URGENCY_MAP[String(data.urgency)],
    follow_up_question: data.follow_up_question,
    red_flags: data.red_flags,
    reasoning: data.reasoning,
    source: "ml_service"
  };
}

function logServiceFailure(reason, errorType) {
  console.error("[mlTriage] Python ML request failed", { reason, errorType });
}

/**
 * Calls the configured Python service with the existing intake fields.
 * Only `text` is used by the current trained model; the remaining values are
 * retained in the transport contract for compatibility and observability.
 */
async function predictTriage(
  { text, language, symptoms = [], duration = null },
  { fetchImpl = globalThis.fetch, timeoutMs = env.ML_SERVICE_TIMEOUT_MS } = {}
) {
  if (typeof text !== "string" || !text.trim()) {
    throw new MlServiceError(422, "INVALID_ML_REQUEST", "A non-empty triage message is required.");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  let data;
  try {
    response = await fetchImpl(env.ML_SERVICE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, language, symptoms, duration }),
      signal: controller.signal
    });
    if (!response.ok) {
      logServiceFailure(`HTTP_${response.status}`, "UpstreamHttpError");
      throw new MlServiceError(
        503,
        "ML_SERVICE_UNAVAILABLE",
        "The ML service is temporarily unavailable."
      );
    }
    try {
      data = await response.json();
    } catch (error) {
      if (controller.signal.aborted) throw error;
      logServiceFailure("INVALID_JSON", error?.name || "SyntaxError");
      throw invalidUpstreamResponse();
    }
  } catch (error) {
    if (error instanceof MlServiceError) throw error;
    const timedOut = controller.signal.aborted;
    const code = timedOut ? "ML_SERVICE_TIMEOUT" : "ML_SERVICE_UNAVAILABLE";
    const message = timedOut
      ? "The ML service did not respond in time."
      : "The ML service is unavailable.";
    logServiceFailure(code, error?.name || "Error");
    throw new MlServiceError(503, code, message);
  } finally {
    clearTimeout(timeoutId);
  }

  try {
    return validateMlResponse(data);
  } catch (error) {
    logServiceFailure(error.code || "INVALID_SCHEMA", error.name || "Error");
    throw error;
  }
}

module.exports = {
  MlServiceError,
  predictTriage
};
