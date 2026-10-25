const { authService } = require("../services/auth.service");
const { getSessionToken, setSessionCookie, clearSessionCookie } = require("../middleware/auth");

async function requestOtp(req, res, next) {
  try {
    res.set("Cache-Control", "no-store");
    const result = await authService.requestOtp(req.body.phone, req.ip || req.socket.remoteAddress);
    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

async function verifyOtp(req, res, next) {
  try {
    res.set("Cache-Control", "no-store");
    const { user, token } = await authService.verifyOtp(req.body.phone, req.body.code);
    setSessionCookie(res, token);
    return res.status(200).json({
      success: true,
      user,
      message: "Phone verified successfully."
    });
  } catch (error) {
    next(error);
  }
}

function getCurrentUser(req, res) {
  res.set("Cache-Control", "no-store");
  const user = authService.getSession(getSessionToken(req));
  if (!user) return res.status(200).json({ success: true, user: null });
  return res.status(200).json({ success: true, user: { phone: user.phone } });
}

function logout(req, res, next) {
  try {
    res.set("Cache-Control", "no-store");
    authService.logout(getSessionToken(req));
    clearSessionCookie(res);
    return res.status(200).json({ success: true, message: "You are signed out." });
  } catch (error) {
    next(error);
  }
}

module.exports = { requestOtp, verifyOtp, getCurrentUser, logout };
