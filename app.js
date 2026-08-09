// Massage by Ash Schedule
// Automatic business hours:
// Tuesday-Friday 09:00-17:00
// Saturday 09:00-15:00
// Sunday/Monday closed
// South African public holidays 09:00-15:00
// Manual Supabase blocks override automatic hours.

const ADMIN_EMAIL = "infocampbellweb@gmail.com";

let db = null;
let schedule = {};
let viewDate = startOfMonth(new Date());
let adminViewDate = startOfMonth(new Date());
let selectedDate = isoDate(new Date());
let adminSelectedDate = selectedDate;
let adminDraft = null;
let realtimeChannel = null;
let deferredInstallPrompt = null;

const $ = id => document.getElementById(id);

function configured() {
  return window.SUPABASE_URL &&
    !window.SUPABASE_URL.includes("PASTE_") &&
    window.SUPABASE_PUBLISHABLE_KEY &&
    !window.SUPABASE_PUBLISHABLE_KEY.includes("PASTE_");
}

function pad(n) { return String(n).padStart(2, "0"); }

function isoDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseISODate(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function sameMonth(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

function prettyDate(key) {
  return parseISODate(key).toLocaleDateString("en-ZA", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

function monthText(date) {
  return date.toLocaleDateString("en-ZA", { month: "long", year: "numeric" });
}

function emptyDay() {
  return { wholeDay: false, blockedSlots: [], customSlots: [], note: "" };
}

function getDayData(key) {
  return schedule[key] || emptyDay();
}

function makeBusinessSlots(startHour, endHour) {
  // User requested :00, :15 and :30 choices, e.g. 09h00, 09h15, 09h30.
  // The closing hour is shown only as the final :00 option.
  const slots = [];
  for (let hour = startHour; hour <= endHour; hour++) {
    slots.push(`${pad(hour)}:00`);
    if (hour < endHour) {
      slots.push(`${pad(hour)}:15`);
      slots.push(`${pad(hour)}:30`);
    }
  }
  return slots;
}

function formatSlot(time) {
  return time.replace(":", "h");
}

function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function addDays(date, amount) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + amount);
  return copy;
}

function southAfricanPublicHolidays(year) {
  const easter = easterSunday(year);
  const holidays = [
    { date: new Date(year, 0, 1), name: "New Year's Day" },
    { date: new Date(year, 2, 21), name: "Human Rights Day" },
    { date: addDays(easter, -2), name: "Good Friday" },
    { date: addDays(easter, 1), name: "Family Day" },
    { date: new Date(year, 3, 27), name: "Freedom Day" },
    { date: new Date(year, 4, 1), name: "Workers' Day" },
    { date: new Date(year, 5, 16), name: "Youth Day" },
    { date: new Date(year, 7, 9), name: "National Women's Day" },
    { date: new Date(year, 8, 24), name: "Heritage Day" },
    { date: new Date(year, 11, 16), name: "Day of Reconciliation" },
    { date: new Date(year, 11, 25), name: "Christmas Day" },
    { date: new Date(year, 11, 26), name: "Day of Goodwill" }
  ];

  const expanded = [...holidays];

  for (const holiday of holidays) {
    if (holiday.date.getDay() === 0) {
      expanded.push({
        date: addDays(holiday.date, 1),
        name: `${holiday.name} (observed)`
      });
    }
  }

  return expanded;
}

function publicHolidayFor(key) {
  const date = parseISODate(key);
  return southAfricanPublicHolidays(date.getFullYear())
    .find(item => isoDate(item.date) === key) || null;
}

function baseAvailabilityForDay(key) {
  const date = parseISODate(key);
  const holiday = publicHolidayFor(key);

  if (holiday) {
    return {
      closed: false,
      holiday: true,
      holidayName: holiday.name,
      label: "Public holiday hours",
      slots: makeBusinessSlots(9, 15)
    };
  }

  const weekday = date.getDay();

  if (weekday === 0 || weekday === 1) {
    return {
      closed: true,
      holiday: false,
      holidayName: "",
      label: "Closed",
      slots: []
    };
  }

  if (weekday === 6) {
    return {
      closed: false,
      holiday: false,
      holidayName: "",
      label: "Saturday hours",
      slots: makeBusinessSlots(9, 15)
    };
  }

  return {
    closed: false,
    holiday: false,
    holidayName: "",
    label: "Business hours",
    slots: makeBusinessSlots(9, 17)
  };
}

function allSlotsForDay(key) {
  return baseAvailabilityForDay(key).slots;
}

function statusForDay(key) {
  const base = baseAvailabilityForDay(key);
  if (base.closed) return "closed";

  const data = getDayData(key);
  if (data.wholeDay) return "blocked";

  const slots = allSlotsForDay(key);
  const blocked = new Set(data.blockedSlots || []);

  if (slots.length && slots.every(time => blocked.has(time))) return "blocked";
  if (blocked.size) return "partial";
  if (base.holiday) return "holiday";
  return "available";
}

function calendarDates(monthDate) {
  const first = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const start = new Date(first);
  const mondayOffset = (first.getDay() + 6) % 7;
  start.setDate(first.getDate() - mondayOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

function setSync(text, error = false) {
  $("syncStatus").textContent = text;
  $("syncStatus").classList.toggle("error", error);
}

async function loadSchedule() {
  if (!db) return;

  setSync("Syncing…");

  const { data, error } = await db
    .from("schedule_days")
    .select("day,whole_day,blocked_slots,custom_slots,private_note");

  if (error) {
    console.error(error);
    setSync("Sync error", true);
    return;
  }

  schedule = {};

  for (const row of data || []) {
    schedule[row.day] = {
      wholeDay: !!row.whole_day,
      blockedSlots: row.blocked_slots || [],
      customSlots: row.custom_slots || [],
      note: row.private_note || ""
    };
  }

  setSync("Live");
  renderPublic();

  if (!$("adminModal").classList.contains("hidden")) {
    await loadAdminDraft();
    renderAdmin();
  }
}

function subscribeRealtime() {
  if (!db) return;

  realtimeChannel = db
    .channel("schedule-live")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "schedule_days" },
      () => loadSchedule()
    )
    .subscribe(status => {
      if (status === "SUBSCRIBED") setSync("Live");
    });
}

function renderCalendar(gridId, labelId, monthDate, selectedKey, handler) {
  $(labelId).textContent = monthText(monthDate);
  const grid = $(gridId);
  grid.innerHTML = "";
  const todayKey = isoDate(new Date());

  calendarDates(monthDate).forEach(date => {
    const key = isoDate(date);
    const base = baseAvailabilityForDay(key);
    const status = statusForDay(key);
    const note = (getDayData(key).note || "").trim();

    const button = document.createElement("button");
    button.type = "button";
    button.dataset.date = key;
    button.title = base.holiday ? base.holidayName : base.label;
    button.className = [
      "day",
      sameMonth(date, monthDate) ? "" : "outside",
      key === selectedKey ? "selected" : "",
      key === todayKey ? "today" : "",
      note ? "has-note" : "",
      status
    ].filter(Boolean).join(" ");

    const holidayBadge = base.holiday ? '<span class="holiday-star" aria-label="Public holiday">★</span>' : "";
    const noteBadge = note ? '<span class="note-indicator" aria-label="Note available"></span>' : "";

    button.innerHTML = `
      <span class="day-number">${date.getDate()}</span>
      ${holidayBadge}
      ${noteBadge}
      <span class="day-status"></span>
    `;

    button.addEventListener("click", () => handler(key));
    grid.appendChild(button);
  });
}

function renderPublic() {
  renderCalendar(
    "calendarGrid",
    "monthLabel",
    viewDate,
    selectedDate,
    key => {
      selectedDate = key;
      viewDate = startOfMonth(parseISODate(key));
      renderPublic();
    }
  );

  $("selectedDateLabel").textContent = prettyDate(selectedDate);

  const wrap = $("publicSlots");
  wrap.innerHTML = "";

  const data = getDayData(selectedDate);
  const base = baseAvailabilityForDay(selectedDate);
  const noteText = (data.note || "").trim();
  const publicNote = $("publicNote");

  if (noteText) {
    publicNote.innerHTML = "";
    const title = document.createElement("strong");
    title.textContent = "Notes";
    const paragraph = document.createElement("p");
    paragraph.textContent = noteText;
    publicNote.append(title, paragraph);
    publicNote.classList.remove("hidden");
  } else {
    publicNote.innerHTML = "";
    publicNote.classList.add("hidden");
  }

  if (base.holiday) {
    const notice = document.createElement("div");
    notice.className = "holiday-notice";
    notice.innerHTML = `<strong>${base.holidayName}</strong><span>Public holiday hours: 09h00 – 15h00</span>`;
    wrap.appendChild(notice);
  }

  if (base.closed) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = "<strong>Closed</strong><br>Sundays and Mondays are regular off days.";
    wrap.appendChild(empty);
    return;
  }

  if (data.wholeDay) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "This date has been manually blocked.";
    wrap.appendChild(empty);
    return;
  }

  const blocked = new Set(data.blockedSlots || []);
  const available = allSlotsForDay(selectedDate).filter(time => !blocked.has(time));

  if (!available.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No appointment times are available on this date.";
    wrap.appendChild(empty);
    return;
  }

  available.forEach(time => {
    const slot = document.createElement("div");
    slot.className = "slot";
    slot.textContent = formatSlot(time);
    wrap.appendChild(slot);
  });
}

function openModal(id) {
  $(id).classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeModal(id) {
  $(id).classList.add("hidden");
  if (!document.querySelector(".modal:not(.hidden)")) {
    document.body.style.overflow = "";
  }
}

document.querySelectorAll("[data-close]").forEach(button => {
  button.addEventListener("click", () => closeModal(button.dataset.close));
});

document.querySelectorAll(".modal").forEach(modal => {
  modal.addEventListener("click", event => {
    if (event.target === modal) closeModal(modal.id);
  });
});

async function currentUser() {
  if (!db) return null;
  const { data } = await db.auth.getUser();
  return data.user || null;
}

$("therapistBtn").addEventListener("click", async () => {
  if (!db) {
    $("setupBanner").classList.remove("hidden");
    return;
  }

  const user = await currentUser();
  user ? openAdmin() : openModal("loginModal");
});

$("loginForm").addEventListener("submit", async event => {
  event.preventDefault();
  $("loginError").textContent = "";

  const email = $("loginEmail").value.trim();
  const password = $("loginPassword").value;

  const { error } = await db.auth.signInWithPassword({ email, password });

  if (error) {
    $("loginError").textContent = "Incorrect email or password.";
    return;
  }

  const user = await currentUser();

  if (!user || user.email?.toLowerCase() !== ADMIN_EMAIL) {
    await db.auth.signOut();
    $("loginError").textContent = "This account is not authorized.";
    return;
  }

  $("loginPassword").value = "";
  closeModal("loginModal");
  openAdmin();
});

$("logoutBtn").addEventListener("click", async () => {
  await db.auth.signOut();
  closeModal("adminModal");
});

async function openAdmin() {
  adminViewDate = startOfMonth(parseISODate(adminSelectedDate));
  await loadAdminDraft();
  renderAdmin();
  openModal("adminModal");
}

async function loadAdminDraft() {
  const src = getDayData(adminSelectedDate);

  adminDraft = {
    wholeDay: !!src.wholeDay,
    blockedSlots: [...(src.blockedSlots || [])],
    note: src.note || ""
  };
}

function renderAdmin() {
  renderCalendar(
    "adminCalendarGrid",
    "adminMonthLabel",
    adminViewDate,
    adminSelectedDate,
    async key => {
      adminSelectedDate = key;
      adminViewDate = startOfMonth(parseISODate(key));
      await loadAdminDraft();
      renderAdmin();
    }
  );

  $("adminSelectedDateLabel").textContent = prettyDate(adminSelectedDate);
  $("blockWholeDay").checked = adminDraft.wholeDay;
  $("dayNote").value = adminDraft.note || "";

  const base = baseAvailabilityForDay(adminSelectedDate);
  const autoInfo = $("autoHoursInfo");

  if (base.holiday) {
    autoInfo.innerHTML = `<strong>${base.holidayName}</strong><span>Automatic public-holiday hours: 09h00 – 15h00</span>`;
  } else if (base.closed) {
    autoInfo.innerHTML = "<strong>Automatic off day</strong><span>Closed on Sundays and Mondays.</span>";
  } else if (parseISODate(adminSelectedDate).getDay() === 6) {
    autoInfo.innerHTML = "<strong>Saturday</strong><span>Automatic hours: 09h00 – 15h00</span>";
  } else {
    autoInfo.innerHTML = "<strong>Tuesday – Friday</strong><span>Automatic hours: 09h00 – 17h00</span>";
  }

  renderAdminSlotsOnly();
}

function renderAdminSlotsOnly() {
  const wrap = $("adminSlots");
  wrap.innerHTML = "";

  const base = baseAvailabilityForDay(adminSelectedDate);
  const blocked = new Set(adminDraft.blockedSlots || []);
  const slots = allSlotsForDay(adminSelectedDate);

  if (base.closed) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No hours to edit — this is an automatic off day.";
    wrap.appendChild(empty);
    return;
  }

  slots.forEach(time => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = formatSlot(time);
    button.disabled = adminDraft.wholeDay;
    button.className = "admin-slot" + (blocked.has(time) ? " is-blocked" : "");

    button.addEventListener("click", () => {
      const set = new Set(adminDraft.blockedSlots);
      set.has(time) ? set.delete(time) : set.add(time);
      adminDraft.blockedSlots = [...set].sort();
      renderAdminSlotsOnly();
    });

    wrap.appendChild(button);
  });
}

$("blockWholeDay").addEventListener("change", event => {
  adminDraft.wholeDay = event.target.checked;
  renderAdminSlotsOnly();
});

$("dayNote").addEventListener("input", event => {
  adminDraft.note = event.target.value;
});

function blockTimes(predicate) {
  const slots = allSlotsForDay(adminSelectedDate);
  const set = new Set(adminDraft.blockedSlots || []);
  slots.filter(predicate).forEach(time => set.add(time));
  adminDraft.blockedSlots = [...set].sort();
  renderAdminSlotsOnly();
}

$("blockMorningBtn").addEventListener("click", () => {
  blockTimes(time => Number(time.slice(0, 2)) < 12);
});

$("blockAfternoonBtn").addEventListener("click", () => {
  blockTimes(time => Number(time.slice(0, 2)) >= 12);
});

$("restoreHoursBtn").addEventListener("click", () => {
  adminDraft.wholeDay = false;
  adminDraft.blockedSlots = [];
  $("blockWholeDay").checked = false;
  renderAdminSlotsOnly();
  $("saveMessage").textContent = "Normal hours restored in the editor. Click Save changes.";
});

$("saveDayBtn").addEventListener("click", async () => {
  $("saveDayBtn").disabled = true;
  $("saveMessage").textContent = "Saving…";

  const validSlots = new Set(allSlotsForDay(adminSelectedDate));

  const payload = {
    day: adminSelectedDate,
    whole_day: adminDraft.wholeDay,
    blocked_slots: [...new Set(adminDraft.blockedSlots)]
      .filter(time => validSlots.has(time))
      .sort(),
    custom_slots: [],
    private_note: (adminDraft.note || "").trim(),
    updated_at: new Date().toISOString()
  };

  const { error } = await db
    .from("schedule_days")
    .upsert(payload, { onConflict: "day" });

  $("saveDayBtn").disabled = false;

  if (error) {
    console.error(error);
    $("saveMessage").textContent = "Could not save. Check Supabase setup/RLS.";
    return;
  }

  $("saveMessage").textContent = "Saved.";
  await loadSchedule();
  setTimeout(() => { $("saveMessage").textContent = ""; }, 1800);
});

$("clearDayBtn").addEventListener("click", async () => {
  const { error } = await db
    .from("schedule_days")
    .delete()
    .eq("day", adminSelectedDate);

  if (error) {
    $("saveMessage").textContent = "Could not clear this date.";
    return;
  }

  $("saveMessage").textContent = "Manual blocks and notes cleared. Automatic hours restored.";
  await loadSchedule();
  await loadAdminDraft();
  renderAdmin();
});

$("copyDayBtn").addEventListener("click", async () => {
  const target = $("copyTargetDate").value;

  if (!target) {
    $("saveMessage").textContent = "Choose the date you want to copy to.";
    return;
  }

  const targetBase = baseAvailabilityForDay(target);
  const validTargetSlots = new Set(targetBase.slots);

  const payload = {
    day: target,
    whole_day: adminDraft.wholeDay,
    blocked_slots: [...new Set(adminDraft.blockedSlots)]
      .filter(time => validTargetSlots.has(time))
      .sort(),
    custom_slots: [],
    private_note: (adminDraft.note || "").trim(),
    updated_at: new Date().toISOString()
  };

  const { error } = await db
    .from("schedule_days")
    .upsert(payload, { onConflict: "day" });

  if (error) {
    console.error(error);
    $("saveMessage").textContent = "Could not copy this date.";
    return;
  }

  $("saveMessage").textContent = `Copied to ${prettyDate(target)}.`;
  await loadSchedule();
});

$("blockRangeBtn").addEventListener("click", async () => {
  const startKey = $("rangeStart").value;
  const endKey = $("rangeEnd").value;

  if (!startKey || !endKey) {
    $("saveMessage").textContent = "Choose both From and To dates.";
    return;
  }

  const startDate = parseISODate(startKey);
  const endDate = parseISODate(endKey);

  if (startDate > endDate) {
    $("saveMessage").textContent = "The From date must be before the To date.";
    return;
  }

  const rows = [];
  const cursor = new Date(startDate);

  while (cursor <= endDate) {
    rows.push({
      day: isoDate(cursor),
      whole_day: true,
      blocked_slots: [],
      custom_slots: [],
      private_note: "",
      updated_at: new Date().toISOString()
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  $("blockRangeBtn").disabled = true;
  $("saveMessage").textContent = "Blocking date range…";

  const { error } = await db
    .from("schedule_days")
    .upsert(rows, { onConflict: "day" });

  $("blockRangeBtn").disabled = false;

  if (error) {
    console.error(error);
    $("saveMessage").textContent = "Could not block the date range.";
    return;
  }

  $("saveMessage").textContent = `Blocked ${rows.length} date${rows.length === 1 ? "" : "s"}.`;
  await loadSchedule();
});

$("prevMonth").addEventListener("click", () => {
  viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1);
  renderPublic();
});

$("nextMonth").addEventListener("click", () => {
  viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1);
  renderPublic();
});

$("todayBtn").addEventListener("click", () => {
  const today = new Date();
  selectedDate = isoDate(today);
  viewDate = startOfMonth(today);
  renderPublic();
});

$("adminPrevMonth").addEventListener("click", () => {
  adminViewDate = new Date(adminViewDate.getFullYear(), adminViewDate.getMonth() - 1, 1);
  renderAdmin();
});

$("adminNextMonth").addEventListener("click", () => {
  adminViewDate = new Date(adminViewDate.getFullYear(), adminViewDate.getMonth() + 1, 1);
  renderAdmin();
});

$("adminTodayBtn").addEventListener("click", async () => {
  const today = new Date();
  adminSelectedDate = isoDate(today);
  adminViewDate = startOfMonth(today);
  await loadAdminDraft();
  renderAdmin();
});

window.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    document.querySelectorAll(".modal:not(.hidden)").forEach(modal => closeModal(modal.id));
  }
});

// PWA install support
window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  $("installBtn").classList.remove("hidden");
});

$("installBtn").addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  $("installBtn").classList.add("hidden");
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  $("installBtn").classList.add("hidden");
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(console.error);
  });
}

async function init() {
  renderPublic();

  if (!configured()) {
    $("setupBanner").classList.remove("hidden");
    setSync("Not configured", true);
    return;
  }

  try {
    db = window.supabase.createClient(
      window.SUPABASE_URL,
      window.SUPABASE_PUBLISHABLE_KEY
    );

    await loadSchedule();
    subscribeRealtime();
  } catch (error) {
    console.error(error);
    $("setupBanner").classList.remove("hidden");
    setSync("Connection error", true);
  }
}

init();
