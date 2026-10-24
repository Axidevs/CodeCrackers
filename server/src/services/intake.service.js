/**
 * CURA Smart Intake & Multi-Turn Conversation Management Service
 * Merges multi-turn conversation context, detects patient proxy & duration,
 * and manages targeted follow-up questions within a 2-4 question budget.
 */

const { QUESTION_BANK } = require("../config/questions");
const { normalizeText, detectLanguage } = require("../utils/textNormalizer");

const MAX_QUESTION_BUDGET = 4;

/**
 * Extracts symptom markers from text
 */
function extractSymptoms(text) {
  const symptoms = [];
  const normalized = normalizeText(text);

  if (/\b(?:bukhar|fever|tap|temperature)\b/i.test(normalized)) symptoms.push("fever");
  if (/\b(?:khansi|cough)\b/i.test(normalized)) symptoms.push("cough");
  if (/\b(?:saans|breath|breathing)\b/i.test(normalized)) symptoms.push("respiratory");
  if (/\b(?:seene|chest)\b/i.test(normalized)) symptoms.push("chest");
  if (/\b(?:ulti|vomit|vomiting)\b/i.test(normalized)) symptoms.push("vomiting");
  if (/\b(?:dast|diarrhea|loose\s*motion)\b/i.test(normalized)) symptoms.push("diarrhea");
  if (/\b(?:sar\s*dard|headache)\b/i.test(normalized)) symptoms.push("headache");
  if (/\b(?:wound|chot|dressing|tanke|stitch)\b/i.test(normalized)) symptoms.push("wound_care");
  if (/\b(?:kamzori|weakness|fatigue)\b/i.test(normalized)) symptoms.push("weakness");

  return symptoms;
}

/**
 * Detects patient proxy (e.g., self, parent, child, elder)
 */
function extractPatientProxy(text) {
  const normalized = normalizeText(text);
  if (/\b(?:papa|pitaji|father|dad)\b/i.test(normalized)) return "father";
  if (/\b(?:mummy|mataji|mother|mom|maa)\b/i.test(normalized)) return "mother";
  if (/\b(?:dada|dadi|nana|nani|grandfather|grandmother|elderly|buzurg)\b/i.test(normalized)) return "elderly_family";
  if (/\b(?:baccha|bacche|child|kid|baby|beta|beti|son|daughter)\b/i.test(normalized)) return "child";
  return "self";
}

/**
 * Detects symptom duration from text
 */
function extractDuration(text) {
  const normalized = normalizeText(text);
  const numWords = "(?:\\d+|ek|do|teen|tin|chaar|char|paanch|panch|chhe|saat|aath|nau|das|dus|one|two|three|four|five|six|seven|eight|nine|ten|few|kuch|several)";
  const match = normalized.match(new RegExp(`\\b(${numWords})\\s*(?:din|days?|ghante|hours?|hafte|weeks?|mahine|months?)\\b`, "i"));
  if (match) {
    return match[0];
  }
  if (/\b(?:aaj\s*se|since\s*today|subah\s*se|since\s*morning)\b/i.test(normalized)) return "today";
  if (/\b(?:kal\s*se|since\s*yesterday)\b/i.test(normalized)) return "yesterday";
  if (/\b(?:hafte\s*bhar|week\s*long)\b/i.test(normalized)) return "1 week";
  return null;
}

/**
 * Processes intake message and conversation history
 * @param {object} params
 * @param {string} params.user_input - Current message from user
 * @param {string} [params.language] - User language hint ('auto', 'hindi', 'english', 'hinglish')
 * @param {Array<object>} [params.conversation_history] - Previous dialogue turns
 * @param {boolean} [params.has_emergency_red_flag] - Whether safety gate triggered emergency
 * @returns {object} Consolidated CaseState
 */
function processIntake({ user_input, language = "auto", conversation_history = [], has_emergency_red_flag = false }) {
  const normalizedInput = normalizeText(user_input);
  const detectedLang = language && language !== "auto" ? language : detectLanguage(user_input);

  // Combine user messages across history turns to create full context
  const pastUserMessages = (conversation_history || [])
    .filter((msg) => msg.role === "user")
    .map((msg) => msg.content);

  const fullConversationText = [...pastUserMessages, user_input].join(" ");
  const normalizedFull = normalizeText(fullConversationText);

  // Identify prior bank questions by their localized text so the backend does not repeat them.
  const priorQuestionMessages = (conversation_history || [])
    .filter((msg) => msg.role === "assistant" && msg.is_question)
    .map((msg) => normalizeText(msg.content));
  const askedQuestionIds = new Set(
    QUESTION_BANK
      .filter((question) => [question.text_en, question.text_hi, question.text_hinglish]
        .some((text) => priorQuestionMessages.includes(normalizeText(text))))
      .map((question) => question.id)
  );
  const questionsAskedCount = priorQuestionMessages.length;

  const symptoms = extractSymptoms(normalizedFull);
  const patient = extractPatientProxy(normalizedFull);
  const duration = extractDuration(normalizedFull);

  // Select only fixed, localized questions relevant to extracted symptoms and not already asked.
  let followUpQuestion = null;

  // RULE: Obvious emergencies NEVER receive follow-up delays
  if (!has_emergency_red_flag && questionsAskedCount < MAX_QUESTION_BUDGET) {
    const relevantQuestionIds = [];
    const hasBreathingOrChestMention = /saans|breath|respirat|chest|seene|sine|छाती|सीने/i.test(normalizedFull);
    if (!hasBreathingOrChestMention && symptoms.some((symptom) => ["respiratory", "chest", "fever", "cough"].includes(symptom))) {
      relevantQuestionIds.push("breathing_or_chest_check");
    }
    if (duration === null) relevantQuestionIds.push("symptom_duration");

    const nextQuestionId = relevantQuestionIds.find((questionId) => !askedQuestionIds.has(questionId));
    if (nextQuestionId) {
      const question = QUESTION_BANK.find((item) => item.id === nextQuestionId);
      followUpQuestion = selectLocalizedQuestion(question, detectedLang);
    }
  }

  return {
    raw_input: user_input,
    normalized_input: normalizedInput,
    full_text: fullConversationText,
    language: detectedLang,
    patient,
    duration,
    symptoms,
    questions_asked_count: questionsAskedCount,
    follow_up_question: followUpQuestion
  };
}

/**
 * Selects question string matching detected language
 */
function selectLocalizedQuestion(questionObj, language) {
  if (!questionObj) return null;
  if (language === "hindi") return questionObj.text_hi;
  if (language === "hinglish") return questionObj.text_hinglish;
  return questionObj.text_en;
}

module.exports = {
  processIntake,
  extractSymptoms,
  extractPatientProxy,
  extractDuration
};
