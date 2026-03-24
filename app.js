/* ============================================================
   GREAT BOOKS QUIZ — app.js
   Stage 2: question flow, selection enforcement, navigation.
   Scoring is NOT implemented here; that is Stage 3.
   ============================================================ */

"use strict";

/* ============================================================
   DATA
   Holds everything loaded from the JSON files.
   ============================================================ */
const data = {
  books:          [],   // Array of book objects
  questions:      [],   // Array of question objects, sorted by display_order
  answerOptions:  {},   // { question_id: [ { display_order, answer_option } ] }
  scoringRules:   [],   // Array of scoring rule objects
  selectionRules: {},   // { rule_group: { rule_name: { value, notes } } }
  genreAdjacency: {}    // { selected_genre: [ { allowed_book_genre, relationship } ] }
};

/* ============================================================
   STATE
   Single source of truth for the quiz session.
   ============================================================ */
const state = {
  screen:           "intro",  // "intro" | "question" | "results"
  questionIndex:    0,        // 0-based index into data.questions
  showMoreMatches:  false,    // expand additional primary picks
  showWildcard:     false,    // expand the rogue pick

  answers: {
    genre:      null,   // string | null
    themes:     [],     // string[] — max 2
    difficulty: null,   // string | null
    length:     null,   // string | null
    mood:       null    // string | null
  }
};

/* ============================================================
   DATA LOADING
   ============================================================ */
async function loadAllData() {
  const BASE = "./data/";
  const files = [
    "books.json",
    "questions.json",
    "answer_options.json",
    "scoring_rules.json",
    "selection_rules.json",
    "genre_adjacency.json"
  ];

  const [books, questions, answerOptions, scoringRules, selectionRules, genreAdjacency] =
    await Promise.all(files.map(f => fetch(BASE + f).then(r => {
      if (!r.ok) throw new Error(`Failed to load ${f}: ${r.status}`);
      return r.json();
    })));

  data.books          = books;
  data.questions      = questions;
  data.answerOptions  = answerOptions;
  data.scoringRules   = scoringRules;
  data.selectionRules = selectionRules;
  data.genreAdjacency = genreAdjacency;
}

/* ============================================================
   ANSWER HELPERS
   ============================================================ */
function getAnswer(questionId) {
  return state.answers[questionId];
}

function isAnswered(question) {
  const { question_id, response_type } = question;
  if (response_type === "multi_select") {
    return state.answers[question_id].length >= question.max_choices;
  }
  return state.answers[question_id] !== null;
}

function setAnswer(questionId, value, maxChoices) {
  if (maxChoices === 1) {
    state.answers[questionId] = value;
  } else {
    const current = state.answers[questionId];
    const idx = current.indexOf(value);
    if (idx !== -1) {
      current.splice(idx, 1);
    } else if (current.length < maxChoices) {
      current.push(value);
    }
  }
}

/* ============================================================
   PROGRESS
   ============================================================ */
function getProgressPercent() {
  if (state.screen === "intro")    return 0;
  if (state.screen === "results")  return 100;
  const total = data.questions.length;
  return Math.round(((state.questionIndex) / total) * 100);
}

function getProgressLabel() {
  if (state.screen === "intro")    return "";
  if (state.screen === "results")  return "Complete";
  return `Question ${state.questionIndex + 1} of ${data.questions.length}`;
}

/* ============================================================
   NAVIGATION
   ============================================================ */
function goToIntro() {
  state.screen          = "intro";
  state.questionIndex   = 0;
  state.showMoreMatches = false;
  state.showWildcard    = false;
  state.answers = { genre: null, themes: [], difficulty: null, length: null, mood: null };
  window.scrollTo({ top: 0, behavior: "smooth" });
  render();
}

function startQuiz() {
  state.screen = "question";
  state.questionIndex = 0;
  window.scrollTo({ top: 0, behavior: "smooth" });
  render();
}

function goNext() {
  const question = data.questions[state.questionIndex];
  if (!isAnswered(question)) return;

  if (state.questionIndex < data.questions.length - 1) {
    state.questionIndex += 1;
  } else {
    state.screen          = "results";
    state.showMoreMatches = false;
    state.showWildcard    = false;
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
  render();
}

function goBack() {
  if (state.screen === "results") {
    state.screen = "question";
    state.questionIndex = data.questions.length - 1;
    window.scrollTo({ top: 0, behavior: "smooth" });
    render();
    return;
  }
  if (state.questionIndex > 0) {
    state.questionIndex -= 1;
  } else {
    state.screen = "intro";
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
  render();
}

/* ============================================================
   RENDER — INTRO SCREEN
   ============================================================ */
function renderIntro() {
  return `
    <div class="screen intro-screen">
      <div>
        <p class="intro-eyebrow">Talking Through History</p>
        <h1 class="intro-title">Not sure what to read next?</h1>
        <p class="intro-body">
          Based on Mortimer Adler's legendary Great Books list, I built this tool that gives you a small set of serious recommendations matched to your interests, mood, and appetite for difficulty.
        </p>
        <div class="intro-meta">
          <span>5 questions</span>
          <span>less than 2 minutes</span>
        </div>
      </div>
      <button class="btn-start" id="btn-start">Begin &rarr;</button>
    </div>
  `;
}

/* ============================================================
   RENDER — QUESTION SCREEN
   ============================================================ */
const QUESTION_LABELS = {
  genre:      "PICK A GENRE",
  themes:     "PICK 2 THEMES",
  difficulty: "Pick a difficulty level",
  length:     "Pick a length",
  mood:       "Pick a mood",
};

function getQuestionLabel(question_id) {
  return QUESTION_LABELS[question_id] || "";
}

function renderQuestion() {
  const question = data.questions[state.questionIndex];
  const { question_id, question_text, max_choices, response_type } = question;
  const options = data.answerOptions[question_id] || [];

  const currentAnswer = getAnswer(question_id);
  const selectedValues = response_type === "multi_select"
    ? currentAnswer
    : (currentAnswer ? [currentAnswer] : []);

  const atMax = response_type === "multi_select" && selectedValues.length >= max_choices;

  const hint = response_type === "multi_select"
    ? selectedValues.length === 0
      ? null
      : selectedValues.length < max_choices
        ? `${max_choices - selectedValues.length} more to go`
        : null
    : null;

  const useSingleCol = question_id === "difficulty" || question_id === "length";

  const optionsHTML = options.map(({ answer_option }) => {
    const isSelected = selectedValues.includes(answer_option);
    const isDisabled = !isSelected && atMax;
    const classes = ["option-btn", isSelected ? "selected" : "", isDisabled ? "disabled" : ""]
      .filter(Boolean).join(" ");

    return `<button class="${classes}"
              data-question="${question_id}"
              data-value="${escapeAttr(answer_option)}"
              data-max="${max_choices}"
              ${isDisabled ? "disabled" : ""}>${escapeHTML(answer_option)}</button>`;
  }).join("");

  const answered = isAnswered(question);
  const isLast = state.questionIndex === data.questions.length - 1;
  const nextLabel = isLast ? "See Results →" : "Next →";

  return `
    <div class="screen question-screen">
      <div>
        <p class="question-number">${getQuestionLabel(question_id)}</p>
        <h2 class="question-text">${escapeHTML(question_text)}</h2>
        <p class="question-hint">${hint || ""}</p>
      </div>

      <div class="options-grid${useSingleCol ? " single-col" : ""}" id="options-grid">
        ${optionsHTML}
      </div>

      <div class="nav-bar">
        <button class="btn-back${state.questionIndex === 0 ? " hidden" : ""}" id="btn-back">
          &larr; Back
        </button>
        <button class="btn-next" id="btn-next" ${answered ? "" : "disabled"}>
          ${nextLabel}
        </button>
      </div>
    </div>
  `;
}

/* ============================================================
   RENDER — BOOK CARD
   Used for both primary picks and the rogue(ish) pick.
   ============================================================ */
function renderBookCard(book, isRogue) {
  const cardClass = isRogue ? "book-card book-card--rogue" : "book-card";

  return `
    <article class="${cardClass}">
      <div class="book-card__meta">
        <span class="book-card__genre-pill">${escapeHTML(book.genre)}</span>
        <span class="book-card__era">${escapeHTML(book.era_section)}</span>
      </div>
      <div>
        <h3 class="book-card__title">${escapeHTML(book.work)}</h3>
        <p class="book-card__author">${escapeHTML(book.author)}</p>
      </div>
      <p class="book-card__tagline">${escapeHTML(book.why_read_this)}</p>
      <p class="book-card__synopsis">${escapeHTML(book.work_synopsis)}</p>
    </article>
  `;
}

/* ============================================================
   RENDER — RESULTS SCREEN
   Calls the scoring engine (scoring.js) and renders results.
   ============================================================ */
function renderResults() {
  const { primaryPicks, roguePick } = runRecommendationEngine(data, state.answers);

  const topPick   = primaryPicks[0];
  const morePicks = primaryPicks.slice(1);

  const topCardHTML = topPick ? renderBookCard(topPick, false) : "";

  const moreMatchesBtn = morePicks.length > 0 && !state.showMoreMatches
    ? `<button class="btn-expand" id="btn-show-matches">You have ${morePicks.length} more ${morePicks.length === 1 ? "match" : "matches"} &darr;</button>`
    : "";
  const moreMatchesCards = state.showMoreMatches
    ? morePicks.map(b => renderBookCard(b, false)).join("")
    : "";

  const rogueBtn = roguePick && !state.showWildcard
    ? `<button class="btn-expand btn-expand--rogue" id="btn-show-wildcard">Show a rogue(ish) pick &darr;</button>`
    : "";

  const rogueSection = roguePick && state.showWildcard
    ? `
      <div class="results-section">
        <div class="results-section-header">
          <p class="results-section-label">A Rogue(ish) Pick</p>
          <p class="results-section-desc" style="font-style:italic;">A nearby detour that still matches your mood and themes.</p>
        </div>
        ${renderBookCard(roguePick, true)}
      </div>
    `
    : "";

  const themesText = state.answers.themes.join(" &amp; ");
  const moodText   = escapeHTML(state.answers.mood);

  return `
    <div class="screen results-screen">

      <div class="results-header">
        <h2 class="results-header__title">YOUR RESULTS</h2>
        <p class="results-header__summary">
          <strong>${escapeHTML(state.answers.genre)}</strong>
          &nbsp;&middot;&nbsp;${themesText}
          &nbsp;&middot;&nbsp;${moodText}
        </p>
      </div>

      <div class="results-section">
        <div class="results-section-header">
          <p class="results-section-label">Your best matches</p>
          <p class="results-section-desc">
            Closest matches across all five dimensions.
          </p>
        </div>
        ${topCardHTML}
        ${moreMatchesCards}
        ${moreMatchesBtn}
        ${rogueBtn}
      </div>

      ${rogueSection}

      <div class="substack-block" id="substack-embed">
        <p class="substack-block__eyebrow">Get the Guide</p>
        <h3 class="substack-block__title">Get my complete reading guide</h3>
        <p class="substack-block__body">
          Subscribe to my Substack and I'll send you my full guide to Mortimer Adler's legendary list of 137 authors and 267 works, complete with pictures, blurbs, and links for every entry.
        </p>
        <div class="substack-block__embed">
          <iframe src="https://nagatasho.substack.com/embed" width="480" height="320" style="border:1px solid #EEE;background:white;" frameborder="0" scrolling="no"></iframe>
        </div>
      </div>

      <div class="results-footer">
        <button class="results-footer__restart" id="btn-restart">Start over</button>
        <button class="results-footer__back" id="btn-back">&larr; Edit my answers</button>
      </div>

    </div>
  `;
}

/* ============================================================
   RENDER — PROGRESS BAR
   ============================================================ */
function renderProgressBar() {
  if (state.screen === "intro") return "";
  const pct = getProgressPercent();
  const label = getProgressLabel();
  return `
    <div class="progress-container">
      <div class="progress-track">
        <div class="progress-fill" style="width: ${pct}%"></div>
      </div>
      <p class="progress-label">${label}</p>
    </div>
  `;
}

/* ============================================================
   MAIN RENDER
   Composes the full page each time state changes.
   ============================================================ */
function render() {
  const app = document.getElementById("app");

  let body = "";
  if (state.screen === "intro")    body = renderIntro();
  if (state.screen === "question") body = renderQuestion();
  if (state.screen === "results")  body = renderResults();

  app.innerHTML = renderProgressBar() + body;

  attachEventListeners();
  requestAnimationFrame(updateScrollHint);
}

/* ============================================================
   EVENT LISTENERS
   Re-attached after every render (cheap, keeps render simple).
   ============================================================ */
function attachEventListeners() {
  const btnStart = document.getElementById("btn-start");
  if (btnStart) btnStart.addEventListener("click", startQuiz);

  const btnRestart = document.getElementById("btn-restart");
  if (btnRestart) btnRestart.addEventListener("click", goToIntro);

  const btnNext = document.getElementById("btn-next");
  if (btnNext) btnNext.addEventListener("click", goNext);

  const btnBack = document.getElementById("btn-back");
  if (btnBack) btnBack.addEventListener("click", goBack);

  const btnShowMatches = document.getElementById("btn-show-matches");
  if (btnShowMatches) btnShowMatches.addEventListener("click", () => {
    state.showMoreMatches = true;
    const { primaryPicks } = runRecommendationEngine(data, state.answers);
    const morePicks = primaryPicks.slice(1);
    const html = morePicks.map(b => renderBookCard(b, false)).join("");
    const temp = document.createElement("div");
    temp.innerHTML = html;
    const rogueBtn = document.getElementById("btn-show-wildcard");
    const parent = btnShowMatches.parentNode;
    while (temp.firstChild) {
      parent.insertBefore(temp.firstChild, rogueBtn || btnShowMatches);
    }
    btnShowMatches.remove();
  });

  const btnShowWildcard = document.getElementById("btn-show-wildcard");
  if (btnShowWildcard) btnShowWildcard.addEventListener("click", () => {
    state.showWildcard = true;
    const { roguePick } = runRecommendationEngine(data, state.answers);
    const rogueHTML = `
      <div class="results-section">
        <div class="results-section-header">
          <p class="results-section-label">A Rogue(ish) Pick</p>
          <p class="results-section-desc" style="font-style:italic;">A nearby detour that still matches your mood and themes.</p>
        </div>
        ${renderBookCard(roguePick, true)}
      </div>`;
    const primarySection = btnShowWildcard.closest(".results-section");
    primarySection.insertAdjacentHTML("afterend", rogueHTML);
    btnShowWildcard.remove();
  });

  const grid = document.getElementById("options-grid");
  if (grid) {
    grid.addEventListener("click", (e) => {
      const btn = e.target.closest(".option-btn");
      if (!btn || btn.disabled) return;

      const questionId = btn.dataset.question;
      const value      = btn.dataset.value;
      const maxChoices = parseInt(btn.dataset.max, 10);

      setAnswer(questionId, value, maxChoices);
      updateOptionsInPlace(questionId, maxChoices);
    });
  }
}

/* ============================================================
   PARTIAL UPDATE — options only (no full re-render, no flash)
   ============================================================ */
function updateOptionsInPlace(questionId, maxChoices) {
  const question = data.questions[state.questionIndex];
  const { response_type } = question;
  const currentAnswer = getAnswer(questionId);
  const selectedValues = response_type === "multi_select"
    ? currentAnswer
    : (currentAnswer ? [currentAnswer] : []);
  const atMax = response_type === "multi_select" && selectedValues.length >= maxChoices;

  const allBtns = document.querySelectorAll(".option-btn");
  allBtns.forEach(btn => {
    const isSelected = selectedValues.includes(btn.dataset.value);
    const isDisabled = !isSelected && atMax;
    btn.classList.toggle("selected", isSelected);
    btn.classList.toggle("disabled", isDisabled);
    btn.disabled = isDisabled;
  });

  const hint = document.querySelector(".question-hint");
  if (hint && response_type === "multi_select") {
    if (selectedValues.length === 0)             hint.textContent = "";
    else if (selectedValues.length < maxChoices) hint.textContent = `${maxChoices - selectedValues.length} more to go`;
    else                                         hint.textContent = "";
  }

  const btnNext = document.getElementById("btn-next");
  if (btnNext) btnNext.disabled = !isAnswered(question);
}

/* ============================================================
   SCROLL HINT
   Shows a down-arrow when there is off-screen content below;
   hides it when the user reaches the bottom or nothing overflows.
   ============================================================ */
function updateScrollHint() {
  const hint = document.getElementById("scroll-hint");
  if (!hint) return;
  const scrollable = document.documentElement.scrollHeight > window.innerHeight + 4;
  const atBottom   = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 10;
  hint.classList.toggle("visible", scrollable && !atBottom);
}

/* ============================================================
   UTILITY — HTML ESCAPING
   ============================================================ */
function escapeHTML(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(str) {
  if (str == null) return "";
  return String(str).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/* ============================================================
   INIT
   ============================================================ */
async function init() {
  window.addEventListener("scroll", updateScrollHint, { passive: true });
  window.addEventListener("resize", updateScrollHint, { passive: true });

  try {
    await loadAllData();
    render();
  } catch (err) {
    document.getElementById("app").innerHTML =
      `<div class="loading-screen" style="color: #b00; font-family: system-ui;">
         Failed to load quiz data: ${escapeHTML(err.message)}
       </div>`;
    console.error("Quiz init error:", err);
  }
}

init();
