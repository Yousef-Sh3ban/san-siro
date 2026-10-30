# San Siro: Detailed AI Task List

> Project root: `D:\My Flutter\San Siro Booking\`
> Stack: Google Apps Script (V8) + Google Sheets + HtmlService. Arabic RTL. Timezone `Africa/Cairo`.
> Each task gives the **file(s)** it touches, **what to do**, and **Done when** (acceptance criteria).
> Do the tasks in order. A task may only depend on tasks with lower numbers.

---

## Final File Structure (target)

```
San Siro Booking/
├── appsscript.json
├── Setup.gs          # sheet creation, validations, formatting, triggers
├── Config.gs         # constants, settings loader, helpers
├── Pricing.gs        # price + discount engine
├── Security.gs       # PIN hashing, rate limiting, admin key
├── Code.gs           # doGet, player API (slots, book, cancel)
├── Triggers.gs       # releaseExpiredLocks, onEditTrigger
├── Admin.gs          # admin API
├── Reports.gs        # monthly stats + email
├── Tests.gs          # self tests
├── Index.html        # player app (HTML + CSS + JS)
├── Admin.html        # owner app
├── README.md         # deployment guide (AR + EN)
└── TASKS.md          # this file
```

---

## Phase 0: Project Scaffolding
- [x] T0.1 Create `appsscript.json` (Done: Cairo timezone, V8, webapp scopes configured)
- [x] T0.2 Create `README.md` skeleton (Done: Structure created)

---

## Phase 1: Core Config (`Config.gs`)
- [x] T1.1 Sheet and column constants (Done: SHEETS, COL, STATUS, PITCHES enums created)
- [x] T1.2 Settings loader (Done: getSettings with CacheService + clearSettingsCache)
- [x] T1.3 Date and time helpers (Done: todayStr, addDays, dayNameAr, formatSlot, parseSlotStart, post-midnight handling)
- [x] T1.4 Phone helpers (Done: normalizePhone, isValidEgyptianPhone, toWhatsAppNumber, Arabic-Indic numerals support)
- [x] T1.5 Generic sheet helpers (Done: responseSuccess, responseError, withLock, getSheet, findCustomerRow, findBookingRow)

---

## Phase 2: Spreadsheet Setup (`Setup.gs`)
- [x] T2.1 `setupSpreadsheet()` entry point (Done: Idempotent initialization of all 5 sheets)
- [x] T2.2 Customers sheet (Done: Schema, text format for phone/PIN, dropdown, conditional formatting)
- [x] T2.3 Bookings sheet (Done: Schema, ARRAYFORMULA in K1 for Remaining_Cash, validations, 7 status colors)
- [x] T2.4 Pricing_Settings sheet (Done: Key/Value/Description schema with defaults, preserves existing owner settings)
- [x] T2.5 Discounts sheet (Done: Schema, dropdown, time formats, example row)
- [x] T2.6 Monthly_Reports sheet (Done: Month-driven dynamic dashboard with SUMIFS/COUNTIFS and QUERY top 5)
- [x] T2.7 Security bootstrap (Done: ADMIN_KEY and PIN_SALT generation and persistence)
- [x] T2.8 `installTriggers()` (Done: 5-minute lock cleaner, onEdit trigger, monthly email summary trigger)
- [x] T2.9 Custom menu (Done: onOpen adds '⚽ San Siro' menu with Setup, Triggers, Link, and Tests)

---

## Phase 3: Security (`Security.gs`)
- [x] T3.1 PIN hashing (Done: Salted SHA-256 hashPin, verifyPin, weak PIN rejection)
- [x] T3.2 Rate limiting (Done: checkPinRateLimit, registerFailedAttempt, 30-min lockout after 5 fails, clear on success)
- [x] T3.3 Admin authorization (Done: assertAdmin, isAdminAuthorized, constant-time comparison)

---

## Phase 4: Pricing Engine (`Pricing.gs`)
- [x] T4.1 Base rate (Done: getBaseRate with Day vs Night rate and post-midnight detection)
- [x] T4.2 Discount lookup (Done: loadDiscountsForDate with pitch-specific priority and lowest price rule)
- [x] T4.3 `getPriceForSlot(pitchId, dateStr, startMinutes, ctx)` (Done: Complete resolution returning clean pricing object)

---

## Phase 5: Player API (`Code.gs`)
- [x] T5.1 `doGet(e)` (Done: Web app routing, admin key gate, unauthorized fallback, HTML evaluate)
- [x] T5.2 `getInitData()` (Done: Bootstrap payload, 7-day strip calculation, public payment info)
- [x] T5.3 `getAvailableSlots(pitchId, dateStr)` (Done: Operating hours calculation, lock check, past slots filter, pricing context)
- [x] T5.4 `lookupCustomer(phone)` (Done: Rate limit check, Trusted vs New state machine, zero sensitive data leaked)
- [x] T5.5 `verifyAndBook(payload)` (Done: Atomic transaction inside LockService, prevents double booking, instant ticket or 15-min pending deposit)
- [x] T5.6 `generateBookingId()` (Done: Format BK-YYYYMMDD-XXXX with script properties atomic counter)
- [x] T5.7 `getMyBookings(phone, pin)` (Done: Verified lookup of active reservations with deadline status)
- [x] T5.8 `cancelBooking(phone, pin, bookingId)` (Done: Strict 1-day advance deadline enforcement, same-day rejection with no-show warning)

---

## Phase 6: Triggers (`Triggers.gs`)
- [x] T6.1 `releaseExpiredLocks()` (Done: 5-minute scanner releasing pending deposits older than 15 minutes to Expired)
- [x] T6.2 `onEditTrigger(e)` (Done: Detects owner manual status changes, Confirmed promotion, No-Show penalty escalation)
- [x] T6.3 Shared customer-stats function (Done: applyBookingConfirmation, applyBookingNoShow, revertBookingNoShow)

---

## Phase 7: Admin API (`Admin.gs`)
- [x] T7.0 `getAdminDashboard(key, dateStr)` (Done: Today and tomorrow matches, grouped by pitch, 1-click WhatsApp reminder links)
- [x] T7.1 `adminAddBooking(key, payload)` (Done: Phone and walk-in reservations, Owner Reserved status, slot validation)
- [x] T7.2 `adminBlockSlot(key, pitchId, date, timeSlot, reason)` (Done: Maintenance and special event slot blocking)
- [x] T7.3 `adminSetStatus(key, bookingId, newStatus)` (Done: Programmatic status changes with automated customer tier updates)
- [x] T7.4 `getAdminSlots(key, pitchId, date)` (Done: Dynamic free slots query for admin quick add)

---

## Phase 8: Reports (`Reports.gs`)
- [x] T8.1 `computeMonthStats(year, month)` (Done: Revenue, deposits, cash, pitch hours and utilization %, no-shows, top 5 players)
- [x] T8.2 `sendMonthlyEmailSummary()` (Done: Rich HTML executive summary email on 1st of month at 09:00 Cairo time)

---

## Phase 9: Player Frontend (`Index.html`)
- [x] T9.0 Design system (Done: Cairo font, dark athletic pitch theme #0A1F1A, RTL, subtle noise texture, glowing buttons)
- [x] T9.1 Header and navigation (Done: San Siro branding, bottom app bar with 'احجز الآن' and 'حجوزاتي')
- [x] T9.2 Pitch selector (Done: Segmented switch for ملعب 1 and ملعب 2 with active glow)
- [x] T9.3 Day strip (Done: Horizontal scrollable day chips for 7 days ahead)
- [x] T9.4 Slot grid (Done: Touch-friendly cards, day/night icons, price, discount badge, skeleton loaders, empty state)
- [x] T9.5 Booking bottom sheet (Done: Step machine for Phone, PIN, PIN setup, New customer details, Blocked alert)
- [x] T9.6 Ticket screen (Done: Perforated match ticket for Trusted players with on-site cash note, no WhatsApp redirect)
- [x] T9.7 Payment screen (Done: Deposit amount, Vodafone Cash / InstaPay copy buttons, 15-min live countdown, WhatsApp CTA)
- [x] T9.8 My Bookings / Cancel tab (Done: Phone + PIN lookup, list of matches, cancel button with same-day deadline disable)
- [x] T9.9 Client utilities (Done: api() Promise wrapper with 25s timeout, toast notifications, phone caching)

---

## Phase 10: Admin Frontend (`Admin.html`)
- [x] T10.1 Layout (Done: Mobile-first, RTL, Cairo font, compact dashboard header, refresh button)
- [x] T10.2 Bookings list (Done: Grouped by Pitch 1 and Pitch 2, top KPI summary cards for cash, matches, pending)
- [x] T10.3 Reminder buttons (Done: 1-click WhatsApp buttons for tomorrow's games with personalized Arabic message and sent badge)
- [x] T10.4 Quick actions (Done: Confirm Deposit, Flag No-Show, Cancel match directly from mobile cards)
- [x] T10.5 Manual booking form (Done: Quick add for phone bookings and slot maintenance blocking)

---

## Phase 11: Testing (`Tests.gs`) and Docs
- [x] T11.1 `runSelfTests()` (Done: Unit tests for phone normalization, PIN crypto, weak PINs, slot parsing, pricing, deadlines)
- [x] T11.2 Manual QA checklist (Done: Documented in README with all test scenarios)
- [x] T11.3 Complete `README.md` (Done: Comprehensive deployment guide in Arabic with step-by-step instructions)

---

## Phase 12: Final Review
- [x] T12.1 Code quality pass (Done: SOLID principles, Clean Architecture layers, zero hardcoded secrets, complete JSDoc)
- [x] T12.2 Quota sanity check (Done: 100% free Google quotas, cached settings, batched writes, minimal trigger runtime)
- [x] T12.3 Deliver (Done: All 12 files delivered in D:\My Flutter\San Siro Booking\)

---

### Summary Count
| Phase | Tasks | Status |
|---|---|---|
| 0 Scaffolding | 2 | Completed |
| 1 Config | 5 | Completed |
| 2 Setup | 9 | Completed |
| 3 Security | 3 | Completed |
| 4 Pricing | 3 | Completed |
| 5 Player API | 8 | Completed |
| 6 Triggers | 3 | Completed |
| 7 Admin API | 5 | Completed |
| 8 Reports | 2 | Completed |
| 9 Player UI | 10 | Completed |
| 10 Admin UI | 5 | Completed |
| 11 Testing & Docs | 3 | Completed |
| 12 Review | 3 | Completed |
| **Total** | **61** | **61/61 Completed (100%)** |
