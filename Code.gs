/**
 * San Siro Football Pitch Booking System
 * Module: Code.gs
 * Responsibility: Web App routing (doGet), Player facing API, atomic booking flow,
 * self-service PIN setup & verification, customer lookup, and cancellation workflow.
 *
 * Architecture: Clean Architecture - Application & Controller Layer (Player).
 */

// ============================================================================
// 1. WEB APP ROUTING (T5.1)
// ============================================================================

/**
 * Handles all incoming HTTP GET requests for the Web App.
 * Routes to Admin or Player UI based on query parameters.
 *
 * @param {Object} e - HTTP event object
 * @returns {GoogleAppsScript.HTML.HtmlOutput}
 */
function doGet(e) {
  var params = (e && e.parameter) ? e.parameter : {};
  var page = String(params.page || '').toLowerCase().trim();

  // Admin Route
  if (page === 'admin') {
    var providedKey = params.key || '';
    var isAuth = isAdminAuthorized(providedKey);
    var adminTemplate = HtmlService.createTemplateFromFile('Admin');
    adminTemplate.adminKey = isAuth ? providedKey : '';
    adminTemplate.isAuthorized = isAuth;
    return adminTemplate.evaluate()
      .setTitle('لوحة تحكم الإدارة ⚽ | San Siro')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // Default Route: Player Booking UI
  var playerTemplate = HtmlService.createTemplateFromFile('Index');
  return playerTemplate.evaluate()
    .setTitle('San Siro ⚽ | حجز ملاعب كرة القدم')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Renders an access denied page in Arabic for unauthorized admin attempts.
 *
 * @returns {GoogleAppsScript.HTML.HtmlOutput}
 */
function renderUnauthorizedPage() {
  var html = '<!DOCTYPE html>' +
    '<html dir="rtl" lang="ar">' +
    '<head>' +
    '<meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>غير مصرح بالدخول | San Siro</title>' +
    '<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap" rel="stylesheet">' +
    '<style>' +
    'body { font-family: "Cairo", sans-serif; background: #0A1F1A; color: #FFFFFF; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; text-align: center; }' +
    '.card { background: #132E27; border: 1px solid #1B4338; border-radius: 16px; padding: 32px 24px; max-width: 420px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }' +
    '.icon { font-size: 54px; margin-bottom: 16px; }' +
    'h1 { font-size: 22px; color: #EF4444; margin: 0 0 12px; }' +
    'p { color: #9CA3AF; font-size: 14px; line-height: 1.6; margin: 0 0 24px; }' +
    'a { display: inline-block; background: #0B6E4F; color: #FFFFFF; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 14px; transition: background 0.2s; }' +
    'a:hover { background: #0e8560; }' +
    '</style>' +
    '</head>' +
    '<body>' +
    '<div class="card">' +
    '<div class="icon">🔒</div>' +
    '<h1>عفواً، الدخول غير مصرح</h1>' +
    '<p>رابط لوحة الإدارة الذي تحاول الوصول إليه غير صالح أو يفتقر إلى مفتاح التحقق السري الخاص بالإدارة.</p>' +
    '<a href="?">العودة لصفحة الحجز الرئيسية</a>' +
    '</div>' +
    '</body>' +
    '</html>';

  return HtmlService.createHtmlOutput(html)
    .setTitle('غير مصرح بالدخول | San Siro')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ============================================================================
// 2. PLAYER INITIALIZATION & SLOTS API (T5.2, T5.3)
// ============================================================================

/**
 * Returns initial bootstrap payload for the player booking interface.
 *
 * @returns {Object} Standard API Response with initial client metadata
 */
function getInitData() {
  try {
    var settings = getSettings();
    var today = todayStr();
    var daysAhead = settings.bookingDaysAhead || 7;
    var days = [];

    for (var i = 0; i <= daysAhead; i++) {
      var dStr = addDays(today, i);
      var parts = dStr.split('-');
      var dayNum = parseInt(parts[2], 10);
      var monthNum = parseInt(parts[1], 10);

      var label = '';
      if (i === 0) {
        label = 'اليوم';
      } else if (i === 1) {
        label = 'غداً';
      } else {
        label = dayNameAr(dStr);
      }

      days.push({
        dateStr: dStr,
        labelAr: label,
        dayNameAr: dayNameAr(dStr),
        dayNum: dayNum,
        monthNameAr: monthNameAr(monthNum),
        isToday: i === 0,
        isTomorrow: i === 1
      });
    }

    var data = {
      stadiumName: settings.stadiumName,
      pitches: [PITCHES.PITCH_1, PITCHES.PITCH_2],
      days: days,
      depositAmount: settings.depositAmount,
      lockMinutes: settings.lockMinutes,
      vodafoneCashNumber: settings.vodafoneCashNumber,
      instaPayHandle: settings.instaPayHandle,
      ownerWhatsAppNumber: settings.ownerWhatsAppNumber,
      paymentInstructions: settings.paymentInstructions
    };

    return responseSuccess(data);
  } catch (e) {
    return responseError('INIT_FAILED', 'تعذر تحميل بيانات النظام: ' + e.message);
  }
}

/**
 * Computes and returns available booking slots for a selected pitch and date.
 * Excludes reserved, confirmed, and pending locked slots.
 * Automatically marks promotional discounts.
 *
 * @param {string} pitchId - 'Pitch 1' | 'Pitch 2'
 * @param {string} dateStr - YYYY-MM-DD
 * @returns {Object} Standard API response with array of open slots
 */
function getAvailableSlots(pitchId, dateStr) {
  try {
    if (pitchId !== PITCHES.PITCH_1 && pitchId !== PITCHES.PITCH_2) {
      return responseError('INVALID_PITCH', 'الملعب المحدد غير صالح.');
    }

    var cleanDate = normalizeDateCell(dateStr);
    var today = todayStr();
    var settings = getSettings();

    // Verify date is within booking window
    if (cleanDate < today || cleanDate > addDays(today, settings.bookingDaysAhead)) {
      return responseError('DATE_OUT_OF_RANGE', 'تاريخ الحجز خارج النطاق المتاح للحجز المسبق.');
    }

    // 1. Generate all theoretical slots based on operating hours
    var openHour = settings.openHour;   // e.g. 14
    var closeHour = settings.closeHour; // e.g. 26 (02:00 next day)
    var slotMins = settings.slotMinutes; // e.g. 60

    var generatedSlots = [];
    var totalOpenMinutes = (closeHour - openHour) * 60;
    var steps = Math.floor(totalOpenMinutes / slotMins);

    for (var s = 0; s < steps; s++) {
      var slotStart = (openHour * 60) + (s * slotMins);
      generatedSlots.push({
        startMinutes: slotStart,
        timeSlot: formatSlot(slotStart, slotMins)
      });
    }

    // 2. Load Bookings for this pitch and date
    var bookSheet = getSheet(SHEETS.BOOKINGS);
    var lastRow = bookSheet.getLastRow();
    var occupiedSlots = {};
    var nowMs = new Date().getTime();

    if (lastRow > 1) {
      // Read columns: Date, Time_Slot, Pitch_ID, Slot_Status, Lock_Expiration
      var bookingsData = bookSheet.getRange(2, 1, lastRow - 1, COL.BOOKINGS.LOCK_EXPIRATION).getValues();

      for (var b = 0; b < bookingsData.length; b++) {
        var row = bookingsData[b];
        var rowDate = normalizeDateCell(row[COL.BOOKINGS.DATE - 1]);
        var rowPitch = String(row[COL.BOOKINGS.PITCH_ID - 1] || '').trim();
        var rowSlot = String(row[COL.BOOKINGS.TIME_SLOT - 1] || '').trim();
        var rowStatus = String(row[COL.BOOKINGS.SLOT_STATUS - 1] || '').trim();
        var lockExpVal = row[COL.BOOKINGS.LOCK_EXPIRATION - 1];

        if (rowDate === cleanDate && rowPitch === pitchId) {
          if (rowStatus === STATUS.CONFIRMED || rowStatus === STATUS.OWNER_RESERVED) {
            occupiedSlots[rowSlot] = true;
          } else if (rowStatus === STATUS.PENDING_DEPOSIT) {
            // Check if lock expiration has elapsed
            var isExpired = false;
            if (lockExpVal instanceof Date) {
              isExpired = lockExpVal.getTime() < nowMs;
            } else if (lockExpVal) {
              isExpired = new Date(lockExpVal).getTime() < nowMs;
            }
            if (!isExpired) {
              occupiedSlots[rowSlot] = true;
            }
          }
        }
      }
    }

    // 3. For today: filter out slots whose start time has already elapsed in Cairo
    var currentCairoMinutes = -1;
    if (cleanDate === today) {
      var nowCairo = nowInCairo();
      var cHour = nowCairo.getHours();
      if (cHour < openHour && openHour >= 12) {
        cHour += 24; // Handle post-midnight current time
      }
      currentCairoMinutes = cHour * 60 + nowCairo.getMinutes();
    }

    // 4. Load discounts once for this date to pass into pricing context
    var discounts = loadDiscountsForDate(cleanDate);
    var pricingContext = {
      settings: settings,
      discounts: discounts
    };

    // 5. Build open slots
    var availableList = [];
    var bookedCount = 0;

    for (var g = 0; g < generatedSlots.length; g++) {
      var slot = generatedSlots[g];

      if (occupiedSlots[slot.timeSlot]) {
        bookedCount++;
        continue;
      }

      // Check if past for today (grace period of 10 minutes)
      if (currentCairoMinutes !== -1 && (slot.startMinutes - 10) < currentCairoMinutes) {
        continue;
      }

      // Compute Price
      var priceDetails = getPriceForSlot(pitchId, cleanDate, slot.startMinutes, pricingContext);

      availableList.push({
        timeSlot: slot.timeSlot,
        startMinutes: slot.startMinutes,
        price: priceDetails.price,
        originalPrice: priceDetails.originalPrice,
        isDiscount: priceDetails.isDiscount,
        eventTitle: priceDetails.eventTitle,
        isNight: priceDetails.isNight
      });
    }

    return responseSuccess({
      pitchId: pitchId,
      dateStr: cleanDate,
      slots: availableList,
      bookedCount: bookedCount
    });
  } catch (e) {
    return responseError('SLOTS_FETCH_FAILED', 'فشل تحميل الفترات المتاحة: ' + e.message);
  }
}

// ============================================================================
// 3. CUSTOMER LOOKUP & AUTHENTICATION (T5.4)
// ============================================================================

/**
 * Looks up customer status by phone without revealing any hashes, PINs, or sensitive statistics.
 *
 * @param {string} phone
 * @returns {Object} Standard API response with customer status category
 */
function lookupCustomer(phone) {
  try {
    var cleanPhone = normalizePhone(phone);
    if (!isValidEgyptianPhone(cleanPhone)) {
      return responseError('INVALID_PHONE', 'يرجى إدخال رقم هاتف محمول مصري صحيح (11 رقم).');
    }

    // Check rate limit lockout first
    var rateLimit = checkPinRateLimit(cleanPhone);
    if (!rateLimit.allowed) {
      return responseError(
        'TOO_MANY_ATTEMPTS',
        'تم تعليق المحاولات لهذا الرقم مؤقتاً لتكرار إدخال رمز PIN غير صحيح. يرجى الانتظار ' + rateLimit.remainingMinutes + ' دقيقة.'
      );
    }

    var settings = getSettings();
    var custSheet = getSheet(SHEETS.CUSTOMERS);
    var rowNum = findCustomerRow(cleanPhone, custSheet);

    if (!rowNum) {
      // Unregistered customer
      return responseSuccess({
        state: 'NEW_UNKNOWN',
        name: '',
        remainingAttempts: rateLimit.remainingAttempts
      });
    }

    // Read customer record
    var rowData = custSheet.getRange(rowNum, 1, 1, COL.CUSTOMERS.CREATED_AT).getValues()[0];
    var playerName = String(rowData[COL.CUSTOMERS.PLAYER_NAME - 1] || '').trim();
    var pinHash = String(rowData[COL.CUSTOMERS.PIN - 1] || '').trim();
    var status = String(rowData[COL.CUSTOMERS.STATUS - 1] || CUSTOMER_STATUS.NEW).trim();
    var noShowCount = Number(rowData[COL.CUSTOMERS.NO_SHOW_COUNT - 1]) || 0;

    // Check Blocked status
    if (status === CUSTOMER_STATUS.BLOCKED || noShowCount >= settings.blockThreshold) {
      return responseSuccess({
        state: 'BLOCKED',
        name: playerName,
        message: 'الحجز الإلكتروني مقيد لهذا الرقم لمخالفة تعليمات الحضور. يرجى التواصل مع إدارة الملعب مباشرة.'
      });
    }

    // Check Trusted status
    if (status === CUSTOMER_STATUS.TRUSTED) {
      if (!pinHash) {
        return responseSuccess({
          state: 'TRUSTED_SETUP',
          name: playerName,
          message: 'أهلاً بك كابتن ' + playerName + '! يرجى تعيين رمز PIN المكون من 4 أرقام لتأمين حجوزاتك الفورية.'
        });
      } else {
        return responseSuccess({
          state: 'TRUSTED_PIN',
          name: playerName,
          remainingAttempts: rateLimit.remainingAttempts
        });
      }
    }

    // Status is 'New'
    if (pinHash) {
      return responseSuccess({
        state: 'NEW_KNOWN',
        name: playerName,
        remainingAttempts: rateLimit.remainingAttempts
      });
    } else {
      return responseSuccess({
        state: 'NEW_UNKNOWN',
        name: playerName,
        remainingAttempts: rateLimit.remainingAttempts
      });
    }
  } catch (e) {
    return responseError('LOOKUP_FAILED', 'فشل التحقق من بيانات اللاعب: ' + e.message);
  }
}

// ============================================================================
// 4. ATOMIC BOOKING TRANSACTION (T5.5, T5.6)
// ============================================================================

/**
 * Generates an atomic sequential Booking ID format BK-YYYYMMDD-XXXX.
 *
 * @param {string} dateStr - YYYY-MM-DD
 * @returns {string} Unique Booking ID
 */
function generateBookingId(dateStr) {
  var props = PropertiesService.getScriptProperties();
  var cleanDate = dateStr.replace(/-/g, '');
  var key = 'COUNTER_' + cleanDate;
  var currentVal = Number(props.getProperty(key)) || 100;
  var nextVal = currentVal + 1;
  props.setProperty(key, String(nextVal));

  return 'BK-' + cleanDate + '-' + nextVal;
}

/**
 * Handles the complete booking verification and persistence inside an atomic lock.
 * Prevents double-booking and handles Trusted vs New flows seamlessly.
 *
 * @param {Object} payload
 * @returns {Object} Standard API response
 */
function verifyAndBook(payload) {
  return withLock(function () {
    try {
      if (!payload) {
        return responseError('INVALID_PAYLOAD', 'بيانات الحجز غير مكتملة.');
      }

      var pitchId = String(payload.pitchId || '').trim();
      var dateStr = normalizeDateCell(payload.date);
      var timeSlot = String(payload.timeSlot || '').trim();
      var phone = normalizePhone(payload.phone);
      var name = String(payload.name || '').trim();
      var pin = normalizePinInput(payload.pin);
      var isSettingPin = !!payload.isSettingPin;

      // 1. Validation
      if (pitchId !== PITCHES.PITCH_1 && pitchId !== PITCHES.PITCH_2) {
        return responseError('INVALID_PITCH', 'الملعب المحدد غير صالح.');
      }
      if (!isValidEgyptianPhone(phone)) {
        return responseError('INVALID_PHONE', 'رقم الهاتف المحمول غير صحيح.');
      }
      if (!isValidPinFormat(pin)) {
        return responseError('INVALID_PIN', 'رمز الـ PIN يجب أن يتكون من 4 أرقام تماماً.');
      }

      var settings = getSettings();
      var today = todayStr();

      if (dateStr < today || dateStr > addDays(today, settings.bookingDaysAhead)) {
        return responseError('INVALID_DATE', 'تاريخ الحجز خارج النطاق المسموح.');
      }

      // Check Rate Limit
      var rateLimit = checkPinRateLimit(phone);
      if (!rateLimit.allowed) {
        return responseError('TOO_MANY_ATTEMPTS', 'تم قفل الحساب مؤقتاً لتكرار إدخال رمز PIN خاطئ.');
      }

      // 2. Double-Booking Check (inside Lock)
      var bookSheet = getSheet(SHEETS.BOOKINGS);
      var lastRow = bookSheet.getLastRow();
      var now = new Date();
      var nowMs = now.getTime();

      if (lastRow > 1) {
        var existing = bookSheet.getRange(2, 1, lastRow - 1, COL.BOOKINGS.LOCK_EXPIRATION).getValues();
        for (var i = 0; i < existing.length; i++) {
          var rDate = normalizeDateCell(existing[i][COL.BOOKINGS.DATE - 1]);
          var rPitch = String(existing[i][COL.BOOKINGS.PITCH_ID - 1] || '').trim();
          var rSlot = String(existing[i][COL.BOOKINGS.TIME_SLOT - 1] || '').trim();
          var rStatus = String(existing[i][COL.BOOKINGS.SLOT_STATUS - 1] || '').trim();
          var rLockExp = existing[i][COL.BOOKINGS.LOCK_EXPIRATION - 1];

          if (rDate === dateStr && rPitch === pitchId && rSlot === timeSlot) {
            if (rStatus === STATUS.CONFIRMED || rStatus === STATUS.OWNER_RESERVED) {
              return responseError('SLOT_TAKEN', 'عفواً، تم حجز هذه الفترة للتو من قبل لاعب آخر.');
            }
            if (rStatus === STATUS.PENDING_DEPOSIT) {
              var expMs = rLockExp instanceof Date ? rLockExp.getTime() : new Date(rLockExp).getTime();
              if (expMs > nowMs) {
                return responseError('SLOT_LOCKED', 'هذه الفترة محجوزة مؤقتاً بانتظار إيداع العربون.');
              }
            }
          }
        }
      }

      // 3. Customer Authentication & State Resolution
      var custSheet = getSheet(SHEETS.CUSTOMERS);
      var custRowNum = findCustomerRow(phone, custSheet);
      var customerStatus = CUSTOMER_STATUS.NEW;
      var storedHash = '';
      var playerName = name;

      if (custRowNum) {
        var cData = custSheet.getRange(custRowNum, 1, 1, COL.CUSTOMERS.CREATED_AT).getValues()[0];
        playerName = String(cData[COL.CUSTOMERS.PLAYER_NAME - 1] || name).trim();
        storedHash = String(cData[COL.CUSTOMERS.PIN - 1] || '').trim();
        customerStatus = String(cData[COL.CUSTOMERS.STATUS - 1] || CUSTOMER_STATUS.NEW).trim();
        var noShows = Number(cData[COL.CUSTOMERS.NO_SHOW_COUNT - 1]) || 0;

        if (customerStatus === CUSTOMER_STATUS.BLOCKED || noShows >= settings.blockThreshold) {
          return responseError('CUSTOMER_BLOCKED', 'الحجز محظور لهذا الرقم. يرجى التواصل مع إدارة الملعب.');
        }

        // Setting PIN on first visit
        if (!storedHash && isSettingPin) {
          if (isWeakPin(pin)) {
            return responseError('WEAK_PIN', 'رمز الـ PIN ضعيف وسهل التخمين. يرجى اختيار رمز غير متكرر أو متسلسل.');
          }
          storedHash = hashPin(phone, pin);
          custSheet.getRange(custRowNum, COL.CUSTOMERS.PIN).setValue(storedHash);
        } else if (storedHash) {
          // Verify PIN
          var isMatch = verifyPin(phone, pin, storedHash);
          if (!isMatch) {
            var failStatus = registerFailedAttempt(phone);
            if (!failStatus.allowed) {
              return responseError('TOO_MANY_ATTEMPTS', 'تم قفل الحساب لمدة 30 دقيقة بسبب 5 محاولات خاطئة.');
            }
            return responseError('WRONG_PIN', 'رمز PIN غير صحيح. المحاولات المتبقية: ' + failStatus.remainingAttempts);
          }
          clearPinAttempts(phone);
        }
      } else {
        // Brand new unregistered customer
        if (!name || name.length < 2) {
          return responseError('NAME_REQUIRED', 'يرجى إدخال اسم اللاعب ثلاثي أو ثنائي على الأقل.');
        }
        if (isWeakPin(pin)) {
          return responseError('WEAK_PIN', 'رمز الـ PIN المختار ضعيف. تجنب استخدام 0000 أو 1234.');
        }

        storedHash = hashPin(phone, pin);
        customerStatus = CUSTOMER_STATUS.NEW;
        playerName = name;

        // Append new customer
        var newCustRow = [
          phone,
          playerName,
          storedHash,
          CUSTOMER_STATUS.NEW,
          0, // Total Bookings
          0, // No Show Count
          '', // Last Booking Date
          'حجز ذاتي لأول مرة',
          Utilities.formatDate(now, TIMEZONE_CAIRO, "yyyy-MM-dd'T'HH:mm:ss")
        ];
        custSheet.appendRow(newCustRow);
      }

      // 4. Calculate Final Price
      var startMinutes = parseSlotStart(timeSlot, settings.openHour);
      var priceResult = getPriceForSlot(pitchId, dateStr, startMinutes, { settings: settings });
      var finalPrice = priceResult.price;
      var bookingId = generateBookingId(dateStr);
      var dayName = dayNameAr(dateStr);
      var timestampStr = Utilities.formatDate(now, TIMEZONE_CAIRO, "yyyy-MM-dd'T'HH:mm:ss");

      // 5. Branch: Trusted (Instant Confirmation) vs New (Pending Deposit)
      if (customerStatus === CUSTOMER_STATUS.TRUSTED) {
        // INSTANT CONFIRMATION
        var confirmedBookingRow = [
          bookingId,
          dateStr,
          dayName,
          timeSlot,
          pitchId,
          STATUS.CONFIRMED,
          playerName,
          phone,
          finalPrice,
          0, // No deposit required
          finalPrice, // Remaining Cash
          '', // No lock expiration
          timestampStr,
          'Online',
          ''
        ];

        bookSheet.appendRow(confirmedBookingRow);

        // Update customer statistics
        if (custRowNum) {
          var curBookings = Number(custSheet.getRange(custRowNum, COL.CUSTOMERS.TOTAL_BOOKINGS).getValue()) || 0;
          custSheet.getRange(custRowNum, COL.CUSTOMERS.TOTAL_BOOKINGS).setValue(curBookings + 1);
          custSheet.getRange(custRowNum, COL.CUSTOMERS.LAST_BOOKING_DATE).setValue(dateStr);
        }

        return responseSuccess({
          flow: 'CONFIRMED',
          ticket: {
            bookingId: bookingId,
            playerName: playerName,
            pitchId: pitchId,
            dateStr: dateStr,
            dayName: dayName,
            timeSlot: timeSlot,
            price: finalPrice,
            stadiumName: settings.stadiumName
          }
        });

      } else {
        // PENDING DEPOSIT FLOW (New Customer)
        var lockMins = settings.lockMinutes || 15;
        var lockExpDate = new Date(now.getTime() + (lockMins * 60 * 1000));
        var lockExpStr = Utilities.formatDate(lockExpDate, TIMEZONE_CAIRO, "yyyy-MM-dd'T'HH:mm:ss");
        var depositAmt = settings.depositAmount || 50;

        var pendingBookingRow = [
          bookingId,
          dateStr,
          dayName,
          timeSlot,
          pitchId,
          STATUS.PENDING_DEPOSIT,
          playerName,
          phone,
          finalPrice,
          depositAmt,
          Math.max(0, finalPrice - depositAmt),
          lockExpStr,
          timestampStr,
          'Online',
          ''
        ];

        bookSheet.appendRow(pendingBookingRow);

        // Generate WhatsApp Receipt Link
        var waMessage = 'السلام عليكم يا كابتن ⚽' + '\n' +
          'حجزت فترة في ' + settings.stadiumName + ' بانتظار تأكيد العربون:' + '\n' +
          '• رقم الحجز: ' + bookingId + '\n' +
          '• الكابتن: ' + playerName + '\n' +
          '• الملعب: ' + pitchId + '\n' +
          '• الموعد: ' + dayName + ' ' + dateStr + ' (' + timeSlot + ')' + '\n' +
          '• قيمة العربون: ' + depositAmt + ' جنيه' + '\n\n' +
          'مرفق صورة إشعار التحويل لتثبيت الحجز.';

        var targetOwnerWa = toWhatsAppNumber(settings.ownerWhatsAppNumber);
        var waUrl = 'https://wa.me/' + targetOwnerWa + '?text=' + encodeURIComponent(waMessage);

        return responseSuccess({
          flow: 'PENDING',
          pending: {
            bookingId: bookingId,
            playerName: playerName,
            pitchId: pitchId,
            dateStr: dateStr,
            dayName: dayName,
            timeSlot: timeSlot,
            price: finalPrice,
            depositAmount: depositAmt,
            remainingCash: Math.max(0, finalPrice - depositAmt),
            expiresAt: lockExpDate.toISOString(),
            lockMinutes: lockMins,
            vodafoneCashNumber: settings.vodafoneCashNumber,
            instaPayHandle: settings.instaPayHandle,
            paymentInstructions: settings.paymentInstructions,
            whatsappReceiptUrl: waUrl
          }
        });
      }
    } catch (e) {
      return responseError('BOOKING_ERROR', 'فشلت عملية الحجز: ' + e.message);
    }
  });
}

// ============================================================================
// 5. CANCELLATION WORKFLOW & DEADLINE ENFORCEMENT (T5.7, T5.8)
// ============================================================================

/**
 * Retrieves active upcoming bookings for a verified customer.
 *
 * @param {string} phone
 * @param {string} pin
 * @returns {Object} Standard API response with array of player's bookings
 */
function getMyBookings(phone, pin) {
  try {
    var cleanPhone = normalizePhone(phone);
    var cleanPin = normalizePinInput(pin);

    if (!isValidEgyptianPhone(cleanPhone) || !isValidPinFormat(cleanPin)) {
      return responseError('INVALID_CREDENTIALS', 'يرجى إدخال رقم هاتف صحيح ورمز PIN المكون من 4 أرقام.');
    }

    var rateLimit = checkPinRateLimit(cleanPhone);
    if (!rateLimit.allowed) {
      return responseError('TOO_MANY_ATTEMPTS', 'تم قفل الحساب مؤقتاً لتكرار إدخال رمز PIN خاطئ.');
    }

    var custSheet = getSheet(SHEETS.CUSTOMERS);
    var custRowNum = findCustomerRow(cleanPhone, custSheet);
    if (!custRowNum) {
      return responseError('NOT_FOUND', 'لم يتم العثور على حساب مسجل بهذا الرقم.');
    }

    var storedHash = String(custSheet.getRange(custRowNum, COL.CUSTOMERS.PIN).getValue() || '').trim();
    if (!verifyPin(cleanPhone, cleanPin, storedHash)) {
      var failStatus = registerFailedAttempt(cleanPhone);
      return responseError('WRONG_PIN', 'رمز PIN غير صحيح. المحاولات المتبقية: ' + failStatus.remainingAttempts);
    }
    clearPinAttempts(cleanPhone);

    var bookSheet = getSheet(SHEETS.BOOKINGS);
    var lastRow = bookSheet.getLastRow();
    if (lastRow <= 1) {
      return responseSuccess({ bookings: [] });
    }

    var data = bookSheet.getRange(2, 1, lastRow - 1, COL.BOOKINGS.CANCELLED_AT).getValues();
    var today = todayStr();
    var results = [];

    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      var rPhone = normalizePhone(row[COL.BOOKINGS.PLAYER_PHONE - 1]);
      var rStatus = String(row[COL.BOOKINGS.SLOT_STATUS - 1] || '').trim();
      var rDate = normalizeDateCell(row[COL.BOOKINGS.DATE - 1]);

      // Only show upcoming matches that are not cancelled or expired
      if (rPhone === cleanPhone && (rStatus === STATUS.CONFIRMED || rStatus === STATUS.PENDING_DEPOSIT || rStatus === STATUS.OWNER_RESERVED)) {
        if (rDate >= today) {
          var canCancel = today < rDate; // Strict advance rule: strictly before match day
          var reason = canCancel ? '' : 'لا يمكن الإلغاء الآلي في نفس يوم المباراة. يرجى التواصل مع الإدارة مباشرة.';

          results.push({
            bookingId: String(row[COL.BOOKINGS.BOOKING_ID - 1]),
            dateStr: rDate,
            dayName: String(row[COL.BOOKINGS.DAY_NAME - 1]),
            timeSlot: String(row[COL.BOOKINGS.TIME_SLOT - 1]),
            pitchId: String(row[COL.BOOKINGS.PITCH_ID - 1]),
            status: rStatus,
            price: Number(row[COL.BOOKINGS.CALCULATED_PRICE - 1]) || 0,
            deposit: Number(row[COL.BOOKINGS.DEPOSIT_AMOUNT - 1]) || 0,
            remainingCash: Number(row[COL.BOOKINGS.REMAINING_CASH - 1]) || 0,
            canCancel: canCancel,
            cancelNotice: reason
          });
        }
      }
    }

    // Sort chronologically
    results.sort(function (a, b) {
      if (a.dateStr !== b.dateStr) return a.dateStr.localeCompare(b.dateStr);
      return parseSlotStart(a.timeSlot) - parseSlotStart(b.timeSlot);
    });

    return responseSuccess({ bookings: results });
  } catch (e) {
    return responseError('FETCH_FAILED', 'تعذر تحميل الحجوزات: ' + e.message);
  }
}

/**
 * Cancels an upcoming reservation respecting the strict 1-day advance deadline.
 *
 * @param {string} phone
 * @param {string} pin
 * @param {string} bookingId
 * @returns {Object} Standard API response
 */
function cancelBooking(phone, pin, bookingId) {
  return withLock(function () {
    try {
      var cleanPhone = normalizePhone(phone);
      var cleanPin = normalizePinInput(pin);
      var targetId = String(bookingId || '').trim();

      if (!isValidEgyptianPhone(cleanPhone) || !isValidPinFormat(cleanPin) || !targetId) {
        return responseError('INVALID_INPUT', 'بيانات الإلغاء غير مكتملة.');
      }

      var rateLimit = checkPinRateLimit(cleanPhone);
      if (!rateLimit.allowed) {
        return responseError('TOO_MANY_ATTEMPTS', 'تم قفل الحساب مؤقتاً.');
      }

      var custSheet = getSheet(SHEETS.CUSTOMERS);
      var custRowNum = findCustomerRow(cleanPhone, custSheet);
      if (!custRowNum) {
        return responseError('CUSTOMER_NOT_FOUND', 'لم يتم العثور على حساب العميل.');
      }

      var storedHash = String(custSheet.getRange(custRowNum, COL.CUSTOMERS.PIN).getValue() || '').trim();
      if (!verifyPin(cleanPhone, cleanPin, storedHash)) {
        var failStatus = registerFailedAttempt(cleanPhone);
        return responseError('WRONG_PIN', 'رمز PIN غير صحيح.');
      }
      clearPinAttempts(cleanPhone);

      var bookSheet = getSheet(SHEETS.BOOKINGS);
      var bookRowNum = findBookingRow(targetId, bookSheet);
      if (!bookRowNum) {
        return responseError('BOOKING_NOT_FOUND', 'لم يتم العثور على الحجز المطلوب.');
      }

      var bookingData = bookSheet.getRange(bookRowNum, 1, 1, COL.BOOKINGS.CANCELLED_AT).getValues()[0];
      var bookPhone = normalizePhone(bookingData[COL.BOOKINGS.PLAYER_PHONE - 1]);
      var bookDate = normalizeDateCell(bookingData[COL.BOOKINGS.DATE - 1]);
      var curStatus = String(bookingData[COL.BOOKINGS.SLOT_STATUS - 1] || '').trim();

      if (bookPhone !== cleanPhone) {
        return responseError('UNAUTHORIZED_BOOKING', 'لا يمكنك إلغاء حجز مسجل لرقم هاتف آخر.');
      }

      if (curStatus === STATUS.CANCELLED || curStatus === STATUS.EXPIRED) {
        return responseError('ALREADY_CANCELLED', 'هذا الحجز ملغي بالفعل مسبقاً.');
      }

      // Strict Deadline Check: Allowed strictly before match day (i.e. todayStr() < bookDate)
      var today = todayStr();
      if (today >= bookDate) {
        return responseError(
          'DEADLINE_PASSED',
          'تم إغلاق الإلغاء الآلي لمباريات اليوم (الموعد النهائي كان 11:59 مساء أمس). يرجى التواصل مع الإدارة مباشرة. الغياب بدون إذن سيتم تسجيله كحالة عدم حضور (No-Show).'
        );
      }

      // Apply cancellation: update status and timestamp
      var nowStr = Utilities.formatDate(new Date(), TIMEZONE_CAIRO, "yyyy-MM-dd'T'HH:mm:ss");
      bookSheet.getRange(bookRowNum, COL.BOOKINGS.SLOT_STATUS).setValue(STATUS.CANCELLED);
      bookSheet.getRange(bookRowNum, COL.BOOKINGS.CANCELLED_AT).setValue(nowStr);

      return responseSuccess({
        message: 'تم إلغاء الحجز بنجاح وأصبحت الفترة متاحة مجدداً في الجدول.',
        bookingId: targetId
      });
    } catch (e) {
      return responseError('CANCEL_FAILED', 'فشلت عملية الإلغاء: ' + e.message);
    }
  });
}
