/* ============================================================
   GREAT BOOKS QUIZ — scoring.js
   Stage 3: full scoring and recommendation engine.

   No UI code here. All logic follows the spreadsheet faithfully.
   Entry point: runRecommendationEngine(data, answers)
   ============================================================ */

"use strict";

/* ============================================================
   ORDERED VALUE LISTS
   Used to calculate "distance" between user choices and book values
   for the rogue(ish) pick eligibility checks.
   ============================================================ */

const LENGTH_ORDER = [
  "You could read it in an afternoon",
  "This'll take a solid weekend alone to read",
  "It'll probably take a couple of weeks casually reading about an hour a day to finish",
  "You might as well marry the book"
];

const DIFFICULTY_ORDER = [
  "It's a pretty intuitive read",
  "You might need to chew on some ideas",
  "Reading this could break your brain"
];

/* Maps quiz answer options → the equivalent book field values.
   These are needed for the rogue(ish) pick distance calculations,
   which compare book values against what the user selected. */
const USER_DIFFICULTY_TO_BOOK = {
  "Keep it intuitive":            "It's a pretty intuitive read",
  "Give me something to chew on": "You might need to chew on some ideas",
  "Break my brain":               "Reading this could break your brain"
};

const USER_LENGTH_TO_BOOK = {
  "Something I could read in an afternoon": "You could read it in an afternoon",
  "A solid weekend":                        "This'll take a solid weekend alone to read",
  "A couple of weeks":                      "It'll probably take a couple of weeks casually reading about an hour a day to finish",
  "I wanna marry the book":                 "You might as well marry the book"
};

/* ============================================================
   SCORE A SINGLE BOOK
   Iterates every scoring rule. For each rule:
     1. Is the user's answer for that question the same as rule.answer_option?
     2. Does the book's field value match rule.book_value?
   If both — add rule.score to the book's total.

   Handles both single-value fields (genre, difficulty, length,
   beginner_friendly) and array fields (themes, mood).
   ============================================================ */
function scoreBook(book, answers, scoringRules) {
  let total = 0;

  for (const rule of scoringRules) {
    const { question_id, answer_option, book_field, book_value, score } = rule;
    if (score == null) continue;

    const userAnswer = answers[question_id];
    if (userAnswer == null) continue;

    /* Does the user's answer match this rule's answer_option?
       themes is an array of up to 2 selected values; all others are strings. */
    const answerMatches = Array.isArray(userAnswer)
      ? userAnswer.includes(answer_option)
      : userAnswer === answer_option;

    if (!answerMatches) continue;

    /* Does the book's field value match this rule's book_value?
       themes and mood are arrays on book objects; all others are strings. */
    const bookFieldValue = book[book_field];
    const fieldMatches = Array.isArray(bookFieldValue)
      ? bookFieldValue.includes(book_value)
      : bookFieldValue === book_value;

    if (fieldMatches) {
      total += score;
    }
  }

  return total;
}

/* ============================================================
   SCORE ALL BOOKS
   Returns a new array, each book augmented with a .score field,
   sorted descending by score.
   ============================================================ */
function scoreAllBooks(books, answers, scoringRules) {
  return books
    .map(book => ({ ...book, score: scoreBook(book, answers, scoringRules) }))
    .sort((a, b) => b.score - a.score);
}

/* ============================================================
   PRIMARY PICKS
   Implements selection_rules.json → primary_results group:
     - count:                   3
     - score_band_from_top:     2  (consider books within 2pts of top score)
     - max_per_author:          1
     - prefer_different_era_section: yes
     - prefer_higher_score_first:    yes  (already satisfied by sorted input)
   ============================================================ */
function selectPrimaryPicks(scoredBooks, selectionRules) {
  const rules        = selectionRules.primary_results;
  const count        = rules.count.value;               // 3
  const scoreBand    = rules.score_band_from_top.value; // 2
  const maxPerAuthor = rules.max_per_author.value;      // 1

  if (scoredBooks.length === 0) return [];

  const topScore = scoredBooks[0].score;

  /* Candidate pool: all books within the score band of the top score. */
  const candidates = scoredBooks.filter(b => b.score >= topScore - scoreBand);

  const selected          = [];
  const authorCount       = {};
  const chosenEraSections = new Set();

  /* Pass 1 — prefer variety across era_sections (higher score still wins
     within the band because scoredBooks is already sorted). */
  for (const book of candidates) {
    if (selected.length >= count) break;
    if ((authorCount[book.author] || 0) >= maxPerAuthor) continue;
    if (!chosenEraSections.has(book.era_section)) {
      selected.push(book);
      authorCount[book.author] = (authorCount[book.author] || 0) + 1;
      chosenEraSections.add(book.era_section);
    }
  }

  /* Pass 2 — fill remaining slots from the candidate pool; era constraint
     relaxed but author constraint still enforced. */
  for (const book of candidates) {
    if (selected.length >= count) break;
    if (selected.some(s => s.id === book.id)) continue;
    if ((authorCount[book.author] || 0) >= maxPerAuthor) continue;
    selected.push(book);
    authorCount[book.author] = (authorCount[book.author] || 0) + 1;
  }

  return selected;
}

/* ============================================================
   HELPERS FOR ROGUE(ISH) PICK
   ============================================================ */
function indexDistance(orderedList, valueA, valueB) {
  const ia = orderedList.indexOf(valueA);
  const ib = orderedList.indexOf(valueB);
  if (ia === -1 || ib === -1) return Infinity;
  return Math.abs(ia - ib);
}

/* ============================================================
   ROGUE(ISH) PICK
   Implements selection_rules.json → rogueish_pick group.

   Hard eligibility gates (must ALL pass):
     - Not already a primary pick
     - Not by the same author as any primary pick
     - Score ≥ 75% of the top overall score
     - Book's mood array includes the user's selected mood
     - At least 1 of the user's selected themes is in the book's themes array
     - Book's genre is in the exact or adjacent genre list for the user's genre choice
     - Length distance ≤ 1 bucket
     - Difficulty distance ≤ 1 step

   Preference rules (applied after filtering):
     - Prefer different era_section from the primary picks
     - Prefer adjacent-genre candidate when its score is within 2pts of the
       best exact-genre candidate (adjacent_genre_max_score_gap = 2)
   ============================================================ */
function selectRoguePick(scoredBooks, answers, primaryPicks, selectionRules, genreAdjacency) {
  const rules = selectionRules.rogueish_pick;

  const primaryIds     = new Set(primaryPicks.map(b => b.id));
  const primaryAuthors = new Set(primaryPicks.map(b => b.author));
  const primaryEraSections = new Set(primaryPicks.map(b => b.era_section));

  /* Score floor: book must reach at least 75% of the overall top score. */
  const topScore = scoredBooks.length > 0 ? scoredBooks[0].score : 0;
  const minScore = topScore * rules.min_score_ratio_vs_top.value;

  /* Allowed book genres from the adjacency map. */
  const adjacencyEntries = genreAdjacency[answers.genre] || [];
  const allAllowedGenres  = adjacencyEntries.map(e => e.allowed_book_genre);
  const exactGenreSet     = new Set(
    adjacencyEntries.filter(e => e.relationship === "exact").map(e => e.allowed_book_genre)
  );
  const adjGenreSet       = new Set(
    adjacencyEntries.filter(e => e.relationship === "adjacent").map(e => e.allowed_book_genre)
  );

  /* Map user's quiz answers to book field values for distance checks. */
  const bookLengthValue     = USER_LENGTH_TO_BOOK[answers.length];
  const bookDifficultyValue = USER_DIFFICULTY_TO_BOOK[answers.difficulty];
  const maxLengthDist       = rules.max_length_distance.value;    // 1
  const maxDifficultyDist   = rules.max_difficulty_distance.value; // 1

  /* Filter to eligible candidates. */
  const candidates = scoredBooks.filter(book => {
    if (primaryIds.has(book.id))      return false;
    if (primaryAuthors.has(book.author)) return false;
    if (book.score < minScore)        return false;

    /* Mood: book's mood array must contain the user's selected mood. */
    if (!book.mood.includes(answers.mood)) return false;

    /* Themes: at least 1 of the user's 2 selected themes must appear in the book. */
    const hasTheme = answers.themes.some(t => book.themes.includes(t));
    if (!hasTheme) return false;

    /* Genre: must be exact or adjacent. */
    if (!allAllowedGenres.includes(book.genre)) return false;

    /* Length distance. */
    if (indexDistance(LENGTH_ORDER, book.length, bookLengthValue) > maxLengthDist) return false;

    /* Difficulty distance. */
    if (indexDistance(DIFFICULTY_ORDER, book.difficulty, bookDifficultyValue) > maxDifficultyDist) return false;

    return true;
  });

  if (candidates.length === 0) return null;

  /* Sort helper: era_section preference first, then score descending. */
  const preferDiffEra = rules.prefer_different_era_section.value === "yes";

  function sortedCandidates(list) {
    return [...list].sort((a, b) => {
      if (preferDiffEra) {
        const aNew = !primaryEraSections.has(a.era_section);
        const bNew = !primaryEraSections.has(b.era_section);
        if (aNew && !bNew) return -1;
        if (!aNew && bNew) return 1;
      }
      return b.score - a.score;
    });
  }

  const exactCandidates = sortedCandidates(candidates.filter(b => exactGenreSet.has(b.genre)));
  const adjCandidates   = sortedCandidates(candidates.filter(b => adjGenreSet.has(b.genre)));

  const bestExact = exactCandidates[0] || null;
  const bestAdj   = adjCandidates[0]   || null;

  if (!bestExact && !bestAdj) return null;
  if (!bestExact) return bestAdj;
  if (!bestAdj)   return bestExact;

  /* Prefer adjacent-genre candidate if it falls within the allowed score gap. */
  const preferAdj = rules.prefer_adjacent_genre_when_close.value === "yes";
  const adjMaxGap = rules.adjacent_genre_max_score_gap.value; // 2

  if (preferAdj && (bestExact.score - bestAdj.score) <= adjMaxGap) {
    return bestAdj;
  }

  return bestExact;
}

/* ============================================================
   PUBLIC ENTRY POINT
   Call this with the fully-loaded data object and the user's answers.
   Returns { primaryPicks: Book[], roguePick: Book | null }
   ============================================================ */
function runRecommendationEngine(data, answers) {
  const { books, scoringRules, selectionRules, genreAdjacency } = data;

  const scoredBooks  = scoreAllBooks(books, answers, scoringRules);
  const primaryPicks = selectPrimaryPicks(scoredBooks, selectionRules);
  const roguePick    = selectRoguePick(
    scoredBooks, answers, primaryPicks, selectionRules, genreAdjacency
  );

  return { primaryPicks, roguePick };
}
