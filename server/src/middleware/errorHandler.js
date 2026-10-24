/**
 * CURA Centralized Error Handler Middleware
 * Returns consistent, structured JSON responses for all error conditions.
 */

function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || (err.status >= 400 && err.status < 600 ? err.status : 500);

  // In production or tests, do not leak raw stack traces to users
  const responsePayload = {
    success: false,
    error: {
      code: statusCode === 409 ? "CONFLICT" : statusCode === 404 ? "NOT_FOUND" : statusCode === 500 && err.code === "BOOKING_PERSISTENCE_FAILED" ? "BOOKING_PERSISTENCE_FAILED" : err.code || "INTERNAL_ERROR",
      message: statusCode === 500 && err.code === "BOOKING_PERSISTENCE_FAILED" ? "Booking could not be saved. Please try again." : err.message || "An unexpected error occurred"
    }
  };

  if (process.env.NODE_ENV === "development" && statusCode === 500) {
    responsePayload.error.stack = err.stack;
  }

  res.status(statusCode).json(responsePayload);
}

module.exports = {
  errorHandler
};
