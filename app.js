// Massage by Ash Schedule
// Business hours are automatic:
// Tue-Fri 09:00-17:00
// Sat 09:00-15:00
// Sun/Mon closed, unless the date is a South African public holiday
// Public holidays 09:00-15:00
// Manual Supabase blocks always override the automatic business hours.

const ADMIN_EMAIL = "infocampbellweb@gmail.com";

let db = null;
let schedule = {};
let viewDate = startOfMonth(new Date());
let adminViewDate = startOfMonth(new Date());
let selectedDate = isoDate(new Date());
let adminSelectedDate = selectedDate;
let adminDraft = null;
let realtimeChannel = null;

const $ = id => document.getElementById(id);

function configured() {
  return window.SUPABASE_URL &&
    !window.SUPABASE_URL.includes("PASTE_") &&
    window.SUPABASE_PUBLISHABLE_KEY &&
    !window.SUPABASE_PUBLISHABLE_KEY.includes("PASTE_");
}

function pad(n) { return String(n).padStart(2, "0"); }

function isoDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseISODate(k) {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function sameMonth(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

function prettyDate(k) {
  return parseISODate(k).toLocaleDateString("en-ZA", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  });
}

function monthText(d) {
  return d.toLocaleDateString("en-ZA", { month: "long", year: "numeric" });
}

function emptyDay() {
  return { wholeDay: false, blockedSlots: [], customSlots: [], note: "" };
}

function getDayData(k) {
  return schedule[k] || emptyDay();
}

function makeBusinessSlots(startHour, endHour) {
  // Time options follow the requested pattern: :00, :15 and :30.
  // The closing hour itself is included as a final :00 option.
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

// Gregorian Easter Sunday (Meeus/Jones/Butcher algorithm).
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

  // Public Holidays Act: if a statutory public holiday falls on Sunday,
  // the following Monday is also a public holiday.
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
  const holiday = southAfricanPublicHolidays(date.getFullYear())
    .find(item => isoDate(item.date) === key);
  return holiday || null;
}

function baseAvailabilityForDay(key) {
  const date = parseISODate(key);
  const holiday = publicHolidayFor(key);

  // Public holidays override the normal Sunday/Monday closure.
  if (holiday) {
    return {
      closed: false,
      holiday: true,
      holidayName: holiday.name,
      label: "Public holiday hours",
      slots: makeBusinessSlots(9, 15)
    };
  }

  const day = date.getDay();

  if (day === 0 || day === 1) {
    return {
      closed: true,
      holiday: false,
      holidayName: "",
      label: "Closed",
      slots: []
    };
  }

  if (day === 6) {
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
  // The automatic business-hours schedule defines the allowed times.
  // custom_slots are intentionally ignored so the app cannot accidentally
  // display a time outside the configured business hours.
  return baseAvailabilityForDay(key).slots;
}

function statusForDay(key) {
  const base = baseAvailabilityForDay(key);
  if (base.closed) return "closed";

  const data = getDayData(key);
  if (data.wholeDay) return "blocked";

  const slots = allSlotsForDay(key);
  const blocked = new Set(data.blockedSlots || []);

  if (slots.length && slots.every(t => blocked.has(t))) return "blocked";
  if (blocked.size) return "partial";
  if (base.holiday) return "holiday";
  return "available";
}

function calendarDates(m) {
  const first = new Date(m.getFullYear(), m.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());

  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

function setSync(text, error = false) {
  $("syncStatus").textContent = text;
  $("syncStatus").style.color = error ? "#b41224" : "";
}

async function loadSchedule() {
  if (!db) return;

  setSync("Syncing…");

  const { data, error } = await db
    .from("schedule_days")
    .select("day,whole_day,blocked_slots,custom_slots");

  if (error) {
    console.error(error);
    setSync("Sync error", true);
    return;
  }

  schedule = {};

  for (const row of data || []) {
    schedule[row.day] = {
      wholeDay: row.whole_day,
      blockedSlots: row.blocked_slots || [],
      customSlots: row.custom_slots || [],
      note: ""
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
  const today = isoDate(new Date());

  calendarDates(monthDate).forEach(date => {
    const key = isoDate(date);
    const status = statusForDay(key);
    const base = baseAvailabilityForDay(key);
    const btn = document.createElement("button");

    btn.type = "button";
    btn.title = base.holiday ? base.holidayName : base.label;
    btn.className = [
      "day",
      sameMonth(date, monthDate) ? "" : "outside",
      key === selectedKey ? "selected" : "",
      key === today ? "today" : "",
      status
    ].filter(Boolean).join(" ");

    const badge = base.holiday ? `<span class="holiday-star">★</span>` : "";

    btn.innerHTML = `
      <span class="day-number">${date.getDate()}</span>
      ${badge}
      <span class="day-status"></span>
    `;

    btn.onclick = () => handler(key);
    grid.appendChild(btn);
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

  if (base.holiday) {
    const notice = document.createElement("div");
    notice.className = "holiday-notice";
    notice.innerHTML = `<strong>${base.holidayName}</strong><span>Public holiday hours: 09h00 – 15h00</span>`;
    wrap.appendChild(notice);
  }

  if (base.closed) {
    wrap.insertAdjacentHTML(
      "beforeend",
      '<div class="empty-state"><strong>Closed</strong><br>Sundays and Mondays are regular off days.</div>'
    );
    return;
  }

  if (data.wholeDay) {
    wrap.insertAdjacentHTML(
      "beforeend",
      '<div class="empty-state">This date has been manually blocked.</div>'
    );
    return;
  }

  const blocked = new Set(data.blockedSlots || []);
  const available = allSlotsForDay(selectedDate).filter(t => !blocked.has(t));

  if (!available.length) {
    wrap.insertAdjacentHTML(
      "beforeend",
      '<div class="empty-state">No appointment times are available on this date.</div>'
    );
    return;
  }

  available.forEach(time => {
    const el = document.createElement("div");
    el.className = "slot";
    el.textContent = formatSlot(time);
    wrap.appendChild(el);
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

document.querySelectorAll("[data-close]").forEach(
  b => b.onclick = () => closeModal(b.dataset.close)
);

document.querySelectorAll(".modal").forEach(
  m => m.onclick = e => {
    if (e.target === m) closeModal(m.id);
  }
);

async function currentUser() {
  if (!db) return null;
  const { data } = await db.auth.getUser();
  return data.user || null;
}

$("therapistBtn").onclick = async () => {
  if (!db) {
    $("setupBanner").classList.remove("hidden");
    return;
  }

  const user = await currentUser();
  user ? openAdmin() : openModal("loginModal");
};

$("loginForm").onsubmit = async e => {
  e.preventDefault();
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
};

$("logoutBtn").onclick = async () => {
  await db.auth.signOut();
  closeModal("adminModal");
};

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
    customSlots: [],
    note: ""
  };

  if (db) {
    const { data } = await db
      .from("schedule_days")
      .select("private_note")
      .eq("day", adminSelectedDate)
      .maybeSingle();

    if (data) adminDraft.note = data.private_note || "";
  }
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

  const base = baseAvailabilityForDay(adminSelectedDate);
  const autoInfo = $("autoHoursInfo");

  if (autoInfo) {
    if (base.holiday) {
      autoInfo.innerHTML = `<strong>${base.holidayName}</strong><span>Automatic public-holiday hours: 09h00 – 15h00</span>`;
    } else if (base.closed) {
      autoInfo.innerHTML = `<strong>Automatic off day</strong><span>Closed on Sundays and Mondays.</span>`;
    } else if (parseISODate(adminSelectedDate).getDay() === 6) {
      autoInfo.innerHTML = `<strong>Saturday</strong><span>Automatic hours: 09h00 – 15h00</span>`;
    } else {
      autoInfo.innerHTML = `<strong>Tuesday–Friday</strong><span>Automatic hours: 09h00 – 17h00</span>`;
    }
  }

  $("blockWholeDay").checked = adminDraft.wholeDay;
  $("dayNote").value = adminDraft.note || "";

  renderAdminSlotsOnly();
}

function renderAdminSlotsOnly() {
  const wrap = $("adminSlots");
  wrap.innerHTML = "";

  const base = baseAvailabilityForDay(adminSelectedDate);
  const blocked = new Set(adminDraft.blockedSlots || []);
  const slots = allSlotsForDay(adminSelectedDate);

  if (base.closed) {
    wrap.innerHTML = '<div class="empty-state">No hours to edit — this is an automatic off day.</div>';
    return;
  }

  slots.forEach(time => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = formatSlot(time);
    btn.disabled = adminDraft.wholeDay;
    btn.className = "admin-slot" + (blocked.has(time) ? " is-blocked" : "");

    btn.onclick = () => {
      const set = new Set(adminDraft.blockedSlots);
      set.has(time) ? set.delete(time) : set.add(time);
      adminDraft.blockedSlots = [...set].sort();
      renderAdminSlotsOnly();
    };

    wrap.appendChild(btn);
  });
}

$("blockWholeDay").onchange = e => {
  adminDraft.wholeDay = e.target.checked;
  renderAdminSlotsOnly();
};

$("dayNote").oninput = e => {
  adminDraft.note = e.target.value;
};

// The old custom-time form is hidden because this version follows fixed business hours.
const customForm = $("customSlotForm");
if (customForm) customForm.style.display = "none";

$("saveDayBtn").onclick = async () => {
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

  $("saveMessage").textContent = "Saved to Supabase.";
  await loadSchedule();

  setTimeout(() => $("saveMessage").textContent = "", 1800);
};

$("clearDayBtn").onclick = async () => {
  const { error } = await db
    .from("schedule_days")
    .delete()
    .eq("day", adminSelectedDate);

  if (error) {
    $("saveMessage").textContent = "Could not clear this date.";
    return;
  }

  $("saveMessage").textContent = "Manual blocks cleared. Automatic hours restored.";
  await loadSchedule();
  await loadAdminDraft();
  renderAdmin();
};

$("prevMonth").onclick = () => {
  viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1);
  renderPublic();
};

$("nextMonth").onclick = () => {
  viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1);
  renderPublic();
};

$("adminPrevMonth").onclick = () => {
  adminViewDate = new Date(adminViewDate.getFullYear(), adminViewDate.getMonth() - 1, 1);
  renderAdmin();
};

$("adminNextMonth").onclick = () => {
  adminViewDate = new Date(adminViewDate.getFullYear(), adminViewDate.getMonth() + 1, 1);
  renderAdmin();
};

window.onkeydown = e => {
  if (e.key === "Escape") {
    document
      .querySelectorAll(".modal:not(.hidden)")
      .forEach(m => closeModal(m.id));
  }
};

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
  } catch (e) {
    console.error(e);
    $("setupBanner").classList.remove("hidden");
    setSync("Connection error", true);
  }
}

init();
