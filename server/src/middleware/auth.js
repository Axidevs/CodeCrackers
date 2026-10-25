const { authService } = require("../services/auth.service");
const env = require("../config/env");

const SESSION_COOKIE = "cura_session";
const trustedOrigins = new Set(env.CORS_ORIGINS);

function getSessionToken(req) {
  const cookieHeader = req.headers.cookie || "";
  const sessionCookie = cookieHeader.split(";").map((cookie) => cookie.trim()).find((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`));
  return sessionCookie ? sessionCookie.slice(SESSION_COOKIE.length + 1) : null;
}

function requireAuth(req, res, next) {
  const user = authService.getSession(getSessionToken(req));
  if (!user) {
    return res.status(401).json({
      success: false,
      error: { code: "AUTHENTICATION_REQUIRED", message: "Sign in to view your bookings." }
    });
  }
  req.authUser = user;
  next();
}

function loadOptionalAuth(req, res, next) {
  req.authUser = authService.getSession(getSessionToken(req));
  next();
}

function requireTrustedOrigin(req, res, next) {
  const origin = req.get("Origin");
  if (origin && !trustedOrigins.has(origin)) {
    return res.status(403).json({
      success: false,
      error: { code: "ORIGIN_NOT_ALLOWED", message: "This request origin is not allowed." }
    });
  }
  next();
}

function setSessionCookie(res, token) {
  const secure = env.NODE_ENV === "production" ? "; Secure; SameSite=None" : "; SameSite=Lax";
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; Max-Age=${env.AUTH_SESSION_TTL_DAYS * 24 * 60 * 60}${secure}`);
}

function clearSessionCookie(res) {
  const secure = env.NODE_ENV === "production" ? "; Secure; SameSite=None" : "; SameSite=Lax";
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0${secure}`);
}

module.exports = {
  SESSION_COOKIE,
  getSessionToken,
  requireAuth,
  loadOptionalAuth,
  requireTrustedOrigin,
  setSessionCookie,
  clearSessionCookie
};
