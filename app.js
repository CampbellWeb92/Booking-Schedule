// Massage by Ash Schedule - Full live booking manager
// Shared Supabase system for public availability, bookings, buffers, custom hours,
// public notices, holiday overrides, settings, history and Realtime sync.

let db = null;
let schedule = {};
let publicBlocks = {};
let holidayOverrides = {};
let settings = { defaultBufferMinutes: 15, minNoticeMinutes: 120, maxAdvanceDays: 60 };
let appointments = [];
let historyRows = [];
let viewDate = startOfMonth(new Date());
let adminViewDate = startOfMonth(new Date());
let selectedDate = isoDate(new Date());
let adminSelectedDate = selectedDate;
let adminDraft = null;
let realtimeChannels = [];
let adminRealtimeSubscribed = false;
let deferredInstallPrompt = null;

// Pending booking alert preferences are stored per device/browser.
let bookingAlertsEnabled = localStorage.getItem('mba_booking_alerts_enabled') === 'true';
let bookingAlertSoundEnabled = localStorage.getItem('mba_booking_alert_sound') !== 'false';
let bookingAlertAudio = null;
let bookingAlertAudioContext = null;
let bookingAlertAudioUnlocked = false;
let currentAlertAppointmentId = null;
let bookingAlertDismissTimer = null;
let bookingMonitorTimer = null;
let bookingRealtimeRetryTimer = null;
let adminAppointmentsChannel = null;
let adminHistoryChannel = null;
let pendingAlertOpenRequested = new URLSearchParams(location.search).get('pending') === '1';
let editingAppointmentId = null;
let todayMiniViewDate = startOfMonth(new Date());
const ALERTED_PENDING_STORAGE_KEY = 'mba_alerted_pending_booking_ids_v2';
const ALERTED_PENDING_MAX = 150;
const alertedPendingIds = new Set((()=>{
  try { return JSON.parse(localStorage.getItem(ALERTED_PENDING_STORAGE_KEY) || '[]').map(String); }
  catch { return []; }
})());

const $ = id => document.getElementById(id);
const qsa = selector => [...document.querySelectorAll(selector)];

function configured() {
  return window.SUPABASE_URL && !window.SUPABASE_URL.includes("PASTE_") &&
    window.SUPABASE_PUBLISHABLE_KEY && !window.SUPABASE_PUBLISHABLE_KEY.includes("PASTE_");
}
function pad(n) { return String(n).padStart(2, "0"); }
function isoDate(date) { return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`; }
function parseISODate(key) { const [y,m,d] = key.split("-").map(Number); return new Date(y,m-1,d); }
function startOfMonth(date) { return new Date(date.getFullYear(), date.getMonth(), 1); }
function sameMonth(a,b) { return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth(); }
function prettyDate(key) { return parseISODate(key).toLocaleDateString("en-ZA", {weekday:"short", day:"numeric", month:"short", year:"numeric"}); }
function monthText(date) { return date.toLocaleDateString("en-ZA", {month:"long", year:"numeric"}); }
function addDays(date, amount) { const d = new Date(date); d.setDate(d.getDate()+amount); return d; }
function formatSlot(time) { return String(time).slice(0,5).replace(":", "h"); }
function timeToMinutes(value) { const [h,m] = String(value).slice(0,5).split(":").map(Number); return h*60+m; }
function minutesToTime(total) { const mins=Math.max(0,Math.min(total,23*60+59)); return `${pad(Math.floor(mins/60))}:${pad(mins%60)}`; }
function emptyDay() { return { wholeDay:false, blockedSlots:[], customSlots:[], note:"" }; }
function getDayData(key) { return schedule[key] || emptyDay(); }
function getBlocks(key) { return publicBlocks[key] || []; }
function setSync(text, error=false) { if (!$('syncStatus')) return; $('syncStatus').textContent=text; $('syncStatus').classList.toggle('error',error); }
function message(text, isError=false) { if (!$('saveMessage')) return; $('saveMessage').textContent=text; $('saveMessage').classList.toggle('error',isError); }

function makeBusinessSlots(startHour, endHour) {
  const slots=[];
  for (let hour=startHour; hour<=endHour; hour++) {
    slots.push(`${pad(hour)}:00`);
    if (hour<endHour) { slots.push(`${pad(hour)}:15`); slots.push(`${pad(hour)}:30`); }
  }
  return slots;
}
function makeCustomSlots(start, end) {
  const s=timeToMinutes(start), e=timeToMinutes(end);
  if (!Number.isFinite(s)||!Number.isFinite(e)||e<=s) return [];
  const slots=[];
  for (let mins=s; mins<=e; mins+=15) {
    const minute=mins%60;
    if (minute===0 || minute===15 || minute===30 || mins===e) slots.push(minutesToTime(mins));
  }
  if (slots[slots.length-1]!==minutesToTime(e)) slots.push(minutesToTime(e));
  return [...new Set(slots)];
}

function easterSunday(year) {
  const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3);
  const h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451);
  const month=Math.floor((h+l-7*m+114)/31),day=((h+l-7*m+114)%31)+1;
  return new Date(year,month-1,day);
}
function southAfricanPublicHolidays(year) {
  const easter=easterSunday(year);
  const holidays=[
    {date:new Date(year,0,1),name:"New Year's Day"},{date:new Date(year,2,21),name:"Human Rights Day"},
    {date:addDays(easter,-2),name:"Good Friday"},{date:addDays(easter,1),name:"Family Day"},
    {date:new Date(year,3,27),name:"Freedom Day"},{date:new Date(year,4,1),name:"Workers' Day"},
    {date:new Date(year,5,16),name:"Youth Day"},{date:new Date(year,7,9),name:"National Women's Day"},
    {date:new Date(year,8,24),name:"Heritage Day"},{date:new Date(year,11,16),name:"Day of Reconciliation"},
    {date:new Date(year,11,25),name:"Christmas Day"},{date:new Date(year,11,26),name:"Day of Goodwill"}
  ];
  const expanded=[...holidays];
  holidays.forEach(h=>{ if(h.date.getDay()===0) expanded.push({date:addDays(h.date,1),name:`${h.name} (observed)`}); });
  return expanded;
}
function automaticHolidayFor(key) {
  const d=parseISODate(key);
  return southAfricanPublicHolidays(d.getFullYear()).find(h=>isoDate(h.date)===key)||null;
}
function holidayInfoFor(key) {
  const override=holidayOverrides[key];
  const auto=automaticHolidayFor(key);
  if (override?.mode==='normal') return null;
  if (override?.mode==='closed') return {name:override.name||auto?.name||'Public holiday', closed:true, customSlots:[]};
  if (override?.mode==='holiday') return {name:override.name||auto?.name||'Public holiday', closed:false, customSlots:override.customSlots||[]};
  return auto ? {name:auto.name, closed:false, customSlots:[]} : null;
}
function baseAvailabilityForDay(key) {
  const date=parseISODate(key);
  const dayData=getDayData(key);
  const holiday=holidayInfoFor(key);
  let closed=false, slots=[], label='', holidayName='';

  if (holiday?.closed) {
    closed=true; label='Closed for public holiday'; holidayName=holiday.name;
  } else if (holiday) {
    closed=false; label='Public holiday hours'; holidayName=holiday.name;
    slots=(holiday.customSlots?.length ? holiday.customSlots : makeBusinessSlots(9,15));
  } else {
    const weekday=date.getDay();
    if (weekday===0 || weekday===1) { closed=true; label='Closed'; slots=[]; }
    else if (weekday===6) { slots=makeBusinessSlots(9,15); label='Saturday hours'; }
    else { slots=makeBusinessSlots(9,17); label='Business hours'; }
  }

  if (dayData.customSlots?.length) {
    closed=false; slots=[...dayData.customSlots].sort(); label='Custom hours';
  }
  return { closed, holiday:!!holiday, holidayName, label, slots };
}
function allSlotsForDay(key) { return baseAvailabilityForDay(key).slots; }
function slotInsideConfirmedRange(key,time) {
  const m=timeToMinutes(time);
  return getBlocks(key).some(b=>m>=timeToMinutes(b.startTime) && m<timeToMinutes(b.endTime));
}
function slotIsBlocked(key,time) {
  const day=getDayData(key);
  return day.wholeDay || (day.blockedSlots||[]).includes(time) || slotInsideConfirmedRange(key,time);
}
function availablePointSlots(key) {
  return allSlotsForDay(key).filter(t=>!slotIsBlocked(key,t));
}
function statusForDay(key) {
  const base=baseAvailabilityForDay(key);
  if (base.closed) return 'closed';
  const day=getDayData(key);
  if (day.wholeDay) return 'blocked';
  const slots=allSlotsForDay(key), available=availablePointSlots(key);
  if (slots.length && !available.length) return 'blocked';
  if (available.length<slots.length) return 'partial';
  return base.holiday ? 'holiday' : 'available';
}
function publicNoteForDay(key) {
  const dayNote=(getDayData(key).note||'').trim();
  const holidayNote=(holidayOverrides[key]?.publicNote||'').trim();
  const blockNotes=getBlocks(key).map(b=>(b.publicNote||'').trim()).filter(Boolean);
  return [...new Set([dayNote,holidayNote,...blockNotes].filter(Boolean))].join(' ');
}
function calendarDates(monthDate) {
  const first=new Date(monthDate.getFullYear(),monthDate.getMonth(),1),start=new Date(first);
  start.setDate(first.getDate()-((first.getDay()+6)%7));
  return Array.from({length:42},(_,i)=>{ const d=new Date(start); d.setDate(start.getDate()+i); return d; });
}

async function loadPublicData() {
  if (!db) return;
  setSync('Syncing…');
  const [daysRes,blocksRes,holidaysRes,settingsRes]=await Promise.all([
    db.from('public_schedule_days').select('day,whole_day,blocked_slots,custom_slots,public_note'),
    db.from('public_schedule_blocks').select('appointment_id,day,start_time,end_time,kind,public_note'),
    db.from('holiday_overrides').select('day,name,mode,custom_slots,public_note'),
    db.from('schedule_settings').select('default_buffer_minutes,min_notice_minutes,max_advance_days').eq('id',1).maybeSingle()
  ]);
  const firstError=[daysRes.error,blocksRes.error,holidaysRes.error,settingsRes.error].find(Boolean);
  if (firstError) { console.error(firstError); setSync('Upgrade SQL required',true); return; }

  schedule={};
  (daysRes.data||[]).forEach(r=>schedule[r.day]={wholeDay:!!r.whole_day,blockedSlots:r.blocked_slots||[],customSlots:r.custom_slots||[],note:r.public_note||''});
  publicBlocks={};
  (blocksRes.data||[]).forEach(r=>{ (publicBlocks[r.day] ||= []).push({id:r.appointment_id,startTime:String(r.start_time).slice(0,5),endTime:String(r.end_time).slice(0,5),kind:r.kind,publicNote:r.public_note||''}); });
  holidayOverrides={};
  (holidaysRes.data||[]).forEach(r=>holidayOverrides[r.day]={name:r.name||'',mode:r.mode,customSlots:r.custom_slots||[],publicNote:r.public_note||''});
  if (settingsRes.data) settings={defaultBufferMinutes:settingsRes.data.default_buffer_minutes,minNoticeMinutes:settingsRes.data.min_notice_minutes,maxAdvanceDays:settingsRes.data.max_advance_days};
  setSync('Live');
  renderPublic();
  if ($('adminModal') && !$('adminModal').classList.contains('hidden')) { await refreshAdminData(false); }
}
function subscribeRealtime() {
  if (!db) return;
  ['public_schedule_days','public_schedule_blocks','holiday_overrides','schedule_settings'].forEach(table=>{
    const ch=db.channel(`live-${table}`).on('postgres_changes',{event:'*',schema:'public',table},()=>loadPublicData()).subscribe();
    realtimeChannels.push(ch);
  });
}

function renderCalendar(gridId,labelId,monthDate,selectedKey,handler,isAdmin=false) {
  $(labelId).textContent=monthText(monthDate);
  const grid=$(gridId); grid.innerHTML=''; const todayKey=isoDate(new Date());
  calendarDates(monthDate).forEach(date=>{
    const key=isoDate(date),base=baseAvailabilityForDay(key),status=statusForDay(key),note=publicNoteForDay(key);
    const btn=document.createElement('button'); btn.type='button'; btn.dataset.date=key;
    btn.className=['day',sameMonth(date,monthDate)?'':'outside',key===selectedKey?'selected':'',key===todayKey?'today':'',note?'has-note':'',status].filter(Boolean).join(' ');
    btn.title=[base.holidayName||base.label,note].filter(Boolean).join(' — ');
    btn.innerHTML=`<span class="day-number">${date.getDate()}</span>${base.holiday?'<span class="holiday-star" aria-label="Public holiday">★</span>':''}${note?'<span class="note-indicator" aria-label="Public note"></span>':''}<span class="day-status"></span>`;
    btn.addEventListener('click',()=>handler(key));
    grid.appendChild(btn);
  });
}
function renderPublic() {
  if (!$('calendarGrid')) return;
  renderCalendar('calendarGrid','monthLabel',viewDate,selectedDate,key=>{selectedDate=key;viewDate=startOfMonth(parseISODate(key));renderPublic();});
  $('selectedDateLabel').textContent=prettyDate(selectedDate);
  const wrap=$('publicSlots'); wrap.innerHTML='';
  const base=baseAvailabilityForDay(selectedDate), day=getDayData(selectedDate), note=publicNoteForDay(selectedDate), noteBox=$('publicNote');
  if (note) { noteBox.innerHTML=`<strong>Client Notice</strong><p></p>`; noteBox.querySelector('p').textContent=note; noteBox.classList.remove('hidden'); }
  else { noteBox.innerHTML=''; noteBox.classList.add('hidden'); }
  if (base.holiday) { const n=document.createElement('div'); n.className='holiday-notice'; n.innerHTML=`<strong>${base.holidayName}</strong><span>${base.closed?'Closed for this holiday':base.label}</span>`; wrap.appendChild(n); }
  if (base.closed) { wrap.insertAdjacentHTML('beforeend','<div class="empty-state"><strong>Closed</strong><br>No appointment times are available on this date.</div>'); return; }
  if (day.wholeDay) { wrap.insertAdjacentHTML('beforeend','<div class="empty-state">This date is unavailable.</div>'); return; }
  const available=availablePointSlots(selectedDate);
  if (!available.length) { wrap.insertAdjacentHTML('beforeend','<div class="empty-state">No appointment times are available on this date.</div>'); return; }
  available.forEach(time=>{ const el=document.createElement('div'); el.className='slot'; el.textContent=formatSlot(time); wrap.appendChild(el); });
}

function openModal(id) { $(id).classList.remove('hidden'); document.body.style.overflow='hidden'; }
function closeModal(id) { $(id).classList.add('hidden'); if(!document.querySelector('.modal:not(.hidden)')) document.body.style.overflow=''; }
qsa('[data-close]').forEach(b=>b.addEventListener('click',()=>closeModal(b.dataset.close)));
qsa('.modal').forEach(m=>m.addEventListener('click',e=>{if(e.target===m) closeModal(m.id);}));

async function currentUser() { if(!db)return null; const {data}=await db.auth.getUser(); return data.user||null; }
async function isAuthorizedAdmin(user) {
  if (!user?.email) return false;
  const {data,error}=await db.from('schedule_admins').select('email,active').eq('email',user.email.toLowerCase()).maybeSingle();
  return !error && !!data?.active;
}
$('therapistBtn')?.addEventListener('click',async()=>{ if(!db){$('setupBanner').classList.remove('hidden');return;} const u=await currentUser(); if(u && await isAuthorizedAdmin(u)) openAdmin(); else openModal('loginModal'); });
$('loginForm')?.addEventListener('submit',async e=>{
  e.preventDefault(); $('loginError').textContent='';
  const {error}=await db.auth.signInWithPassword({email:$('loginEmail').value.trim(),password:$('loginPassword').value});
  if(error){$('loginError').textContent='Incorrect email or password.';return;}
  const user=await currentUser();
  if(!await isAuthorizedAdmin(user)){await db.auth.signOut();$('loginError').textContent='This account is not authorised for the schedule.';return;}
  $('loginPassword').value=''; closeModal('loginModal');
  if(pendingAlertOpenRequested){pendingAlertOpenRequested=false;await openAdmin();activateBookingsTab();}
  else openAdmin();
});
$('logoutBtn')?.addEventListener('click',async()=>{stopBookingMonitor();adminRealtimeSubscribed=false;await removeAdminRealtimeChannels();await db.auth.signOut();closeModal('adminModal');});

async function loadAppointments() {
  const {data,error}=await db.from('appointments').select('*').order('day',{ascending:true}).order('start_time',{ascending:true});
  if(error){console.error(error);message('Could not load bookings. Run SUPABASE-UPGRADE.sql.',true);return;}
  appointments=data||[];
}
async function loadHistory() {
  const {data,error}=await db.from('schedule_audit').select('id,table_name,action,record_key,actor_email,changed_at,old_row,new_row').order('changed_at',{ascending:false}).limit(60);
  if(!error) historyRows=data||[];
}
async function refreshAdminData(render=true) {
  await Promise.all([loadAppointments(),loadHistory()]);
  if(render) { await loadAdminDraft(); renderAdmin(); renderBookingsPanels(); renderSettings(); renderHistory(); updateAlertSettingsUI(); }
  else { renderBookingsPanels(); renderHistory(); updateAlertSettingsUI(); }
}

function rememberAlertedPendingId(id) {
  if (!id) return;
  alertedPendingIds.add(String(id));
  try {
    const values=[...alertedPendingIds].slice(-ALERTED_PENDING_MAX);
    localStorage.setItem(ALERTED_PENDING_STORAGE_KEY,JSON.stringify(values));
  } catch (error) { console.info('Could not persist alerted booking IDs:',error); }
}

function ensureBookingAlertAudio() {
  if (!bookingAlertAudio) {
    bookingAlertAudio = new Audio(new URL('notification.wav', location.href).href);
    bookingAlertAudio.preload = 'auto';
    bookingAlertAudio.volume = 0.9;
    bookingAlertAudio.setAttribute('playsinline','');
  }
  return bookingAlertAudio;
}

function ensureBookingAudioContext() {
  if (!bookingAlertAudioContext) {
    const AudioCtx=window.AudioContext||window.webkitAudioContext;
    if (AudioCtx) bookingAlertAudioContext=new AudioCtx();
  }
  return bookingAlertAudioContext;
}

async function unlockBookingAlertAudio() {
  if (!bookingAlertSoundEnabled) return;
  try {
    const audio=ensureBookingAlertAudio();
    const previousVolume=audio.volume;
    audio.volume=0;
    audio.currentTime=0;
    await audio.play();
    audio.pause();
    audio.currentTime=0;
    audio.volume=previousVolume;
    bookingAlertAudioUnlocked=true;
  } catch (error) {
    console.info('HTML audio unlock was deferred:',error);
  }
  try {
    const ctx=ensureBookingAudioContext();
    if (ctx?.state==='suspended') await ctx.resume();
    if (ctx?.state==='running') bookingAlertAudioUnlocked=true;
  } catch (error) {
    console.info('Web Audio unlock was deferred:',error);
  }
}

async function playFallbackBookingChime() {
  try {
    const ctx=ensureBookingAudioContext();
    if (!ctx) return false;
    if (ctx.state==='suspended') await ctx.resume();
    if (ctx.state!=='running') return false;
    const now=ctx.currentTime;
    const gain=ctx.createGain();
    gain.gain.setValueAtTime(0.0001,now);
    gain.gain.exponentialRampToValueAtTime(0.22,now+0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001,now+0.65);
    gain.connect(ctx.destination);
    [[660,0],[880,0.16],[1046,0.34]].forEach(([frequency,delay])=>{
      const osc=ctx.createOscillator();
      osc.type='sine';
      osc.frequency.setValueAtTime(frequency,now+delay);
      osc.connect(gain);
      osc.start(now+delay);
      osc.stop(now+delay+0.28);
    });
    return true;
  } catch (error) {
    console.info('Fallback booking chime unavailable:',error);
    return false;
  }
}

async function playBookingAlertSound() {
  if (!bookingAlertSoundEnabled) return;
  try {
    const audio=ensureBookingAlertAudio();
    audio.pause();
    audio.currentTime=0;
    audio.volume=0.9;
    await audio.play();
    bookingAlertAudioUnlocked=true;
    return;
  } catch (error) {
    console.info('WAV booking chime could not play; trying fallback chime.',error);
  }
  await playFallbackBookingChime();
}

function notificationPermissionText() {
  if (!('Notification' in window)) return 'Device notifications are not supported by this browser.';
  if (Notification.permission==='granted') return 'Device notifications are allowed.';
  if (Notification.permission==='denied') return 'Device notifications are blocked in browser settings.';
  return 'Device notification permission has not been granted yet.';
}

function updateAlertSettingsUI() {
  const title=$('alertStatusTitle'), text=$('alertStatusText'), enable=$('enableAlertsBtn'), sound=$('toggleAlertSoundBtn');
  if (!title || !text) return;
  if (bookingAlertsEnabled) {
    title.textContent='Booking alerts are enabled';
    text.textContent=`Live booking checks are on. ${bookingAlertSoundEnabled?'Chime is on.':'Chime is muted.'} ${notificationPermissionText()}`;
    if(enable) enable.textContent='Alerts Enabled';
  } else {
    title.textContent='Booking alerts are off';
    text.textContent=`Enable alerts on this device to receive real pending-booking notifications. ${notificationPermissionText()}`;
    if(enable) enable.textContent='Enable Booking Alerts';
  }
  if(sound) sound.textContent=bookingAlertSoundEnabled?'Mute Sound':'Unmute Sound';
}

async function enableBookingAlerts({playConfirmation=true,scanNow=true}={}) {
  bookingAlertsEnabled=true;
  localStorage.setItem('mba_booking_alerts_enabled','true');
  if ('Notification' in window && Notification.permission==='default') {
    try { await Notification.requestPermission(); } catch (error) { console.info(error); }
  }
  // This function is called from a click/tap. Unlock both audio paths here so
  // a later Realtime/polling callback can play the same chime without a gesture.
  await unlockBookingAlertAudio();
  if (playConfirmation) await playBookingAlertSound();
  updateAlertSettingsUI();
  startBookingMonitor();
  if (scanNow) await scanForPendingBookingAlerts({includeExisting:true});
  message('Booking alerts are enabled. New website requests will be checked live and by fallback polling.');
}

function dismissBookingAlert() {
  if(bookingAlertDismissTimer) clearTimeout(bookingAlertDismissTimer);
  bookingAlertDismissTimer=null;
  $('bookingAlertPopup')?.classList.add('hidden');
}

async function showDeviceBookingNotification(appointment, isTest=false) {
  if (!bookingAlertsEnabled || !('Notification' in window) || Notification.permission!=='granted') return;
  const start=String(appointment.start_time||'').slice(0,5);
  const title=isTest?'Test Booking Alert':'New Pending Booking';
  const body=isTest
    ? 'Your Massage by Ash booking alerts are working.'
    : `${appointment.client_name||'Client'} · ${prettyDate(appointment.day)} at ${formatSlot(start)}${appointment.service?` · ${appointment.service}`:''}`;
  const options={
    body,
    icon:'./images/logo-clean.png',
    badge:'./images/logo-clean.png',
    tag:isTest?'mba-booking-alert-test':`mba-booking-${appointment.id}`,
    renotify:true,
    requireInteraction:!isTest,
    silent:false,
    timestamp:Date.now(),
    data:{appointmentId:appointment.id||null,url:'./?pending=1'}
  };
  try {
    if ('serviceWorker' in navigator) {
      let registration=await navigator.serviceWorker.getRegistration();
      if (!registration) registration=await navigator.serviceWorker.ready;
      await registration.showNotification(title,options);
    } else {
      new Notification(title,options);
    }
  } catch (error) { console.info('Device notification unavailable:',error); }
}

async function showPendingBookingAlert(appointment,{test=false}={}) {
  if (!test && (!bookingAlertsEnabled || appointment?.status!=='pending' || appointment?.kind==='manual_block')) return;
  if (!test && appointment?.id && alertedPendingIds.has(String(appointment.id))) return;
  if (!test && appointment?.id) rememberAlertedPendingId(appointment.id);

  currentAlertAppointmentId=appointment?.id||null;
  const title=$('bookingAlertTitle'), details=$('bookingAlertDetails'), popup=$('bookingAlertPopup');
  const start=String(appointment?.start_time||'09:00').slice(0,5);
  if(title) title.textContent=test?'Test alert — everything is working':(appointment?.client_name||'New pending booking');
  if(details) details.textContent=test
    ? 'This test also enables real booking alerts on this device.'
    : `${prettyDate(appointment.day)} at ${formatSlot(start)}${appointment.service?` · ${appointment.service}`:''}`;
  popup?.classList.remove('hidden');

  if(bookingAlertDismissTimer) clearTimeout(bookingAlertDismissTimer);
  bookingAlertDismissTimer=setTimeout(dismissBookingAlert,test?9000:25000);
  await playBookingAlertSound();
  if(navigator.vibrate && !test) navigator.vibrate([180,80,180,80,260]);
  await showDeviceBookingNotification(appointment,test);
}

async function openPendingBookings(appointmentId=null) {
  const user=await currentUser();
  if(!user || !await isAuthorizedAdmin(user)) {
    pendingAlertOpenRequested=true;
    openModal('loginModal');
    return;
  }
  if($('adminModal')?.classList.contains('hidden')) await openAdmin();
  activateBookingsTab();
  dismissBookingAlert();
  const targetId=appointmentId||currentAlertAppointmentId;
  if(targetId){
    setTimeout(()=>{
      const card=document.querySelector(`[data-appointment-id="${CSS.escape(String(targetId))}"]`);
      if(card){card.classList.add('alert-highlight');card.scrollIntoView({behavior:'smooth',block:'center'});setTimeout(()=>card.classList.remove('alert-highlight'),2600);}
    },60);
  } else $('pendingRequests')?.scrollIntoView({behavior:'smooth',block:'start'});
}

async function scanForPendingBookingAlerts({includeExisting=false}={}) {
  if (!db || !bookingAlertsEnabled) return;
  // Use the locally persisted session here; the appointments RLS policy remains
  // the authority for whether this device may read pending requests.
  const {data:sessionData}=await db.auth.getSession();
  if (!sessionData?.session?.user) return;
  const {data,error}=await db.from('appointments')
    .select('id,day,start_time,end_time,status,kind,service,client_name,client_phone,source,created_at')
    .eq('status','pending')
    .eq('kind','booking')
    .order('created_at',{ascending:true});
  if (error) {
    console.info('Pending booking fallback check failed:',error);
    return;
  }
  const unseen=(data||[]).filter(a=>a.id && !alertedPendingIds.has(String(a.id)));
  if (!unseen.length) return;
  // When alerts are explicitly enabled/tested, includeExisting=true ensures a
  // pending request that Realtime already missed is surfaced immediately.
  const alerts=includeExisting ? unseen : unseen;
  for (const appointment of alerts) await showPendingBookingAlert(appointment);
  await loadAppointments();
  renderBookingsPanels();
}

function stopBookingMonitor() {
  if (bookingMonitorTimer) clearInterval(bookingMonitorTimer);
  bookingMonitorTimer=null;
}

function startBookingMonitor() {
  stopBookingMonitor();
  if (!bookingAlertsEnabled) return;
  bookingMonitorTimer=setInterval(()=>scanForPendingBookingAlerts(),15000);
}

function scheduleRealtimeRetry() {
  if (bookingRealtimeRetryTimer) return;
  bookingRealtimeRetryTimer=setTimeout(()=>{
    bookingRealtimeRetryTimer=null;
    adminRealtimeSubscribed=false;
    subscribeAdminRealtime();
    scanForPendingBookingAlerts();
  },5000);
}

async function removeAdminRealtimeChannels() {
  const channels=[adminAppointmentsChannel,adminHistoryChannel].filter(Boolean);
  adminAppointmentsChannel=null;
  adminHistoryChannel=null;
  for (const channel of channels) {
    try { await db?.removeChannel(channel); } catch (error) { console.info(error); }
  }
}

async function subscribeAdminRealtime() {
  if (!db || adminRealtimeSubscribed) return;
  const user=await currentUser();
  if (!user || !await isAuthorizedAdmin(user)) return;

  await removeAdminRealtimeChannels();

  adminAppointmentsChannel=db.channel(`admin-appointments-live-${Date.now()}`)
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'appointments'},async payload=>{
      await loadAppointments();
      renderBookingsPanels();
      const appointment=payload.new;
      if(appointment?.status==='pending' && appointment?.kind!=='manual_block') await showPendingBookingAlert(appointment);
    })
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'appointments'},async payload=>{
      await loadAppointments();
      renderBookingsPanels();
      if(payload.new?.status==='pending' && payload.old?.status!=='pending' && payload.new?.kind!=='manual_block') {
        await showPendingBookingAlert(payload.new);
      }
    })
    .on('postgres_changes',{event:'DELETE',schema:'public',table:'appointments'},async()=>{
      await loadAppointments();
      renderBookingsPanels();
    })
    .subscribe((status,error)=>{
      console.info('Booking Realtime status:',status,error||'');
      if(status==='SUBSCRIBED'){
        adminRealtimeSubscribed=true;
        if(bookingRealtimeRetryTimer){clearTimeout(bookingRealtimeRetryTimer);bookingRealtimeRetryTimer=null;}
        scanForPendingBookingAlerts();
      } else if(status==='CHANNEL_ERROR' || status==='TIMED_OUT' || status==='CLOSED'){
        adminRealtimeSubscribed=false;
        scheduleRealtimeRetry();
      }
    });

  adminHistoryChannel=db.channel(`admin-history-live-${Date.now()}`)
    .on('postgres_changes',{event:'*',schema:'public',table:'schedule_audit'},async()=>{await loadHistory();renderHistory();})
    .subscribe((status,error)=>{
      if(status==='CHANNEL_ERROR' || status==='TIMED_OUT') console.info('History Realtime status:',status,error||'');
    });

  realtimeChannels.push(adminAppointmentsChannel,adminHistoryChannel);
  startBookingMonitor();
}

$('enableAlertsBtn')?.addEventListener('click',()=>enableBookingAlerts());
$('toggleAlertSoundBtn')?.addEventListener('click',async()=>{
  bookingAlertSoundEnabled=!bookingAlertSoundEnabled;
  localStorage.setItem('mba_booking_alert_sound',String(bookingAlertSoundEnabled));
  updateAlertSettingsUI();
  if(bookingAlertSoundEnabled){await unlockBookingAlertAudio();await playBookingAlertSound();}
});
$('testAlertBtn')?.addEventListener('click',async()=>{
  // A successful test must mean REAL alerts are enabled too. The old build
  // allowed the test popup/sound to work while real alerts were still off.
  if(!bookingAlertsEnabled) await enableBookingAlerts({playConfirmation:false,scanNow:false});
  else await unlockBookingAlertAudio();
  await showPendingBookingAlert({id:'test',status:'pending',kind:'booking',day:isoDate(new Date()),start_time:'09:00',service:'Test appointment',client_name:'Test client'},{test:true});
  await scanForPendingBookingAlerts({includeExisting:true});
});
$('dismissBookingAlertBtn')?.addEventListener('click',dismissBookingAlert);
$('viewBookingAlertBtn')?.addEventListener('click',()=>openPendingBookings(currentAlertAppointmentId));
if('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message',event=>{
  if(event.data?.type==='OPEN_PENDING_BOOKINGS') openPendingBookings(event.data.appointmentId||null);
});

// Prime audio on the first interaction anywhere in the installed app/page.
document.addEventListener('pointerdown',async function primeBookingAudio(){
  document.removeEventListener('pointerdown',primeBookingAudio);
  if(!bookingAlertsEnabled || !bookingAlertSoundEnabled) return;
  await unlockBookingAlertAudio();
},{passive:true});

// Recheck after the app returns from the background or reconnects. This catches
// requests received while a mobile browser/PWA paused its WebSocket.
window.addEventListener('focus',()=>{ if(bookingAlertsEnabled){subscribeAdminRealtime();scanForPendingBookingAlerts();} });
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible' && bookingAlertsEnabled){subscribeAdminRealtime();scanForPendingBookingAlerts();}
});
window.addEventListener('online',()=>{ if(bookingAlertsEnabled){adminRealtimeSubscribed=false;subscribeAdminRealtime();scanForPendingBookingAlerts();} });
async function openAdmin() {
  adminViewDate=startOfMonth(parseISODate(adminSelectedDate));
  todayMiniViewDate=startOfMonth(new Date());
  await subscribeAdminRealtime();
  if(bookingAlertsEnabled) startBookingMonitor();
  await refreshAdminData(false); await loadAdminDraft(); renderAdmin(); renderBookingsPanels(); renderSettings(); renderHistory(); updateAlertSettingsUI(); openModal('adminModal');
  switchAdminTab('today');
  if(bookingAlertsEnabled) scanForPendingBookingAlerts();
}
async function loadAdminDraft() {
  const src=getDayData(adminSelectedDate);
  adminDraft={wholeDay:!!src.wholeDay,blockedSlots:[...(src.blockedSlots||[])],customSlots:[...(src.customSlots||[])],note:src.note||''};
}
function autoInfoText(key) {
  const base=baseAvailabilityForDay(key), autoHoliday=automaticHolidayFor(key), override=holidayOverrides[key];
  if (override?.mode==='normal') return `<strong>Holiday override: normal day</strong><span>${base.label}</span>`;
  if (base.holiday) return `<strong>${base.holidayName}</strong><span>${base.closed?'Closed by holiday override':base.label}</span>`;
  if (adminDraft?.customSlots?.length) return `<strong>Custom hours</strong><span>${formatSlot(adminDraft.customSlots[0])} – ${formatSlot(adminDraft.customSlots.at(-1))}</span>`;
  if (base.closed) return '<strong>Automatic off day</strong><span>Closed on Sundays and Mondays unless custom hours are set.</span>';
  return `<strong>${base.label}</strong><span>${formatSlot(base.slots[0])} – ${formatSlot(base.slots.at(-1))}</span>`;
}
function renderAdmin() {
  renderCalendar('adminCalendarGrid','adminMonthLabel',adminViewDate,adminSelectedDate,async key=>{adminSelectedDate=key;adminViewDate=startOfMonth(parseISODate(key));await loadAdminDraft();renderAdmin();renderBookingsPanels();});
  $('adminSelectedDateLabel').textContent=prettyDate(adminSelectedDate);
  $('autoHoursInfo').innerHTML=autoInfoText(adminSelectedDate);
  $('blockWholeDay').checked=adminDraft.wholeDay;
  $('dayNote').value=adminDraft.note||'';
  const custom=adminDraft.customSlots||[];
  $('useCustomHours').checked=custom.length>0;
  if(custom.length){$('customOpen').value=custom[0];$('customClose').value=custom.at(-1);}
  const h=holidayOverrides[adminSelectedDate];
  $('holidayMode').value=h?.mode||'automatic'; $('holidayName').value=h?.name||automaticHolidayFor(adminSelectedDate)?.name||'';
  renderAdminSlotsOnly(); renderAdminBookingOptions(); renderDayAppointments();
  if($('addBookingDate')) $('addBookingDate').value=adminSelectedDate;
  updateDashboardSummary();
}
function editableSlotsForDraft() {
  if(adminDraft.customSlots?.length) return adminDraft.customSlots;
  const base=baseAvailabilityForDay(adminSelectedDate);
  return base.slots;
}
function renderAdminSlotsOnly() {
  const wrap=$('adminSlots'); wrap.innerHTML=''; const slots=editableSlotsForDraft(); const blocked=new Set(adminDraft.blockedSlots||[]);
  if(!slots.length){wrap.innerHTML='<div class="empty-state">No hours to edit. Turn on custom hours to open this date.</div>';return;}
  slots.forEach(time=>{const b=document.createElement('button');b.type='button';b.textContent=formatSlot(time);b.disabled=adminDraft.wholeDay;b.className='admin-slot'+(blocked.has(time)?' is-blocked':'');b.onclick=()=>{const s=new Set(adminDraft.blockedSlots);s.has(time)?s.delete(time):s.add(time);adminDraft.blockedSlots=[...s].sort();renderAdminSlotsOnly();renderAdminBookingOptions();};wrap.appendChild(b);});
}
function renderAdminBookingOptions() {
  const starts=adminDraft.wholeDay?[]:[...new Set(editableSlotsForDraft())].sort(),close=adminDraft.wholeDay?0:(editableSlotsForDraft().length?timeToMinutes(editableSlotsForDraft().at(-1)):0);
  const bookingSel=$('bookingStart'), manualSel=$('manualBlockStart');
  if(bookingSel){
    const prev=bookingSel.value,duration=Number($('bookingDuration')?.value||30),buffer=Number($('bookingBuffer')?.value||settings.defaultBufferMinutes);
    bookingSel.innerHTML='<option value="">Choose time</option>';
    starts.forEach(t=>{
      const appointmentEnd=timeToMinutes(t)+duration;
      const protectedEnd=appointmentEnd+buffer;
      // Only the client appointment must finish by closing. The private buffer may extend beyond closing.
      if(appointmentEnd<=close&&!rangeConflicts(adminSelectedDate,t,minutesToTime(protectedEnd))){const o=document.createElement('option');o.value=t;o.textContent=formatSlot(t);bookingSel.appendChild(o);}
    });
    if([...bookingSel.options].some(o=>o.value===prev))bookingSel.value=prev;
  }
  if(manualSel){const prev=manualSel.value;manualSel.innerHTML='<option value="">Choose time</option>';starts.forEach(t=>{if(!slotIsBlocked(adminSelectedDate,t)){const o=document.createElement('option');o.value=t;o.textContent=formatSlot(t);manualSel.appendChild(o);}});if([...manualSel.options].some(o=>o.value===prev))manualSel.value=prev;}
}
function normalizeClientKey(a) {
  const phone=String(a.client_phone||'').replace(/\D/g,'');
  if(phone) return `phone:${phone}`;
  const name=String(a.client_name||'').trim().toLowerCase();
  return name ? `name:${name}` : '';
}
function appointmentSearchText(a) {
  return [a.client_name,a.client_phone,a.service,a.day,a.status,a.client_notes].filter(Boolean).join(' ').toLowerCase();
}
function filteredBookingAppointments(rows) {
  const query=String($('bookingSearch')?.value||'').trim().toLowerCase();
  const status=$('bookingStatusFilter')?.value||'all';
  return rows.filter(a=>{
    if(a.kind!=='booking') return false;
    if(status!=='all' && a.status!==status) return false;
    if(query && !appointmentSearchText(a).includes(query)) return false;
    return true;
  });
}
function statusLabel(status) {
  return ({pending:'Pending',confirmed:'Confirmed',completed:'Completed',cancelled:'Cancelled'})[status]||status;
}
function whatsappDigitsForPhone(phone) {
  const digits=String(phone||'').replace(/\D/g,'');
  if(!digits) return '';
  if(digits.startsWith('27')) return digits;
  if(digits.startsWith('0')) return `27${digits.slice(1)}`;
  if(digits.length===9) return `27${digits}`;
  return digits;
}
function whatsappUrlForPhone(phone) {
  const digits=whatsappDigitsForPhone(phone);
  return digits ? `https://wa.me/${digits}` : '';
}
function appendClientDetails(main,a) {
  if(!a.client_name && !a.client_phone) return;

  const clientRow=document.createElement('div');
  clientRow.className='client-row';

  if(a.client_name){
    const key=normalizeClientKey(a);
    if(key){
      const clientButton=document.createElement('button');
      clientButton.type='button';
      clientButton.className='client-history-link';
      clientButton.textContent=a.client_name;
      clientButton.title='View client history';
      clientButton.addEventListener('click',()=>openClientHistory(a));
      clientRow.appendChild(clientButton);
    } else {
      const span=document.createElement('span');
      span.className='client-name-text';
      span.textContent=a.client_name;
      clientRow.appendChild(span);
    }
  }

  if(a.client_phone){
    const url=whatsappUrlForPhone(a.client_phone);
    if(url){
      const phone=document.createElement('a');
      phone.className='client-whatsapp-link';
      phone.href=url;
      phone.target='_blank';
      phone.rel='noopener';
      phone.title=`Open WhatsApp chat with ${a.client_phone}`;
      phone.textContent=a.client_phone;
      clientRow.appendChild(phone);
    } else {
      const phone=document.createElement('span');
      phone.className='client-phone-text';
      phone.textContent=a.client_phone;
      clientRow.appendChild(phone);
    }
  }

  main.appendChild(clientRow);
}
function appointmentMenuButton(text,fn,extraClass=''){
  const b=document.createElement('button');
  b.type='button';
  b.className=`appointment-menu-item ${extraClass}`.trim();
  b.textContent=text;
  b.addEventListener('click',e=>{
    e.preventDefault();
    e.stopPropagation();
    const popover=b.closest('.appointment-menu-popover');
    const ownerId=popover?.dataset.ownerMenuId;
    const details=(ownerId&&document.getElementById(ownerId))||b.closest('details');
    if(details)details.open=false;
    fn();
  });
  return b;
}
function whatsappActionLink(a,label='WhatsApp'){
  const url=whatsappUrlForPhone(a.client_phone);
  if(!url)return null;
  const link=document.createElement('a');
  link.className='booking-whatsapp-action';
  link.href=url;link.target='_blank';link.rel='noopener';link.textContent=label;
  return link;
}

let activeFloatingAppointmentMenu=null;

function closeFloatingAppointmentMenu(menu){
  if(!menu)return;
  const items=document.querySelector(`.appointment-menu-popover[data-owner-menu-id="${menu.id}"]`);
  if(items && items.parentElement===document.body){
    items.classList.remove('floating-appointment-popover');
    items.removeAttribute('style');
    menu.appendChild(items);
  }
  menu.classList.remove('menu-open-front');
  if(menu.open)menu.open=false;
  if(activeFloatingAppointmentMenu===menu)activeFloatingAppointmentMenu=null;
}

function positionFloatingAppointmentMenu(menu,summary,items){
  if(!menu.open || items.parentElement!==document.body)return;

  const buttonRect=summary.getBoundingClientRect();
  const menuRect=items.getBoundingClientRect();
  const edge=10;
  const bottomNavAllowance=window.innerWidth<=680 ? 92 : 12;

  let left=buttonRect.right-menuRect.width;
  left=Math.max(edge,Math.min(left,window.innerWidth-menuRect.width-edge));

  let top=buttonRect.bottom+6;
  if(top+menuRect.height>window.innerHeight-bottomNavAllowance){
    top=buttonRect.top-menuRect.height-6;
  }
  top=Math.max(edge,Math.min(top,window.innerHeight-menuRect.height-edge));

  items.style.left=`${Math.round(left)}px`;
  items.style.top=`${Math.round(top)}px`;
}

function enableFloatingAppointmentMenu(menu,summary,items){
  menu.addEventListener('toggle',()=>{
    if(menu.open){
      if(activeFloatingAppointmentMenu && activeFloatingAppointmentMenu!==menu){
        closeFloatingAppointmentMenu(activeFloatingAppointmentMenu);
      }
      activeFloatingAppointmentMenu=menu;
      menu.classList.add('menu-open-front');

      // Move the actual dropdown to <body>. This prevents booking cards,
      // collapsed History groups, scroll panels, and modals from clipping it.
      document.body.appendChild(items);
      items.classList.add('floating-appointment-popover');
      items.style.visibility='hidden';
      items.style.display='block';

      requestAnimationFrame(()=>{
        positionFloatingAppointmentMenu(menu,summary,items);
        items.style.visibility='visible';
      });
    }else{
      if(items.parentElement===document.body){
        items.classList.remove('floating-appointment-popover');
        items.removeAttribute('style');
        menu.appendChild(items);
      }
      menu.classList.remove('menu-open-front');
      if(activeFloatingAppointmentMenu===menu)activeFloatingAppointmentMenu=null;
    }
  });
}

document.addEventListener('pointerdown',event=>{
  const menu=activeFloatingAppointmentMenu;
  if(!menu)return;
  const items=document.querySelector(`.appointment-menu-popover[data-owner-menu-id="${menu.id}"]`);
  if(menu.contains(event.target) || items?.contains(event.target))return;
  closeFloatingAppointmentMenu(menu);
});

window.addEventListener('resize',()=>{
  const menu=activeFloatingAppointmentMenu;
  if(!menu || !menu.open)return;
  const summary=menu.querySelector('summary');
  const items=document.querySelector(`.appointment-menu-popover[data-owner-menu-id="${menu.id}"]`);
  if(summary&&items)positionFloatingAppointmentMenu(menu,summary,items);
});

document.addEventListener('scroll',()=>{
  const menu=activeFloatingAppointmentMenu;
  if(!menu || !menu.open)return;
  const summary=menu.querySelector('summary');
  const items=document.querySelector(`.appointment-menu-popover[data-owner-menu-id="${menu.id}"]`);
  if(summary&&items)positionFloatingAppointmentMenu(menu,summary,items);
},true);

function appointmentCard(a, includeActions=true) {
  const div=document.createElement('article');
  div.className=`appointment-card status-${a.status}${a.status==='pending'?' pending-emphasis':''}`;
  div.dataset.appointmentId=String(a.id||'');

  const start=String(a.start_time||'').slice(0,5);
  const end=String(a.end_time||'').slice(0,5);
  const blocked=String(a.blocked_until_time||a.end_time||'').slice(0,5);

  const timeBlock=document.createElement('div');
  timeBlock.className='appointment-time-block';
  timeBlock.innerHTML=`<strong>${formatSlot(start)}</strong><span>${formatSlot(end)}</span>`;
  div.appendChild(timeBlock);

  const main=document.createElement('div');
  main.className='appointment-main';
  const service=document.createElement('strong');
  service.className='appointment-service';
  service.textContent=a.kind==='manual_block'?'Manual block':(a.service||'Appointment');
  main.appendChild(service);

  const meta=document.createElement('span');
  meta.className='appointment-time';
  meta.textContent=`${prettyDate(a.day)}${blocked&&blocked!==end?` · protected until ${formatSlot(blocked)}`:''}`;
  main.appendChild(meta);
  appendClientDetails(main,a);

  if(a.client_notes){
    const notes=document.createElement('small');notes.className='appointment-client-notes';notes.textContent=a.client_notes;main.appendChild(notes);
  }
  div.appendChild(main);

  const pill=document.createElement('span');pill.className='status-pill';pill.textContent=statusLabel(a.status);div.appendChild(pill);

  if(includeActions){
    const row=document.createElement('div');row.className='appointment-actions';

    if(a.status==='pending'){
      row.append(actionButton('Confirm',()=>confirmAppointment(a),'confirm-action'),actionButton('Decline',()=>updateAppointmentStatus(a.id,'cancelled'),'danger-action'));
    }else if(a.status==='confirmed'){
      row.append(actionButton('Complete',()=>updateAppointmentStatus(a.id,'completed'),'complete-action'));
      const wa=whatsappActionLink(a);if(wa)row.appendChild(wa);
    }else{
      const wa=whatsappActionLink(a);if(wa)row.appendChild(wa);
    }

    if(a.kind==='booking'){
      const menu=document.createElement('details');
      menu.className='appointment-menu';
      menu.id=`appointment-menu-${String(a.id||Date.now()).replace(/[^a-zA-Z0-9_-]/g,'-')}-${Math.random().toString(36).slice(2,7)}`;

      const summary=document.createElement('summary');
      summary.setAttribute('aria-label','More booking actions');
      summary.textContent='⋯';
      menu.appendChild(summary);

      const items=document.createElement('div');
      items.className='appointment-menu-popover';
      items.dataset.ownerMenuId=menu.id;

      items.appendChild(appointmentMenuButton('Edit Booking',()=>openEditBooking(a),'edit-menu-action'));
      if(a.status==='confirmed'||a.status==='pending')items.appendChild(appointmentMenuButton('Cancel Booking',()=>updateAppointmentStatus(a.id,'cancelled'),'cancel-menu-action'));
      if(normalizeClientKey(a))items.appendChild(appointmentMenuButton('View Client History',()=>openClientHistory(a)));
      items.appendChild(appointmentMenuButton('Delete Booking',()=>deleteBooking(a),'delete-menu-action'));

      menu.appendChild(items);
      enableFloatingAppointmentMenu(menu,summary,items);
      row.appendChild(menu);
    }
    if(row.children.length)div.appendChild(row);
  }
  return div;
}
function actionButton(text,fn,extraClass=''){
  const b=document.createElement('button');b.type='button';b.className=`admin-outline small-action ${extraClass}`.trim();b.textContent=text;b.onclick=fn;return b;
}
function escapeHtml(v){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function selectedDayAppointments() { return appointments.filter(a=>a.day===adminSelectedDate && a.status!=='cancelled').sort((a,b)=>String(a.start_time).localeCompare(String(b.start_time))); }
function renderDayAppointments(){
  const w=$('dayAppointments');if(!w)return;w.innerHTML='';const rows=selectedDayAppointments();
  if(!rows.length){w.innerHTML='<div class="empty-state compact">No bookings or time blocks on this date.</div>';return;}
  rows.forEach(a=>w.appendChild(appointmentCard(a)));
}
function fillAppointmentList(id,rows,emptyText,includeActions=true){
  const wrap=$(id);if(!wrap)return;wrap.innerHTML='';
  if(!rows.length){wrap.innerHTML=`<div class="empty-state compact">${emptyText}</div>`;return;}
  rows.forEach(a=>wrap.appendChild(appointmentCard(a,includeActions)));
}
function updateDashboardSummary(){
  const today=isoDate(new Date());
  const todayConfirmed=appointments.filter(a=>a.kind==='booking'&&a.status==='confirmed'&&a.day===today).sort((a,b)=>String(a.start_time).localeCompare(String(b.start_time)));
  const pending=appointments.filter(a=>a.kind==='booking'&&a.status==='pending');
  const now=new Date();
  const upcoming=appointments.filter(a=>a.kind==='booking'&&a.status==='confirmed'&&(`${a.day}T${String(a.start_time).slice(0,5)}`)>=`${today}T${pad(now.getHours())}:${pad(now.getMinutes())}`).sort((a,b)=>`${a.day}${a.start_time}`.localeCompare(`${b.day}${b.start_time}`));
  if($('summaryTodayBookings')) $('summaryTodayBookings').textContent=String(todayConfirmed.length);
  if($('summaryPendingBookings')) $('summaryPendingBookings').textContent=String(pending.length);
  if($('summaryNextBooking')) $('summaryNextBooking').textContent=upcoming.length?formatSlot(String(upcoming[0].start_time).slice(0,5)):'—';
  if($('summaryNextBookingMeta')) $('summaryNextBookingMeta').textContent=upcoming.length?`${upcoming[0].day===today?'Today':prettyDate(upcoming[0].day)} · ${upcoming[0].client_name||upcoming[0].service||'Appointment'}`:'No upcoming booking';
  if($('summarySelectedDate')) $('summarySelectedDate').textContent=adminSelectedDate===today?'Today':prettyDate(adminSelectedDate);
  if($('summarySelectedStatus')) $('summarySelectedStatus').textContent=baseAvailabilityForDay(adminSelectedDate).label||'Schedule';
  if($('mobilePendingCount')){$('mobilePendingCount').textContent=String(pending.length);$('mobilePendingCount').classList.toggle('hidden',pending.length===0);}
}
function fillDashboardList(id,rows,emptyText,limit=0){
  const wrap=$(id);if(!wrap)return;wrap.innerHTML='';
  const display=limit?rows.slice(0,limit):rows;
  if(!display.length){wrap.innerHTML=`<div class="empty-state compact">${emptyText}</div>`;return;}
  display.forEach(a=>{const card=appointmentCard(a,true);card.classList.add('dashboard-compact-card');wrap.appendChild(card);});
}
function renderTodayMiniCalendar(){
  if(!$('todayMiniCalendarGrid'))return;
  renderCalendar('todayMiniCalendarGrid','todayMiniMonthLabel',todayMiniViewDate,adminSelectedDate,async key=>{
    adminSelectedDate=key;adminViewDate=startOfMonth(parseISODate(key));todayMiniViewDate=startOfMonth(parseISODate(key));
    await loadAdminDraft();renderAdmin();renderTodayDashboard();switchAdminTab('day');
  });
}
function renderTodayDashboard(){
  if(!$('todayMainAppointments'))return;
  const today=isoDate(new Date());
  const pending=appointments.filter(a=>a.kind==='booking'&&a.status==='pending').sort((a,b)=>`${a.day}${a.start_time}`.localeCompare(`${b.day}${b.start_time}`));
  const todayRows=appointments.filter(a=>a.kind==='booking'&&a.status==='confirmed'&&a.day===today).sort((a,b)=>String(a.start_time).localeCompare(String(b.start_time)));
  const future=appointments.filter(a=>a.kind==='booking'&&a.status==='confirmed'&&a.day>today).sort((a,b)=>`${a.day}${a.start_time}`.localeCompare(`${b.day}${b.start_time}`));
  if($('todayDashboardDate'))$('todayDashboardDate').textContent=new Date().toLocaleDateString('en-ZA',{weekday:'long',day:'numeric',month:'long'});
  if($('todayDashboardSummary'))$('todayDashboardSummary').textContent=`${todayRows.length} booking${todayRows.length===1?'':'s'} today · ${pending.length} pending · ${future.length?`next future booking ${prettyDate(future[0].day)}`:'no future bookings'}`;
  if($('todayPendingCount'))$('todayPendingCount').textContent=String(pending.length);
  if($('todayMainCount'))$('todayMainCount').textContent=String(todayRows.length);
  fillDashboardList('todayPendingRequests',pending,'No pending requests.',3);
  fillDashboardList('todayMainAppointments',todayRows,'No confirmed appointments today.');
  fillDashboardList('todayUpcomingPreview',future,'No upcoming bookings.',3);
  renderTodayMiniCalendar();
}
function renderBookingsPanels(){
  const today=isoDate(new Date());
  const rows=filteredBookingAppointments(appointments);
  const pending=rows.filter(a=>a.status==='pending').sort((a,b)=>`${a.day}${a.start_time}`.localeCompare(`${b.day}${b.start_time}`));
  const todayRows=rows.filter(a=>a.status==='confirmed'&&a.day===today).sort((a,b)=>String(a.start_time).localeCompare(String(b.start_time)));
  const upcoming=rows.filter(a=>a.status==='confirmed'&&a.day>today).sort((a,b)=>`${a.day}${a.start_time}`.localeCompare(`${b.day}${b.start_time}`));
  const overdue=rows.filter(a=>a.status==='confirmed'&&a.day<today).sort((a,b)=>`${a.day}${a.start_time}`.localeCompare(`${b.day}${b.start_time}`));
  const completed=rows.filter(a=>a.status==='completed').sort((a,b)=>`${b.day}${b.start_time}`.localeCompare(`${a.day}${a.start_time}`));
  const cancelled=rows.filter(a=>a.status==='cancelled').sort((a,b)=>`${b.day}${b.start_time}`.localeCompare(`${a.day}${a.start_time}`));

  const allPending=appointments.filter(a=>a.kind==='booking'&&a.status==='pending');
  if($('pendingCount')) $('pendingCount').textContent=String(allPending.length);
  if($('pendingSectionCount')) $('pendingSectionCount').textContent=String(pending.length);
  if($('todaySectionCount')) $('todaySectionCount').textContent=String(todayRows.length);
  if($('upcomingSectionCount')) $('upcomingSectionCount').textContent=String(upcoming.length);
  if($('overdueSectionCount')) $('overdueSectionCount').textContent=String(overdue.length);
  if($('completedCount')) $('completedCount').textContent=String(completed.length);
  if($('cancelledCount')) $('cancelledCount').textContent=String(cancelled.length);

  fillAppointmentList('pendingRequests',pending,'No pending website requests.');
  fillAppointmentList('todayAppointments',todayRows,'No confirmed appointments today.');
  fillAppointmentList('upcomingAppointments',upcoming,'No upcoming confirmed appointments.');
  fillAppointmentList('overdueAppointments',overdue,'No past confirmed appointments need attention.');
  fillAppointmentList('completedAppointments',completed,'No completed bookings match this filter.',true);
  fillAppointmentList('cancelledAppointments',cancelled,'No cancelled bookings match this filter.',true);
  renderDayAppointments();
  updateDashboardSummary();
  renderTodayDashboard();
}
function renderSettings(){if(!$('settingBuffer'))return;$('settingBuffer').value=String(settings.defaultBufferMinutes);$('settingNotice').value=String(settings.minNoticeMinutes);$('settingAdvance').value=String(settings.maxAdvanceDays);$('bookingBuffer').value=String(settings.defaultBufferMinutes);}
function renderHistory(){
  const w=$('historyList');if(!w)return;w.innerHTML='';
  const query=String($('historySearch')?.value||'').trim().toLowerCase();
  const rows=historyRows.filter(r=>!query||[r.action,r.table_name,r.record_key,r.actor_email,r.changed_at].filter(Boolean).join(' ').toLowerCase().includes(query));
  if(!rows.length){w.innerHTML='<div class="empty-state compact">No matching activity found.</div>';return;}
  rows.forEach(r=>{const el=document.createElement('article');el.className='history-item';const when=new Date(r.changed_at).toLocaleString('en-ZA',{dateStyle:'medium',timeStyle:'short'});el.innerHTML=`<strong>${escapeHtml(r.action)} · ${escapeHtml(r.table_name)}</strong><span>${escapeHtml(r.record_key)} · ${when}</span><small>${escapeHtml(r.actor_email||'system')}</small>`;w.appendChild(el);});
}
function openClientHistory(sourceAppointment){
  const key=normalizeClientKey(sourceAppointment);if(!key)return;
  const rows=appointments.filter(a=>a.kind==='booking'&&normalizeClientKey(a)===key).sort((a,b)=>`${b.day}${b.start_time}`.localeCompare(`${a.day}${a.start_time}`));
  const title=$('clientHistoryTitle'),meta=$('clientHistoryMeta'),list=$('clientHistoryList');

  if(title) title.textContent=sourceAppointment.client_name||sourceAppointment.client_phone||'Client';

  if(meta){
    const completed=rows.filter(a=>a.status==='completed').length;
    meta.innerHTML='';
    const summary=document.createElement('span');
    const pastRows=rows.filter(a=>a.day<=isoDate(new Date()));
    const lastVisit=pastRows.length?pastRows[0]:null;
    summary.textContent=`${rows.length} visit${rows.length===1?'':'s'} · ${completed} completed${lastVisit?` · Last visit ${prettyDate(lastVisit.day)}`:''}`;
    meta.appendChild(summary);

    if(sourceAppointment.client_phone){
      const url=whatsappUrlForPhone(sourceAppointment.client_phone);
      if(url){
        const link=document.createElement('a');
        link.className='client-history-whatsapp';
        link.href=url;
        link.target='_blank';
        link.rel='noopener';
        link.textContent=sourceAppointment.client_phone;
        link.title='Open WhatsApp chat';
        meta.appendChild(link);
      }
    }
  }

  if(list){
    list.innerHTML='';
    rows.forEach(a=>list.appendChild(appointmentCard(a,false)));
  }

  openModal('clientHistoryModal');
}
function switchAdminTab(tab){
  if(tab==='settings'||tab==='history')tab='more';
  qsa('[data-admin-tab]').forEach(b=>b.classList.toggle('active',b.dataset.adminTab===tab));
  qsa('[data-mobile-admin-tab]').forEach(b=>b.classList.toggle('active',b.dataset.mobileAdminTab===tab));
  qsa('[data-admin-panel]').forEach(p=>p.classList.toggle('hidden',p.dataset.adminPanel!==tab));
  if(tab==='today')renderTodayDashboard();
  if(tab==='bookings')renderBookingsPanels();
  if(tab==='more'){renderSettings();renderHistory();updateAlertSettingsUI();}
  if(tab==='add'){
    if($('addBookingDate')) $('addBookingDate').value=adminSelectedDate;
    renderAdminBookingOptions();
  }
}
function activateBookingsTab(){switchAdminTab('bookings');}

$('blockWholeDay')?.addEventListener('change',e=>{adminDraft.wholeDay=e.target.checked;renderAdminSlotsOnly();});
$('dayNote')?.addEventListener('input',e=>adminDraft.note=e.target.value);
function blockTimes(predicate){const s=new Set(adminDraft.blockedSlots||[]);editableSlotsForDraft().filter(predicate).forEach(t=>s.add(t));adminDraft.blockedSlots=[...s].sort();renderAdminSlotsOnly();renderAdminBookingOptions();}
$('blockMorningBtn')?.addEventListener('click',()=>blockTimes(t=>timeToMinutes(t)<12*60));
$('blockAfternoonBtn')?.addEventListener('click',()=>blockTimes(t=>timeToMinutes(t)>=12*60));
$('restoreHoursBtn')?.addEventListener('click',()=>{adminDraft.wholeDay=false;adminDraft.blockedSlots=[];adminDraft.customSlots=[];$('blockWholeDay').checked=false;$('useCustomHours').checked=false;renderAdmin();message('Automatic hours restored in the editor. Click Save Day Changes.');});
$('useCustomHours')?.addEventListener('change',e=>{if(!e.target.checked){adminDraft.customSlots=[];renderAdminSlotsOnly();renderAdminBookingOptions();}});
$('applyCustomHoursBtn')?.addEventListener('click',()=>{if(!$('useCustomHours').checked){message('Turn on custom hours first.',true);return;}const slots=makeCustomSlots($('customOpen').value,$('customClose').value);if(slots.length<2){message('Choose a valid opening and closing time.',true);return;}adminDraft.customSlots=slots;adminDraft.blockedSlots=adminDraft.blockedSlots.filter(t=>slots.includes(t));renderAdminSlotsOnly();renderAdminBookingOptions();message(`Custom hours set to ${formatSlot(slots[0])}–${formatSlot(slots.at(-1))}. Save the day to publish them.`);});

async function saveHolidayOverride(){const mode=$('holidayMode').value,name=$('holidayName').value.trim();if(mode==='automatic'){const {error}=await db.from('holiday_overrides').delete().eq('day',adminSelectedDate);if(error)throw error;return;}const {error}=await db.from('holiday_overrides').upsert({day:adminSelectedDate,mode,name,custom_slots:[],public_note:'',updated_at:new Date().toISOString()},{onConflict:'day'});if(error)throw error;}
$('saveDayBtn')?.addEventListener('click',async()=>{
  try{$('saveDayBtn').disabled=true;message('Saving…');const payload={day:adminSelectedDate,whole_day:adminDraft.wholeDay,blocked_slots:[...new Set(adminDraft.blockedSlots)].sort(),custom_slots:[...new Set(adminDraft.customSlots||[])].sort(),public_note:(adminDraft.note||'').trim(),private_note:(adminDraft.note||'').trim(),updated_at:new Date().toISOString()};const {error}=await db.from('schedule_days').upsert(payload,{onConflict:'day'});if(error)throw error;await saveHolidayOverride();await loadPublicData();await loadAdminDraft();renderAdmin();message('Day changes saved.');setTimeout(()=>message(''),1800);}catch(e){console.error(e);message('Could not save. Run the upgrade SQL and check admin access.',true);}finally{$('saveDayBtn').disabled=false;}
});
$('clearDayBtn')?.addEventListener('click',async()=>{const [a,b]=await Promise.all([db.from('schedule_days').delete().eq('day',adminSelectedDate),db.from('holiday_overrides').delete().eq('day',adminSelectedDate)]);if(a.error||b.error){message('Could not clear this date.',true);return;}await loadPublicData();await loadAdminDraft();renderAdmin();message('Manual day settings cleared. Appointments were kept.');});
$('copyDayBtn')?.addEventListener('click',async()=>{const target=$('copyTargetDate').value;if(!target){message('Choose the date you want to copy to.',true);return;}const {error}=await db.from('schedule_days').upsert({day:target,whole_day:adminDraft.wholeDay,blocked_slots:[...adminDraft.blockedSlots],custom_slots:[...(adminDraft.customSlots||[])],public_note:(adminDraft.note||'').trim(),private_note:(adminDraft.note||'').trim(),updated_at:new Date().toISOString()},{onConflict:'day'});if(error){message('Could not copy this date.',true);return;}await loadPublicData();message(`Copied to ${prettyDate(target)}.`);});
$('blockRangeBtn')?.addEventListener('click',async()=>{const s=$('rangeStart').value,e=$('rangeEnd').value,n=$('rangeNote').value.trim();if(!s||!e){message('Choose both From and To dates.',true);return;}if(parseISODate(s)>parseISODate(e)){message('The From date must be before the To date.',true);return;}const rows=[];for(let d=parseISODate(s);d<=parseISODate(e);d=addDays(d,1)){rows.push({day:isoDate(d),whole_day:true,blocked_slots:[],custom_slots:[],public_note:n,private_note:n,updated_at:new Date().toISOString()});}const {error}=await db.from('schedule_days').upsert(rows,{onConflict:'day'});if(error){message('Could not block the date range.',true);return;}await loadPublicData();message(`Blocked ${rows.length} date${rows.length===1?'':'s'} with the public notice.`);});

function getDayCloseMinutes(key){const slots=allSlotsForDay(key);return slots.length?timeToMinutes(slots.at(-1)):0;}
function rangeConflicts(key,start,end){const sm=timeToMinutes(start),em=timeToMinutes(end);if(getDayData(key).wholeDay)return true;return (getDayData(key).blockedSlots||[]).some(t=>{const m=timeToMinutes(t);return m>=sm&&m<em;})||getBlocks(key).some(b=>sm<timeToMinutes(b.endTime)&&em>timeToMinutes(b.startTime));}
function rangeConflictsExcept(key,start,end,appointmentId){
  const sm=timeToMinutes(start),em=timeToMinutes(end);
  if(getDayData(key).wholeDay) return true;
  const manualConflict=(getDayData(key).blockedSlots||[]).some(t=>{
    const m=timeToMinutes(t);
    return m>=sm&&m<em;
  });
  if(manualConflict) return true;
  return getBlocks(key)
    .filter(b=>String(b.id)!==String(appointmentId))
    .some(b=>sm<timeToMinutes(b.endTime)&&em>timeToMinutes(b.startTime));
}
$('addBookingBtn')?.addEventListener('click',async()=>{const start=$('bookingStart').value,duration=Number($('bookingDuration').value),buffer=Number($('bookingBuffer').value),close=getDayCloseMinutes(adminSelectedDate);if(!start){message('Choose a start time.',true);return;}const endM=timeToMinutes(start)+duration,blockEnd=endM+buffer;if(endM>close){message('This client appointment would finish after closing time. Choose an earlier start or a shorter duration.',true);return;}const end=minutesToTime(endM),blockedUntil=minutesToTime(blockEnd);if(rangeConflicts(adminSelectedDate,start,blockedUntil)){message('That range overlaps an existing booking or block.',true);return;}const {error}=await db.from('appointments').insert({day:adminSelectedDate,start_time:start,end_time:end,blocked_until_time:blockedUntil,duration_minutes:duration,buffer_minutes:buffer,kind:'booking',status:'confirmed',service:$('bookingService').value.trim()||'Appointment',client_name:$('bookingClient').value.trim(),client_phone:$('bookingPhone').value.trim(),client_type:'',client_notes:'',public_note:'',source:'admin'});if(error){console.error(error);message(error.message?.includes('appointments_no_confirmed_overlap')?'That time overlaps an existing confirmed or completed booking.':'Could not add booking.',true);return;}await loadPublicData();await loadAppointments();renderBookingsPanels();renderAdminBookingOptions();if($('bookingClient'))$('bookingClient').value='';if($('bookingPhone'))$('bookingPhone').value='';message('Confirmed booking added and public availability updated.');switchAdminTab('bookings');});
$('addManualBlockBtn')?.addEventListener('click',async()=>{const start=$('manualBlockStart').value,end=$('manualBlockEnd').value,note=$('manualBlockNote').value.trim();if(!start||!end||timeToMinutes(end)<=timeToMinutes(start)){message('Choose a valid start and end time.',true);return;}if(rangeConflicts(adminSelectedDate,start,end)){message('That block overlaps an existing booking or block.',true);return;}const duration=timeToMinutes(end)-timeToMinutes(start);const {error}=await db.from('appointments').insert({day:adminSelectedDate,start_time:start,end_time:end,blocked_until_time:end,duration_minutes:duration,buffer_minutes:0,kind:'manual_block',status:'confirmed',service:'Manual block',client_name:'',client_phone:'',client_type:'',client_notes:'',public_note:note,source:'admin'});if(error){message('Could not add time block.',true);return;}await loadPublicData();await loadAppointments();renderBookingsPanels();renderAdminBookingOptions();message('Time range blocked.');});
$('bookingDuration')?.addEventListener('change',renderAdminBookingOptions);
$('bookingBuffer')?.addEventListener('change',renderAdminBookingOptions);
$('manualBlockStart')?.addEventListener('change',()=>{if(!$('manualBlockStart').value)return;$('manualBlockEnd').value=minutesToTime(timeToMinutes($('manualBlockStart').value)+30);});

async function confirmAppointment(a){const buffer=settings.defaultBufferMinutes,endM=timeToMinutes(String(a.end_time).slice(0,5)),blockedUntil=minutesToTime(endM+buffer),close=getDayCloseMinutes(a.day);if(endM>close){message('This client appointment would finish after closing time and cannot be confirmed.',true);return;}const start=String(a.start_time).slice(0,5);if(rangeConflicts(a.day,start,blockedUntil)){message('Cannot confirm: that time overlaps an existing confirmed/completed booking or block.',true);return;}const {error}=await db.from('appointments').update({status:'confirmed',buffer_minutes:buffer,blocked_until_time:blockedUntil}).eq('id',a.id);if(error){console.error(error);message('Could not confirm this request.',true);return;}await loadPublicData();await loadAppointments();renderBookingsPanels();message('Booking confirmed. The website availability changed immediately.');}
async function updateAppointmentStatus(id,status){const {error}=await db.from('appointments').update({status}).eq('id',id);if(error){message('Could not update appointment.',true);return;}await loadPublicData();await loadAppointments();renderBookingsPanels();message(`Appointment marked ${status}.`);}

function appointmentDurationMinutes(a){
  const stored=Number(a.duration_minutes);
  if(Number.isFinite(stored) && stored>0) return stored;
  return Math.max(15,timeToMinutes(String(a.end_time).slice(0,5))-timeToMinutes(String(a.start_time).slice(0,5)));
}
function appointmentBufferMinutes(a){
  const stored=Number(a.buffer_minutes);
  if(Number.isFinite(stored) && stored>=0) return stored;
  const end=timeToMinutes(String(a.end_time).slice(0,5));
  const blocked=timeToMinutes(String(a.blocked_until_time||a.end_time).slice(0,5));
  return Math.max(0,blocked-end);
}
function ensureSelectOption(select,value,label){
  if(!select) return;
  if(![...select.options].some(o=>o.value===String(value))){
    const option=document.createElement('option');
    option.value=String(value);
    option.textContent=label||String(value);
    select.appendChild(option);
  }
}
function populateEditBookingStartOptions(preferredValue=''){
  const select=$('editBookingStart');
  const day=$('editBookingDate')?.value;
  if(!select||!day) return;

  const duration=Number($('editBookingDuration')?.value||30);
  const close=getDayCloseMinutes(day);
  const previous=preferredValue || select.value;
  const starts=[...new Set(allSlotsForDay(day))].sort();

  select.innerHTML='<option value="">Choose time</option>';

  starts.forEach(time=>{
    if(timeToMinutes(time)+duration<=close){
      const option=document.createElement('option');
      option.value=time;
      option.textContent=formatSlot(time);
      select.appendChild(option);
    }
  });

  if(previous && ![...select.options].some(o=>o.value===previous)){
    const historical=document.createElement('option');
    historical.value=previous;
    historical.textContent=`${formatSlot(previous)} (current)`;
    select.appendChild(historical);
  }
  if(previous) select.value=previous;
}
function openEditBooking(a){
  if(!a || a.kind!=='booking') return;
  editingAppointmentId=a.id;

  const duration=appointmentDurationMinutes(a);
  const buffer=appointmentBufferMinutes(a);

  $('editBookingDate').value=a.day||'';
  ensureSelectOption($('editBookingDuration'),duration,`${duration} min`);
  ensureSelectOption($('editBookingBuffer'),buffer,`${buffer} min`);
  $('editBookingDuration').value=String(duration);
  $('editBookingBuffer').value=String(buffer);
  $('editBookingService').value=a.service||'';
  $('editBookingClient').value=a.client_name||'';
  $('editBookingPhone').value=a.client_phone||'';
  $('editBookingNotes').value=a.client_notes||'';
  $('editBookingStatusText').textContent=`Status: ${statusLabel(a.status)} · ${prettyDate(a.day)} · ${formatSlot(String(a.start_time).slice(0,5))}`;
  $('editBookingMessage').textContent='';

  populateEditBookingStartOptions(String(a.start_time).slice(0,5));
  openModal('editBookingModal');
}
async function saveEditedBooking(){
  const original=appointments.find(a=>String(a.id)===String(editingAppointmentId));
  if(!original){
    $('editBookingMessage').textContent='This booking could not be found. Refresh the bookings list and try again.';
    return;
  }

  const day=$('editBookingDate').value;
  const start=$('editBookingStart').value;
  const duration=Number($('editBookingDuration').value);
  const buffer=Number($('editBookingBuffer').value);

  if(!day||!start||!Number.isFinite(duration)||duration<=0||!Number.isFinite(buffer)||buffer<0){
    $('editBookingMessage').textContent='Choose a valid date, start time, duration and buffer.';
    return;
  }

  const endM=timeToMinutes(start)+duration;
  const blockedEndM=endM+buffer;
  const end=minutesToTime(endM);
  const blockedUntil=minutesToTime(blockedEndM);

  const originalStart=String(original.start_time).slice(0,5);
  const originalDuration=appointmentDurationMinutes(original);
  const originalBuffer=appointmentBufferMinutes(original);
  const timingChanged=
    day!==original.day ||
    start!==originalStart ||
    duration!==originalDuration ||
    buffer!==originalBuffer;

  if(timingChanged && original.status!=='cancelled'){
    const close=getDayCloseMinutes(day);
    if(!close || endM>close){
      $('editBookingMessage').textContent='The edited appointment would finish outside the business hours for that date.';
      return;
    }
    if(rangeConflictsExcept(day,start,blockedUntil,original.id)){
      $('editBookingMessage').textContent='That edited time overlaps another booking, blocked time or closed day.';
      return;
    }
  }

  $('saveEditBookingBtn').disabled=true;
  $('editBookingMessage').textContent='Saving changes…';

  const payload={
    day,
    start_time:start,
    end_time:end,
    blocked_until_time:blockedUntil,
    duration_minutes:duration,
    buffer_minutes:buffer,
    service:$('editBookingService').value.trim()||'Appointment',
    client_name:$('editBookingClient').value.trim(),
    client_phone:$('editBookingPhone').value.trim(),
    client_notes:$('editBookingNotes').value.trim()
  };

  const {error}=await db.from('appointments').update(payload).eq('id',original.id);

  $('saveEditBookingBtn').disabled=false;

  if(error){
    console.error(error);
    $('editBookingMessage').textContent=
      error.message?.includes('appointments_no_confirmed_overlap')
        ? 'That time overlaps another confirmed or completed booking.'
        : 'Could not save the booking changes.';
    return;
  }

  editingAppointmentId=null;
  closeModal('editBookingModal');
  await loadPublicData();
  await loadAppointments();
  renderBookingsPanels();
  renderAdminBookingOptions();
  renderDayAppointments();
  message('Booking updated. Availability has been refreshed.');
}
async function deleteBooking(a){
  if(!a || a.kind!=='booking') return;

  const client=a.client_name||a.client_phone||'this client';
  const when=`${prettyDate(a.day)} at ${formatSlot(String(a.start_time).slice(0,5))}`;
  const confirmed=window.confirm(
    `Delete the booking for ${client} on ${when}?\n\nThis permanently removes the booking and releases its reserved time.`
  );
  if(!confirmed) return;

  const {error}=await db.from('appointments').delete().eq('id',a.id);
  if(error){
    console.error(error);
    message('Could not delete the booking.',true);
    return;
  }

  await loadPublicData();
  await loadAppointments();
  renderBookingsPanels();
  renderAdminBookingOptions();
  renderDayAppointments();
  message('Booking deleted and its reserved time has been released.');
}

$('editBookingDate')?.addEventListener('change',()=>populateEditBookingStartOptions());
$('editBookingDuration')?.addEventListener('change',()=>populateEditBookingStartOptions());
$('saveEditBookingBtn')?.addEventListener('click',saveEditedBooking);


$('saveSettingsBtn')?.addEventListener('click',async()=>{const payload={default_buffer_minutes:Number($('settingBuffer').value),min_notice_minutes:Number($('settingNotice').value),max_advance_days:Number($('settingAdvance').value)};const {error}=await db.from('schedule_settings').update(payload).eq('id',1);if(error){message('Could not save booking rules.',true);return;}settings={defaultBufferMinutes:payload.default_buffer_minutes,minNoticeMinutes:payload.min_notice_minutes,maxAdvanceDays:payload.max_advance_days};renderSettings();message('Booking rules saved and published to the website.');});
$('undoDayBtn')?.addEventListener('click',async()=>{const {data,error}=await db.rpc('undo_last_schedule_day_change',{p_day:adminSelectedDate});if(error){message('Could not undo the last day change.',true);return;}await loadPublicData();await loadHistory();await loadAdminDraft();renderAdmin();renderHistory();message(data||'Previous state restored.');});

qsa('[data-admin-tab]').forEach(btn=>btn.addEventListener('click',()=>switchAdminTab(btn.dataset.adminTab)));
qsa('[data-mobile-admin-tab]').forEach(btn=>btn.addEventListener('click',()=>switchAdminTab(btn.dataset.mobileAdminTab)));
qsa('[data-go-admin-tab]').forEach(btn=>btn.addEventListener('click',()=>switchAdminTab(btn.dataset.goAdminTab)));
$('bookingSearch')?.addEventListener('input',renderBookingsPanels);
$('bookingStatusFilter')?.addEventListener('change',()=>{
  const status=$('bookingStatusFilter').value;
  if(status==='completed') $('completedBookingsGroup')?.setAttribute('open','');
  if(status==='cancelled') $('cancelledBookingsGroup')?.setAttribute('open','');
  renderBookingsPanels();
});
$('historySearch')?.addEventListener('input',renderHistory);
$('addBookingDate')?.addEventListener('change',async e=>{
  if(!e.target.value)return;
  adminSelectedDate=e.target.value;adminViewDate=startOfMonth(parseISODate(adminSelectedDate));
  await loadAdminDraft();renderAdmin();switchAdminTab('add');
});

$('floatingAddBookingBtn')?.addEventListener('click',()=>switchAdminTab('add'));
$('todayOpenSelectedDate')?.addEventListener('click',()=>switchAdminTab('day'));
$('todayMiniPrev')?.addEventListener('click',()=>{todayMiniViewDate=new Date(todayMiniViewDate.getFullYear(),todayMiniViewDate.getMonth()-1,1);renderTodayMiniCalendar();});
$('todayMiniNext')?.addEventListener('click',()=>{todayMiniViewDate=new Date(todayMiniViewDate.getFullYear(),todayMiniViewDate.getMonth()+1,1);renderTodayMiniCalendar();});
$('prevMonth')?.addEventListener('click',()=>{viewDate=new Date(viewDate.getFullYear(),viewDate.getMonth()-1,1);renderPublic();});
$('nextMonth')?.addEventListener('click',()=>{viewDate=new Date(viewDate.getFullYear(),viewDate.getMonth()+1,1);renderPublic();});
$('todayBtn')?.addEventListener('click',()=>{const t=new Date();selectedDate=isoDate(t);viewDate=startOfMonth(t);renderPublic();});
$('adminPrevMonth')?.addEventListener('click',()=>{adminViewDate=new Date(adminViewDate.getFullYear(),adminViewDate.getMonth()-1,1);renderAdmin();});
$('adminNextMonth')?.addEventListener('click',()=>{adminViewDate=new Date(adminViewDate.getFullYear(),adminViewDate.getMonth()+1,1);renderAdmin();});
$('adminTodayBtn')?.addEventListener('click',async()=>{const t=new Date();adminSelectedDate=isoDate(t);adminViewDate=startOfMonth(t);await loadAdminDraft();renderAdmin();});
window.addEventListener('keydown',e=>{if(e.key==='Escape')qsa('.modal:not(.hidden)').forEach(m=>closeModal(m.id));});

window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstallPrompt=e;$('installBtn')?.classList.remove('hidden');});
$('installBtn')?.addEventListener('click',async()=>{if(!deferredInstallPrompt)return;deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;$('installBtn').classList.add('hidden');});
window.addEventListener('appinstalled',()=>{deferredInstallPrompt=null;$('installBtn')?.classList.add('hidden');});
if('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('service-worker.js').catch(console.error));

async function init(){
  renderPublic();
  if(!configured()){$('setupBanner').classList.remove('hidden');setSync('Not configured',true);return;}
  try{
    db=window.supabase.createClient(window.SUPABASE_URL,window.SUPABASE_PUBLISHABLE_KEY);
    await loadPublicData();
    subscribeRealtime();
    updateAlertSettingsUI();
    const existingUser=await currentUser();
    const existingAdmin=existingUser && await isAuthorizedAdmin(existingUser);
    if(existingAdmin){
      await loadAppointments();
      renderBookingsPanels();
      await subscribeAdminRealtime();
      if(bookingAlertsEnabled){
        startBookingMonitor();
        await unlockBookingAlertAudio();
        await scanForPendingBookingAlerts({includeExisting:true});
      }
    }

    db.auth.onAuthStateChange(async(event,session)=>{
      if(event==='SIGNED_OUT'){
        stopBookingMonitor();
        adminRealtimeSubscribed=false;
        await removeAdminRealtimeChannels();
        return;
      }
      if(session?.user && (event==='SIGNED_IN' || event==='TOKEN_REFRESHED' || event==='INITIAL_SESSION')){
        if(await isAuthorizedAdmin(session.user)){
          if(event==='TOKEN_REFRESHED') adminRealtimeSubscribed=false;
          await subscribeAdminRealtime();
          if(bookingAlertsEnabled){startBookingMonitor();scanForPendingBookingAlerts();}
        }
      }
    });

    if(pendingAlertOpenRequested){
      if(existingAdmin){pendingAlertOpenRequested=false;await openAdmin();activateBookingsTab();}
      else openModal('loginModal');
    }
  }
  catch(e){console.error(e);$('setupBanner').classList.remove('hidden');setSync('Connection error',true);}
}
init();
