const config = require('../config.js');

const maxFailedLoginAttempts = config.authSecurity?.maxFailedLoginAttempts ?? 5;
const attemptWindowMs = config.authSecurity?.attemptWindowMs ?? 15 * 60 * 1000;
const lockoutMs = config.authSecurity?.lockoutMs ?? 15 * 60 * 1000;
const failedAttempts = new Map();

function checkLoginAllowed(req, email, now = Date.now()) {
  const key = getAttemptKey(req, email);
  const attempt = getAttempt(key, now);

  if (attempt?.blockedUntil && attempt.blockedUntil > now) {
    return { allowed: false, retryAfterMs: attempt.blockedUntil - now };
  }

  return { allowed: true };
}

function recordFailedLogin(req, email, now = Date.now()) {
  const key = getAttemptKey(req, email);
  const current = getAttempt(key, now);
  const next =
    current && now - current.windowStartedAt < attemptWindowMs
      ? current
      : {
          count: 0,
          windowStartedAt: now,
          blockedUntil: 0,
        };

  next.count += 1;
  if (next.count >= maxFailedLoginAttempts) {
    next.blockedUntil = now + lockoutMs;
  }

  failedAttempts.set(key, next);
}

function recordSuccessfulLogin(req, email) {
  failedAttempts.delete(getAttemptKey(req, email));
}

function resetLoginRateLimiter() {
  failedAttempts.clear();
}

function getAttemptKey(req, email) {
  return `${normalizeValue(req.ip)}:${normalizeValue(email)}`;
}

function normalizeValue(value) {
  return String(value ?? '').trim().toLowerCase();
}

function getAttempt(key, now) {
  const attempt = failedAttempts.get(key);
  if (!attempt) {
    return null;
  }

  const attemptWindowExpired = now - attempt.windowStartedAt >= attemptWindowMs;
  const lockoutExpired = !attempt.blockedUntil || attempt.blockedUntil <= now;

  if (attemptWindowExpired && lockoutExpired) {
    failedAttempts.delete(key);
    return null;
  }

  return attempt;
}

module.exports = {
  checkLoginAllowed,
  recordFailedLogin,
  recordSuccessfulLogin,
  resetLoginRateLimiter,
};
