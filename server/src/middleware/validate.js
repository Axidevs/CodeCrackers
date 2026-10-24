/**
 * Request Validation Middleware using Zod
 */

function validateBody(schema) {
  return (req, res, next) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      const issues = err.issues || err.errors;
      if (issues || err.name === "ZodError") {
        return res.status(422).json({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid request payload",
            details: (issues || []).map((e) => ({
              field: (e.path || []).join("."),
              message: e.message
            }))
          }
        });
      }
      next(err);
    }
  };
}

module.exports = {
  validateBody
};
