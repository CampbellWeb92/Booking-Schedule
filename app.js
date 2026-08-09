const DEFAULT_SLOTS=["08:00","09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00","18:00","19:00","20:00"];
let db=null,schedule={},viewDate=startOfMonth(new Date()),adminViewDate=startOfMonth(new Date()),selectedDate=isoDate(new Date()),adminSelectedDate=selectedDate,adminDraft=null,realtimeChannel=null;
const $=id=>document.getElementById(id);

function configured(){
  return window.SUPABASE_URL &&
    !window.SUPABASE_URL.includes("PASTE_") &&
    window.SUPABASE_PUBLISHABLE_KEY &&
    !window.SUPABASE_PUBLISHABLE_KEY.includes("PASTE_");
}
function pad(n){return String(n).padStart(2,"0")}
function isoDate(d){return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`}
function parseISODate(k){const[y,m,d]=k.split("-").map(Number);return new Date(y,m-1,d)}
function startOfMonth(d){return new Date(d.getFullYear(),d.getMonth(),1)}
function sameMonth(a,b){return a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()}
function prettyDate(k){return parseISODate(k).toLocaleDateString("en-ZA",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}
function monthText(d){return d.toLocaleDateString("en-ZA",{month:"long",year:"numeric"})}
function emptyDay(){return{wholeDay:false,blockedSlots:[],customSlots:[],note:""}}
function getDayData(k){return schedule[k]||emptyDay()}
function allSlotsForDay(k){const d=getDayData(k);return[...new Set([...DEFAULT_SLOTS,...(d.customSlots||[])])].sort()}
function statusForDay(k){const d=getDayData(k);if(d.wholeDay)return"blocked";const a=allSlotsForDay(k),b=new Set(d.blockedSlots||[]);if(a.length&&a.every(t=>b.has(t)))return"blocked";if(b.size)return"partial";return"available"}
function calendarDates(m){const f=new Date(m.getFullYear(),m.getMonth(),1),s=new Date(f);s.setDate(f.getDate()-f.getDay());return Array.from({length:42},(_,i)=>{const d=new Date(s);d.setDate(s.getDate()+i);return d})}
function setSync(text,error=false){$("syncStatus").textContent=text;$("syncStatus").style.color=error?"#b41224":""}

async function loadSchedule(){
  if(!db)return;
  setSync("Syncing…");
  const {data,error}=await db.from("schedule_days").select("day,whole_day,blocked_slots,custom_slots");
  if(error){console.error(error);setSync("Sync error",true);return}
  schedule={};
  for(const row of data||[]){
    schedule[row.day]={wholeDay:row.whole_day,blockedSlots:row.blocked_slots||[],customSlots:row.custom_slots||[],note:""};
  }
  setSync("Live");
  renderPublic();
  if(!$("adminModal").classList.contains("hidden")){loadAdminDraft();renderAdmin()}
}
function subscribeRealtime(){
  if(!db)return;
  realtimeChannel=db.channel("schedule-live")
    .on("postgres_changes",{event:"*",schema:"public",table:"schedule_days"},()=>loadSchedule())
    .subscribe(status=>{if(status==="SUBSCRIBED")setSync("Live")});
}
function renderCalendar(gridId,labelId,monthDate,selectedKey,handler){
  $(labelId).textContent=monthText(monthDate);const grid=$(gridId);grid.innerHTML="";const today=isoDate(new Date());
  calendarDates(monthDate).forEach(date=>{
    const key=isoDate(date),status=statusForDay(key),btn=document.createElement("button");
    btn.type="button";btn.className=["day",sameMonth(date,monthDate)?"":"outside",key===selectedKey?"selected":"",key===today?"today":"",status].filter(Boolean).join(" ");
    btn.innerHTML=`<span class="day-number">${date.getDate()}</span><span class="day-status"></span>`;btn.onclick=()=>handler(key);grid.appendChild(btn);
  });
}
function renderPublic(){
  renderCalendar("calendarGrid","monthLabel",viewDate,selectedDate,key=>{selectedDate=key;viewDate=startOfMonth(parseISODate(key));renderPublic()});
  $("selectedDateLabel").textContent=prettyDate(selectedDate);const wrap=$("publicSlots");wrap.innerHTML="";const data=getDayData(selectedDate);
  if(data.wholeDay){wrap.innerHTML='<div class="empty-state">This date is fully booked or blocked.</div>';return}
  const blocked=new Set(data.blockedSlots||[]),available=allSlotsForDay(selectedDate).filter(t=>!blocked.has(t));
  if(!available.length){wrap.innerHTML='<div class="empty-state">No appointment times are available on this date.</div>';return}
  available.forEach(t=>{const e=document.createElement("div");e.className="slot";e.textContent=t;wrap.appendChild(e)});
}
function openModal(id){$(id).classList.remove("hidden");document.body.style.overflow="hidden"}
function closeModal(id){$(id).classList.add("hidden");if(!document.querySelector(".modal:not(.hidden)"))document.body.style.overflow=""}
document.querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>closeModal(b.dataset.close));
document.querySelectorAll(".modal").forEach(m=>m.onclick=e=>{if(e.target===m)closeModal(m.id)});

async function currentUser(){if(!db)return null;const{data}=await db.auth.getUser();return data.user||null}
$("therapistBtn").onclick=async()=>{
  if(!db){$("setupBanner").classList.remove("hidden");return}
  const user=await currentUser();
  user?openAdmin():openModal("loginModal");
};
$("loginForm").onsubmit=async e=>{
  e.preventDefault();$("loginError").textContent="";
  const email=$("loginEmail").value.trim(),password=$("loginPassword").value;
  const{error}=await db.auth.signInWithPassword({email,password});
  if(error){$("loginError").textContent="Incorrect email or password.";return}
  const user=await currentUser();
  if(!user||user.email?.toLowerCase()!=="infocampbellweb@gmail.com"){
    await db.auth.signOut();$("loginError").textContent="This account is not authorized.";return;
  }
  $("loginPassword").value="";closeModal("loginModal");openAdmin();
};
$("logoutBtn").onclick=async()=>{await db.auth.signOut();closeModal("adminModal")};

async function openAdmin(){adminViewDate=startOfMonth(parseISODate(adminSelectedDate));await loadAdminDraft();renderAdmin();openModal("adminModal")}
async function loadAdminDraft(){
  const src=getDayData(adminSelectedDate);adminDraft={wholeDay:!!src.wholeDay,blockedSlots:[...(src.blockedSlots||[])],customSlots:[...(src.customSlots||[])],note:""};
  if(db){
    const{data}=await db.from("schedule_days").select("private_note").eq("day",adminSelectedDate).maybeSingle();
    if(data)adminDraft.note=data.private_note||"";
  }
}
function renderAdmin(){
  renderCalendar("adminCalendarGrid","adminMonthLabel",adminViewDate,adminSelectedDate,async key=>{adminSelectedDate=key;adminViewDate=startOfMonth(parseISODate(key));await loadAdminDraft();renderAdmin()});
  $("adminSelectedDateLabel").textContent=prettyDate(adminSelectedDate);$("blockWholeDay").checked=adminDraft.wholeDay;$("dayNote").value=adminDraft.note||"";renderAdminSlotsOnly();
}
function renderAdminSlotsOnly(){
  const wrap=$("adminSlots");wrap.innerHTML="";const blocked=new Set(adminDraft.blockedSlots||[]);
  [...new Set([...DEFAULT_SLOTS,...(adminDraft.customSlots||[])])].sort().forEach(time=>{
    const b=document.createElement("button");b.type="button";b.textContent=time;b.disabled=adminDraft.wholeDay;b.className="admin-slot"+(blocked.has(time)?" is-blocked":"");
    b.onclick=()=>{const s=new Set(adminDraft.blockedSlots);s.has(time)?s.delete(time):s.add(time);adminDraft.blockedSlots=[...s].sort();renderAdminSlotsOnly()};wrap.appendChild(b);
  });
}
$("blockWholeDay").onchange=e=>{adminDraft.wholeDay=e.target.checked;renderAdminSlotsOnly()};
$("dayNote").oninput=e=>adminDraft.note=e.target.value;
$("customSlotForm").onsubmit=e=>{e.preventDefault();const t=$("customTime").value;if(!t)return;if(!adminDraft.customSlots.includes(t)&&!DEFAULT_SLOTS.includes(t))adminDraft.customSlots.push(t);$("customTime").value="";renderAdminSlotsOnly()};

$("saveDayBtn").onclick=async()=>{
  $("saveDayBtn").disabled=true;$("saveMessage").textContent="Saving…";
  const payload={day:adminSelectedDate,whole_day:adminDraft.wholeDay,blocked_slots:[...new Set(adminDraft.blockedSlots)].sort(),custom_slots:[...new Set(adminDraft.customSlots)].sort(),private_note:(adminDraft.note||"").trim(),updated_at:new Date().toISOString()};
  const{error}=await db.from("schedule_days").upsert(payload,{onConflict:"day"});
  $("saveDayBtn").disabled=false;
  if(error){console.error(error);$("saveMessage").textContent="Could not save. Check Supabase setup/RLS.";return}
  $("saveMessage").textContent="Saved to Supabase.";await loadSchedule();setTimeout(()=>$("saveMessage").textContent="",1800);
};
$("clearDayBtn").onclick=async()=>{
  const{error}=await db.from("schedule_days").delete().eq("day",adminSelectedDate);
  if(error){$("saveMessage").textContent="Could not clear this date.";return}
  $("saveMessage").textContent="Date cleared.";await loadSchedule();await loadAdminDraft();renderAdmin();
};

$("prevMonth").onclick=()=>{viewDate=new Date(viewDate.getFullYear(),viewDate.getMonth()-1,1);renderPublic()};
$("nextMonth").onclick=()=>{viewDate=new Date(viewDate.getFullYear(),viewDate.getMonth()+1,1);renderPublic()};
$("adminPrevMonth").onclick=()=>{adminViewDate=new Date(adminViewDate.getFullYear(),adminViewDate.getMonth()-1,1);renderAdmin()};
$("adminNextMonth").onclick=()=>{adminViewDate=new Date(adminViewDate.getFullYear(),adminViewDate.getMonth()+1,1);renderAdmin()};
window.onkeydown=e=>{if(e.key==="Escape")document.querySelectorAll(".modal:not(.hidden)").forEach(m=>closeModal(m.id))};

async function init(){
  renderPublic();
  if(!configured()){
    $("setupBanner").classList.remove("hidden");setSync("Not configured",true);return;
  }
  try{
    db=window.supabase.createClient(window.SUPABASE_URL,window.SUPABASE_PUBLISHABLE_KEY);
    await loadSchedule();subscribeRealtime();
  }catch(e){console.error(e);$("setupBanner").classList.remove("hidden");setSync("Connection error",true)}
}
init();
