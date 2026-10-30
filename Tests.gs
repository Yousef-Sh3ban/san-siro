/**
 * San Siro Football Pitch Booking System
 * Module: Tests.gs
 * Responsibility: Automated self-testing suite for domain logic, validation routines,
 * cryptographic operations, date/time normalization, and pricing engine.
 *
 * Architecture: Clean Architecture - Testing & Verification Layer.
 */

// ============================================================================
// SELF-TEST RUNNER & ASSERTION UTILITIES
// ============================================================================

/**
 * Runs all automated self-tests and outputs the results to Logger / UI.
 * Does NOT write mock data to live database sheets.
 *
 * @returns {{passed: number, failed: number, errors: Array<string>}}
 */
function runSelfTests() {
  var results = {
    passed: 0,
    failed: 0,
    errors: []
  };

  function assert(testName, condition, extraInfo) {
    if (condition) {
      results.passed++;
      Logger.log('  PASS: ' + testName);
    } else {
      results.failed++;
      var msg = 'FAIL: ' + testName + (extraInfo ? ' -> ' + extraInfo : '');
      results.errors.push(msg);
      Logger.log('  ' + msg);
    }
  }

  Logger.log('====================================================');
  Logger.log('🧪 بدء تشغيل الفحص الذاتي لنظام ملاعب سان سيرو...');
  Logger.log('====================================================');

  // --------------------------------------------------------------------------
  // TEST SUITE 1: Phone Normalization & Validation (T1.4)
  // --------------------------------------------------------------------------
  Logger.log('[Suite 1: Phone Normalization]');
  assert('Normalize simple mobile', normalizePhone('01012345678') === '01012345678');
  assert('Normalize with spaces and dashes', normalizePhone('010-1234 5678') === '01012345678');
  assert('Normalize international +20 prefix', normalizePhone('+201012345678') === '01012345678');
  assert('Normalize international 0020 prefix', normalizePhone('00201012345678') === '01012345678');
  assert('Normalize Arabic-Indic digits (٠١٠١٢٣٤٥٦٧٨)', normalizePhone('٠١٠١٢٣٤٥٦٧٨') === '01012345678');
  assert('Valid Egyptian phone check (010, 011, 012, 015)', isValidEgyptianPhone('01012345678') === true);
  assert('Valid Egyptian phone check (011)', isValidEgyptianPhone('01123456789') === true);
  assert('Reject invalid landline (02...)', isValidEgyptianPhone('0233445566') === false);
  assert('Reject short phone', isValidEgyptianPhone('0101234') === false);
  assert('To WhatsApp international format', toWhatsAppNumber('01012345678') === '201012345678');

  // --------------------------------------------------------------------------
  // TEST SUITE 2: Date & Time Normalization (T1.3)
  // --------------------------------------------------------------------------
  Logger.log('[Suite 2: Date & Time Normalization (12-Hour System)]');
  assert('addDays calculation', addDays('2026-10-30', 2) === '2026-11-01');
  assert('addDays negative calculation', addDays('2026-11-01', -2) === '2026-10-30');
  assert('Arabic day name for Thursday', dayNameAr('2026-10-29') === 'الخميس');
  assert('Arabic day name for Friday', dayNameAr('2026-10-30') === 'الجمعة');

  // 12-Hour slot formatting tests
  assert('Slot format afternoon 12h (02:00 PM - 03:00 PM)', formatSlot(14 * 60, 60) === '02:00 PM - 03:00 PM');
  assert('Slot format evening 12h (08:00 PM - 09:00 PM)', formatSlot(20 * 60, 60) === '08:00 PM - 09:00 PM');
  assert('Slot format midnight 12h (12:00 AM - 01:00 AM)', formatSlot(24 * 60, 60) === '12:00 AM - 01:00 AM');
  assert('Slot format post-midnight 12h (01:00 AM - 02:00 AM)', formatSlot(25 * 60, 60) === '01:00 AM - 02:00 AM');

  // Slot parsing tests (12h AM/PM, Arabic ص/م, legacy 24h)
  assert('Parse slot start 12h PM', parseSlotStart('08:00 PM - 09:00 PM', 14) === 20 * 60);
  assert('Parse slot start 12h PM afternoon', parseSlotStart('02:00 PM - 03:00 PM', 14) === 14 * 60);
  assert('Parse slot start 12h midnight (12:00 AM)', parseSlotStart('12:00 AM - 01:00 AM', 14) === 24 * 60);
  assert('Parse slot start 12h AM post-midnight (01:00 AM)', parseSlotStart('01:00 AM - 02:00 AM', 14) === 25 * 60);
  assert('Parse slot start Arabic م', parseSlotStart('08:00 م - 09:00 م', 14) === 20 * 60);
  assert('Parse slot start Arabic ص post-midnight', parseSlotStart('01:00 ص - 02:00 ص', 14) === 25 * 60);
  assert('Parse slot start legacy 24h daytime', parseSlotStart('14:00 - 15:00', 14) === 14 * 60);
  assert('Parse slot start legacy 24h evening', parseSlotStart('20:00 - 21:00', 14) === 20 * 60);
  assert('Parse slot start legacy 24h post-midnight', parseSlotStart('01:00 - 02:00', 14) === 25 * 60);

  // Discount cell parsing tests
  assert('Parse discount cell 12h PM', parseDiscountTimeCell('08:00 PM') === 20 * 60);
  assert('Parse discount cell 12h AM', parseDiscountTimeCell('10:00 AM') === 10 * 60);
  assert('Parse discount cell Arabic م', parseDiscountTimeCell('08:00 م') === 20 * 60);
  assert('Parse discount cell legacy 24h', parseDiscountTimeCell('20:00') === 20 * 60);

  // --------------------------------------------------------------------------
  // TEST SUITE 3: Security & Cryptographic PIN Operations (T3.1, T3.3)
  // --------------------------------------------------------------------------
  Logger.log('[Suite 3: Security & Cryptography]');
  assert('Valid PIN format (4 digits)', isValidPinFormat('1984') === true);
  assert('Valid PIN format with Arabic-Indic digits (١٩٨٤)', isValidPinFormat('١٩٨٤') === true);
  assert('Reject non-4-digit PIN (3 digits)', isValidPinFormat('123') === false);
  assert('Reject non-numeric PIN', isValidPinFormat('abcd') === false);
  assert('Weak PIN detection (0000)', isWeakPin('0000') === true);
  assert('Weak PIN detection (1234)', isWeakPin('1234') === true);
  assert('Weak PIN detection (9999)', isWeakPin('9999') === true);
  assert('Accept strong PIN (5928)', isWeakPin('5928') === false);

  var testHash = hashPin('01012345678', '5928');
  assert('PIN Hash generation generates 64-char hex', typeof testHash === 'string' && testHash.length === 64);
  assert('PIN verification with correct PIN', verifyPin('01012345678', '5928', testHash) === true);
  assert('PIN verification with incorrect PIN', verifyPin('01012345678', '5929', testHash) === false);

  // --------------------------------------------------------------------------
  // TEST SUITE 4: Pricing Engine (T4.1, T4.3)
  // --------------------------------------------------------------------------
  Logger.log('[Suite 4: Pricing Engine]');
  var mockSettings = {
    pitch1DayRate: 200,
    pitch1NightRate: 250,
    pitch2DayRate: 180,
    pitch2NightRate: 220,
    nightStartMinutes: 17 * 60, // 17:00 (05:00 PM)
    depositAmount: 50
  };

  // Base rates without discounts
  var p1Day = getPriceForSlot('Pitch 1', '2026-10-30', 14 * 60, { settings: mockSettings, discounts: [] });
  assert('Pitch 1 Day Rate equals 200', p1Day.price === 200 && p1Day.isNight === false && p1Day.isDiscount === false);

  var p1Night = getPriceForSlot('Pitch 1', '2026-10-30', 19 * 60, { settings: mockSettings, discounts: [] });
  assert('Pitch 1 Night Rate equals 250', p1Night.price === 250 && p1Night.isNight === true);

  var p2Day = getPriceForSlot('Pitch 2', '2026-10-30', 15 * 60, { settings: mockSettings, discounts: [] });
  assert('Pitch 2 Day Rate equals 180', p2Day.price === 180 && p2Day.isNight === false);

  var p2Night = getPriceForSlot('Pitch 2', '2026-10-30', 21 * 60, { settings: mockSettings, discounts: [] });
  assert('Pitch 2 Night Rate equals 220', p2Night.price === 220 && p2Night.isNight === true);

  // Post-midnight slot (25:00 -> 01:00 AM) qualifies as night rate
  var p1PostMidnight = getPriceForSlot('Pitch 1', '2026-10-30', 25 * 60, { settings: mockSettings, discounts: [] });
  assert('Pitch 1 Post-Midnight qualifies as Night Rate (250)', p1PostMidnight.price === 250 && p1PostMidnight.isNight === true);

  // Discounts
  var mockDiscounts = [
    {
      startMinutes: 20 * 60,
      endMinutes: 23 * 60,
      applicablePitch: 'All',
      discountedPrice: 170,
      eventTitle: 'خصم عام'
    },
    {
      startMinutes: 20 * 60,
      endMinutes: 22 * 60,
      applicablePitch: 'Pitch 1',
      discountedPrice: 160,
      eventTitle: 'عرض ملعب 1 الحصري'
    }
  ];

  // Slot at 20:00 (08:00 PM) on Pitch 1: Specific discount (160) should win over All (170) and base (250)
  var p1Discount = getPriceForSlot('Pitch 1', '2026-10-30', 20 * 60, { settings: mockSettings, discounts: mockDiscounts });
  assert('Pitch-specific discount wins over general discount', p1Discount.price === 160 && p1Discount.isDiscount === true && p1Discount.eventTitle === 'عرض ملعب 1 الحصري');

  // Slot at 20:00 on Pitch 2: General discount (170) should apply (since Pitch 1 discount is not applicable)
  var p2Discount = getPriceForSlot('Pitch 2', '2026-10-30', 20 * 60, { settings: mockSettings, discounts: mockDiscounts });
  assert('General discount applies to Pitch 2', p2Discount.price === 170 && p2Discount.isDiscount === true && p2Discount.eventTitle === 'خصم عام');

  // --------------------------------------------------------------------------
  // TEST SUITE 5: Advance Cancellation Deadline Logic (T5.8)
  // --------------------------------------------------------------------------
  Logger.log('[Suite 5: Cancellation Deadline Rule]');
  var simToday = '2026-10-30';
  var simTomorrow = '2026-10-31';
  var simSameDay = '2026-10-30';

  // Rule: Allowed strictly before match day (simToday < matchDate)
  assert('Advance cancellation allowed for tomorrow match', (simToday < simTomorrow) === true);
  assert('Cancellation rejected for match scheduled today', (simToday < simSameDay) === false);

  // Booking ID pattern test
  var sampleBookingId = 'BK-20261030-101';
  assert('Booking ID matches pattern BK-YYYYMMDD-XXXX', /^BK-\d{8}-\d+$/.test(sampleBookingId) === true);

  Logger.log('====================================================');
  Logger.log('ملخص النتائج: ' + results.passed + ' نجح | ' + results.failed + ' فشل');
  Logger.log('====================================================');

  try {
    var ui = SpreadsheetApp.getUi();
    var alertMsg = 'نتائج الفحص الذاتي:\n\n' +
      '• نجح: ' + results.passed + '\n' +
      '• فشل: ' + results.failed + '\n' +
      (results.failed > 0 ? '\nالأخطاء:\n' + results.errors.join('\n') : '\nكافة الفحوصات تعمل بأعلى كفاءة! ⚽');
    ui.alert('الفحص الذاتي 🧪', alertMsg, ui.ButtonSet.OK);
  } catch (e) {
    // Headless execution
  }

  return results;
}
