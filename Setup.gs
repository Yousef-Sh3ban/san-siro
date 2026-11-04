/**
 * San Siro Football Pitch Booking System
 * Module: Setup.gs
 * Responsibility: Idempotent initialization of database sheets, data validations,
 * conditional formatting rules, formula dashboards, automated triggers, and admin menu.
 *
 * Architecture: Clean Architecture - Infrastructure / Setup Layer.
 */

// ============================================================================
// 1. MASTER INITIALIZATION ENTRY POINT (T2.1)
// ============================================================================

/**
 * Initializes or repairs the entire San Siro spreadsheet ecosystem.
 * Completely idempotent: preserves all existing bookings and customer records.
 */
function setupSpreadsheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error('يرجى فتح الاسكريبت من داخل جدول بيانات Google Sheets.');
  }

  Logger.log('بدء تهيئة نظام ملاعب سان سيرو...');

  // 1. Setup individual sheets
  setupCustomersSheet(ss);
  setupBookingsSheet(ss);
  setupPricingSettingsSheet(ss);
  setupDiscountsSheet(ss);
  setupMonthlyReportsSheet(ss);

  // 2. Security bootstrap
  var adminKey = setupSecurityBootstrap();

  // 3. Automated triggers
  var triggerCount = installTriggers();

  // 4. Clear cache to reload new configurations
  clearSettingsCache();

  var summaryMsg = '✅ تم تهيئة نظام سان سيرو بنجاح!\n\n' +
    '• تم إنشاء / تحديث الجداول الخمسة.\n' +
    '• تم ضبط قواعد التحقق والتنسيق الشرطي.\n' +
    '• تم تثبيت المحفزات التلقائية (عدد: ' + triggerCount + ').\n' +
    '• مفتاح الإدارة السري (Admin Key):\n' + adminKey + '\n\n' +
    'يمكنك الآن نشر تطبيق الويب ومشاركة الرابط مع اللاعبين.';

  Logger.log(summaryMsg);

  try {
    SpreadsheetApp.getUi().alert('نظام سان سيرو ⚽', summaryMsg, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {
    // UI might not be available if called via API/headless execution
  }
}

// ============================================================================
// 2. SHEET-SPECIFIC INITIALIZATION (T2.2 - T2.6)
// ============================================================================

/**
 * Helper to get or create a sheet.
 */
function getOrCreateSheet(ss, sheetName) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  return sheet;
}

/**
 * T2.2: Setup Customers Sheet
 */
function setupCustomersSheet(ss) {
  var sheet = getOrCreateSheet(ss, SHEETS.CUSTOMERS);
  var headers = [
    'Phone_Number',
    'Player_Name',
    'PIN',
    'Status',
    'Total_Bookings',
    'No_Show_Count',
    'Last_Booking_Date',
    'Notes',
    'Created_At'
  ];

  // Set headers
  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setValues([headers]);
  headerRange.setBackground('#0B6E4F');
  headerRange.setFontColor('#FFFFFF');
  headerRange.setFontWeight('bold');
  headerRange.setHorizontalAlignment('center');
  sheet.setFrozenRows(1);

  // Column formatting
  // Phone & PIN as text (@) so leading zeros are preserved
  sheet.getRange('A2:A').setNumberFormat('@');
  sheet.getRange('C2:C').setNumberFormat('@');
  sheet.getRange('E2:F').setNumberFormat('#,##0');
  sheet.getRange('G2:G').setNumberFormat('yyyy-mm-dd');
  sheet.getRange('I2:I').setNumberFormat('yyyy-mm-dd hh:mm:ss am/pm');

  // Status dropdown rule
  var statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList([CUSTOMER_STATUS.TRUSTED, CUSTOMER_STATUS.NEW, CUSTOMER_STATUS.BLOCKED], true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange('D2:D').setDataValidation(statusRule);

  // Column widths
  sheet.setColumnWidth(1, 140); // Phone
  sheet.setColumnWidth(2, 170); // Name
  sheet.setColumnWidth(3, 140); // PIN
  sheet.setColumnWidth(4, 110); // Status
  sheet.setColumnWidth(5, 120); // Total Bookings
  sheet.setColumnWidth(6, 120); // No Show Count
  sheet.setColumnWidth(7, 130); // Last Booking Date
  sheet.setColumnWidth(8, 220); // Notes
  sheet.setColumnWidth(9, 160); // Created At

  // Conditional Formatting
  var rules = [];
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$D2="Blocked"')
    .setBackground('#FCE8E6')
    .setFontColor('#C5221F')
    .setRanges([sheet.getRange('A2:I')])
    .build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$D2="New"')
    .setBackground('#FEF7E0')
    .setFontColor('#B06000')
    .setRanges([sheet.getRange('A2:I')])
    .build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$D2="Trusted"')
    .setBackground('#E6F4EA')
    .setFontColor('#137333')
    .setRanges([sheet.getRange('A2:I')])
    .build());

  sheet.setConditionalFormatRules(rules);
}

/**
 * T2.3: Setup Bookings Sheet
 */
function setupBookingsSheet(ss) {
  var sheet = getOrCreateSheet(ss, SHEETS.BOOKINGS);
  var headers = [
    'Booking_ID',
    'Date',
    'Day_Name',
    'Time_Slot',
    'Pitch_ID',
    'Slot_Status',
    'Player_Name',
    'Player_Phone',
    'Calculated_Price',
    'Deposit_Amount',
    'Remaining_Cash',
    'Lock_Expiration',
    'Created_At',
    'Source',
    'Cancelled_At'
  ];

  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setValues([headers]);
  headerRange.setBackground('#0B6E4F');
  headerRange.setFontColor('#FFFFFF');
  headerRange.setFontWeight('bold');
  headerRange.setHorizontalAlignment('center');
  sheet.setFrozenRows(1);

  // Column formatting
  sheet.getRange('A2:A').setNumberFormat('@'); // Booking ID
  sheet.getRange('B2:B').setNumberFormat('yyyy-mm-dd'); // Date
  sheet.getRange('D2:D').setNumberFormat('@'); // Time Slot (12h format e.g. "08:00 PM - 09:00 PM")
  sheet.getRange('H2:H').setNumberFormat('@'); // Player Phone
  sheet.getRange('I2:K').setNumberFormat('#,##0 \"ج.م\"'); // Currencies
  sheet.getRange('L2:M').setNumberFormat('yyyy-mm-dd hh:mm:ss am/pm'); // Expiration / Created
  sheet.getRange('O2:O').setNumberFormat('yyyy-mm-dd hh:mm:ss am/pm'); // Cancelled At

  // Pitch Dropdown
  var pitchRule = SpreadsheetApp.newDataValidation()
    .requireValueInList([PITCHES.PITCH_1, PITCHES.PITCH_2], true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange('E2:E').setDataValidation(pitchRule);

  // Slot Status Dropdown
  var slotStatuses = [
    STATUS.AVAILABLE,
    STATUS.PENDING_DEPOSIT,
    STATUS.CONFIRMED,
    STATUS.OWNER_RESERVED,
    STATUS.CANCELLED,
    STATUS.EXPIRED,
    STATUS.NO_SHOW
  ];
  var statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(slotStatuses, true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange('F2:F').setDataValidation(statusRule);

  // Column widths
  sheet.setColumnWidth(1, 140); // Booking ID
  sheet.setColumnWidth(2, 110); // Date
  sheet.setColumnWidth(3, 110); // Day Name
  sheet.setColumnWidth(4, 170); // Time Slot (wider to fit 12h format)
  sheet.setColumnWidth(5, 110); // Pitch ID
  sheet.setColumnWidth(6, 130); // Slot Status
  sheet.setColumnWidth(7, 160); // Player Name
  sheet.setColumnWidth(8, 130); // Player Phone
  sheet.setColumnWidth(9, 120); // Price
  sheet.setColumnWidth(10, 120); // Deposit
  sheet.setColumnWidth(11, 130); // Remaining Cash
  sheet.setColumnWidth(12, 180); // Lock Exp
  sheet.setColumnWidth(13, 180); // Created
  sheet.setColumnWidth(14, 100); // Source
  sheet.setColumnWidth(15, 180); // Cancelled

  // Conditional Formatting on F2:F (Slot_Status)
  var rules = [];
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$F2="Confirmed"')
    .setBackground('#E6F4EA')
    .setFontColor('#137333')
    .setRanges([sheet.getRange('A2:O')])
    .build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$F2="Pending Deposit"')
    .setBackground('#FEF7E0')
    .setFontColor('#B06000')
    .setRanges([sheet.getRange('A2:O')])
    .build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$F2="Owner Reserved"')
    .setBackground('#E8F0FE')
    .setFontColor('#1A73E8')
    .setRanges([sheet.getRange('A2:O')])
    .build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$F2="No-Show"')
    .setBackground('#FCE8E6')
    .setFontColor('#C5221F')
    .setRanges([sheet.getRange('A2:O')])
    .build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('OR($F2="Cancelled", $F2="Expired")')
    .setBackground('#F1F3F4')
    .setFontColor('#5F6368')
    .setRanges([sheet.getRange('A2:O')])
    .build());

  sheet.setConditionalFormatRules(rules);
}

/**
 * T2.4: Setup Pricing_Settings Sheet
 */
function setupPricingSettingsSheet(ss) {
  var sheet = getOrCreateSheet(ss, SHEETS.PRICING_SETTINGS);
  var headers = ['Key', 'Value', 'Description (الوصف)'];

  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setValues([headers]);
  headerRange.setBackground('#0B6E4F');
  headerRange.setFontColor('#FFFFFF');
  headerRange.setFontWeight('bold');
  headerRange.setHorizontalAlignment('center');
  sheet.setFrozenRows(1);

  // Default configuration definitions
  var defaultSettings = [
    ['Stadium_Name', 'San Siro', 'اسم المجمع الرياضي الذي يظهر للاعبين'],
    ['Admin_Password', 'sansiro2026', 'كلمة مرور الدخول للوحة تحكم الإدارة على الموقع (يمكنك تغييرها في أي وقت)'],
    ['Pitch_1_Day_Rate', 200, 'سعر الساعة لملعب 1 نهاراً (جنيه)'],
    ['Pitch_1_Night_Rate', 250, 'سعر الساعة لملعب 1 ليلاً بعد ساعة البدء المسائية (جنيه)'],
    ['Pitch_2_Day_Rate', 180, 'سعر الساعة لملعب 2 نهاراً (جنيه)'],
    ['Pitch_2_Night_Rate', 220, 'سعر الساعة لملعب 2 ليلاً بعد ساعة البدء المسائية (جنيه)'],
    ['Night_Start_Hour', '05:00 PM', 'ساعة بداية تطبيق الأسعار المسائية (صيغة 12 ساعة مثلاً 05:00 PM أو 17:00)'],
    ['Open_Hour', '02:00 PM', 'ساعة فتح الملعب يومياً (مثلاً 02:00 PM أو 14)'],
    ['Close_Hour', '02:00 AM', 'ساعة إغلاق الملعب (مثلاً 02:00 AM تعني 2 صباحاً بعد منتصف الليل)'],
    ['Slot_Minutes', 60, 'مدة الحجز بالدقائق (افتراضياً 60 دقيقة)'],
    ['Deposit_Amount', 50, 'قيمة العربون المطلوب من اللاعبين الجدد لتثبيت الحجز (جنيه)'],
    ['Lock_Minutes', 15, 'مدة قفل الفترة بانتظار تحويل العربون قبل إتاحتها مجدداً (دقائق)'],
    ['Booking_Days_Ahead', 7, 'عدد الأيام المتاحة للحجز المسبق في جدول المواعيد'],
    ['No_Show_Threshold', 2, 'عدد مرات الغياب بدون إذن التي تؤدي لإعادة اللاعب لرتبة New وطلب عربون'],
    ['Block_Threshold', 3, 'عدد مرات الغياب التي تؤدي لحظر الحجز الآلي لهذا الرقم نهائياً'],
    ['Payment_Instructions', 'يرجى تحويل العربون لتأكيد الحجز عبر فودافون كاش أو إنستاباي وإرسال إشعار التحويل.', 'تعليمات الدفع التي تظهر للاعب الجديد'],
    ['Vodafone_Cash_Number', '01012345678', 'رقم محفظة فودافون كاش لاستقبال العربون'],
    ['InstaPay_Handle', 'sansiro@instapay', 'عنوان إنستاباي InstaPay لاستقبال العربون'],
    ['Owner_WhatsApp_Number', '01012345678', 'رقم واتساب الإدارة لاستقبال إشعارات التحويل والتواصل'],
    ['Owner_Email', Session.getEffectiveUser().getEmail() || '', 'البريد الإلكتروني الذي يستلم التقرير الشهري التلقائي']
  ];

  // Read existing keys to preserve user edits
  var lastRow = sheet.getLastRow();
  var existingKeys = {};
  if (lastRow > 1) {
    var existingData = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < existingData.length; i++) {
      var k = String(existingData[i][0]).trim();
      if (k) existingKeys[k] = true;
    }
  }

  // Append only missing keys
  var toAppend = [];
  for (var j = 0; j < defaultSettings.length; j++) {
    var defKey = defaultSettings[j][0];
    if (!existingKeys[defKey]) {
      toAppend.push(defaultSettings[j]);
    }
  }

  if (toAppend.length > 0) {
    var targetRow = Math.max(lastRow + 1, 2);
    sheet.getRange(targetRow, 1, toAppend.length, 3).setValues(toAppend);
  }

  sheet.setColumnWidth(1, 220); // Key
  sheet.setColumnWidth(2, 240); // Value
  sheet.setColumnWidth(3, 400); // Description
}

/**
 * T2.5: Setup Discounts Sheet
 */
function setupDiscountsSheet(ss) {
  var sheet = getOrCreateSheet(ss, SHEETS.DISCOUNTS);
  var headers = [
    'Date',
    'Start_Time',
    'End_Time',
    'Applicable_Pitch',
    'Discounted_Price',
    'Event_Title'
  ];

  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setValues([headers]);
  headerRange.setBackground('#0B6E4F');
  headerRange.setFontColor('#FFFFFF');
  headerRange.setFontWeight('bold');
  headerRange.setHorizontalAlignment('center');
  sheet.setFrozenRows(1);

  // Dropdown for Applicable_Pitch
  var pitchRule = SpreadsheetApp.newDataValidation()
    .requireValueInList([PITCHES.PITCH_1, PITCHES.PITCH_2, 'All'], true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange('D2:D').setDataValidation(pitchRule);

  sheet.getRange('A2:A').setNumberFormat('yyyy-mm-dd');
  sheet.getRange('B2:C').setNumberFormat('hh:mm am/pm');
  sheet.getRange('E2:E').setNumberFormat('#,##0 \"ج.م\"');

  // Add sample example row if empty
  if (sheet.getLastRow() <= 1) {
    var sampleDate = addDays(todayStr(), 3);
    sheet.appendRow([sampleDate, '08:00 PM', '11:00 PM', 'All', 150, 'عرض سهرة الأبطال 🏆']);
  }

  sheet.setColumnWidth(1, 120);
  sheet.setColumnWidth(2, 120);
  sheet.setColumnWidth(3, 120);
  sheet.setColumnWidth(4, 140);
  sheet.setColumnWidth(5, 140);
  sheet.setColumnWidth(6, 260);
}

/**
 * T2.6: Setup Monthly_Reports Sheet
 */
function setupMonthlyReportsSheet(ss) {
  var sheet = getOrCreateSheet(ss, SHEETS.MONTHLY_REPORTS);
  sheet.clear();

  // Title
  sheet.getRange('A1:B1').merge();
  sheet.getRange('A1').setValue('📊 تقرير الأداء المالي والتشغيلي لملاعب سان سيرو')
    .setFontSize(14)
    .setFontWeight('bold')
    .setBackground('#0B6E4F')
    .setFontColor('#FFFFFF')
    .setHorizontalAlignment('center');

  sheet.getRange('C1').setValue('شهر التقرير:')
    .setFontWeight('bold')
    .setHorizontalAlignment('left');

  // B1 equivalent or D1: Month selector
  var monthCell = sheet.getRange('D1');
  monthCell.setValue(todayStr())
    .setNumberFormat('yyyy-mm')
    .setFontWeight('bold')
    .setBackground('#FEF7E0')
    .setHorizontalAlignment('center');

  // KPI Table Headers
  sheet.getRange('A3:E3').setValues([[
    'المؤشر المالي والتشغيلي (KPI)',
    'القيمة المحسوبة',
    'الوحدة',
    'المعادلة المستخدمة',
    'ملاحظات توضيحية'
  ]])
  .setBackground('#1F2937')
  .setFontColor('#FFFFFF')
  .setFontWeight('bold')
  .setHorizontalAlignment('center');

  // Formulated KPI rows driven by Month in D1
  var kpiData = [
    [
      'إجمالي الإيرادات المؤكدة المحصلة',
      '=SUMIFS(Bookings!I:I, Bookings!F:F, "Confirmed", Bookings!B:B, ">="&DATE(YEAR(D1), MONTH(D1), 1), Bookings!B:B, "<="&EOMONTH(D1, 0))',
      'جنيه',
      'SUMIFS(Price, Confirmed)',
      'يشمل كافة المباريات الملعوبة والمؤكدة خلال الشهر'
    ],
    [
      'عربين حجوزات الغياب (No-Show Deposits)',
      '=SUMIFS(Bookings!J:J, Bookings!F:F, "No-Show", Bookings!B:B, ">="&DATE(YEAR(D1), MONTH(D1), 1), Bookings!B:B, "<="&EOMONTH(D1, 0))',
      'جنيه',
      'SUMIFS(Deposit, No-Show)',
      'العربين المحصلة إلكترونياً والتي لم تُسترد لغياب الفريق'
    ],
    [
      'إجمالي الدخل الإجمالي (Gross Revenue)',
      '=B4+B5',
      'جنيه',
      'B4 + B5',
      'إجمالي ما دخل الخزينة فعلياً'
    ],
    [
      'إجمالي العربين الإلكترونية المستلمة',
      '=SUMIFS(Bookings!J:J, Bookings!F:F, "Confirmed", Bookings!B:B, ">="&DATE(YEAR(D1), MONTH(D1), 1), Bookings!B:B, "<="&EOMONTH(D1, 0)) + B5',
      'جنيه',
      'SUMIFS(Deposits)',
      'عبر فودافون كاش وإنستاباي'
    ],
    [
      'إجمالي المبالغ النقدية المتبقية (كاش في الملعب)',
      '=SUMIFS(Bookings!K:K, Bookings!F:F, "Confirmed", Bookings!B:B, ">="&DATE(YEAR(D1), MONTH(D1), 1), Bookings!B:B, "<="&EOMONTH(D1, 0))',
      'جنيه',
      'SUMIFS(Remaining_Cash)',
      'المبالغ التي تم تحصيلها كاش من الكباتن بعد انتهاء المباريات'
    ],
    [
      'ساعات تشغيل ملعب 1 (Pitch 1)',
      '=COUNTIFS(Bookings!E:E, "Pitch 1", Bookings!F:F, "Confirmed", Bookings!B:B, ">="&DATE(YEAR(D1), MONTH(D1), 1), Bookings!B:B, "<="&EOMONTH(D1, 0))',
      'ساعة',
      'COUNTIFS(Pitch 1, Confirmed)',
      'عدد الساعات الفعلية المحجوزة'
    ],
    [
      'ساعات تشغيل ملعب 2 (Pitch 2)',
      '=COUNTIFS(Bookings!E:E, "Pitch 2", Bookings!F:F, "Confirmed", Bookings!B:B, ">="&DATE(YEAR(D1), MONTH(D1), 1), Bookings!B:B, "<="&EOMONTH(D1, 0))',
      'ساعة',
      'COUNTIFS(Pitch 2, Confirmed)',
      'عدد الساعات الفعلية المحجوزة'
    ],
    [
      'عدد حالات الغياب بدون إذن (No-Shows)',
      '=COUNTIFS(Bookings!F:F, "No-Show", Bookings!B:B, ">="&DATE(YEAR(D1), MONTH(D1), 1), Bookings!B:B, "<="&EOMONTH(D1, 0))',
      'حالة',
      'COUNTIFS(No-Show)',
      'تم تسجيلها على اللاعبين تلقائياً'
    ],
    [
      'عدد الإلغاءات المسبقة (Cancellations)',
      '=COUNTIFS(Bookings!F:F, "Cancelled", Bookings!B:B, ">="&DATE(YEAR(D1), MONTH(D1), 1), Bookings!B:B, "<="&EOMONTH(D1, 0))',
      'حالة',
      'COUNTIFS(Cancelled)',
      'أُلغيت بنجاح قبل الموعد النهائي'
    ]
  ];

  sheet.getRange(4, 1, kpiData.length, 5).setValues(kpiData);

  sheet.getRange('B4:B8').setNumberFormat('#,##0 \"ج.م\"');
  sheet.getRange('B9:B12').setNumberFormat('#,##0');

  // Top 5 Frequent Players Query section
  sheet.getRange('A15:D15').merge();
  sheet.getRange('A15').setValue('🏆 قائمة أكثر 5 لاعبين حجزاً خلال هذا الشهر')
    .setFontWeight('bold')
    .setBackground('#0B6E4F')
    .setFontColor('#FFFFFF')
    .setHorizontalAlignment('center');

  sheet.getRange('A16:D16').setValues([['اسم اللاعب', 'رقم الهاتف', 'عدد المباريات', 'إجمالي المبلغ المنفق']])
    .setBackground('#374151')
    .setFontColor('#FFFFFF')
    .setFontWeight('bold');

  // Top 5 dynamic formula query
  sheet.getRange('A17').setFormula(
    '=IFERROR(QUERY(Bookings!A2:K, \"SELECT G, H, COUNT(A), SUM(I) WHERE F = \'Confirmed\' AND B >= date \'\"&TEXT(DATE(YEAR(D1), MONTH(D1), 1), \"yyyy-mm-dd\")&\"\' AND B <= date \'\"&TEXT(EOMONTH(D1, 0), \"yyyy-mm-dd\")&\"\' GROUP BY G, H ORDER BY COUNT(A) DESC LIMIT 5 LABEL COUNT(A) \'\', SUM(I) \'\'\", 0), \"لا توجد بيانات كافية لهذا الشهر\")'
  );

  sheet.setColumnWidth(1, 280);
  sheet.setColumnWidth(2, 160);
  sheet.setColumnWidth(3, 80);
  sheet.setColumnWidth(4, 280);
  sheet.setColumnWidth(5, 300);
}

// ============================================================================
// 3. SECURITY BOOTSTRAP & TRIGGER INSTALLATION (T2.7, T2.8)
// ============================================================================

/**
 * T2.7: Bootstraps admin secret key and PIN hashing salt in Script Properties.
 *
 * @returns {string} The active ADMIN_KEY
 */
function setupSecurityBootstrap() {
  var props = PropertiesService.getScriptProperties();
  var adminKey = props.getProperty('ADMIN_KEY');
  var pinSalt = props.getProperty('PIN_SALT');

  if (!adminKey) {
    adminKey = generateSecureRandomToken(24);
    props.setProperty('ADMIN_KEY', adminKey);
    Logger.log('تم توليد مفتاح إدارة جديد: ' + adminKey);
  }

  if (!pinSalt) {
    pinSalt = generateSecureRandomToken(32);
    props.setProperty('PIN_SALT', pinSalt);
    Logger.log('تم توليد مفتاح تشفير الـ PIN (Salt).');
  }

  return adminKey;
}

/**
 * Rotates the ADMIN_KEY to a new token.
 *
 * @returns {string} New admin key
 */
function rotateAdminKey() {
  var newKey = generateSecureRandomToken(24);
  PropertiesService.getScriptProperties().setProperty('ADMIN_KEY', newKey);
  Logger.log('تم تدوير مفتاح الإدارة بنجاح: ' + newKey);
  return newKey;
}

/**
 * Generates a cryptographically strong pseudo-random token.
 *
 * @param {number} length
 * @returns {string}
 */
function generateSecureRandomToken(length) {
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  var result = '';
  var entropy = Utilities.getUuid() + '-' + Utilities.getUuid() + '-' + new Date().getTime() + '-' + Session.getTemporaryActiveUserKey();
  var rawBytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    entropy
  );
  for (var i = 0; i < length; i++) {
    var byteVal = (rawBytes[i % rawBytes.length] + 256) % 256;
    result += chars.charAt(byteVal % chars.length);
  }
  return result;
}

/**
 * T2.8: Installs or refreshes all required automated project triggers.
 * Ensures exactly 3 clean triggers exist without duplicates.
 *
 * @returns {number} Count of installed triggers
 */
function installTriggers() {
  var existingTriggers = ScriptApp.getProjectTriggers();
  var managedHandlers = ['releaseExpiredLocks', 'onEditTrigger', 'sendMonthlyEmailSummary'];

  // Remove existing triggers matching our handlers to prevent duplicates
  for (var i = 0; i < existingTriggers.length; i++) {
    var handler = existingTriggers[i].getHandlerFunction();
    if (managedHandlers.indexOf(handler) !== -1) {
      ScriptApp.deleteTrigger(existingTriggers[i]);
    }
  }

  var installed = 0;

  // 1. Time-driven trigger for releasing expired locks every 5 minutes
  ScriptApp.newTrigger('releaseExpiredLocks')
    .timeBased()
    .everyMinutes(5)
    .create();
  installed++;

  // 2. Installable onEdit trigger for spreadsheet changes (Confirmed/No-Show updates)
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.newTrigger('onEditTrigger')
    .forSpreadsheet(ss)
    .onEdit()
    .create();
  installed++;

  // 3. Monthly trigger on the 1st of every month at 09:00 Cairo time
  ScriptApp.newTrigger('sendMonthlyEmailSummary')
    .timeBased()
    .onMonthDay(1)
    .atHour(9)
    .inTimezone(TIMEZONE_CAIRO)
    .create();
  installed++;

  Logger.log('تم تثبيت ' + installed + ' محفزات تلقائية بنجاح.');
  return installed;
}

// ============================================================================
// 4. SPREADSHEET CUSTOM MENU (T2.9)
// ============================================================================

/**
 * T2.9: Adds the San Siro control menu to the Google Spreadsheet UI.
 */
function onOpen() {
  try {
    var ui = SpreadsheetApp.getUi();
    ui.createMenu('⚽ San Siro')
      .addItem('🛠️ تهيئة وتحديث الجداول (Setup / Repair)', 'setupSpreadsheet')
      .addItem('⏰ تثبيت المحفزات التلقائية (Install Triggers)', 'installTriggers')
      .addSeparator()
      .addItem('🔗 عرض رابط لوحة الإدارة (Show Admin Link)', 'showAdminUrlDialog')
      .addItem('🧪 تشغيل الفحص الذاتي (Run Self Tests)', 'runSelfTests')
      .addSeparator()
      .addItem('📧 إرسال تقرير الشهر الماضي الآن (Send Monthly Report)', 'sendMonthlyEmailSummary')
      .addToUi();
  } catch (e) {
    Logger.log('تعذر إنشاء القائمة المخصصة: ' + e.message);
  }
}

/**
 * Displays the owner admin URL with secret key in a modal popup.
 */
function showAdminUrlDialog() {
  var adminKey = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  if (!adminKey) {
    adminKey = setupSecurityBootstrap();
  }

  var webAppUrl = ScriptApp.getService().getUrl() || '[يرجى نشر تطبيق الويب أولاً للحصول على الرابط]';
  var adminUrl = webAppUrl.indexOf('?') === -1
    ? webAppUrl + '?page=admin&key=' + adminKey
    : webAppUrl + '&page=admin&key=' + adminKey;

  var htmlOutput = HtmlService.createHtmlOutput(
    '<div style="font-family: Cairo, Arial, sans-serif; direction: rtl; padding: 15px; line-height: 1.6;">' +
    '<h3 style="color: #0B6E4F; margin-top: 0;">⚽ رابط لوحة إدارة سان سيرو</h3>' +
    '<p>احفظ هذا الرابط في المفضلة على هاتفك للوصول السريع إلى حجوزات الغد وإرسال تذكيرات الواتساب:</p>' +
    '<div style="background: #F3F4F6; padding: 10px; border-radius: 6px; word-break: break-all; font-family: monospace; font-size: 13px;">' +
    adminUrl +
    '</div>' +
    '<p style="margin-top: 15px; font-size: 12px; color: #6B7280;">⚠️ تنبيه: لا تشارك هذا الرابط مع أي شخص؛ فهو يحتوي على مفتاح الإدارة السري.</p>' +
    '</div>'
  ).setWidth(520).setHeight(260);

  SpreadsheetApp.getUi().showModalDialog(htmlOutput, 'لوحة تحكم الإدارة');
}
