/**
 * CURA Multilingual Text Normalizer
 * Provides NFKC Unicode normalization, script detection, repeated-char collapse,
 * and canonical spelling harmonization for English, Hindi (Devanagari), and Hinglish.
 */

// Common Hinglish phonetic and typo variations mapped to canonical terms
const VARIANT_MAP = [
  // Fever
  [/\b(?:bukhaaar|bukhar|bukhaar|bukar|bukhr)\b/gi, "bukhar"],
  // Cough
  [/\b(?:khaansi|khansi|khasi|khaasi)\b/gi, "khansi"],
  // Breath / Breathing
  [/\b(?:saans|sans|saas|shwas)\b/gi, "saans"],
  // Pain / Trouble
  [/\b(?:taklif|takleef|taklef|dikkat|dikat|pareshani|parshani)\b/gi, "takleef"],
  [/\b(?:dardd|dard|drd)\b/gi, "dard"],
  // Chest
  [/\b(?:seena|seene|sine|chhati|chati)\b/gi, "seene"],
  // Consciousness
  [/\b(?:behosh|behoshh|bayhosh|behoshi)\b/gi, "behosh"],
  // Blood
  [/\b(?:khoon|khun)\b/gi, "khoon"],
  // Vomit
  [/\b(?:ultii|ulti|vomit|vomitting)\b/gi, "ulti"],
  // Negation tokens
  [/\b(?:nahin|nhi|naa|ni)\b/gi, "nahi"]
];

/**
 * Normalizes user input text
 * @param {string} text - Raw input string
 * @returns {string} - Cleaned and normalized text
 */
function normalizeText(text) {
  if (!text || typeof text !== "string") {
    return "";
  }

  // 1. Unicode NFKC normalization
  let normalized = text.normalize("NFKC");

  // 2. Strip zero-width characters and control codes
  normalized = normalized.replace(/[\u200B-\u200D\uFEFF]/g, "");

  // 3. Lowercase Latin characters
  normalized = normalized.toLowerCase();

  // 4. Collapse consecutive duplicate letters (3 or more) to max 2
  // e.g., 'bukhaaaar' -> 'bukhaar', 'pleaaase' -> 'please'
  normalized = normalized.replace(/([a-zA-Z])\1{2,}/g, "$1$1");

  // 5. Apply phonetic variant replacements for Hinglish
  for (const [pattern, replacement] of VARIANT_MAP) {
    normalized = normalized.replace(pattern, replacement);
  }

  // 6. Normalize whitespace
  normalized = normalized.replace(/\s+/g, " ").trim();

  return normalized;
}

/**
 * Detects whether the text is English, Hindi (Devanagari), or Hinglish
 * @param {string} text
 * @returns {'english' | 'hindi' | 'hinglish'}
 */
function detectLanguage(text) {
  if (!text || typeof text !== "string") {
    return "english";
  }

  // Check for Devanagari Unicode range (\u0900-\u097F)
  const devanagariCount = (text.match(/[\u0900-\u097F]/g) || []).length;
  const latinCount = (text.match(/[a-zA-Z]/g) || []).length;

  if (devanagariCount > latinCount) {
    return "hindi";
  }

  // Check for typical Hinglish marker tokens
  const hinglishTokens = /\b(?:hai|hain|ho|tha|the|thi|ko|ka|ki|ke|me|mai|mein|se|aur|bhi|nahi|bahut|kya|kyun|mera|meri|papa|mummy|bhai|behen|dada|dadi)\b/i;
  if (hinglishTokens.test(text)) {
    return "hinglish";
  }

  return "english";
}

module.exports = {
  normalizeText,
  detectLanguage
};
