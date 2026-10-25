const express = require("express");
const { requestOtp, verifyOtp, getCurrentUser, updateProfile, logout } = require("../controllers/auth.controller");
const { requireAuth, requireTrustedOrigin } = require("../middleware/auth");
const { validateBody } = require("../middleware/validate");
const { OtpRequestSchema, OtpVerifySchema, ProfileUpdateSchema } = require("../utils/schemas");

const router = express.Router();

router.post("/auth/otp/request", requireTrustedOrigin, validateBody(OtpRequestSchema), requestOtp);
router.post("/auth/otp/verify", requireTrustedOrigin, validateBody(OtpVerifySchema), verifyOtp);
router.get("/auth/me", getCurrentUser);
router.put("/auth/profile", requireTrustedOrigin, requireAuth, validateBody(ProfileUpdateSchema), updateProfile);
router.post("/auth/logout", requireTrustedOrigin, logout);

module.exports = router;
