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
  $('loginPassword').value=''; closeModal('loginModal'); openAdmin();
});
$('logoutBtn')?.addEventListener('click',async()=>{await db.auth.signOut();closeModal('adminModal');});

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
  if(render) { await loadAdminDraft(); renderAdmin(); renderBookingsPanels(); renderSettings(); renderHistory(); }
  else { renderBookingsPanels(); renderHistory(); }
}
function subscribeAdminRealtime() {
  if (!db || adminRealtimeSubscribed) return;
  adminRealtimeSubscribed = true;
  const appointmentsChannel=db.channel('admin-appointments-live').on('postgres_changes',{event:'*',schema:'public',table:'appointments'},async()=>{await loadAppointments();renderBookingsPanels();}).subscribe();
  const historyChannel=db.channel('admin-history-live').on('postgres_changes',{event:'*',schema:'public',table:'schedule_audit'},async()=>{await loadHistory();renderHistory();}).subscribe();
  realtimeChannels.push(appointmentsChannel,historyChannel);
}
async function openAdmin() {
  adminViewDate=startOfMonth(parseISODate(adminSelectedDate));
  subscribeAdminRealtime();
  await refreshAdminData(false); await loadAdminDraft(); renderAdmin(); renderBookingsPanels(); renderSettings(); renderHistory(); openModal('adminModal');
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
function selectedDayAppointments() { return appointments.filter(a=>a.day===adminSelectedDate && a.status!=='cancelled').sort((a,b)=>String(a.start_time).localeCompare(String(b.start_time))); }
function appointmentCard(a, includeActions=true) {
  const div=document.createElement('article'); div.className=`appointment-card status-${a.status}`;
  const end=String(a.end_time).slice(0,5), blocked=String(a.blocked_until_time).slice(0,5), start=String(a.start_time).slice(0,5);
  div.innerHTML=`<div><strong>${a.kind==='manual_block'?'Manual block':escapeHtml(a.service||'Appointment')}</strong><span>${prettyDate(a.day)} · ${formatSlot(start)}–${formatSlot(end)}${blocked!==end?` · buffer until ${formatSlot(blocked)}`:''}</span>${a.client_name?`<small>${escapeHtml(a.client_name)}${a.client_phone?` · ${escapeHtml(a.client_phone)}`:''}</small>`:''}${a.client_notes?`<small>${escapeHtml(a.client_notes)}</small>`:''}</div><span class="status-pill">${a.status}</span>`;
  if(includeActions){const row=document.createElement('div');row.className='appointment-actions';if(a.status==='pending'){row.append(actionButton('Confirm',()=>confirmAppointment(a)),actionButton('Cancel',()=>updateAppointmentStatus(a.id,'cancelled')));}else if(a.status==='confirmed'){row.append(actionButton('Complete',()=>updateAppointmentStatus(a.id,'completed')),actionButton('Cancel',()=>updateAppointmentStatus(a.id,'cancelled')));}div.appendChild(row);}return div;
}
function actionButton(text,fn){const b=document.createElement('button');b.type='button';b.className='admin-outline small-action';b.textContent=text;b.onclick=fn;return b;}
function escapeHtml(v){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function renderDayAppointments(){const w=$('dayAppointments');if(!w)return;w.innerHTML='';const rows=selectedDayAppointments();if(!rows.length){w.innerHTML='<div class="empty-state compact">No bookings or time blocks on this date.</div>';return;}rows.forEach(a=>w.appendChild(appointmentCard(a)));}
function renderBookingsPanels(){
  const pending=$('pendingRequests'), upcoming=$('upcomingAppointments'); if(!pending||!upcoming)return;
  const pend=appointments.filter(a=>a.status==='pending').sort((a,b)=>`${a.day}${a.start_time}`.localeCompare(`${b.day}${b.start_time}`));
  $('pendingCount').textContent=String(pend.length); pending.innerHTML=''; upcoming.innerHTML='';
  if(!pend.length) pending.innerHTML='<div class="empty-state compact">No pending website requests.</div>'; else pend.forEach(a=>pending.appendChild(appointmentCard(a)));
  const today=isoDate(new Date()), conf=appointments.filter(a=>a.status==='confirmed'&&a.day>=today).sort((a,b)=>`${a.day}${a.start_time}`.localeCompare(`${b.day}${b.start_time}`));
  if(!conf.length) upcoming.innerHTML='<div class="empty-state compact">No upcoming confirmed appointments.</div>'; else conf.forEach(a=>upcoming.appendChild(appointmentCard(a)));
  renderDayAppointments();
}
function renderSettings(){if(!$('settingBuffer'))return;$('settingBuffer').value=String(settings.defaultBufferMinutes);$('settingNotice').value=String(settings.minNoticeMinutes);$('settingAdvance').value=String(settings.maxAdvanceDays);$('bookingBuffer').value=String(settings.defaultBufferMinutes);}
function renderHistory(){const w=$('historyList');if(!w)return;w.innerHTML='';if(!historyRows.length){w.innerHTML='<div class="empty-state compact">No activity recorded yet.</div>';return;}historyRows.forEach(r=>{const el=document.createElement('article');el.className='history-item';const when=new Date(r.changed_at).toLocaleString('en-ZA',{dateStyle:'medium',timeStyle:'short'});el.innerHTML=`<strong>${escapeHtml(r.action)} · ${escapeHtml(r.table_name)}</strong><span>${escapeHtml(r.record_key)} · ${when}</span><small>${escapeHtml(r.actor_email||'system')}</small>`;w.appendChild(el);});}

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
$('addBookingBtn')?.addEventListener('click',async()=>{const start=$('bookingStart').value,duration=Number($('bookingDuration').value),buffer=Number($('bookingBuffer').value),close=getDayCloseMinutes(adminSelectedDate);if(!start){message('Choose a start time.',true);return;}const endM=timeToMinutes(start)+duration,blockEnd=endM+buffer;if(endM>close){message('This client appointment would finish after closing time. Choose an earlier start or a shorter duration.',true);return;}const end=minutesToTime(endM),blockedUntil=minutesToTime(blockEnd);if(rangeConflicts(adminSelectedDate,start,blockedUntil)){message('That range overlaps an existing booking or block.',true);return;}const {error}=await db.from('appointments').insert({day:adminSelectedDate,start_time:start,end_time:end,blocked_until_time:blockedUntil,duration_minutes:duration,buffer_minutes:buffer,kind:'booking',status:'confirmed',service:$('bookingService').value.trim()||'Appointment',client_name:$('bookingClient').value.trim(),client_phone:$('bookingPhone').value.trim(),client_type:'',client_notes:'',public_note:'',source:'admin'});if(error){console.error(error);message(error.message?.includes('appointments_no_confirmed_overlap')?'That time overlaps another confirmed range.':'Could not add booking.',true);return;}await loadPublicData();await loadAppointments();renderBookingsPanels();renderAdminBookingOptions();message('Confirmed booking added and public availability updated.');});
$('addManualBlockBtn')?.addEventListener('click',async()=>{const start=$('manualBlockStart').value,end=$('manualBlockEnd').value,note=$('manualBlockNote').value.trim();if(!start||!end||timeToMinutes(end)<=timeToMinutes(start)){message('Choose a valid start and end time.',true);return;}if(rangeConflicts(adminSelectedDate,start,end)){message('That block overlaps an existing booking or block.',true);return;}const duration=timeToMinutes(end)-timeToMinutes(start);const {error}=await db.from('appointments').insert({day:adminSelectedDate,start_time:start,end_time:end,blocked_until_time:end,duration_minutes:duration,buffer_minutes:0,kind:'manual_block',status:'confirmed',service:'Manual block',client_name:'',client_phone:'',client_type:'',client_notes:'',public_note:note,source:'admin'});if(error){message('Could not add time block.',true);return;}await loadPublicData();await loadAppointments();renderBookingsPanels();renderAdminBookingOptions();message('Time range blocked.');});
$('bookingDuration')?.addEventListener('change',renderAdminBookingOptions);
$('bookingBuffer')?.addEventListener('change',renderAdminBookingOptions);
$('manualBlockStart')?.addEventListener('change',()=>{if(!$('manualBlockStart').value)return;$('manualBlockEnd').value=minutesToTime(timeToMinutes($('manualBlockStart').value)+30);});

async function confirmAppointment(a){const buffer=settings.defaultBufferMinutes,endM=timeToMinutes(String(a.end_time).slice(0,5)),blockedUntil=minutesToTime(endM+buffer),close=getDayCloseMinutes(a.day);if(endM>close){message('This client appointment would finish after closing time and cannot be confirmed.',true);return;}const start=String(a.start_time).slice(0,5);if(rangeConflicts(a.day,start,blockedUntil)){message('Cannot confirm: that time now overlaps a confirmed booking or block.',true);return;}const {error}=await db.from('appointments').update({status:'confirmed',buffer_minutes:buffer,blocked_until_time:blockedUntil}).eq('id',a.id);if(error){console.error(error);message('Could not confirm this request.',true);return;}await loadPublicData();await loadAppointments();renderBookingsPanels();message('Booking confirmed. The website availability changed immediately.');}
async function updateAppointmentStatus(id,status){const {error}=await db.from('appointments').update({status}).eq('id',id);if(error){message('Could not update appointment.',true);return;}await loadPublicData();await loadAppointments();renderBookingsPanels();message(`Appointment marked ${status}.`);}

$('saveSettingsBtn')?.addEventListener('click',async()=>{const payload={default_buffer_minutes:Number($('settingBuffer').value),min_notice_minutes:Number($('settingNotice').value),max_advance_days:Number($('settingAdvance').value)};const {error}=await db.from('schedule_settings').update(payload).eq('id',1);if(error){message('Could not save booking rules.',true);return;}settings={defaultBufferMinutes:payload.default_buffer_minutes,minNoticeMinutes:payload.min_notice_minutes,maxAdvanceDays:payload.max_advance_days};renderSettings();message('Booking rules saved and published to the website.');});
$('undoDayBtn')?.addEventListener('click',async()=>{const {data,error}=await db.rpc('undo_last_schedule_day_change',{p_day:adminSelectedDate});if(error){message('Could not undo the last day change.',true);return;}await loadPublicData();await loadHistory();await loadAdminDraft();renderAdmin();renderHistory();message(data||'Previous state restored.');});

qsa('[data-admin-tab]').forEach(btn=>btn.addEventListener('click',()=>{qsa('[data-admin-tab]').forEach(b=>b.classList.toggle('active',b===btn));qsa('[data-admin-panel]').forEach(p=>p.classList.toggle('hidden',p.dataset.adminPanel!==btn.dataset.adminTab));if(btn.dataset.adminTab==='history')renderHistory();if(btn.dataset.adminTab==='bookings')renderBookingsPanels();}));

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
  try{db=window.supabase.createClient(window.SUPABASE_URL,window.SUPABASE_PUBLISHABLE_KEY);await loadPublicData();subscribeRealtime();}
  catch(e){console.error(e);$('setupBanner').classList.remove('hidden');setSync('Connection error',true);}
}
init();
