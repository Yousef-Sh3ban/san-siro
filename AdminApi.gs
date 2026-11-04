/**
 * San Siro Football Pitch Booking System
 * Module: Admin.gs
 * Responsibility: Secure Administrative API endpoints: Daily match dashboards,
 * 1-click WhatsApp reminders for tomorrow, phone/walk-in reservations,
 * maintenance slot blocking, and manual status transitions.
 *
 * Architecture: Clean Architecture - Application & Controller Layer (Admin).
 */

// ============================================================================
// 1. DASHBOARD & REMINDER RETRIEVAL (T7.0)
// ============================================================================

/**
 * Retrieves the comprehensive administrative dashboard for Today and Tomorrow.
 * Includes pre-built 1-click WhatsApp reminder links.
 *
 * @param {string} key - Secret admin key
 * @param {string} [targetDate] - Target date YYYY-MM-DD (defaults to today)
 * @returns {Object} Standard API response with admin dashboard data
 */
function getAdminDashboard(key, targetDate) {
  try {
    assertAdmin(key);

    var settings = getSettings();
    var today = todayStr();
    var selectedDate = targetDate ? normalizeDateCell(targetDate) : today;
    var tomorrow = addDays(selectedDate, 1);

    var bookSheet = getSheet(SHEETS.BOOKINGS);
    var lastRow = bookSheet.getLastRow();
    var rows = [];

    if (lastRow > 1) {
      rows = bookSheet.getRange(2, 1, lastRow - 1, COL.BOOKINGS.CANCELLED_AT).getValues();
    }

    var selectedMatches = { pitch1: [], pitch2: [] };
    var tomorrowMatches = { pitch1: [], pitch2: [] };
    var pendingReview = [];

    var todayExpectedCash = 0;
    var todayConfirmedCount = 0;

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var bId = String(r[COL.BOOKINGS.BOOKING_ID - 1]);
      var bDate = normalizeDateCell(r[COL.BOOKINGS.DATE - 1]);
      var bDay = String(r[COL.BOOKINGS.DAY_NAME - 1]);
      var bSlot = String(r[COL.BOOKINGS.TIME_SLOT - 1]);
      var bPitch = String(r[COL.BOOKINGS.PITCH_ID - 1]);
      var bStatus = String(r[COL.BOOKINGS.SLOT_STATUS - 1]);
      var bName = String(r[COL.BOOKINGS.PLAYER_NAME - 1]);
      var bPhone = normalizePhone(r[COL.BOOKINGS.PLAYER_PHONE - 1]);
      var bPrice = Number(r[COL.BOOKINGS.CALCULATED_PRICE - 1]) || 0;
      var bDeposit = Number(r[COL.BOOKINGS.DEPOSIT_AMOUNT - 1]) || 0;
      var remVal = r[COL.BOOKINGS.REMAINING_CASH - 1];
      var bRemaining = (remVal !== undefined && remVal !== '' && !isNaN(Number(remVal))) ? Number(remVal) : Math.max(0, bPrice - bDeposit);
      var bSource = String(r[COL.BOOKINGS.SOURCE - 1] || 'Online');

      var item = {
        bookingId: bId,
        dateStr: bDate,
        dayName: bDay,
        timeSlot: bSlot,
        pitchId: bPitch,
        status: bStatus,
        playerName: bName,
        phone: bPhone,
        price: bPrice,
        deposit: bDeposit,
        remainingCash: bRemaining,
        source: bSource
      };

      // Collect pending deposits that need verification
      if (bStatus === STATUS.PENDING_DEPOSIT) {
        pendingReview.push(item);
      }

      // Group for Selected Date (Today)
      if (bDate === selectedDate) {
        if (bStatus === STATUS.CONFIRMED || bStatus === STATUS.OWNER_RESERVED) {
          todayConfirmedCount++;
          todayExpectedCash += bRemaining;
        }

        if (bPitch === PITCHES.PITCH_1) {
          selectedMatches.pitch1.push(item);
        } else {
          selectedMatches.pitch2.push(item);
        }
      }

      // Group for Tomorrow (with Reminder Link)
      if (bDate === tomorrow) {
        // Pre-build personalized WhatsApp reminder message for confirmed or reserved matches
        if (bStatus === STATUS.CONFIRMED || bStatus === STATUS.OWNER_RESERVED) {
          var reminderText = 'تذكير يا كابتن ' + bName + ' ⚽:\n' +
            'موعد مباراتكم غداً ' + bDay + ' في ملعب (' + bPitch + ') الساعة ' + bSlot + '.\n' +
            'ننتظركم في الموعد بملعب ' + settings.stadiumName + '، علماً بأن اليوم هو آخر موعد متاح للإلغاء المسبق.\n' +
            'المبلغ المتبقي كاش في الملعب: ' + bRemaining + ' جنيه.';

          var waNumber = toWhatsAppNumber(bPhone);
          item.reminderUrl = 'https://wa.me/' + waNumber + '?text=' + encodeURIComponent(reminderText);
        } else {
          item.reminderUrl = null;
        }

        if (bPitch === PITCHES.PITCH_1) {
          tomorrowMatches.pitch1.push(item);
        } else {
          tomorrowMatches.pitch2.push(item);
        }
      }
    }

    // Sort slots chronologically
    function sortBySlot(a, b) {
      return parseSlotStart(a.timeSlot) - parseSlotStart(b.timeSlot);
    }
    selectedMatches.pitch1.sort(sortBySlot);
    selectedMatches.pitch2.sort(sortBySlot);
    tomorrowMatches.pitch1.sort(sortBySlot);
    tomorrowMatches.pitch2.sort(sortBySlot);

    return responseSuccess({
      selectedDate: selectedDate,
      selectedDateAr: dayNameAr(selectedDate) + ' (' + selectedDate + ')',
      tomorrowDate: tomorrow,
      tomorrowDateAr: dayNameAr(tomorrow) + ' (' + tomorrow + ')',
      selectedMatches: selectedMatches,
      tomorrowMatches: tomorrowMatches,
      pendingReview: pendingReview,
      summary: {
        todayConfirmedMatches: todayConfirmedCount,
        todayExpectedCash: todayExpectedCash,
        pendingReviewCount: pendingReview.length
      }
    });
  } catch (e) {
    return responseError('ADMIN_DASHBOARD_ERROR', e.message);
  }
}

// ============================================================================
// 2. ADMIN MANUAL BOOKING & SLOT BLOCKING (T7.1, T7.2, T7.4)
// ============================================================================

/**
 * Returns available slots for admin manual booking.
 *
 * @param {string} key
 * @param {string} pitchId
 * @param {string} dateStr
 * @returns {Object} Standard API response
 */
function getAdminSlots(key, pitchId, dateStr) {
  try {
    assertAdmin(key);
    return getAvailableSlots(pitchId, dateStr);
  } catch (e) {
    return responseError('ADMIN_SLOTS_ERROR', e.message);
  }
}

/**
 * Creates a phone or walk-in booking by stadium owner.
 *
 * @param {string} key
 * @param {Object} payload
 * @returns {Object} Standard API response
 */
function adminAddBooking(key, payload) {
  return withLock(function () {
    try {
      assertAdmin(key);
      if (!payload) return responseError('INVALID_INPUT', 'بيانات الحجز غير مكتملة.');

      var pitchId = String(payload.pitchId || '').trim();
      var dateStr = normalizeDateCell(payload.date);
      var timeSlot = String(payload.timeSlot || '').trim();
      var playerName = String(payload.name || '').trim();
      var phone = normalizePhone(payload.phone);
      var customPrice = payload.price !== undefined && payload.price !== '' ? Number(payload.price) : null;

      if (!pitchId || !dateStr || !timeSlot || !playerName) {
        return responseError('MISSING_FIELDS', 'يرجى استيفاء الملعب، التاريخ، الفترة، واسم اللاعب.');
      }

      var settings = getSettings();
      var bookSheet = getSheet(SHEETS.BOOKINGS);
      var lastRow = bookSheet.getLastRow();
      var now = new Date();

      // Check slot availability
      if (lastRow > 1) {
        var existing = bookSheet.getRange(2, 1, lastRow - 1, COL.BOOKINGS.SLOT_STATUS).getValues();
        for (var i = 0; i < existing.length; i++) {
          var rDate = normalizeDateCell(existing[i][COL.BOOKINGS.DATE - 1]);
          var rPitch = String(existing[i][COL.BOOKINGS.PITCH_ID - 1] || '').trim();
          var rSlot = String(existing[i][COL.BOOKINGS.TIME_SLOT - 1] || '').trim();
          var rStatus = String(existing[i][COL.BOOKINGS.SLOT_STATUS - 1] || '').trim();

          if (rDate === dateStr && rPitch === pitchId && rSlot === timeSlot) {
            if (rStatus === STATUS.CONFIRMED || rStatus === STATUS.OWNER_RESERVED || rStatus === STATUS.PENDING_DEPOSIT) {
              return responseError('SLOT_TAKEN', 'هذه الفترة محجوزة بالفعل في الجدول.');
            }
          }
        }
      }

      // Calculate Price if not explicitly overridden
      var finalPrice = customPrice;
      if (finalPrice === null || isNaN(finalPrice)) {
        var startMins = parseSlotStart(timeSlot, settings.openHour);
        var priceObj = getPriceForSlot(pitchId, dateStr, startMins, { settings: settings });
        finalPrice = priceObj.price;
      }

      var bookingId = generateBookingId(dateStr);
      var dayName = dayNameAr(dateStr);
      var nowStr = Utilities.formatDate(now, TIMEZONE_CAIRO, "yyyy-MM-dd'T'HH:mm:ss");

      var newBookingRow = [
        bookingId,
        dateStr,
        dayName,
        timeSlot,
        pitchId,
        STATUS.OWNER_RESERVED,
        playerName,
        phone || 'حجز هاتفي',
        finalPrice,
        0, // Deposit collected directly or on site
        finalPrice,
        '',
        nowStr,
        'Admin',
        ''
      ];

      bookSheet.appendRow(newBookingRow);

      // If phone was provided, ensure customer is noted as Trusted
      if (phone && isValidEgyptianPhone(phone)) {
        applyBookingConfirmation(phone, playerName, dateStr);
      }

      return responseSuccess({
        message: 'تم تسجيل الحجز بنجاح.',
        bookingId: bookingId
      });
    } catch (e) {
      return responseError('ADMIN_BOOKING_ERROR', e.message);
    }
  });
}

/**
 * Blocks a slot for maintenance, tournament, or stadium reservation.
 *
 * @param {string} key
 * @param {string} pitchId
 * @param {string} dateStr
 * @param {string} timeSlot
 * @param {string} reason
 * @returns {Object} Standard API response
 */
function adminBlockSlot(key, pitchId, dateStr, timeSlot, reason) {
  return withLock(function () {
    try {
      assertAdmin(key);

      var cleanDate = normalizeDateCell(dateStr);
      var label = '🔧 صيانة: ' + (reason || 'مغلق للصيانة أو مناسبة خاصة');
      var bookSheet = getSheet(SHEETS.BOOKINGS);

      // Check slot availability before blocking
      var lastRow = bookSheet.getLastRow();
      if (lastRow > 1) {
        var existing = bookSheet.getRange(2, 1, lastRow - 1, COL.BOOKINGS.SLOT_STATUS).getValues();
        for (var i = 0; i < existing.length; i++) {
          var rDate = normalizeDateCell(existing[i][COL.BOOKINGS.DATE - 1]);
          var rPitch = String(existing[i][COL.BOOKINGS.PITCH_ID - 1] || '').trim();
          var rSlot = String(existing[i][COL.BOOKINGS.TIME_SLOT - 1] || '').trim();
          var rStatus = String(existing[i][COL.BOOKINGS.SLOT_STATUS - 1] || '').trim();

          if (rDate === cleanDate && rPitch === pitchId && rSlot === timeSlot) {
            if (rStatus === STATUS.CONFIRMED || rStatus === STATUS.OWNER_RESERVED) {
              return responseError('SLOT_TAKEN', 'هذه الفترة محجوزة أو مغلقة بالفعل في الجدول.');
            }
          }
        }
      }

      var bookingId = generateBookingId(cleanDate);
      var dayName = dayNameAr(cleanDate);
      var nowStr = Utilities.formatDate(new Date(), TIMEZONE_CAIRO, "yyyy-MM-dd'T'HH:mm:ss");

      var blockRow = [
        bookingId,
        cleanDate,
        dayName,
        timeSlot,
        pitchId,
        STATUS.OWNER_RESERVED,
        label,
        '-',
        0,
        0,
        0,
        '',
        nowStr,
        'Admin',
        ''
      ];

      bookSheet.appendRow(blockRow);
      return responseSuccess({ message: 'تم إغلاق الفترة بنجاح.', bookingId: bookingId });
    } catch (e) {
      return responseError('ADMIN_BLOCK_ERROR', e.message);
    }
  });
}

// ============================================================================
// 3. MANUAL STATUS TRANSITIONS (T7.3)
// ============================================================================

/**
 * Allows the owner to programmatically change slot status
 * (e.g. Confirm Pending Deposit, Flag No-Show, Cancel Match).
 * Applies all automated customer tier side-effects.
 *
 * @param {string} key
 * @param {string} bookingId
 * @param {string} newStatus - 'Confirmed' | 'Cancelled' | 'No-Show'
 * @returns {Object} Standard API response
 */
function adminSetStatus(key, bookingId, newStatus) {
  return withLock(function () {
    try {
      assertAdmin(key);

      var bookSheet = getSheet(SHEETS.BOOKINGS);
      var rowNum = findBookingRow(bookingId, bookSheet);
      if (!rowNum) {
        return responseError('NOT_FOUND', 'لم يتم العثور على الحجز المحدد.');
      }

      var rowData = bookSheet.getRange(rowNum, 1, 1, COL.BOOKINGS.CANCELLED_AT).getValues()[0];
      var oldStatus = String(rowData[COL.BOOKINGS.SLOT_STATUS - 1] || '').trim();
      var pitchId = String(rowData[COL.BOOKINGS.PITCH_ID - 1] || '').trim();
      var timeSlot = String(rowData[COL.BOOKINGS.TIME_SLOT - 1] || '').trim();
      var phone = normalizePhone(rowData[COL.BOOKINGS.PLAYER_PHONE - 1]);
      var playerName = String(rowData[COL.BOOKINGS.PLAYER_NAME - 1] || '').trim();
      var matchDate = normalizeDateCell(rowData[COL.BOOKINGS.DATE - 1]);
      var nowStr = Utilities.formatDate(new Date(), TIMEZONE_CAIRO, "yyyy-MM-dd'T'HH:mm:ss");

      if (oldStatus === newStatus) {
        return responseSuccess({
          message: 'الحجز بالفعل في هذه الحالة: ' + newStatus,
          bookingId: bookingId,
          newStatus: newStatus
        });
      }

      // Validate transitions
      if (newStatus === STATUS.CONFIRMED) {
        // Prevent double booking: verify no OTHER active booking occupies this slot
        var totalRows = bookSheet.getLastRow();
        if (totalRows > 1) {
          var allBookings = bookSheet.getRange(2, 1, totalRows - 1, COL.BOOKINGS.SLOT_STATUS).getValues();
          for (var bIdx = 0; bIdx < allBookings.length; bIdx++) {
            var bRowNum = bIdx + 2;
            if (bRowNum === rowNum) continue; // Skip self
            var rDate = normalizeDateCell(allBookings[bIdx][COL.BOOKINGS.DATE - 1]);
            var rPitch = String(allBookings[bIdx][COL.BOOKINGS.PITCH_ID - 1] || '').trim();
            var rSlot = String(allBookings[bIdx][COL.BOOKINGS.TIME_SLOT - 1] || '').trim();
            var rStatus = String(allBookings[bIdx][COL.BOOKINGS.SLOT_STATUS - 1] || '').trim();

            if (rDate === matchDate && rPitch === pitchId && rSlot === timeSlot) {
              if (rStatus === STATUS.CONFIRMED || rStatus === STATUS.OWNER_RESERVED) {
                return responseError('SLOT_ALREADY_CONFIRMED', 'الفترة محجوزة بالفعل بحجز مؤكد آخر (' + rStatus + '). يرجى إلغاء الحجز الآخر أولاً.');
              }
            }
          }
        }

        bookSheet.getRange(rowNum, COL.BOOKINGS.SLOT_STATUS).setValue(STATUS.CONFIRMED);
        bookSheet.getRange(rowNum, COL.BOOKINGS.LOCK_EXPIRATION).setValue('');
        bookSheet.getRange(rowNum, COL.BOOKINGS.CANCELLED_AT).setValue('');
        if (phone) applyBookingConfirmation(phone, playerName, matchDate);
      } else if (newStatus === STATUS.NO_SHOW) {
        bookSheet.getRange(rowNum, COL.BOOKINGS.SLOT_STATUS).setValue(STATUS.NO_SHOW);
        if (phone && oldStatus !== STATUS.NO_SHOW) applyBookingNoShow(phone, playerName, matchDate);
      } else if (newStatus === STATUS.CANCELLED) {
        bookSheet.getRange(rowNum, COL.BOOKINGS.SLOT_STATUS).setValue(STATUS.CANCELLED);
        bookSheet.getRange(rowNum, COL.BOOKINGS.CANCELLED_AT).setValue(nowStr);
        if (oldStatus === STATUS.NO_SHOW && phone) {
          revertBookingNoShow(phone);
        }
      } else {
        return responseError('INVALID_STATUS', 'الحالة المطلوبة غير مقبولة.');
      }

      return responseSuccess({
        message: 'تم تحديث حالة الحجز إلى: ' + newStatus,
        bookingId: bookingId,
        newStatus: newStatus
      });
    } catch (e) {
      return responseError('ADMIN_STATUS_ERROR', e.message);
    }
  });
}
