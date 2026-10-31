/**
 * San Siro Football Pitch Booking System
 * Module: Config.gs
 * Responsibility: Centralized configuration, domain constants, typed settings repository,
 * date/time operations in Africa/Cairo, phone normalization, and infrastructure helpers.
 *
 * Architecture: Clean Architecture - Core / Foundation Layer.
 */

// ============================================================================
// 1. DOMAIN CONSTANTS & ENUMS (T1.1)
// ============================================================================

/**
 * Sheet names within the San Siro Google Spreadsheet.
 */
var SHEETS = Object.freeze({
  CUSTOMERS: 'Customers',
  BOOKINGS: 'Bookings',
  PRICING_SETTINGS: 'Pricing_Settings',
  DISCOUNTS: 'Discounts',
  MONTHLY_REPORTS: 'Monthly_Reports'
});

/**
 * 1-based Column Index Mappings for each Sheet.
 * Ensures zero hardcoded column numbers throughout the application.
 */
var COL = Object.freeze({
  CUSTOMERS: {
    PHONE_NUMBER: 1,      // Primary Key (01xxxxxxxxx)
    PLAYER_NAME: 2,       // String
    PIN: 3,               // SHA-256 Hashed PIN string
    STATUS: 4,            // 'Trusted' | 'New' | 'Blocked'
    TOTAL_BOOKINGS: 5,    // Integer
    NO_SHOW_COUNT: 6,     // Integer
    LAST_BOOKING_DATE: 7, // YYYY-MM-DD
    NOTES: 8,             // Free text
    CREATED_AT: 9         // ISO Timestamp
  },
  BOOKINGS: {
    BOOKING_ID: 1,        // BK-YYYYMMDD-XXXX
    DATE: 2,              // YYYY-MM-DD
    DAY_NAME: 3,          // Arabic / English Day string
    TIME_SLOT: 4,         // 12h format e.g. "08:00 PM - 09:00 PM"
    PITCH_ID: 5,          // 'Pitch 1' | 'Pitch 2'
    SLOT_STATUS: 6,       // 'Available' | 'Pending Deposit' | 'Confirmed' | 'Owner Reserved' | 'Cancelled' | 'Expired' | 'No-Show'
    PLAYER_NAME: 7,       // String
    PLAYER_PHONE: 8,      // 01xxxxxxxxx
    CALCULATED_PRICE: 9,  // Number (EGP)
    DEPOSIT_AMOUNT: 10,   // Number (EGP)
    REMAINING_CASH: 11,   // Formula or Number
    LOCK_EXPIRATION: 12,  // Timestamp
    CREATED_AT: 13,       // Timestamp
    SOURCE: 14,           // 'Online' | 'Admin'
    CANCELLED_AT: 15      // Timestamp
  },
  DISCOUNTS: {
    DATE: 1,              // YYYY-MM-DD
    START_TIME: 2,        // hh:mm AM/PM (e.g. "06:00 PM")
    END_TIME: 3,          // hh:mm AM/PM (e.g. "10:00 PM")
    APPLICABLE_PITCH: 4,  // 'Pitch 1' | 'Pitch 2' | 'All'
    DISCOUNTED_PRICE: 5,  // Number (EGP)
    EVENT_TITLE: 6        // String
  }
});

/**
 * Reservation Slot Status Lifecycle
 */
var STATUS = Object.freeze({
  AVAILABLE: 'Available',
  PENDING_DEPOSIT: 'Pending Deposit',
  CONFIRMED: 'Confirmed',
  OWNER_RESERVED: 'Owner Reserved',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
  NO_SHOW: 'No-Show'
});

/**
 * Customer Tier Classifications
 */
var CUSTOMER_STATUS = Object.freeze({
  TRUSTED: 'Trusted',
  NEW: 'New',
  BLOCKED: 'Blocked'
});

/**
 * Stadium Pitch Identifiers
 */
var PITCHES = Object.freeze({
  PITCH_1: 'Pitch 1',
  PITCH_2: 'Pitch 2'
});

/**
 * Active statuses that physically occupy a pitch slot (prevents double bookings)
 */
var ACTIVE_STATUSES = Object.freeze([
  STATUS.PENDING_DEPOSIT,
  STATUS.CONFIRMED,
  STATUS.OWNER_RESERVED
]);

/**
 * Primary timezone used across the platform
 */
var TIMEZONE_CAIRO = 'Africa/Cairo';

// ============================================================================
// 2. SETTINGS REPOSITORY & LOADER (T1.2)
// ============================================================================

var CACHE_KEY_SETTINGS = 'san_siro_settings_v1';
var SETTINGS_CACHE_TTL_SEC = 300; // 5 minutes

/**
 * Parses hour settings supporting 12-hour (05:00 PM, 5 PM, 5 م) or 24-hour formats.
 *
 * @param {*} raw
 * @param {number} defaultVal
 * @param {boolean} [isCloseHour=false]
 * @param {number} [openHour=14]
 * @returns {number} 0-48 integer hour
 */
function parseConfigHour(raw, defaultVal, isCloseHour, openHour) {
  if (raw === undefined || raw === null || raw === '') return defaultVal;
  if (raw instanceof Date) return raw.getHours();
  var match = String(raw).trim().match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM|am|pm|ص|م)?/i);
  if (match) {
    var h = parseInt(match[1], 10);
    var p = match[3] ? match[3].toUpperCase() : '';
    if (p === 'PM' || p === 'م') {
      if (h < 12) h += 12;
    } else if (p === 'AM' || p === 'ص') {
      if (h === 12) h = 0;
    }
    if (isCloseHour && openHour !== undefined && h < openHour && openHour >= 12) {
      h += 24;
    }
    return h;
  }
  var num = Number(raw);
  return isNaN(num) ? defaultVal : num;
}

/**
 * Loads and parses system configuration from Pricing_Settings sheet with caching.
 *
 * @param {boolean} [forceRefresh=false]
 * @returns {Object} Typed settings object
 */
function getSettings(forceRefresh) {
  var cache = CacheService.getScriptCache();
  if (!forceRefresh) {
    var cached = cache.get(CACHE_KEY_SETTINGS);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (e) {
        // Fall back to reading from sheet if cache is corrupt
      }
    }
  }

  var sheet = getSheet(SHEETS.PRICING_SETTINGS);
  var data = sheet.getDataRange().getValues();
  var rawMap = {};

  // Skip header row if exists
  var startRow = 0;
  if (data.length > 0 && (data[0][0] === 'Key' || data[0][0] === 'المفتاح')) {
    startRow = 1;
  }

  for (var i = startRow; i < data.length; i++) {
    var key = String(data[i][0] || '').trim();
    var val = data[i][1];
    if (key) {
      rawMap[key] = val;
    }
  }

  var openHour = parseConfigHour(rawMap['Open_Hour'], 14);
  var closeHour = parseConfigHour(rawMap['Close_Hour'], 26, true, openHour);
  var nightHour = parseConfigHour(rawMap['Night_Start_Hour'], 17);

  var settings = {
    stadiumName: String(rawMap['Stadium_Name'] || 'San Siro').trim(),
    adminPassword: String(rawMap['Admin_Password'] || rawMap['Admin_PIN'] || 'sansiro2026').trim(),
    pitch1DayRate: Number(rawMap['Pitch_1_Day_Rate']) || 200,
    pitch1NightRate: Number(rawMap['Pitch_1_Night_Rate']) || 250,
    pitch2DayRate: Number(rawMap['Pitch_2_Day_Rate']) || 180,
    pitch2NightRate: Number(rawMap['Pitch_2_Night_Rate']) || 220,
    nightStartHour: nightHour,
    nightStartMinutes: nightHour * 60,
    openHour: openHour,
    closeHour: closeHour,
    slotMinutes: Number(rawMap['Slot_Minutes']) || 60,
    depositAmount: Number(rawMap['Deposit_Amount']) || 50,
    lockMinutes: Number(rawMap['Lock_Minutes']) || 15,
    bookingDaysAhead: Number(rawMap['Booking_Days_Ahead']) || 7,
    noShowThreshold: Number(rawMap['No_Show_Threshold']) || 2,
    blockThreshold: Number(rawMap['Block_Threshold']) || 3,
    paymentInstructions: String(rawMap['Payment_Instructions'] || 'يرجى تحويل العربون لتأكيد الحجز').trim(),
    vodafoneCashNumber: String(rawMap['Vodafone_Cash_Number'] || '').trim(),
    instaPayHandle: String(rawMap['InstaPay_Handle'] || '').trim(),
    ownerWhatsAppNumber: normalizePhone(String(rawMap['Owner_WhatsApp_Number'] || '')),
    ownerEmail: String(rawMap['Owner_Email'] || Session.getEffectiveUser().getEmail() || '').trim()
  };

  try {
    cache.put(CACHE_KEY_SETTINGS, JSON.stringify(settings), SETTINGS_CACHE_TTL_SEC);
  } catch (e) {
    // Cache put failure is non-fatal
  }

  return settings;
}

/**
 * Clears the cached settings.
 */
function clearSettingsCache() {
  CacheService.getScriptCache().remove(CACHE_KEY_SETTINGS);
}

// ============================================================================
// 3. DATE & TIME OPERATIONS IN AFRICA/CAIRO (T1.3)
// ============================================================================

/**
 * Returns current date string in Cairo time (YYYY-MM-DD).
 *
 * @returns {string}
 */
function todayStr() {
  return Utilities.formatDate(new Date(), TIMEZONE_CAIRO, 'yyyy-MM-dd');
}

/**
 * Returns current timestamp in Cairo time.
 *
 * @returns {Date}
 */
function nowInCairo() {
  var now = new Date();
  var cairoStr = Utilities.formatDate(now, TIMEZONE_CAIRO, "yyyy-MM-dd'T'HH:mm:ss");
  return new Date(cairoStr);
}

/**
 * Adds or subtracts days from a YYYY-MM-DD string in Cairo timezone.
 *
 * @param {string} dateStr - Format YYYY-MM-DD
 * @param {number} n - Number of days to add (can be negative)
 * @returns {string} - Resulting YYYY-MM-DD
 */
function addDays(dateStr, n) {
  var parts = String(dateStr).split('-');
  var d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  d.setDate(d.getDate() + n);
  return Utilities.formatDate(d, TIMEZONE_CAIRO, 'yyyy-MM-dd');
}

/**
 * Converts a cell value (Date object or string) into standardized YYYY-MM-DD.
 *
 * @param {*} value
 * @returns {string}
 */
function normalizeDateCell(value) {
  if (!value) return '';
  if (value instanceof Date) {
    return Utilities.formatDate(value, TIMEZONE_CAIRO, 'yyyy-MM-dd');
  }
  var str = String(value).trim();
  // If format is like 2026-10-30T... or 2026/10/30
  if (str.indexOf('T') !== -1) {
    str = str.split('T')[0];
  }
  str = str.replace(/\//g, '-');
  return str;
}

/**
 * Arabic Day Name.
 *
 * @param {string} dateStr - YYYY-MM-DD
 * @returns {string}
 */
function dayNameAr(dateStr) {
  var parts = String(dateStr).split('-');
  var d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  var days = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  return days[d.getDay()];
}

/**
 * English Day Name.
 *
 * @param {string} dateStr - YYYY-MM-DD
 * @returns {string}
 */
function dayNameEn(dateStr) {
  var parts = String(dateStr).split('-');
  var d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  var days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[d.getDay()];
}

/**
 * Arabic Month Name (1-based month).
 *
 * @param {number} monthNum - 1 to 12
 * @returns {string}
 */
function monthNameAr(monthNum) {
  var months = [
    'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
  ];
  return months[(monthNum - 1) % 12] || '';
}

/**
 * Formats slot time range from start minute (relative to operating day) in 12-hour format (hh:mm AM/PM).
 * Handles hours >= 24 gracefully (e.g. 24:00 -> 12:00 AM, 25:00 -> 01:00 AM, 26:00 -> 02:00 AM).
 *
 * @param {number} startMinutes - e.g. 14*60 = 840 (02:00 PM) or 25*60 = 1500 (01:00 AM next morning)
 * @param {number} slotMinutes - Duration in minutes, e.g. 60
 * @returns {string} e.g. "02:00 PM - 03:00 PM" or "08:00 PM - 09:00 PM" or "01:00 AM - 02:00 AM"
 */
function formatSlot(startMinutes, slotMinutes) {
  var endMinutes = startMinutes + slotMinutes;

  function toClock(mins) {
    var rawHours = Math.floor(mins / 60);
    var displayHours = rawHours % 24;
    var displayMins = mins % 60;
    var period = displayHours >= 12 ? 'PM' : 'AM';
    var h12 = displayHours % 12;
    if (h12 === 0) h12 = 12;
    var hh = h12 < 10 ? '0' + h12 : '' + h12;
    var mm = displayMins < 10 ? '0' + displayMins : '' + displayMins;
    return hh + ':' + mm + ' ' + period;
  }

  return toClock(startMinutes) + ' - ' + toClock(endMinutes);
}

/**
 * Parses a slot string like "08:00 PM - 09:00 PM", "01:00 AM - 02:00 AM",
 * Arabic "08:00 م - 09:00 م", or legacy "20:00 - 21:00" into start minute
 * relative to the operating schedule.
 *
 * @param {string} timeSlot - e.g. "08:00 PM - 09:00 PM"
 * @param {number} [openHour=14] - Operating open hour
 * @returns {number} Start minute from base operating day
 */
function parseSlotStart(timeSlot, openHour) {
  if (!timeSlot) return 0;
  if (openHour === undefined) openHour = 14;

  var str = String(timeSlot).trim();
  var match = str.match(/(\d{1,2}):(\d{2})(?:\s*(AM|PM|am|pm|ص|م))?/i);
  if (!match) return 0;

  var hours = parseInt(match[1], 10);
  var minutes = parseInt(match[2], 10);
  var period = match[3] ? match[3].toUpperCase() : '';

  if (period === 'PM' || period === 'م') {
    if (hours < 12) hours += 12;
  } else if (period === 'AM' || period === 'ص') {
    if (hours === 12) hours = 0;
  }

  // If parsed hour is less than openHour and openHour is afternoon/night (e.g., open at 14, slot is 01:00 AM),
  // it corresponds to next calendar day within the operating night (i.e. 24 + hours).
  if (hours < openHour && openHour >= 12) {
    hours += 24;
  }

  return hours * 60 + minutes;
}

// ============================================================================
// 4. PHONE SANITIZATION & VALIDATION (T1.4)
// ============================================================================

/**
 * Normalizes any phone input into standard Egyptian format (01xxxxxxxxx).
 * Handles: Arabic-Indic digits (٠-٩), spaces, dashes, +20, 0020, leading 20.
 *
 * @param {string} input
 * @returns {string} Standard 11-digit Egyptian phone or empty string if unparseable
 */
function normalizePhone(input) {
  if (!input) return '';
  var str = String(input).trim();

  // Convert Arabic-Indic numerals to Latin numerals
  var arabicIndicDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  for (var i = 0; i < 10; i++) {
    str = str.replace(new RegExp(arabicIndicDigits[i], 'g'), String(i));
  }

  // Remove non-digit characters
  var digits = str.replace(/\D/g, '');

  // Strip international prefix (0020 or +20)
  if (digits.indexOf('0020') === 0) {
    digits = digits.substring(4);
  } else if (digits.indexOf('20') === 0 && digits.length === 12) {
    digits = digits.substring(2);
  }

  // Ensure leading zero
  if (digits.length === 10 && (digits.charAt(0) === '1')) {
    digits = '0' + digits;
  }

  return digits;
}

/**
 * Validates whether the phone number is an authentic Egyptian mobile number:
 * 11 digits starting with 010, 011, 012, or 015.
 *
 * @param {string} phone
 * @returns {boolean}
 */
function isValidEgyptianPhone(phone) {
  var normalized = normalizePhone(phone);
  return /^01[0125]\d{8}$/.test(normalized);
}

/**
 * Converts a normalized Egyptian phone to the international WhatsApp format (201xxxxxxxxx).
 *
 * @param {string} phone
 * @returns {string}
 */
function toWhatsAppNumber(phone) {
  var normalized = normalizePhone(phone);
  if (!normalized) return '';
  if (normalized.charAt(0) === '0') {
    return '20' + normalized.substring(1);
  }
  return '20' + normalized;
}

// ============================================================================
// 5. INFRASTRUCTURE & SHEET HELPERS (T1.5)
// ============================================================================

/**
 * Standard Success API Response Envelope
 *
 * @param {*} data
 * @returns {Object}
 */
function responseSuccess(data) {
  return {
    ok: true,
    data: data === undefined ? null : data
  };
}

/**
 * Standard Error API Response Envelope with Arabic explanation
 *
 * @param {string} code - Machine-readable error code
 * @param {string} message - Human-readable Arabic message
 * @param {*} [details=null]
 * @returns {Object}
 */
function responseError(code, message, details) {
  return {
    ok: false,
    code: code || 'ERROR',
    message: message || 'حدث خطأ غير متوقع. يرجى المحاولة لاحقاً.',
    details: details || null
  };
}

/**
 * Returns a Google Sheet by name or throws a structured descriptive error.
 *
 * @param {string} sheetName
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} [ss] - Optional spreadsheet instance
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getSheet(sheetName, ss) {
  var spreadsheet = ss || SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) {
    throw new Error('لم يتم العثور على جدول البيانات النشط. تأكد من ربط الاسكريبت بجدول بيانات Google Sheets.');
  }
  var sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error('لم يتم العثور على ورقة العمل: ' + sheetName + '. يرجى تشغيل Setup أولاً.');
  }
  return sheet;
}

/**
 * Executes a function inside an exclusive atomic Script Lock.
 * Critical for preventing race conditions and double bookings.
 *
 * @param {Function} fn - Function to execute under lock
 * @param {number} [timeoutMs=20000] - Lock wait timeout in ms
 * @returns {*} Return value of fn
 */
function withLock(fn, timeoutMs) {
  var lock = LockService.getScriptLock();
  var waitTime = timeoutMs || 20000;
  var acquired = lock.tryLock(waitTime);

  if (!acquired) {
    throw new Error('النظام مشغول حالياً بمعالجة حجز آخر. يرجى إعادة المحاولة خلال ثوانٍ معدودة.');
  }

  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/**
 * Reads all rows from a sheet and returns array of objects with 1-based row index.
 *
 * @param {string} sheetName
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} [ss]
 * @returns {Array<{rowNum: number, values: Array<*>}>}
 */
function readAllRowsWithIndex(sheetName, ss) {
  var sheet = getSheet(sheetName, ss);
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow <= 1 || lastCol === 0) {
    return [];
  }

  var rangeValues = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var results = [];
  for (var i = 0; i < rangeValues.length; i++) {
    results.push({
      rowNum: i + 2, // 1-based row index in sheet
      values: rangeValues[i]
    });
  }
  return results;
}

/**
 * Finds a row number (1-based) in Customers sheet matching phone.
 *
 * @param {string} phone
 * @param {GoogleAppsScript.Spreadsheet.Sheet} [sheet]
 * @returns {number|null} 1-based row index or null if not found
 */
function findCustomerRow(phone, sheet) {
  var custSheet = sheet || getSheet(SHEETS.CUSTOMERS);
  var targetPhone = normalizePhone(phone);
  if (!targetPhone) return null;

  var lastRow = custSheet.getLastRow();
  if (lastRow <= 1) return null;

  var phoneValues = custSheet.getRange(2, COL.CUSTOMERS.PHONE_NUMBER, lastRow - 1, 1).getValues();
  for (var i = 0; i < phoneValues.length; i++) {
    if (normalizePhone(phoneValues[i][0]) === targetPhone) {
      return i + 2;
    }
  }
  return null;
}

/**
 * Finds a row number (1-based) in Bookings sheet matching bookingId.
 *
 * @param {string} bookingId
 * @param {GoogleAppsScript.Spreadsheet.Sheet} [sheet]
 * @returns {number|null} 1-based row index or null if not found
 */
function findBookingRow(bookingId, sheet) {
  var bookSheet = sheet || getSheet(SHEETS.BOOKINGS);
  if (!bookingId) return null;
  var targetId = String(bookingId).trim();

  var lastRow = bookSheet.getLastRow();
  if (lastRow <= 1) return null;

  var idValues = bookSheet.getRange(2, COL.BOOKINGS.BOOKING_ID, lastRow - 1, 1).getValues();
  for (var i = 0; i < idValues.length; i++) {
    if (String(idValues[i][0]).trim() === targetId) {
      return i + 2;
    }
  }
  return null;
}
