/**
 * San Siro Football Pitch Booking System
 * Module: Reports.gs
 * Responsibility: Monthly financial & operational analytics compilation,
 * and automated HTML email executive summary dispatcher.
 *
 * Architecture: Clean Architecture - Domain / Reporting & Notification Layer.
 */

// ============================================================================
// 1. MONTHLY METRICS COMPUTATION (T8.1)
// ============================================================================

/**
 * Computes pure analytical metrics for a given year and month (1-based).
 *
 * @param {number} year - e.g. 2026
 * @param {number} month - 1 to 12
 * @returns {Object} Comprehensive month statistics
 */
function computeMonthStats(year, month) {
  var settings = getSettings();
  var startStr = year + '-' + (month < 10 ? '0' + month : month) + '-01';
  var lastDayNum = new Date(year, month, 0).getDate();
  var endStr = year + '-' + (month < 10 ? '0' + month : month) + '-' + (lastDayNum < 10 ? '0' + lastDayNum : lastDayNum);

  var bookSheet = getSheet(SHEETS.BOOKINGS);
  var lastRow = bookSheet.getLastRow();
  var rows = [];

  if (lastRow > 1) {
    rows = bookSheet.getRange(2, 1, lastRow - 1, COL.BOOKINGS.CANCELLED_AT).getValues();
  }

  var stats = {
    year: year,
    month: month,
    monthNameAr: monthNameAr(month),
    daysInMonth: lastDayNum,
    totalGrossRevenue: 0,
    electronicDeposits: 0,
    cashOnSite: 0,
    pitch1Hours: 0,
    pitch2Hours: 0,
    pitch1Revenue: 0,
    pitch2Revenue: 0,
    confirmedMatchesCount: 0,
    noShowCount: 0,
    cancellationCount: 0,
    topPlayersMap: {}
  };

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var rDate = normalizeDateCell(r[COL.BOOKINGS.DATE - 1]);
    var rStatus = String(r[COL.BOOKINGS.SLOT_STATUS - 1] || '').trim();
    var rPitch = String(r[COL.BOOKINGS.PITCH_ID - 1] || '').trim();
    var rPrice = Number(r[COL.BOOKINGS.CALCULATED_PRICE - 1]) || 0;
    var rDeposit = Number(r[COL.BOOKINGS.DEPOSIT_AMOUNT - 1]) || 0;
    var rRemaining = Number(r[COL.BOOKINGS.REMAINING_CASH - 1]) || Math.max(0, rPrice - rDeposit);
    var rName = String(r[COL.BOOKINGS.PLAYER_NAME - 1] || '').trim();
    var rPhone = normalizePhone(r[COL.BOOKINGS.PLAYER_PHONE - 1]);

    if (rDate >= startStr && rDate <= endStr) {
      if (rStatus === STATUS.CONFIRMED || rStatus === STATUS.OWNER_RESERVED) {
        stats.confirmedMatchesCount++;
        stats.totalGrossRevenue += rPrice;
        stats.electronicDeposits += rDeposit;
        stats.cashOnSite += rRemaining;

        if (rPitch === PITCHES.PITCH_1) {
          stats.pitch1Hours++;
          stats.pitch1Revenue += rPrice;
        } else if (rPitch === PITCHES.PITCH_2) {
          stats.pitch2Hours++;
          stats.pitch2Revenue += rPrice;
        }

        // Top players aggregation
        if (rPhone) {
          if (!stats.topPlayersMap[rPhone]) {
            stats.topPlayersMap[rPhone] = { name: rName, phone: rPhone, matches: 0, spent: 0 };
          }
          stats.topPlayersMap[rPhone].matches++;
          stats.topPlayersMap[rPhone].spent += rPrice;
        }
      } else if (rStatus === STATUS.NO_SHOW) {
        stats.noShowCount++;
        // Retain deposit from no-show bookings in gross revenue
        stats.electronicDeposits += rDeposit;
        stats.totalGrossRevenue += rDeposit;
      } else if (rStatus === STATUS.CANCELLED) {
        stats.cancellationCount++;
      }
    }
  }

  // Calculate pitch utilization %
  var dailyOperatingHours = Math.max(1, settings.closeHour - settings.openHour);
  var totalPossibleHoursPerPitch = lastDayNum * dailyOperatingHours;
  stats.pitch1UtilizationPct = Math.round((stats.pitch1Hours / totalPossibleHoursPerPitch) * 100);
  stats.pitch2UtilizationPct = Math.round((stats.pitch2Hours / totalPossibleHoursPerPitch) * 100);

  // Convert top players map to sorted top 5 array
  var playersList = [];
  for (var p in stats.topPlayersMap) {
    playersList.push(stats.topPlayersMap[p]);
  }
  playersList.sort(function (a, b) {
    if (b.matches !== a.matches) return b.matches - a.matches;
    return b.spent - a.spent;
  });
  stats.top5Players = playersList.slice(0, 5);

  return stats;
}

// ============================================================================
// 2. AUTOMATED HTML EMAIL EXECUTIVE SUMMARY (T8.2)
// ============================================================================

/**
 * Compiles the previous month's operational statistics and sends
 * a rich HTML executive email to the stadium owner.
 * Triggered on the 1st of every month at 09:00 Cairo time.
 */
function sendMonthlyEmailSummary() {
  try {
    var settings = getSettings();
    var recipient = settings.ownerEmail;
    if (!recipient) {
      Logger.log('لم يتم العثور على بريد إلكتروني للإدارة في Pricing_Settings.');
      return;
    }

    // Determine target month (previous month)
    var now = new Date();
    var prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    var targetYear = prevMonthDate.getFullYear();
    var targetMonth = prevMonthDate.getMonth() + 1; // 1 to 12

    var stats = computeMonthStats(targetYear, targetMonth);
    var ssUrl = SpreadsheetApp.getActiveSpreadsheet().getUrl();

    var subject = '⚽ التقرير الشهري لملاعب ' + settings.stadiumName + ' - شهر ' + stats.monthNameAr + ' ' + targetYear;

    var topPlayersRows = '';
    if (stats.top5Players.length === 0) {
      topPlayersRows = '<tr><td colspan="4" style="text-align: center; padding: 12px; color: #6B7280;">لا توجد بيانات كافية</td></tr>';
    } else {
      for (var i = 0; i < stats.top5Players.length; i++) {
        var pl = stats.top5Players[i];
        topPlayersRows += '<tr style="border-bottom: 1px solid #E5E7EB;">' +
          '<td style="padding: 10px; font-weight: bold;">' + (i + 1) + '. ' + pl.name + '</td>' +
          '<td style="padding: 10px; direction: ltr; text-align: right;">' + pl.phone + '</td>' +
          '<td style="padding: 10px; text-align: center;">' + pl.matches + ' مباراة</td>' +
          '<td style="padding: 10px; text-align: left; font-weight: bold; color: #0B6E4F;">' + pl.spent.toLocaleString('ar-EG') + ' ج.م</td>' +
          '</tr>';
      }
    }

    var htmlBody = '<!DOCTYPE html>' +
      '<html dir="rtl" lang="ar">' +
      '<head><meta charset="UTF-8"></head>' +
      '<body style="font-family: Arial, sans-serif; background-color: #F3F4F6; margin: 0; padding: 20px; direction: rtl;">' +
      '<div style="max-width: 620px; margin: 0 auto; background: #FFFFFF; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">' +

      // Header
      '<div style="background: #0B6E4F; color: #FFFFFF; padding: 24px; text-align: center;">' +
      '<h1 style="margin: 0; font-size: 24px;">⚽ مجمع ملاعب ' + settings.stadiumName + '</h1>' +
      '<p style="margin: 8px 0 0; font-size: 16px; opacity: 0.9;">التقرير المالي والتشغيلي - شهر ' + stats.monthNameAr + ' ' + targetYear + '</p>' +
      '</div>' +

      '<div style="padding: 24px;">' +

      // KPI Grid
      '<h3 style="color: #1F2937; margin-top: 0; border-bottom: 2px solid #0B6E4F; padding-bottom: 8px;">📊 ملخص الأداء المالي</h3>' +
      '<table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">' +
      '<tr>' +
      '<td style="padding: 12px; background: #ECFDF5; border-radius: 8px; width: 48%; text-align: center;">' +
      '<div style="font-size: 13px; color: #047857;">إجمالي الدخل الإجمالي</div>' +
      '<div style="font-size: 22px; font-weight: bold; color: #065F46; margin-top: 4px;">' + stats.totalGrossRevenue.toLocaleString('ar-EG') + ' ج.م</div>' +
      '</td>' +
      '<td style="width: 4%;"></td>' +
      '<td style="padding: 12px; background: #EFF6FF; border-radius: 8px; width: 48%; text-align: center;">' +
      '<div style="font-size: 13px; color: #1D4ED8;">إجمالي المباريات الملعوبة</div>' +
      '<div style="font-size: 22px; font-weight: bold; color: #1E40AF; margin-top: 4px;">' + stats.confirmedMatchesCount + ' مباراة</div>' +
      '</td>' +
      '</tr>' +
      '<tr><td colspan="3" style="height: 12px;"></td></tr>' +
      '<tr>' +
      '<td style="padding: 12px; background: #FEF3C7; border-radius: 8px; text-align: center;">' +
      '<div style="font-size: 13px; color: #92400E;">العربين الإلكترونية المستلمة</div>' +
      '<div style="font-size: 18px; font-weight: bold; color: #78350F; margin-top: 4px;">' + stats.electronicDeposits.toLocaleString('ar-EG') + ' ج.م</div>' +
      '</td>' +
      '<td></td>' +
      '<td style="padding: 12px; background: #F3F4F6; border-radius: 8px; text-align: center;">' +
      '<div style="font-size: 13px; color: #374151;">النقدية المحصلة بالملعب (كاش)</div>' +
      '<div style="font-size: 18px; font-weight: bold; color: #111827; margin-top: 4px;">' + stats.cashOnSite.toLocaleString('ar-EG') + ' ج.م</div>' +
      '</td>' +
      '</tr>' +
      '</table>' +

      // Pitch Comparison
      '<h3 style="color: #1F2937; border-bottom: 2px solid #0B6E4F; padding-bottom: 8px;">🏟️ كفاءة واستخدام الملاعب</h3>' +
      '<table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 14px;">' +
      '<tr style="background: #F9FAFB; font-weight: bold;">' +
      '<th style="padding: 10px; text-align: right;">الملعب</th>' +
      '<th style="padding: 10px; text-align: center;">ساعات التشغيل</th>' +
      '<th style="padding: 10px; text-align: center;">نسبة الإشغال</th>' +
      '<th style="padding: 10px; text-align: left;">الإيراد</th>' +
      '</tr>' +
      '<tr style="border-bottom: 1px solid #E5E7EB;">' +
      '<td style="padding: 10px; font-weight: bold;">ملعب 1 (Pitch 1)</td>' +
      '<td style="padding: 10px; text-align: center;">' + stats.pitch1Hours + ' ساعة</td>' +
      '<td style="padding: 10px; text-align: center; color: #0B6E4F; font-weight: bold;">' + stats.pitch1UtilizationPct + '%</td>' +
      '<td style="padding: 10px; text-align: left;">' + stats.pitch1Revenue.toLocaleString('ar-EG') + ' ج.م</td>' +
      '</tr>' +
      '<tr style="border-bottom: 1px solid #E5E7EB;">' +
      '<td style="padding: 10px; font-weight: bold;">ملعب 2 (Pitch 2)</td>' +
      '<td style="padding: 10px; text-align: center;">' + stats.pitch2Hours + ' ساعة</td>' +
      '<td style="padding: 10px; text-align: center; color: #0B6E4F; font-weight: bold;">' + stats.pitch2UtilizationPct + '%</td>' +
      '<td style="padding: 10px; text-align: left;">' + stats.pitch2Revenue.toLocaleString('ar-EG') + ' ج.م</td>' +
      '</tr>' +
      '</table>' +

      // Quality & Discipline
      '<div style="background: #FFFBEB; border: 1px solid #FDE68A; border-radius: 8px; padding: 14px; margin-bottom: 24px;">' +
      '<div style="font-weight: bold; color: #92400E; margin-bottom: 6px;">⚠️ الانضباط والإلغاءات:</div>' +
      '<div style="font-size: 14px; color: #78350F;">' +
      '• عدد حالات الغياب بدون إذن (No-Shows): <strong>' + stats.noShowCount + '</strong> حالة.<br>' +
      '• عدد الإلغاءات المسبقة قبل الموعد: <strong>' + stats.cancellationCount + '</strong> حالة.' +
      '</div>' +
      '</div>' +

      // Top Players
      '<h3 style="color: #1F2937; border-bottom: 2px solid #0B6E4F; padding-bottom: 8px;">🏆 كباتن الشهر الأكثر التزاماً وحجزاً</h3>' +
      '<table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 14px;">' +
      '<tr style="background: #F9FAFB; font-weight: bold;">' +
      '<th style="padding: 10px; text-align: right;">اللاعب</th>' +
      '<th style="padding: 10px; text-align: right;">الهاتف</th>' +
      '<th style="padding: 10px; text-align: center;">المباريات</th>' +
      '<th style="padding: 10px; text-align: left;">المبلغ المنفق</th>' +
      '</tr>' +
      topPlayersRows +
      '</table>' +

      // CTA Button
      '<div style="text-align: center; margin-top: 24px;">' +
      '<a href="' + ssUrl + '" style="background: #0B6E4F; color: #FFFFFF; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: bold; display: inline-block;">فتح جدول البيانات الكامل في Google Sheets</a>' +
      '</div>' +

      '</div>' + // padding
      '<div style="background: #F9FAFB; padding: 16px; text-align: center; font-size: 12px; color: #9CA3AF; border-top: 1px solid #E5E7EB;">' +
      'تم إنشاء هذا التقرير آلياً بواسطة نظام ملاعب سان سيرو السحابي ⚽' +
      '</div>' +
      '</div>' +
      '</body>' +
      '</html>';

    MailApp.sendEmail({
      to: recipient,
      subject: subject,
      htmlBody: htmlBody
    });

    Logger.log('تم إرسال التقرير الشهري بنجاح إلى: ' + recipient);
  } catch (err) {
    Logger.log('خطأ أثناء إرسال التقرير الشهري: ' + err.message);
  }
}
