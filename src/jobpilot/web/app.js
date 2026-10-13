const stages = ["Saved", "Tailored", "Applied", "Interviewing", "Offer"];
const state = { jobs: [], profile: null, scores: {}, view: "overview", busy: false, user: null, remoteTracker: {}, matching: false, scoreFailures: 0 };
const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const localTracker = () => { try { return JSON.parse(localStorage.getItem("jobpilot-tracker") || "{}"); } catch { return {}; } };
const tracker = () => JSON.parse(JSON.stringify(state.user ? state.remoteTracker : localTracker()));
const saveTracker = async (value) => {
  if (!state.user) {
    localStorage.setItem("jobpilot-tracker", JSON.stringify(value));
    updateStats();
    return;
  }
  const previous = state.remoteTracker;
  state.remoteTracker = JSON.parse(JSON.stringify(value));
  updateStats();
  const ids = new Set([...Object.keys(previous), ...Object.keys(value)]);
  let failed = false;
  for (const id of ids) {
    if (JSON.stringify(previous[id]) === JSON.stringify(value[id])) continue;
    try {
      if (!value[id]) await api(`/api/v1/applications/${encodeURIComponent(id)}`, {method:"DELETE"});
      else await api("/api/v1/applications", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({job_id:Number(id),stage:value[id].stage})});
    } catch {
      failed = true;
    }
  }
  if (failed) {
    try {
      state.remoteTracker = await (await api("/api/v1/applications")).json();
      updateStats();
      if (state.view === "applications") renderBoard();
    } catch { /* keep the last visible copy if the connection drops */ }
    toast("A saved role could not sync. Please refresh your application board.");
  }
};
const safeUrl = (value) => { try { const url = new URL(value); return ["https:","http:"].includes(url.protocol) ? url.href : "#"; } catch { return "#"; } };

document.addEventListener("DOMContentLoaded", () => {
  const today = new Date();
  $("#today-date").textContent = new Intl.DateTimeFormat(undefined, {month:"short",day:"numeric",year:"numeric"}).format(today);
  $("#footer-year").textContent = today.getFullYear();
  $("#refresh-button").addEventListener("click", () => loadJobs());
  $("#account-button").addEventListener("click", () => state.user ? showAccountPanel() : showAccountForm("signup"));
  $("#search-input").addEventListener("keydown", (event) => { if (event.key === "Enter") loadJobs(); });
  $("#location-filter").addEventListener("change", () => loadJobs());
  $("#remote-filter").addEventListener("change", () => loadJobs());
  $("#upload-button").addEventListener("click", chooseCV);
  $("#add-cv-link").addEventListener("click", chooseCV);
  $("#cv-file").addEventListener("change", (event) => uploadCV(event.target.files?.[0]));
  $("#cv-file").addEventListener("cancel", () => setCvUploadStatus("No file selected. Choose a PDF or DOCX when you’re ready.", ""));
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
  loadAccount();
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


async function loadAccount() {
  try {
    const result = await (await api("/api/v1/auth/me")).json();
    state.user = result.user;
    if (state.user) {
      const local = localTracker();
      const remote = await (await api("/api/v1/applications")).json();
      state.remoteTracker = {...local, ...remote};
      const failedLocal = {};
      for (const [id, record] of Object.entries(local)) {
        if (remote[id]) continue;
        try {
          await api("/api/v1/applications", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({job_id:Number(id),stage:record.stage})});
        } catch { failedLocal[id] = record; }
      }
      if (!Object.keys(failedLocal).length) localStorage.removeItem("jobpilot-tracker");
      const synced = await (await api("/api/v1/applications")).json();
      state.remoteTracker = {...failedLocal, ...synced};
      if (Object.keys(failedLocal).length) toast("Some older saved roles could not be moved to your account. Please check your board.");
    }
  } catch {
    state.user = null;
    state.remoteTracker = {};
  }
  renderAccountButton();
  updateStats();
  renderJobs();
}
function renderAccountButton() {
  const button = $("#account-button");
  button.textContent = state.user ? "Account" : "Sign in";
  button.setAttribute("aria-label", state.user ? "Account settings" : "Sign in or create an account");
  $("#user-name").textContent = state.user?.name || "Your workspace";
  $("#user-avatar").textContent = state.user ? state.user.name.trim()[0].toUpperCase() : "Y";
}
function showAccountForm(mode) {
  const signup = mode === "signup";
  openModal(`<div class="modal-eyebrow">OPTIONAL JOBPILOT ACCOUNT</div><h2 id="modal-title">${signup ? "Save your applications anywhere." : "Welcome back."}</h2><p class="modal-subtitle">${signup ? "Create an account to keep your application board across devices. You can keep browsing without signing up." : "Sign in to see your saved application board."}</p><form id="account-form" class="account-form">
    ${signup ? '<label>Your name<input name="name" autocomplete="name" required maxlength="120"></label>' : ""}
    <label>Email address<input name="email" type="email" autocomplete="email" required maxlength="320"></label>
    <label>Password<input name="password" type="password" autocomplete="${signup ? "new-password" : "current-password"}" required minlength="${signup ? "12" : "1"}" maxlength="128">${signup ? '<small>Use at least 12 characters.</small>' : ""}</label>
    ${signup ? '<label class="account-consent"><input name="consent" type="checkbox" required><span>I agree that JobPilot stores my name, email address and saved application board. My CV remains session-only and is not stored in this account.</span></label>' : ""}
    <div class="account-error hidden" id="account-error" role="alert"></div>
    <div class="modal-actions"><button class="button button-primary" type="submit">${signup ? "Create account" : "Sign in"}</button><button class="button button-secondary" type="button" id="account-mode-toggle">${signup ? "I already have an account" : "Create an account"}</button></div>
  </form><p class="account-footnote">Email verification and password recovery are not set up yet. Keep your password safe.</p>`);
  $("#account-mode-toggle").addEventListener("click", () => showAccountForm(signup ? "login" : "signup"));
  $("#account-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const button = event.currentTarget.querySelector('button[type="submit"]');
    const errorBox = $("#account-error");
    button.disabled = true;
    button.textContent = signup ? "Creating…" : "Signing in…";
    errorBox.classList.add("hidden");
    const payload = signup
      ? {name:String(form.get("name") || "").trim(),email:String(form.get("email") || "").trim(),password:String(form.get("password") || ""),consent:form.get("consent") === "on"}
      : {email:String(form.get("email") || "").trim(),password:String(form.get("password") || "")};
    try {
      const response = await api(`/api/v1/auth/${signup ? "signup" : "login"}`, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
      const result = await response.json();
      state.user = result.user;
      closeModal();
      await loadAccount();
      toast(signup ? "Your account is ready. Your application board will sync here." : "You are signed in.");
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.classList.remove("hidden");
      button.disabled = false;
      button.textContent = signup ? "Create account" : "Sign in";
    }
  });
}
function showAccountPanel() {
  if (!state.user) return showAccountForm("signup");
  openModal(`<div class="modal-eyebrow">YOUR OPTIONAL ACCOUNT</div><h2 id="modal-title">Your JobPilot account</h2><p class="modal-subtitle">${escapeHtml(state.user.name)} · ${escapeHtml(state.user.email)}</p><div class="profile-panel"><h3>Saved applications</h3><p>Your board is linked to this account and can be opened on another device. Your CV is still kept only in memory for the current session.</p></div><div class="modal-actions"><button class="button button-secondary" id="account-signout">Sign out</button><button class="button button-secondary" id="account-delete">Delete account</button></div>`);
  $("#account-signout").addEventListener("click", async () => {
    try { await api("/api/v1/auth/logout", {method:"POST"}); } catch { /* clear local account view even if the request times out */ }
    state.user = null; state.remoteTracker = {}; renderAccountButton(); closeModal(); updateStats(); renderJobs(); toast("You are signed out. Guest browsing is still available.");
  });
  $("#account-delete").addEventListener("click", async () => {
    if (!window.confirm("Delete your JobPilot account and its saved application board? This cannot be undone.")) return;
    const password = window.prompt("Enter your password to confirm account deletion:");
    if (password === null) return;
    try {
      await api("/api/v1/auth/account", {method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({password})});
      state.user = null; state.remoteTracker = {}; localStorage.removeItem("jobpilot-tracker");
      renderAccountButton(); closeModal(); updateStats(); renderJobs(); toast("Your account and saved board were deleted.");
    } catch (error) { toast(error.message); }
  });
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
    const preferredLanding = state.view === "overview" && !location && !remote;
    let importedJobs;
    if (preferredLanding) {
      const southAfricaParams = new URLSearchParams(params);
      southAfricaParams.set("location", "South Africa");
      const remoteParams = new URLSearchParams(params);
      remoteParams.set("remote", "true");
      const [southAfricaResponse, remoteResponse] = await Promise.all([
        api(`/api/v1/jobs?${southAfricaParams}`),
        api(`/api/v1/jobs?${remoteParams}`),
      ]);
      const [southAfricaJobs, remoteJobs] = await Promise.all([southAfricaResponse.json(), remoteResponse.json()]);
      const uniqueJobs = new Map([...southAfricaJobs, ...remoteJobs].map(job => [job.id, job]));
      importedJobs = [...uniqueJobs.values()];
    } else {
      const response = await api(`/api/v1/jobs?${params}`);
      importedJobs = await response.json();
    }
    state.jobs = state.view === "internships"
      ? importedJobs.filter(isSouthAfricanEarlyCareer).sort((a, b) => earlyCareerPriority(b) - earlyCareerPriority(a))
      : preferredLanding
        ? interleaveLandingJobs(importedJobs.filter(isPreferredLandingRole))
        : importedJobs;
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
    renderRecommendations();
    return;
  }
  list.innerHTML = state.jobs.map(jobCard).join("");
  bindJobActions(list);
  renderRecommendations();
}
function bindJobActions(container) {
  container.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => handleJobAction(button.dataset.action, Number(button.dataset.jobId))));
}
function renderRecommendations() {
  const section = $("#profile-recommendations");
  if (!section) return;
  const shouldShow = !!state.profile;
  section.classList.toggle("hidden", !shouldShow);
  if (!shouldShow) return;
  const list = $("#recommendation-list");
  const ranked = state.jobs
    .filter(job => state.scores[job.id] !== undefined)
    .sort((a, b) => recommendationRank(b) - recommendationRank(a))
    .slice(0, 6);
  if (!ranked.length) {
    const copy = state.matching
      ? "Comparing your skills, education and experience with current roles…"
      : state.scoreFailures
        ? "We couldn’t analyze matches just now. You can keep browsing and try uploading your CV again."
        : !state.jobs.length
          ? "No current jobs match these filters. Clear the filters or check back when the feed updates."
          : "Your profile is ready. We’re preparing role recommendations.";
    list.innerHTML = `<div class="recommendation-status" role="status">${escapeHtml(copy)}</div>`;
    return;
  }
  list.innerHTML = ranked.map(jobCard).join("");
  bindJobActions(list);
}
function recommendationRank(job) {
  const text = [job.title || "", job.employment_type, ...(job.tags || [])].filter(Boolean).join(" ");
  let studentBoost = 0;
  if (/\b(intern|internship|internships|graduate|graduates|grad|learnership|learnerships|trainee|trainees|apprentice|apprenticeship|student|entry.level|junior)\b/i.test(text)) studentBoost += 9;
  if (/\b(data science|data|software|IT|information technology|technology|analytics|cyber|cloud|devops|engineering|programming|machine learning|QA tester|technical support)\b/i.test(text)) studentBoost += 4;
  return state.scores[job.id] + studentBoost;
}

function landingRoleText(job) {
  return [job.title || "", job.employment_type || "", ...(job.tags || [])].join(" ");
}
function isEarlyCareerRole(job) {
  return /\b(intern(?:ship)?s?|graduates?|grad|learnerships?|trainees?|apprentices?|apprenticeships?|vacation programmes?|vacation programs?|student programmes?|student programs?|entry.level|junior)\b/i.test(landingRoleText(job));
}
function isFocusedTechRole(job) {
  return /\b(data science|data scientist|data analyst|business intelligence|bi analyst|software (?:developer|engineer)|web developer|application developer)\b/i.test(landingRoleText(job));
}
function isITRole(job) {
  return /\b(it|information technology|technology|software|data|analytics|cyber ?security|machine learning|artificial intelligence|cloud|devops|network|database|systems analyst|qa tester|technical support|programming|developer|engineer)\b/i.test(landingRoleText(job));
}
function isPreferredLandingRole(job) {
  const isSouthAfrican = job.country_code === "ZA" || /south africa/i.test(job.location || "");
  return (isSouthAfrican || job.is_remote === true) && isITRole(job);
}
function interleaveLandingJobs(jobs) {
  const isZa = job => job.country_code === "ZA" || /south africa/i.test(job.location || "");
  const groups = [
    jobs.filter(job => isZa(job) && isEarlyCareerRole(job) && isFocusedTechRole(job)),
    jobs.filter(job => job.is_remote === true && !isZa(job) && isEarlyCareerRole(job) && isFocusedTechRole(job)),
    jobs.filter(job => isZa(job) && !isEarlyCareerRole(job) && isFocusedTechRole(job)),
    jobs.filter(job => job.is_remote === true && !isZa(job) && !isEarlyCareerRole(job) && isFocusedTechRole(job)),
    jobs.filter(job => isZa(job) && isEarlyCareerRole(job) && !isFocusedTechRole(job)),
    jobs.filter(job => job.is_remote === true && !isZa(job) && isEarlyCareerRole(job) && !isFocusedTechRole(job)),
    jobs.filter(job => isZa(job) && !isEarlyCareerRole(job) && !isFocusedTechRole(job)),
    jobs.filter(job => job.is_remote === true && !isZa(job) && !isEarlyCareerRole(job) && !isFocusedTechRole(job)),
  ];
  const ordered = [];
  for (let index = 0; groups.some(group => index < group.length); index++) {
    groups.forEach(group => { if (group[index]) ordered.push(group[index]); });
  }
  return ordered;
}
function isSouthAfricanEarlyCareer(job) {
  const text = [job.title, job.employment_type, ...(job.tags || [])].filter(Boolean).join(" ");
  const earlyCareer = /\b(?:intern(?:ship)?s?|graduates?|grad|learnerships?|trainees?|apprenticeships?|vacation programmes?|vacation programs?|student programmes?|student programs?)\b/i.test(text);
  const southAfrican = job.country_code === "ZA" || /south africa/i.test(job.location || "");
  return earlyCareer && southAfrican;
}
function earlyCareerPriority(job) {
  if (isFocusedTechRole(job)) return 2;
  return isITRole(job) ? 1 : 0;
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

function chooseCV() {
  setCvUploadStatus("Choose a PDF or DOCX CV. JobPilot will analyze it for this session only.", "");
  $("#cv-file").click();
}
async function uploadCV(file) {
  if (!file) {
    setCvUploadStatus("Choose a PDF or DOCX CV to start your profile analysis.", "error");
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    setCvUploadStatus("That file is over 8 MB. Choose a smaller CV.", "error");
    const cvInput = $("#cv-file");
    if (cvInput) cvInput.value = "";
    return;
  }
  const form = new FormData();
  form.append("file", file);
  setCvUploadStatus("Uploading your CV securely for this session…", "working");
  const uploadButton = $("#upload-button") || $("#replace-cv-button");
  if (uploadButton) { uploadButton.disabled = true; uploadButton.textContent = "Analyzing…"; }
  try {
    const response = await api("/api/v1/cv/parse", {method:"POST", body:form});
    state.profile = await response.json();
    state.scores = {};
    state.scoreFailures = 0;
    $("#stat-cv").textContent = state.profile.name || "Ready to match";
    $("#user-name").textContent = state.profile.name || "Your workspace";
    $("#user-avatar").textContent = (state.profile.name || "Y").trim()[0].toUpperCase();
    $("#cv-banner").innerHTML = `<div class="cv-graphic"><div class="orb orb-one"></div><div class="orb orb-two"></div><div class="cv-sheet"><span></span><span></span><span></span><i>✓</i></div></div><div class="cv-copy"><span class="banner-kicker">PROFILE READY · SESSION ONLY</span><h2>${escapeHtml(state.profile.name || "Your CV is ready to go.")}</h2><p>${(state.profile.skills || []).length} skills detected. We’ll rank student-friendly roles using your skills, education and experience. Your CV stays in this session only.</p></div><div class="cv-cta"><button class="button button-light" id="review-profile-button">Review profile</button><button class="button button-secondary" id="replace-cv-button">Replace CV</button><span>PDF or DOCX · up to 8 MB</span></div>`;
    $("#review-profile-button").addEventListener("click", showProfileModal);
    $("#replace-cv-button").addEventListener("click", chooseCV);
    renderJobs();
    updateStats();
    setCvUploadStatus("CV received. Comparing your profile with the current job feed. Recommendations will appear below.", "success");
    void scoreVisibleJobs();
    toast("CV analyzed. Your suggested roles are being prepared.");
  } catch (error) {
    setCvUploadStatus(`We couldn’t read that CV: ${error.message}. Please try a PDF or DOCX under 8 MB.`, "error");
    toast(error.message);
  } finally {
    if (uploadButton?.isConnected) {
      uploadButton.disabled = false;
      uploadButton.textContent = uploadButton.id === "upload-button" ? "Upload your CV ↗" : "Replace CV";
    }
    const cvInput = $("#cv-file");
    if (cvInput) cvInput.value = "";
  }
}
function setCvUploadStatus(message, tone = "") {
  const status = $("#cv-upload-status");
  if (!status) return;
  status.textContent = message;
  status.className = `cv-upload-status ${tone}`.trim();
  status.classList.toggle("hidden", !message);
}

function showProfileModal() {
  const profile = state.profile;
  const skillChips = (profile.skills || []).map(skill => `<span class="keyword">${escapeHtml(skill)}</span>`).join("");
  const educationItems = (profile.education || []).map(item => `<span class="keyword">${escapeHtml(item)}</span>`).join("");
  openModal(`<div class="modal-eyebrow">YOUR PROFILE · SESSION ONLY</div><h2 id="modal-title">${escapeHtml(profile.name || "CV profile")}</h2><p class="modal-subtitle">Take a moment to check the details we found. Your original CV remains unchanged.</p><div class="profile-panel"><h3>Contact</h3><p>${escapeHtml([profile.email,profile.phone].filter(Boolean).join(" · ") || "No contact details detected")}</p></div><div class="profile-panel"><h3>Professional summary</h3><p>${escapeHtml(profile.summary || "No summary section was detected.")}</p></div><div class="profile-panel"><h3>Education detected</h3><div class="keyword-list">${educationItems || "No education entries detected."}</div></div><div class="profile-panel"><h3>Skills detected</h3><div class="keyword-list">${skillChips || "Few known skills detected. Recommendations will rely more on the role title and education found in your CV."}</div></div><div class="review-note">${escapeHtml((profile.parser_notes || []).join(" "))}</div><div class="modal-actions"><button class="button button-primary" id="profile-done">Explore your matches</button><button class="button button-secondary" id="profile-close">Close</button></div>`);
  $("#profile-done").addEventListener("click", closeModal); $("#profile-close").addEventListener("click", closeModal);
}

async function scoreVisibleJobs() {
  if (!state.profile) return;
  if (state.matching) return;
  state.matching = true;
  state.scoreFailures = 0;
  renderRecommendations();
  const jobs = state.jobs.filter(job => state.scores[job.id] === undefined).slice(0, 60);
  let cursor = 0;
  const worker = async () => { while (cursor < jobs.length) { const job = jobs[cursor++]; await scoreJob(job, false); } };
  await Promise.all(Array.from({length:4}, worker));
  state.matching = false;
  renderRecommendations();
}

async function scoreJob(job, showResult) {
  if (!state.profile) return;
  try {
    const response = await api("/api/v1/cv/match", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({profile:state.profile,job_title:job.title,job_description:job.description || ""})});
    const result = await response.json(); state.scores[job.id] = result.score;
    if (showResult) showMatch(job,result); else updateCardScore(job.id, result.score);
    updateStats();
    renderRecommendations();
  } catch (error) {
    if (!showResult) state.scoreFailures += 1;
    if (showResult) toast(error.message);
  }
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
  $("#overview-feed-note").classList.add("hidden");
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
  $("#metric-grid").classList.remove("hidden"); $("#cv-banner").classList.remove("hidden"); $("#internships-note").classList.add("hidden"); $("#overview-feed-note").classList.remove("hidden");
  $("#profile-recommendations").classList.toggle("hidden", !state.profile);
  $("#welcome-kicker").innerHTML = '<span class="spark">✳</span> YOUR NEXT MOVE STARTS HERE';
  $("#welcome-title").textContent = "Make your next move.";
  $("#welcome-subhead").textContent = "A clearer path from job search to signed offer.";
  $("#feed-kicker").textContent = "CURATED FOR YOUR NEXT CHAPTER";
  $("#feed-title").textContent = "Data, software & IT opportunities";
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
function updateCardScore(jobId, score) { document.querySelectorAll(`.job-card[data-job-id="${jobId}"] .job-actions`).forEach(actions=>{let pill=actions.querySelector(".match-pill");if(!pill){pill=document.createElement("span");pill.className="match-pill";actions.prepend(pill);}pill.textContent=`${score}% match`;pill.classList.toggle("low",score<70);}); }
function openModal(content) { $("#modal-content").innerHTML=content; $("#modal-backdrop").classList.remove("hidden"); document.body.style.overflow="hidden"; }
function closeModal() { $("#modal-backdrop").classList.add("hidden"); document.body.style.overflow=""; }
function toast(message) { const element=$("#toast");element.textContent=message;element.classList.add("visible");clearTimeout(toast.timer);toast.timer=setTimeout(()=>element.classList.remove("visible"),3600); }
function timeAgo(date) { const days=Math.floor((Date.now()-new Date(date).getTime())/86400000);return days<1?"Today":days===1?"1 day ago":`${days} days ago`; }
function formatSalary(job) { const amount=job.salary_min&&job.salary_max?`${job.salary_min.toLocaleString()}–${job.salary_max.toLocaleString()}`:Number(job.salary_min||job.salary_max).toLocaleString();return `${job.salary_currency||""} ${amount}`.trim(); }
function slug(value) { return String(value||"role").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,60)||"role"; }
function compactJob(job) { return {id:job.id,title:job.title,company:job.company,location:job.location,url:job.url,is_remote:job.is_remote,eligibility:job.eligibility}; }

