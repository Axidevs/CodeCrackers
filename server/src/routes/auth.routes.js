const express = require("express");
const { requestOtp, verifyOtp, getCurrentUser, logout } = require("../controllers/auth.controller");
const { requireTrustedOrigin } = require("../middleware/auth");
const { validateBody } = require("../middleware/validate");
const { OtpRequestSchema, OtpVerifySchema } = require("../utils/schemas");

const router = express.Router();

router.post("/auth/otp/request", requireTrustedOrigin, validateBody(OtpRequestSchema), requestOtp);
router.post("/auth/otp/verify", requireTrustedOrigin, validateBody(OtpVerifySchema), verifyOtp);
router.get("/auth/me", getCurrentUser);
router.post("/auth/logout", requireTrustedOrigin, logout);

module.exports = router;
