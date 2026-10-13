const stages = ["Saved", "Tailored", "Applied", "Interviewing", "Offer"];
const state = { jobs: [], profile: null, scores: {}, view: "overview", busy: false };
const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const tracker = () => { try { return JSON.parse(localStorage.getItem("jobpilot-tracker") || "{}"); } catch { return {}; } };
const saveTracker = (value) => { localStorage.setItem("jobpilot-tracker", JSON.stringify(value)); updateStats(); };
const safeUrl = (value) => { try { const url = new URL(value); return ["https:","http:"].includes(url.protocol) ? url.href : "#"; } catch { return "#"; } };

document.addEventListener("DOMContentLoaded", () => {
  const today = new Date();
  $("#today-date").textContent = new Intl.DateTimeFormat(undefined, {month:"short",day:"numeric",year:"numeric"}).format(today);
  $("#footer-year").textContent = today.getFullYear();
  $("#refresh-button").addEventListener("click", () => loadJobs());
  $("#search-input").addEventListener("keydown", (event) => { if (event.key === "Enter") loadJobs(); });
  $("#location-filter").addEventListener("change", () => loadJobs());
  $("#remote-filter").addEventListener("change", () => loadJobs());
  $("#upload-button").addEventListener("click", () => $("#cv-file").click());
  $("#add-cv-link").addEventListener("click", () => $("#cv-file").click());
  $("#cv-file").addEventListener("change", (event) => uploadCV(event.target.files?.[0]));
  $("#view-applications").addEventListener("click", showBoard);
  $("#back-to-jobs").addEventListener("click", showOverview);
  document.querySelectorAll(".nav-item").forEach((button) => button.addEventListener("click", () => {
    if (button.dataset.view === "applications") showBoard();
    else if (button.dataset.view === "internships") showInternships();
    else showOverview();
  }));
  $("#modal-close").addEventListener("click", closeModal);
  $("#modal-backdrop").addEventListener("click", (event) => { if (event.target.id === "modal-backdrop") closeModal(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeModal(); });
  loadJobs();
});

async function api(path, options = {}) {
  const response = await fetch(path, options);
  if (!response.ok) {
    let detail = `Request failed (${response.status})`;
    try { detail = (await response.json()).detail || detail; } catch { /* response was not JSON */ }
    throw new Error(detail);
  }
  return response;
}

async function loadJobs() {
  const list = $("#job-list");
  list.innerHTML = '<div class="loading-state"><span class="loader"></span>Finding roles worth your time…</div>';
  const params = new URLSearchParams({limit:"100"});
  const query = $("#search-input").value.trim();
  const location = $("#location-filter").value;
  const remote = $("#remote-filter").value;
  if (query) params.set("q", query);
  if (location) params.set("location", location);
  if (remote) params.set("remote", remote);
  if (state.view === "internships") params.set("early_career_only", "true");
  try {
    const response = await api(`/api/v1/jobs?${params}`);
    const importedJobs = await response.json();
    state.jobs = state.view === "internships" ? importedJobs.filter(isSouthAfricanEarlyCareer) : importedJobs;
    renderJobs();
    if (state.profile) scoreVisibleJobs();
  } catch (error) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">⌁</div><strong>Could not reach your job feed</strong><p>${escapeHtml(error.message)}. Make sure the JobPilot API is running, then refresh.</p><button class="button button-secondary" onclick="loadJobs()">Try again</button></div>`;
  }
  updateStats();
}

function renderJobs() {
  const list = $("#job-list");
  $("#results-count").textContent = `${state.jobs.length} ${state.jobs.length === 1 ? "role" : "roles"}`;
  $("#stat-jobs").textContent = state.jobs.length.toLocaleString();
  if (!state.jobs.length) {
    const isInternships = state.view === "internships";
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">✳</div><strong>' + (isInternships ? "No South African early career roles are in the feed yet." : "Your next opportunity will show up here.") + '</strong><p>' + (isInternships ? "This section needs a connected South African source. Add your Adzuna API keys in Render, then refresh the feed to import internships, graduate programmes and learnerships." : "The feed is ready. Run the daily job ingestion to bring in current South African and remote roles.") + '</p><button class="button button-secondary" onclick="loadJobs()">' + (isInternships ? "Refresh early career roles" : "Refresh feed") + '</button></div>';
    return;
  }
  list.innerHTML = state.jobs.map(jobCard).join("");
  list.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => handleJobAction(button.dataset.action, Number(button.dataset.jobId))));
}

function isSouthAfricanEarlyCareer(job) {
  const text = [job.title, job.employment_type, ...(job.tags || [])].filter(Boolean).join(" ");
  const earlyCareer = /\b(?:intern(?:ship)?s?|graduates?|grad|learnerships?|trainees?|apprenticeships?|vacation programmes?|vacation programs?|student programmes?|student programs?)\b/i.test(text);
  const southAfrican = job.country_code === "ZA" || /south africa/i.test(job.location || "");
  return earlyCareer && southAfrican;
}
function jobCard(job) {
  const id = Number(job.id), initials = (job.company || "?").split(/\s+/).map(x => x[0]).slice(0,2).join("").toUpperCase();
  const tags = (job.tags || []).slice(0,4).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join("");
  const tracked = tracker()[id];
  const score = state.scores[id];
  const posted = job.published_at ? timeAgo(job.published_at) : "Recently added";
  const sourceName = job.source === "jobicy" ? "Jobicy" : job.source === "remoteok" ? "Remote OK" : job.source === "adzuna_za" ? "Adzuna" : job.source;
  return `<article class="job-card" data-job-id="${id}"><div class="job-main"><div class="job-company-row"><span class="company-logo">${escapeHtml(initials)}</span><span class="job-company">${escapeHtml(job.company || "Unknown company")}</span><span class="job-posted">${escapeHtml(posted)}</span></div><div class="job-source">Source: <a href="${escapeHtml(safeUrl(job.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(sourceName)}</a></div><h3 class="job-title">${escapeHtml(job.title)}</h3><div class="job-meta"><span>⌖ &nbsp;${escapeHtml(job.location || "Location not specified")}</span><span class="meta-sep">·</span><span>${job.is_remote ? "Remote" : escapeHtml(job.employment_type || "Full-time")}</span>${job.salary_min || job.salary_max ? `<span class="meta-sep">·</span><span>${escapeHtml(formatSalary(job))}</span>` : ""}</div><div class="job-tags">${job.is_remote ? '<span class="tag remote">Remote</span>' : ""}${tags}</div>${job.eligibility === "eligibility_unverified" ? '<div class="eligibility">Confirm South African applicant eligibility with the employer.</div>' : ""}</div><div class="job-actions">${score !== undefined ? `<span class="match-pill ${score < 70 ? "low" : ""}">${score}% match</span>` : state.profile ? '<span class="match-pill low">Scoring…</span>' : ""}<div class="job-action-row">${state.profile ? `<button class="button button-small button-secondary" data-action="match" data-job-id="${id}">Match</button>` : ""}<button class="button button-small ${state.profile ? "button-primary" : "button-secondary"}" data-action="tailor" data-job-id="${id}" ${state.profile ? "" : "title=\"Add your CV first\""}>Tailor</button></div><div class="job-action-row"><button class="button button-small button-save ${tracked ? "saved" : ""}" data-action="${tracked ? "untrack" : "save"}" data-job-id="${id}">${tracked ? escapeHtml(tracked.stage) : "＋ Save role"}</button><a class="button button-small button-secondary" href="${escapeHtml(safeUrl(job.url))}" target="_blank" rel="noopener noreferrer">View role ↗</a></div></div></article>`;
}

async function handleJobAction(action, id) {
  const job = state.jobs.find(item => Number(item.id) === id);
  if (!job) return;
  if (action === "save") {
    const data = tracker(); data[id] = {stage:"Saved", job:compactJob(job)}; saveTracker(data); renderJobs(); toast("Role added to your application board.");
  } else if (action === "untrack") {
    const data = tracker(); delete data[id]; saveTracker(data); renderJobs(); toast("Role removed from your board.");
  } else if (action === "match") await scoreJob(job, true);
  else if (action === "tailor") state.profile ? await tailorJob(job) : $("#cv-file").click();
}

async function uploadCV(file) {
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) { toast("That file is over 8 MB. Choose a smaller CV."); return; }
  const form = new FormData(); form.append("file", file);
  toast("Reading your CV securely for this session…");
  try {
    const response = await api("/api/v1/cv/parse", {method:"POST", body:form});
    state.profile = await response.json();
    $("#stat-cv").textContent = state.profile.name || "Ready to match";
    $("#user-name").textContent = state.profile.name || "Your workspace";
    $("#user-avatar").textContent = (state.profile.name || "Y").trim()[0].toUpperCase();
    $("#cv-banner").innerHTML = `<div class="cv-graphic"><div class="orb orb-one"></div><div class="orb orb-two"></div><div class="cv-sheet"><span></span><span></span><span></span><i>✓</i></div></div><div class="cv-copy"><span class="banner-kicker">PROFILE READY · SESSION ONLY</span><h2>${escapeHtml(state.profile.name || "Your CV is ready to go.")}</h2><p>${(state.profile.skills || []).length} skills found. Your profile is in memory for this session and is not saved.</p></div><div class="cv-cta"><button class="button button-light" id="replace-cv-button">Replace CV <span>↗</span></button><span>PDF or DOCX · up to 8 MB</span></div>`;
    $("#replace-cv-button").addEventListener("click", () => $("#cv-file").click());
    state.scores = {};
    renderJobs(); updateStats(); scoreVisibleJobs();
    showProfileModal(); toast("Your CV is ready. You can review matches and tailor a role.");
  } catch (error) { toast(error.message); }
  $("#cv-file").value = "";
}

function showProfileModal() {
  const profile = state.profile;
  const skillChips = (profile.skills || []).map(skill => `<span class="keyword">${escapeHtml(skill)}</span>`).join("");
  openModal(`<div class="modal-eyebrow">YOUR PROFILE · SESSION ONLY</div><h2 id="modal-title">${escapeHtml(profile.name || "CV profile")}</h2><p class="modal-subtitle">Take a moment to check the details we found. Your original CV remains unchanged.</p><div class="profile-panel"><h3>Contact</h3><p>${escapeHtml([profile.email,profile.phone].filter(Boolean).join(" · ") || "No contact details detected")}</p></div><div class="profile-panel"><h3>Professional summary</h3><p>${escapeHtml(profile.summary || "No summary section was detected.")}</p></div><div class="profile-panel"><h3>Skills detected</h3><div class="keyword-list">${skillChips || "No known skills detected. Check the CV format or use clear skill names."}</div></div><div class="review-note">${escapeHtml((profile.parser_notes || []).join(" "))}</div><div class="modal-actions"><button class="button button-primary" id="profile-done">Explore your matches</button><button class="button button-secondary" id="profile-close">Close</button></div>`);
  $("#profile-done").addEventListener("click", closeModal); $("#profile-close").addEventListener("click", closeModal);
}

async function scoreVisibleJobs() {
  if (!state.profile) return;
  const jobs = state.jobs.filter(job => state.scores[job.id] === undefined).slice(0, 60);
  let cursor = 0;
  const worker = async () => { while (cursor < jobs.length) { const job = jobs[cursor++]; await scoreJob(job, false); } };
  await Promise.all(Array.from({length:4}, worker));
}

async function scoreJob(job, showResult) {
  if (!state.profile) return;
  try {
    const response = await api("/api/v1/cv/match", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({profile:state.profile,job_title:job.title,job_description:job.description || ""})});
    const result = await response.json(); state.scores[job.id] = result.score;
    if (showResult) showMatch(job,result); else updateCardScore(job.id, result.score);
    updateStats();
  } catch (error) { if (showResult) toast(error.message); }
}

function showMatch(job, result) {
  const missing = (result.missing_keywords || []).slice(0,16).map(word => `<span class="missing-keyword">${escapeHtml(word)}</span>`).join("");
  const matched = (result.matched_keywords || []).slice(0,16).map(word => `<span class="keyword">${escapeHtml(word)}</span>`).join("");
  openModal(`<div class="modal-eyebrow">ROLE MATCH · ${result.score}%</div><h2 id="modal-title">${escapeHtml(job.title)}</h2><p class="modal-subtitle">${escapeHtml(job.company)} · ${escapeHtml(job.location)}</p><div class="profile-panel"><h3>How your profile lines up</h3><p>${result.score}% overall score · ${(result.keyword_coverage*100).toFixed(0)}% keyword coverage · ${(result.cosine_similarity*100).toFixed(0)}% text similarity</p></div><div class="profile-panel"><h3>Skills and terms found in your CV</h3><div class="keyword-list">${matched || "No direct overlaps detected"}</div></div><div class="profile-panel"><h3>Terms to check against your experience</h3><div class="keyword-list">${missing || "No missing terms detected"}</div></div><div class="review-note">A match score is a relevance signal, not a hiring outcome. Only add a missing skill to your CV if you can support it with real experience.</div>`);
}

async function tailorJob(job) {
  openModal(`<div class="modal-eyebrow">AI CV TAILORING</div><h2 id="modal-title">Before you create a draft</h2><p class="modal-subtitle">Your extracted CV profile and this job description will be sent to the AI provider configured for this workspace. The app does not save your CV, but the provider may process the request under its own terms.</p><div class="review-note">Only continue if you are comfortable sharing this information with the configured provider. You will be able to review the complete draft before downloading it.</div><div class="modal-actions"><button class="button button-primary" id="confirm-tailor">Continue to tailor</button><button class="button button-secondary" id="cancel-tailor">Cancel</button></div>`);
  $("#confirm-tailor").addEventListener("click", () => { closeModal(); requestTailoring(job); });
  $("#cancel-tailor").addEventListener("click", closeModal);
}

async function requestTailoring(job) {
  const button = document.querySelector(`[data-action="tailor"][data-job-id="${job.id}"]`);
  if (button) { button.disabled = true; button.textContent = "Working…"; }
  try {
    const response = await api("/api/v1/cv/tailor", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({profile:state.profile,job_title:job.title,company:job.company || "",job_description:job.description || ""})});
    const tailored = await response.json();
    const data = tracker(); data[job.id] = {stage:"Tailored", job:compactJob(job)}; saveTracker(data); renderJobs();
    showTailored(job, tailored);
  } catch (error) { toast(error.message); }
  finally { if (button) { button.disabled = false; button.textContent = "Tailor"; } }
}

function showTailored(job, tailored) {
  const bullets = (tailored.bullets || []).map(item => `<div class="profile-panel"><h3>Reworked experience bullet</h3><p>${escapeHtml(item.text)}</p><p style="font-size:10px;color:#738096;margin-top:7px">Source: ${escapeHtml(item.source_text)}</p></div>`).join("");
  openModal(`<div class="modal-eyebrow">TAILORED DRAFT · REVIEW BEFORE USING</div><h2 id="modal-title">${escapeHtml(job.title)}</h2><p class="modal-subtitle">Drafted for ${escapeHtml(job.company || "this role")}. Your source CV has not been changed.</p><div class="review-note">${escapeHtml(tailored.grounding_note || "Review every line for accuracy before using it.")}</div><div class="tailored-section"><h3>Professional summary</h3><textarea id="tailored-summary">${escapeHtml(tailored.summary || "")}</textarea></div><div class="tailored-section"><h3>Prioritized skills</h3><div class="keyword-list">${(tailored.skills || []).map(x=>`<span class="keyword">${escapeHtml(x)}</span>`).join("")}</div></div>${bullets}<div class="tailored-section"><h3>Cover letter draft</h3><textarea id="cover-letter">${escapeHtml(tailored.cover_letter || "")}</textarea></div><div class="modal-actions"><button class="button button-primary" id="download-docx">Download DOCX</button><button class="button button-secondary" id="download-pdf">Download PDF</button><button class="button button-secondary" id="copy-letter">Copy cover letter</button></div>`);
  $("#download-docx").addEventListener("click", () => downloadTailored(job,tailored,"docx"));
  $("#download-pdf").addEventListener("click", () => downloadTailored(job,tailored,"pdf"));
  $("#copy-letter").addEventListener("click", async () => { await navigator.clipboard.writeText($("#cover-letter").value); toast("Cover letter copied."); });
}

async function downloadTailored(job, tailored, format) {
  const edited = {...tailored,summary:$("#tailored-summary").value,cover_letter:$("#cover-letter").value};
  const response = await api("/api/v1/cv/export",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({profile:state.profile,job_title:job.title,company:job.company || "",tailored:edited,format})});
  const blob = await response.blob(), url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href=url; link.download=`${slug(job.title)}-cv.${format}`; link.click(); URL.revokeObjectURL(url);
  toast(`${format.toUpperCase()} download ready.`);
}

function showBoard() {
  state.view="applications"; $("#overview-view").classList.add("hidden"); $("#applications-view").classList.remove("hidden");
  $("#breadcrumb-current").textContent="Applications"; document.querySelectorAll(".nav-item").forEach(button=>button.classList.toggle("active",button.dataset.view==="applications"));
  renderBoard();
}
function showInternships() {
  state.view = "internships";
  $("#overview-view").classList.remove("hidden");
  $("#applications-view").classList.add("hidden");
  $("#metric-grid").classList.add("hidden");
  $("#cv-banner").classList.add("hidden");
  $("#internships-note").classList.remove("hidden");
  $("#breadcrumb-current").textContent = "SA Internships & Graduates";
  $("#search-input").value = "";
  $("#location-filter").value = "South Africa";
  $("#remote-filter").value = "";
  $("#welcome-kicker").textContent = "EARLY CAREER OPPORTUNITIES";
  $("#welcome-title").textContent = "Start your career here.";
  $("#welcome-subhead").textContent = "Explore South African internships, graduate programmes and learnerships.";
  $("#feed-kicker").textContent = "SOUTH AFRICAN EARLY CAREER ROLES";
  $("#feed-title").textContent = "Internships & graduate programmes";
  document.querySelectorAll(".nav-item").forEach(button => button.classList.toggle("active", button.dataset.view === "internships"));
  loadJobs();
}
function showOverview() {
  state.view="overview"; $("#location-filter").value=""; $("#remote-filter").value=""; $("#overview-view").classList.remove("hidden"); $("#applications-view").classList.add("hidden");
  $("#metric-grid").classList.remove("hidden"); $("#cv-banner").classList.remove("hidden"); $("#internships-note").classList.add("hidden");
  $("#welcome-kicker").innerHTML = '<span class="spark">✳</span> YOUR NEXT MOVE STARTS HERE';
  $("#welcome-title").textContent = "Make your next move.";
  $("#welcome-subhead").textContent = "A clearer path from job search to signed offer.";
  $("#feed-kicker").textContent = "CURATED FOR YOUR NEXT CHAPTER";
  $("#feed-title").textContent = "Explore opportunities";
  $("#breadcrumb-current").textContent="Overview"; document.querySelectorAll(".nav-item").forEach(button=>button.classList.toggle("active",button.dataset.view==="overview"));
  loadJobs();
}
function renderBoard() {
  const data=tracker(), entries=Object.entries(data); $("#application-count").textContent=entries.length; $("#board-summary").innerHTML=stages.map(stage=>`<div class="board-summary-item">${escapeHtml(stage)}<strong>${entries.filter(([,item])=>item.stage===stage).length}</strong></div>`).join("");
  $("#kanban-board").innerHTML=stages.map(stage=>{const cards=entries.filter(([,item])=>item.stage===stage);return `<div class="kanban-column"><div class="kanban-head">${escapeHtml(stage)}<span>${cards.length}</span></div><div class="kanban-items">${cards.length?cards.map(([id,item])=>`<article class="kanban-card"><h3>${escapeHtml(item.job.title)}</h3><p>${escapeHtml(item.job.company)} · ${escapeHtml(item.job.location)}</p><select data-track-id="${escapeHtml(id)}" aria-label="Change stage for ${escapeHtml(item.job.title)}">${stages.map(option=>`<option ${option===item.stage?"selected":""}>${escapeHtml(option)}</option>`).join("")}</select></article>`).join(""):'<div class="kanban-empty">Nothing here yet.<br>Save a role to get started.</div>'}</div></div>`}).join("");
  $("#kanban-board").querySelectorAll("select").forEach(select=>select.addEventListener("change",()=>{const records=tracker(),id=select.dataset.trackId;if(records[id])records[id].stage=select.value;saveTracker(records);renderBoard();}));
  updateStats();
}

function updateStats() { const data=tracker(), entries=Object.values(data); $("#stat-pipeline").textContent=entries.length; $("#application-count").textContent=entries.length; $("#stat-matches").textContent=Object.values(state.scores).filter(score=>score>=85).length; }
function updateCardScore(jobId, score) { const actions=document.querySelector(`.job-card[data-job-id="${jobId}"] .job-actions`);if(!actions)return;let pill=actions.querySelector(".match-pill");if(!pill){pill=document.createElement("span");pill.className="match-pill";actions.prepend(pill);}pill.textContent=`${score}% match`;pill.classList.toggle("low",score<70); }
function openModal(content) { $("#modal-content").innerHTML=content; $("#modal-backdrop").classList.remove("hidden"); document.body.style.overflow="hidden"; }
function closeModal() { $("#modal-backdrop").classList.add("hidden"); document.body.style.overflow=""; }
function toast(message) { const element=$("#toast");element.textContent=message;element.classList.add("visible");clearTimeout(toast.timer);toast.timer=setTimeout(()=>element.classList.remove("visible"),3600); }
function timeAgo(date) { const days=Math.floor((Date.now()-new Date(date).getTime())/86400000);return days<1?"Today":days===1?"1 day ago":`${days} days ago`; }
function formatSalary(job) { const amount=job.salary_min&&job.salary_max?`${job.salary_min.toLocaleString()}–${job.salary_max.toLocaleString()}`:Number(job.salary_min||job.salary_max).toLocaleString();return `${job.salary_currency||""} ${amount}`.trim(); }
function slug(value) { return String(value||"role").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,60)||"role"; }
function compactJob(job) { return {id:job.id,title:job.title,company:job.company,location:job.location,url:job.url,is_remote:job.is_remote,eligibility:job.eligibility}; }

