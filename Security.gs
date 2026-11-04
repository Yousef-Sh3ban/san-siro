/**
 * San Siro Football Pitch Booking System
 * Module: Security.gs
 * Responsibility: Authentication, PIN cryptographic hashing, brute-force rate limiting,
 * password quality enforcement, and administrative authorization guards.
 *
 * Architecture: Clean Architecture - Security & Access Control Layer.
 */

// ============================================================================
// 1. PIN CRYPTOGRAPHIC HASHING & VALIDATION (T3.1)
// ============================================================================

/**
 * Weak 4-digit PIN blacklists (common sequences and repeated digits)
 */
var WEAK_PINS = Object.freeze([
  '0000', '1111', '2222', '3333', '4444',
  '5555', '6666', '7777', '8888', '9999',
  '1234', '4321', '0123', '9876', '2580', '1379'
]);

/**
 * Validates if the PIN string consists of exactly 4 digits.
 * Converts Arabic-Indic digits to Latin before checking.
 *
 * @param {string} pin
 * @returns {boolean}
 */
function isValidPinFormat(pin) {
  if (pin === undefined || pin === null) return false;
  var str = String(pin).trim();

  // Convert Arabic-Indic numerals
  var arabicIndicDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  for (var i = 0; i < 10; i++) {
    str = str.replace(new RegExp(arabicIndicDigits[i], 'g'), String(i));
  }

  return /^\d{4}$/.test(str);
}

/**
 * Checks whether a 4-digit PIN is overly simple or easily guessable.
 *
 * @param {string} pin
 * @returns {boolean} True if PIN is weak
 */
function isWeakPin(pin) {
  var sanitized = normalizePinInput(pin);
  if (!sanitized || sanitized.length !== 4) return true;
  return WEAK_PINS.indexOf(sanitized) !== -1;
}

/**
 * Sanitizes PIN input into a standard 4-digit Latin string.
 *
 * @param {string} pin
 * @returns {string}
 */
function normalizePinInput(pin) {
  if (!pin) return '';
  var str = String(pin).trim();
  var arabicIndicDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  for (var i = 0; i < 10; i++) {
    str = str.replace(new RegExp(arabicIndicDigits[i], 'g'), String(i));
  }
  return str.replace(/\D/g, '');
}

/**
 * Computes a salted SHA-256 hash of the player's PIN and phone number.
 * Ensures hashes cannot be matched using rainbow tables.
 *
 * @param {string} phone - Normalized 11-digit phone number
 * @param {string} pin - 4-digit PIN
 * @returns {string} Hex-encoded SHA-256 hash string
 */
function hashPin(phone, pin) {
  var cleanPhone = normalizePhone(phone);
  var cleanPin = normalizePinInput(pin);

  if (!cleanPhone || !cleanPin) {
    throw new Error('بيانات الهاتف أو الـ PIN غير صالحة لإجراء التشفير.');
  }

  var props = PropertiesService.getScriptProperties();
  var salt = props.getProperty('PIN_SALT');
  if (!salt) {
    // If salt is unexpectedly missing, initialize one
    salt = setupSecurityBootstrap();
    salt = props.getProperty('PIN_SALT');
  }

  // Raw input combining salt, phone, and PIN
  var rawPayload = salt + ':' + cleanPhone + ':' + cleanPin;
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    rawPayload,
    Utilities.Charset.UTF_8
  );

  // Convert bytes to hex string
  var hex = '';
  for (var i = 0; i < digest.length; i++) {
    var byteVal = (digest[i] + 256) % 256;
    var byteHex = byteVal.toString(16);
    if (byteHex.length === 1) hex += '0';
    hex += byteHex;
  }
  return hex;
}

/**
 * Verifies a provided PIN against an existing stored hash.
 * Uses a time-safe string comparison.
 *
 * @param {string} phone
 * @param {string} inputPin
 * @param {string} storedHash
 * @returns {boolean}
 */
function verifyPin(phone, inputPin, storedHash) {
  if (!inputPin || !storedHash) return false;
  var computed = hashPin(phone, inputPin);

  if (computed.length !== storedHash.length) return false;
  var diff = 0;
  for (var i = 0; i < computed.length; i++) {
    diff |= (computed.charCodeAt(i) ^ storedHash.charCodeAt(i));
  }
  return diff === 0;
}

// ============================================================================
// 2. BRUTE-FORCE RATE LIMITING (T3.2)
// ============================================================================

var MAX_PIN_ATTEMPTS = 5;
var LOCKOUT_PERIOD_MINUTES = 30;
var CACHE_PREFIX_ATTEMPTS = 'pin_fail_';

/**
 * Checks whether a phone number is locked out due to too many failed PIN attempts.
 *
 * @param {string} phone
 * @returns {{allowed: boolean, remainingAttempts: number, remainingMinutes: number}}
 */
function checkPinRateLimit(phone) {
  var cleanPhone = normalizePhone(phone);
  if (!cleanPhone) {
    return { allowed: false, remainingAttempts: 0, remainingMinutes: LOCKOUT_PERIOD_MINUTES };
  }

  var cache = CacheService.getScriptCache();
  var recordStr = cache.get(CACHE_PREFIX_ATTEMPTS + cleanPhone);

  if (!recordStr) {
    return { allowed: true, remainingAttempts: MAX_PIN_ATTEMPTS, remainingMinutes: 0 };
  }

  try {
    var record = JSON.parse(recordStr);
    var count = Number(record.count) || 0;
    var lockedUntil = Number(record.lockedUntil) || 0;
    var nowMs = new Date().getTime();

    if (count >= MAX_PIN_ATTEMPTS) {
      if (nowMs < lockedUntil) {
        var remainingMins = Math.ceil((lockedUntil - nowMs) / (60 * 1000));
        return {
          allowed: false,
          remainingAttempts: 0,
          remainingMinutes: Math.max(1, remainingMins)
        };
      } else {
        // Lockout expired
        cache.remove(CACHE_PREFIX_ATTEMPTS + cleanPhone);
        return { allowed: true, remainingAttempts: MAX_PIN_ATTEMPTS, remainingMinutes: 0 };
      }
    }

    return {
      allowed: true,
      remainingAttempts: Math.max(0, MAX_PIN_ATTEMPTS - count),
      remainingMinutes: 0
    };
  } catch (e) {
    return { allowed: true, remainingAttempts: MAX_PIN_ATTEMPTS, remainingMinutes: 0 };
  }
}

/**
 * Registers a failed PIN attempt. Triggers a 30-minute lockout on reaching 5 failures.
 *
 * @param {string} phone
 * @returns {{allowed: boolean, remainingAttempts: number, remainingMinutes: number}}
 */
function registerFailedAttempt(phone) {
  var cleanPhone = normalizePhone(phone);
  if (!cleanPhone) return { allowed: false, remainingAttempts: 0, remainingMinutes: LOCKOUT_PERIOD_MINUTES };

  var cache = CacheService.getScriptCache();
  var key = CACHE_PREFIX_ATTEMPTS + cleanPhone;
  var recordStr = cache.get(key);
  var record = { count: 0, lockedUntil: 0 };

  if (recordStr) {
    try {
      record = JSON.parse(recordStr);
    } catch (e) {
      record = { count: 0, lockedUntil: 0 };
    }
  }

  record.count = (Number(record.count) || 0) + 1;
  var nowMs = new Date().getTime();

  if (record.count >= MAX_PIN_ATTEMPTS) {
    record.lockedUntil = nowMs + (LOCKOUT_PERIOD_MINUTES * 60 * 1000);
    var ttlSeconds = LOCKOUT_PERIOD_MINUTES * 60;
    cache.put(key, JSON.stringify(record), ttlSeconds);

    return {
      allowed: false,
      remainingAttempts: 0,
      remainingMinutes: LOCKOUT_PERIOD_MINUTES
    };
  } else {
    // Keep failure count alive for 30 minutes
    cache.put(key, JSON.stringify(record), LOCKOUT_PERIOD_MINUTES * 60);
    return {
      allowed: true,
      remainingAttempts: MAX_PIN_ATTEMPTS - record.count,
      remainingMinutes: 0
    };
  }
}

/**
 * Clears failed attempts counter upon successful authentication.
 *
 * @param {string} phone
 */
function clearPinAttempts(phone) {
  var cleanPhone = normalizePhone(phone);
  if (cleanPhone) {
    CacheService.getScriptCache().remove(CACHE_PREFIX_ATTEMPTS + cleanPhone);
  }
}

// ============================================================================
// 3. ADMIN AUTHORIZATION GUARDS (T3.3)
// ============================================================================

/**
 * Validates the provided admin key against the stored ADMIN_KEY property.
 *
 * @param {string} key
 * @returns {boolean}
 */
function safeStringCompare(a, b) {
  if (!a || !b) return false;
  var strA = String(a).trim();
  var strB = String(b).trim();
  if (strA.length !== strB.length) return false;
  var diff = 0;
  for (var i = 0; i < strA.length; i++) {
    diff |= (strA.charCodeAt(i) ^ strB.charCodeAt(i));
  }
  return diff === 0;
}

var ADMIN_LOCKOUT_MAX_ATTEMPTS = 5;
var ADMIN_LOCKOUT_DURATION_SEC = 900; // 15 minutes
var CACHE_KEY_ADMIN_ATTEMPTS = 'admin_login_fail_count';
var CACHE_KEY_ADMIN_LOCKOUT = 'admin_login_locked_until';

/**
 * Checks if admin login is currently locked out due to excessive failed attempts.
 *
 * @returns {{allowed: boolean, remainingMinutes?: number}}
 */
function checkAdminRateLimit() {
  var cache = CacheService.getScriptCache();
  var lockedUntil = cache.get(CACHE_KEY_ADMIN_LOCKOUT);
  if (lockedUntil) {
    var waitMin = Math.ceil((Number(lockedUntil) - Date.now()) / 60000);
    if (waitMin > 0) {
      return { allowed: false, remainingMinutes: waitMin };
    }
  }
  return { allowed: true };
}

/**
 * Records a failed admin login attempt and locks out if threshold reached.
 */
function recordAdminLoginFailure() {
  var cache = CacheService.getScriptCache();
  var curAttempts = Number(cache.get(CACHE_KEY_ADMIN_ATTEMPTS) || 0) + 1;
  if (curAttempts >= ADMIN_LOCKOUT_MAX_ATTEMPTS) {
    var lockUntil = Date.now() + (ADMIN_LOCKOUT_DURATION_SEC * 1000);
    cache.put(CACHE_KEY_ADMIN_LOCKOUT, String(lockUntil), ADMIN_LOCKOUT_DURATION_SEC);
    cache.remove(CACHE_KEY_ADMIN_ATTEMPTS);
  } else {
    cache.put(CACHE_KEY_ADMIN_ATTEMPTS, String(curAttempts), ADMIN_LOCKOUT_DURATION_SEC);
  }
}

/**
 * Resets admin login failure counters upon successful authentication.
 */
function resetAdminLoginFailures() {
  var cache = CacheService.getScriptCache();
  cache.remove(CACHE_KEY_ADMIN_ATTEMPTS);
  cache.remove(CACHE_KEY_ADMIN_LOCKOUT);
}

/**
 * Validates the provided admin key against the stored ADMIN_KEY property
 * or the Pricing_Settings sheet Admin_Password.
 * Does NOT permit hardcoded fallback passwords.
 *
 * @param {string} key
 * @returns {boolean}
 */
function isAdminAuthorized(key) {
  if (!key) return false;
  var cleanKey = String(key).trim();

  // 1. Check ScriptProperties ADMIN_KEY
  try {
    var actualKey = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
    if (actualKey && safeStringCompare(cleanKey, actualKey)) return true;
  } catch (e) {}

  // 2. Check Pricing_Settings sheet Admin_Password
  try {
    var settings = getSettings();
    if (settings.adminPassword && safeStringCompare(cleanKey, settings.adminPassword)) {
      return true;
    }
  } catch (e) {}

  return false;
}

/**
 * Public RPC to verify admin key from the login screen with rate limiting.
 *
 * @param {string} key
 * @returns {Object} response
 */
function verifyAdminKey(key) {
  try {
    var limit = checkAdminRateLimit();
    if (!limit.allowed) {
      return responseError(
        'LOCKED_OUT',
        'تم قفل تسجيل الدخول مؤقتاً لتكرار إدخال كلمة مرور خاطئة. يرجى الانتظار ' + limit.remainingMinutes + ' دقيقة.'
      );
    }

    if (isAdminAuthorized(key)) {
      resetAdminLoginFailures();
      return responseSuccess({ authorized: true });
    }

    recordAdminLoginFailure();
    return responseError('INVALID_KEY', 'كلمة مرور الإدارة غير صحيحة، يرجى المحاولة مرة أخرى.');
  } catch (err) {
    return responseError('AUTH_ERROR', err.message);
  }
}

/**
 * Asserts that the admin key is valid, otherwise throws an UNAUTHORIZED exception.
 * Must be invoked at the top of every administrative backend function.
 *
 * @param {string} key
 * @throws {Error} If key is invalid
 */
function assertAdmin(key) {
  if (!isAdminAuthorized(key)) {
    throw new Error('غير مصرح بالدخول (UNAUTHORIZED). مفتاح لوحة الإدارة غير صالح أو مفقود.');
  }
}
