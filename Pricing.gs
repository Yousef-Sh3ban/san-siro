/**
 * San Siro Football Pitch Booking System
 * Module: Pricing.gs
 * Responsibility: Price calculation engine, Day/Night tiered pricing rules,
 * promotional & big-match discount matching, and priority resolution.
 *
 * Architecture: Clean Architecture - Domain / Pricing Layer.
 */

// ============================================================================
// 1. BASE RATE EVALUATION (T4.1)
// ============================================================================

/**
 * Determines whether a slot qualifies for night rate and returns the base price.
 *
 * @param {string} pitchId - 'Pitch 1' | 'Pitch 2'
 * @param {number} startMinutes - Minutes from start of operating day (e.g. 14:00 = 840, 24:00 = 1440)
 * @param {Object} settings - Loaded system settings
 * @returns {{basePrice: number, isNight: boolean}}
 */
function getBaseRate(pitchId, startMinutes, settings) {
  var nightCutoffMinutes = settings.nightStartMinutes || (17 * 60);

  // Any slot starting at or after the cutoff hour (including post-midnight hours >= 24:00) is Night
  var isNight = startMinutes >= nightCutoffMinutes;

  var basePrice;
  if (pitchId === PITCHES.PITCH_2) {
    basePrice = isNight ? settings.pitch2NightRate : settings.pitch2DayRate;
  } else {
    // Default to Pitch 1
    basePrice = isNight ? settings.pitch1NightRate : settings.pitch1DayRate;
  }

  return {
    basePrice: Number(basePrice) || 0,
    isNight: isNight
  };
}

// ============================================================================
// 2. DISCOUNT LOOKUP & PARSING (T4.2)
// ============================================================================

/**
 * Parses time cell value from Discounts sheet (string "08:00 PM", "8:00 م", "20:00", or Date object)
 * into minutes from midnight (0 to 1439).
 *
 * @param {*} timeCell
 * @returns {number}
 */
function parseDiscountTimeCell(timeCell) {
  if (!timeCell) return 0;

  if (timeCell instanceof Date) {
    return timeCell.getHours() * 60 + timeCell.getMinutes();
  }

  var str = String(timeCell).trim();
  var match = str.match(/(\d{1,2}):(\d{2})(?:\s*(AM|PM|am|pm|ص|م))?/i);
  if (match) {
    var hours = parseInt(match[1], 10);
    var mins = parseInt(match[2], 10);
    var period = match[3] ? match[3].toUpperCase() : '';
    if (period === 'PM' || period === 'م') {
      if (hours < 12) hours += 12;
    } else if (period === 'AM' || period === 'ص') {
      if (hours === 12) hours = 0;
    }
    return hours * 60 + mins;
  }

  return 0;
}

/**
 * Loads and filters active discounts for a specific date.
 * Reads Discounts sheet once and returns structured rules.
 *
 * @param {string} dateStr - Target date YYYY-MM-DD
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} [ss]
 * @returns {Array<Object>} List of applicable discount rules
 */
function loadDiscountsForDate(dateStr, ss) {
  var sheet = getSheet(SHEETS.DISCOUNTS, ss);
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  var data = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
  var targetDate = normalizeDateCell(dateStr);
  var activeDiscounts = [];

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var rowDate = normalizeDateCell(row[COL.DISCOUNTS.DATE - 1]);

    if (rowDate === targetDate) {
      var startMin = parseDiscountTimeCell(row[COL.DISCOUNTS.START_TIME - 1]);
      var endMin = parseDiscountTimeCell(row[COL.DISCOUNTS.END_TIME - 1]);

      // If end time is earlier than start time (e.g. 20:00 to 02:00), adjust for midnight crossing
      if (endMin <= startMin && endMin > 0) {
        endMin += 24 * 60;
      } else if (endMin === 0 && startMin > 0) {
        // e.g. 00:00 means 24:00 (midnight)
        endMin = 24 * 60;
      }

      var pitchRule = String(row[COL.DISCOUNTS.APPLICABLE_PITCH - 1] || 'All').trim();
      var discountedPrice = Number(row[COL.DISCOUNTS.DISCOUNTED_PRICE - 1]);
      var eventTitle = String(row[COL.DISCOUNTS.EVENT_TITLE - 1] || 'عرض خاص').trim();

      if (!isNaN(discountedPrice) && discountedPrice > 0) {
        activeDiscounts.push({
          startMinutes: startMin,
          endMinutes: endMin,
          applicablePitch: pitchRule,
          discountedPrice: discountedPrice,
          eventTitle: eventTitle
        });
      }
    }
  }

  return activeDiscounts;
}

// ============================================================================
// 3. FINAL PRICE RESOLUTION ENGINE (T4.3)
// ============================================================================

/**
 * Calculates the final price for a specific slot, taking into account
 * base rates, night premiums, promotional discounts, and specificity rules.
 *
 * Resolution Priority:
 * 1. Pitch-specific discount for the exact pitch (e.g. "Pitch 1") takes precedence over "All".
 * 2. If multiple discounts match at the same priority, the lowest price wins.\n * 3. If no discount matches, standard base rate (Day vs Night) applies.
 *
 * @param {string} pitchId - 'Pitch 1' | 'Pitch 2'
 * @param {string} dateStr - YYYY-MM-DD
 * @param {number} startMinutes - Minutes from start of operating day
 * @param {Object} [ctx] - Optional context: { settings, discounts }
 * @returns {Object} Price calculation details
 */
function getPriceForSlot(pitchId, dateStr, startMinutes, ctx) {
  var context = ctx || {};
  var settings = context.settings || getSettings();
  var discounts = context.discounts;

  if (!discounts) {
    discounts = loadDiscountsForDate(dateStr);
  }

  // 1. Calculate Base Rate
  var baseRateInfo = getBaseRate(pitchId, startMinutes, settings);
  var basePrice = baseRateInfo.basePrice;
  var isNight = baseRateInfo.isNight;

  // 2. Evaluate Discounts
  // Compare slot start time with discount windows.
  // Normalize slot minutes if slot extends past midnight (e.g. 24:00 = 1440)
  var matchedSpecific = null;
  var matchedGeneral = null;

  for (var i = 0; i < discounts.length; i++) {
    var disc = discounts[i];
    var inWindow = (startMinutes >= disc.startMinutes && startMinutes < disc.endMinutes);

    // Also check modulo 1440 in case discount was specified as 00:00 - 02:00
    if (!inWindow && startMinutes >= 1440) {
      var moduloStart = startMinutes % 1440;
      inWindow = (moduloStart >= disc.startMinutes && moduloStart < disc.endMinutes);
    }

    if (inWindow) {
      if (disc.applicablePitch === pitchId) {
        if (!matchedSpecific || disc.discountedPrice < matchedSpecific.discountedPrice) {
          matchedSpecific = disc;
        }
      } else if (disc.applicablePitch === 'All') {
        if (!matchedGeneral || disc.discountedPrice < matchedGeneral.discountedPrice) {
          matchedGeneral = disc;
        }
      }
    }
  }

  // Pitch-specific discount wins over general 'All' discount
  var winningDiscount = matchedSpecific || matchedGeneral;

  if (winningDiscount && winningDiscount.discountedPrice < basePrice) {
    return {
      price: winningDiscount.discountedPrice,
      originalPrice: basePrice,
      isDiscount: true,
      eventTitle: winningDiscount.eventTitle,
      isNight: isNight
    };
  }

  // Standard pricing without discount
  return {
    price: basePrice,
    originalPrice: basePrice,
    isDiscount: false,
    eventTitle: null,
    isNight: isNight
  };
}
