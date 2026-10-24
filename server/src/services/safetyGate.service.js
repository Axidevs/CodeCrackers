/**
 * CURA Independent Deterministic Emergency Safety Gate
 * Evaluates patient input against medical red-flag criteria.
 * Completely decoupled from ML models — ML predictions cannot downgrade an emergency.
 */

const { RED_FLAGS, NEGATION_PATTERNS, INVERSE_NEGATION_PATTERNS, EMERGENCY_PROTOCOL } = require("../config/safetyRules");
const { normalizeText } = require("../utils/textNormalizer");

/**
 * Checks if a specific symptom match in the text is negated.
 * Analyzes both preceding context (English: "no chest pain") and following context (Hinglish: "dard nahi hai").
 * Bounded by clause boundaries (. , ! ? lekin par but aur).
 */
function isNegated(text, matchIndex, matchLength) {
  // Extract context window around the match
  const precedingWindow = text.slice(Math.max(0, matchIndex - 35), matchIndex);
  const followingWindow = text.slice(matchIndex + matchLength, Math.min(text.length, matchIndex + matchLength + 35));

  // Find last clause boundary before the match
  const clauseBreaks = /[.,!?;]|\b(?:lekin|par|magar|but|however|aur|and)\b/i;
  const preBreakMatch = precedingWindow.split(clauseBreaks).pop();
  const postBreakMatch = followingWindow.split(clauseBreaks)[0];

  // Check preceding negation (e.g., "no pain", "without chest pain", "koi takleef nahi")
  if (NEGATION_PATTERNS.PRECEDING.test(preBreakMatch)) {
    return true;
  }

  // Check following negation (e.g., "dard nahi hai", "pain absent")
  if (NEGATION_PATTERNS.FOLLOWING_OR_GENERAL.test(postBreakMatch)) {
    return true;
  }

  // Check Devanagari negation
  if (NEGATION_PATTERNS.DEVANAGARI.test(preBreakMatch) || NEGATION_PATTERNS.DEVANAGARI.test(postBreakMatch)) {
    return true;
  }

  return false;
}

/**
 * Evaluates text for emergency red flags
 * @param {string} text - User message (raw or partially normalized)
 * @returns {object} RuleResult
 */
function evaluateSafety(text) {
  if (!text || typeof text !== "string" || text.trim() === "") {
    return {
      state: "NONE",
      is_emergency: false,
      red_flags: [],
      reasoning: "No symptoms reported",
      emergency_action: null
    };
  }

  const normalized = normalizeText(text);
  const activeRedFlags = [];
  const triggeredReasons = [];

  // 1. FIRST: Check Inverse-Negation Patterns (Inability expressions)
  // e.g. "saans nahi le pa raha" -> Breathing inability -> ACTIVE EMERGENCY!
  for (const inv of INVERSE_NEGATION_PATTERNS) {
    if (inv.pattern.test(normalized) || (inv.devanagari && inv.devanagari.test(text))) {
      if (!activeRedFlags.includes(inv.flag_id)) {
        activeRedFlags.push(inv.flag_id);
        triggeredReasons.push(inv.reason);
      }
    }
  }

  // 2. SECOND: Check standard Red-Flag patterns
  for (const flag of RED_FLAGS) {
    if (activeRedFlags.includes(flag.id)) {
      continue; // Already flagged via inverse-negation
    }

    for (const pattern of flag.patterns) {
      const match = pattern.exec(normalized) || pattern.exec(text);
      if (match) {
        const matchIndex = match.index;
        const matchLength = match[0].length;

        // Check if this symptom mention is negated (e.g., "no chest pain", "dard nahi hai")
        const negated = isNegated(normalized, matchIndex, matchLength);

        if (!negated) {
          activeRedFlags.push(flag.id);
          triggeredReasons.push(flag.reason);
          break; // Flag triggered, move to next flag
        }
      }
    }
  }

  // 3. Assemble Rule Result
  if (activeRedFlags.length > 0) {
    return {
      state: "CONFIRMED",
      is_emergency: true,
      red_flags: activeRedFlags,
      reasoning: triggeredReasons.join("; ") + ". Immediate emergency response required.",
      emergency_action: {
        call: EMERGENCY_PROTOCOL.primary_number,
        ambulance: EMERGENCY_PROTOCOL.ambulance_number,
        guidance: "Immediate medical attention required. Please call 112 or visit the nearest emergency department.",
        steps: EMERGENCY_PROTOCOL.steps
      }
    };
  }

  return {
    state: "NONE",
    is_emergency: false,
    red_flags: [],
    reasoning: null,
    emergency_action: null
  };
}

module.exports = {
  evaluateSafety,
  isNegated
};
