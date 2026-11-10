import { assessPassphrase, getCompletionPercent } from './lab.js';

const completionKey = 'cyber-field-lab-completed-v1';
const validModules = ['phishing', 'passwords', 'incident'];
const views = [...document.querySelectorAll('.view')];
const navigationLinks = [...document.querySelectorAll('[data-view]')];
const sectionTitles = {
  overview: 'OVERVIEW',
  phishing: 'MESSAGE TRIAGE',
  passwords: 'PASSWORD HYGIENE',
  incident: 'INCIDENT RESPONSE',
};

function readCompletion() {
  try {
    const saved = JSON.parse(localStorage.getItem(completionKey) ?? '[]');
    return Array.isArray(saved) ? saved.filter((item) => validModules.includes(item)) : [];
  } catch {
    return [];
  }
}

let completed = readCompletion();

function setComplete(moduleName) {
  if (!completed.includes(moduleName)) completed = [...completed, moduleName];
  try {
    localStorage.setItem(completionKey, JSON.stringify(completed));
  } catch {
    // The exercise still works if browser storage is unavailable.
  }
  renderProgress();
}

function renderProgress() {
  const percent = getCompletionPercent(completed);
  document.querySelector('#progress-count').innerHTML = `${completed.length} <small>/ 3 MODULES COMPLETE</small>`;
  document.querySelector('#progress-percent').textContent = `${percent}%`;
  document.querySelector('#progress-bar').style.width = `${percent}%`;
  document.querySelector('.progress-track').setAttribute('aria-valuenow', String(completed.length));
  for (const moduleName of validModules) {
    const label = completed.includes(moduleName) ? 'COMPLETE' : 'NOT STARTED';
    document.querySelector(`[data-state="${moduleName}"]`).textContent = label;
  }
}

function navigate() {
  const viewId = location.hash.slice(1) || 'overview';
  const activeView = document.getElementById(viewId) ? viewId : 'overview';
  for (const view of views) {
    const active = view.id === activeView;
    view.hidden = !active;
    view.classList.toggle('is-visible', active);
  }
  for (const link of navigationLinks) {
    link.classList.toggle('is-active', link.dataset.view === activeView && link.classList.contains('nav-link'));
  }
  document.querySelector('#current-section').textContent = sectionTitles[activeView];
  window.scrollTo(0, 0);
}

document.querySelectorAll('[data-answer]').forEach((button) => {
  button.addEventListener('click', () => {
    const feedback = document.querySelector('#phishing-feedback');
    const correct = button.dataset.answer === 'report';
    feedback.hidden = false;
    feedback.className = `feedback-box ${correct ? 'feedback-good' : 'feedback-review'}`;
    feedback.textContent = correct
      ? 'Good call. Avoid interacting with the message, verify using a known official channel, and report it through your organization\'s process. The urgency and unexpected request are warning signs.'
      : 'Take another look. Unexpected urgency is a pressure tactic. Do not reply or open the link; verify independently through a known official channel and report the message.';
    document.querySelectorAll('[data-answer]').forEach((choice) => { choice.disabled = true; });
    setComplete('phishing');
  });
});

const passwordInput = document.querySelector('#password-input');
passwordInput.addEventListener('input', () => {
  const assessment = assessPassphrase(passwordInput.value);
  document.querySelector('#strength-label').textContent = assessment.label;
  document.querySelector('#strength-bar').style.width = `${assessment.score * 25}%`;
  document.querySelector('.strength-track').setAttribute('aria-valuenow', String(assessment.score));
  document.querySelector('[data-rule="length"]').classList.toggle('rule-met', assessment.longEnough);
  document.querySelector('[data-rule="variety"]').classList.toggle('rule-met', assessment.hasVariety);
  document.querySelector('[data-rule="unique"]').classList.toggle('rule-met', assessment.uniqueEnough);
});

document.querySelector('#toggle-password').addEventListener('click', (event) => {
  const show = passwordInput.type === 'password';
  passwordInput.type = show ? 'text' : 'password';
  event.currentTarget.textContent = show ? 'HIDE' : 'SHOW';
  event.currentTarget.setAttribute('aria-label', `${show ? 'Hide' : 'Show'} sample passphrase`);
});

document.querySelector('#complete-password').addEventListener('click', () => {
  setComplete('passwords');
  const status = document.querySelector('.completion-status');
  status.textContent = 'COMPLETE';
  status.classList.add('status-complete');
});

const incidentChoices = [...document.querySelectorAll('[data-incident]')];
incidentChoices.forEach((button) => {
  button.addEventListener('click', () => {
    const correct = button.dataset.incident === 'contain';
    const feedback = document.querySelector('#incident-feedback');
    feedback.hidden = false;
    feedback.className = `feedback-box ${correct ? 'feedback-good' : 'feedback-review'}`;
    feedback.textContent = correct
      ? 'Strong response. Verify with the employee through a trusted channel, contain active sessions, preserve evidence, and notify the response team according to policy.'
      : 'Avoid delay or irreversible actions. Confirm through a trusted channel, contain active sessions, preserve evidence, and involve the response team under your organization\'s plan.';
    incidentChoices.forEach((choice) => { choice.disabled = true; });
    document.querySelector('#reset-incident').hidden = false;
    setComplete('incident');
  });
});

document.querySelector('#reset-incident').addEventListener('click', () => {
  document.querySelector('#incident-feedback').hidden = true;
  document.querySelector('#reset-incident').hidden = true;
  incidentChoices.forEach((choice) => { choice.disabled = false; });
});

window.addEventListener('hashchange', navigate);
renderProgress();
navigate();