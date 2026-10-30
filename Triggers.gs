/**
 * San Siro Football Pitch Booking System
 * Module: Triggers.gs
 * Responsibility: Automated background triggers: 15-minute pending lock expiration,
 * installable onEdit trigger for spreadsheet status changes, and customer tier updates.
 *
 * Architecture: Clean Architecture - Infrastructure / Event & Trigger Handlers.
 */

// ============================================================================
// 1. TIME-DRIVEN TRIGGER: RELEASE EXPIRED LOCKS (T6.1)
// ============================================================================

/**
 * Periodically called every 5 minutes by the time-driven trigger.
 * Scans Bookings sheet for rows where Slot_Status == 'Pending Deposit'
 * and Lock_Expiration timestamp has elapsed, resetting them to 'Expired'.
 */
function releaseExpiredLocks() {
  withLock(function () {
    try {
      var bookSheet = getSheet(SHEETS.BOOKINGS);
      var lastRow = bookSheet.getLastRow();
      if (lastRow <= 1) return;

      var nowMs = new Date().getTime();
      // Read Status and Lock_Expiration columns
      var range = bookSheet.getRange(2, 1, lastRow - 1, COL.BOOKINGS.LOCK_EXPIRATION);
      var data = range.getValues();
      var expiredCount = 0;

      for (var i = 0; i < data.length; i++) {
        var row = data[i];
        var status = String(row[COL.BOOKINGS.SLOT_STATUS - 1] || '').trim();
        var lockExp = row[COL.BOOKINGS.LOCK_EXPIRATION - 1];

        if (status === STATUS.PENDING_DEPOSIT && lockExp) {
          var expMs = (lockExp instanceof Date) ? lockExp.getTime() : new Date(lockExp).getTime();
          if (!isNaN(expMs) && expMs < nowMs) {
            var targetRowNum = i + 2;
            bookSheet.getRange(targetRowNum, COL.BOOKINGS.SLOT_STATUS).setValue(STATUS.EXPIRED);
            expiredCount++;
          }
        }
      }

      if (expiredCount > 0) {
        Logger.log('تم تحرير ' + expiredCount + ' حجوزات منتهية الصلاحية وإعادتها للإتاحة.');
      }
    } catch (e) {
      Logger.log('خطأ أثناء تحرير الحجوزات المنتهية: ' + e.message);
    }
  });
}

// ============================================================================
// 2. INSTALLABLE ONEDIT TRIGGER (T6.2)
// ============================================================================

/**
 * Installable trigger executed whenever an edit occurs in the Google Spreadsheet.
 * Detects manual changes by the stadium owner to the Slot_Status column.
 *
 * @param {Object} e - Edit event object
 */
function onEditTrigger(e) {
  try {
    if (!e || !e.range) return;

    var range = e.range;
    var sheet = range.getSheet();
    if (sheet.getName() !== SHEETS.BOOKINGS) return;

    var startCol = range.getColumn();
    var endCol = range.getLastColumn();

    // Check if Slot_Status column (Column 6) was edited
    if (startCol > COL.BOOKINGS.SLOT_STATUS || endCol < COL.BOOKINGS.SLOT_STATUS) {
      return;
    }

    var startRow = Math.max(2, range.getRow());
    var endRow = range.getLastRow();

    for (var r = startRow; r <= endRow; r++) {
      var rowData = sheet.getRange(r, 1, 1, COL.BOOKINGS.CANCELLED_AT).getValues()[0];
      var newStatus = String(rowData[COL.BOOKINGS.SLOT_STATUS - 1] || '').trim();
      var phone = normalizePhone(rowData[COL.BOOKINGS.PLAYER_PHONE - 1]);
      var playerName = String(rowData[COL.BOOKINGS.PLAYER_NAME - 1] || '').trim();
      var matchDate = normalizeDateCell(rowData[COL.BOOKINGS.DATE - 1]);

      if (!phone) continue;

      var oldValue = String(e.oldValue || '').trim();

      // Case 1: Slot manually marked as 'Confirmed'
      if (newStatus === STATUS.CONFIRMED && oldValue !== STATUS.CONFIRMED) {
        // Clear lock expiration on confirmation
        sheet.getRange(r, COL.BOOKINGS.LOCK_EXPIRATION).setValue('');
        applyBookingConfirmation(phone, playerName, matchDate);
      }
      // Case 2: Slot marked as 'No-Show'
      else if (newStatus === STATUS.NO_SHOW && oldValue !== STATUS.NO_SHOW) {
        applyBookingNoShow(phone, playerName, matchDate);
      }
      // Case 3: Slot reverted from 'No-Show' (owner correction)
      else if (oldValue === STATUS.NO_SHOW && newStatus !== STATUS.NO_SHOW) {
        revertBookingNoShow(phone);
      }
    }
  } catch (err) {
    Logger.log('خطأ في معالج onEditTrigger: ' + err.message);
  }
}

// ============================================================================
// 3. REUSABLE CUSTOMER STATE MACHINE SIDE-EFFECTS (T6.3)
// ============================================================================

/**
 * Updates customer records when a booking is confirmed (via script or owner manual edit).
 * Promotes 'New' customers to 'Trusted' and increments their total booking count.
 *
 * @param {string} phone
 * @param {string} playerName
 * @param {string} matchDate
 */
function applyBookingConfirmation(phone, playerName, matchDate) {
  try {
    var custSheet = getSheet(SHEETS.CUSTOMERS);
    var rowNum = findCustomerRow(phone, custSheet);
    var nowStr = Utilities.formatDate(new Date(), TIMEZONE_CAIRO, "yyyy-MM-dd'T'HH:mm:ss");

    if (rowNum) {
      var curStatus = String(custSheet.getRange(rowNum, COL.CUSTOMERS.STATUS).getValue() || '').trim();
      var curTotal = Number(custSheet.getRange(rowNum, COL.CUSTOMERS.TOTAL_BOOKINGS).getValue()) || 0;

      // Upgrade 'New' to 'Trusted' upon verified deposit / owner confirmation
      // Never automatically upgrade 'Blocked' customers!
      if (curStatus === CUSTOMER_STATUS.NEW) {
        custSheet.getRange(rowNum, COL.CUSTOMERS.STATUS).setValue(CUSTOMER_STATUS.TRUSTED);
      }

      custSheet.getRange(rowNum, COL.CUSTOMERS.TOTAL_BOOKINGS).setValue(curTotal + 1);
      if (matchDate) {
        custSheet.getRange(rowNum, COL.CUSTOMERS.LAST_BOOKING_DATE).setValue(matchDate);
      }
    } else {
      // Append new customer as Trusted
      var newRow = [
        phone,
        playerName || 'كابتن',
        '', // PIN blank, will set on next online visit
        CUSTOMER_STATUS.TRUSTED,
        1,
        0,
        matchDate || todayStr(),
        'تم تأكيده يدوياً من الإدارة',
        nowStr
      ];
      custSheet.appendRow(newRow);
    }
  } catch (e) {
    Logger.log('فشل تحديث بيانات العميل عند التأكيد: ' + e.message);
  }
}

/**
 * Updates customer penalties when marked as No-Show.
 * Increments penalty counter and downgrades to New or Blocked upon reaching thresholds.
 *
 * @param {string} phone
 * @param {string} playerName
 * @param {string} matchDate
 */
function applyBookingNoShow(phone, playerName, matchDate) {
  try {
    var settings = getSettings();
    var custSheet = getSheet(SHEETS.CUSTOMERS);
    var rowNum = findCustomerRow(phone, custSheet);
    var today = todayStr();

    if (rowNum) {
      var curNoShows = Number(custSheet.getRange(rowNum, COL.CUSTOMERS.NO_SHOW_COUNT).getValue()) || 0;
      var newNoShows = curNoShows + 1;
      custSheet.getRange(rowNum, COL.CUSTOMERS.NO_SHOW_COUNT).setValue(newNoShows);

      // Append audit note
      var notesRange = custSheet.getRange(rowNum, COL.CUSTOMERS.NOTES);
      var currentNotes = String(notesRange.getValue() || '').trim();
      var penaltyNote = '[' + today + ']: تسجيل غياب بدون إذن لمباراة (' + (matchDate || today) + ')';
      notesRange.setValue(currentNotes ? currentNotes + '\n' + penaltyNote : penaltyNote);

      // Evaluate penalty tiers
      if (newNoShows >= settings.blockThreshold) {
        custSheet.getRange(rowNum, COL.CUSTOMERS.STATUS).setValue(CUSTOMER_STATUS.BLOCKED);
        Logger.log('تم حظر اللاعب ' + phone + ' لتجاوز حد الغياب (' + newNoShows + ').');
      } else if (newNoShows >= settings.noShowThreshold) {
        custSheet.getRange(rowNum, COL.CUSTOMERS.STATUS).setValue(CUSTOMER_STATUS.NEW);
        Logger.log('تم تحويل اللاعب ' + phone + ' إلى رتبة New لإلزامه بالعربون.');
      }
    } else {
      // If customer row was not present, create as New with 1 no-show
      var newRow = [
        phone,
        playerName || 'غير مسجل',
        '',
        CUSTOMER_STATUS.NEW,
        0,
        1,
        matchDate || today,
        '[' + today + ']: تم تسجيل غياب بدون إذن',
        Utilities.formatDate(new Date(), TIMEZONE_CAIRO, "yyyy-MM-dd'T'HH:mm:ss")
      ];
      custSheet.appendRow(newRow);
    }
  } catch (e) {
    Logger.log('فشل تسجيل حالة No-Show: ' + e.message);
  }
}

/**
 * Reverts a mistaken No-Show assignment.
 *
 * @param {string} phone
 */
function revertBookingNoShow(phone) {
  try {
    var custSheet = getSheet(SHEETS.CUSTOMERS);
    var rowNum = findCustomerRow(phone, custSheet);
    if (!rowNum) return;

    var curNoShows = Number(custSheet.getRange(rowNum, COL.CUSTOMERS.NO_SHOW_COUNT).getValue()) || 0;
    var updatedCount = Math.max(0, curNoShows - 1);
    custSheet.getRange(rowNum, COL.CUSTOMERS.NO_SHOW_COUNT).setValue(updatedCount);
  } catch (e) {
    Logger.log('فشل التراجع عن حالة No-Show: ' + e.message);
  }
}
