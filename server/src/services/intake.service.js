/**
 * CURA Smart Intake & Multi-Turn Conversation Management Service
 * Merges multi-turn conversation context, detects patient proxy & duration,
 * and manages targeted follow-up questions within a 2-4 question budget.
 */

const { QUESTION_BANK } = require("../config/questions");
const { normalizeText, detectLanguage } = require("../utils/textNormalizer");
const { isNegated } = require("./safetyGate.service");

const MAX_QUESTION_BUDGET = 4;
const QUESTIONS_BY_ID = new Map(QUESTION_BANK.map((question) => [question.id, question]));

/**
 * Extracts symptom markers from text
 */
function extractSymptoms(text) {
  const symptoms = [];
  const normalized = normalizeText(text);
  const hasPositiveMatch = (pattern) => {
    const globalPattern = new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`);
    let match;
    while ((match = globalPattern.exec(normalized)) !== null) {
      if (!isNegated(normalized, match.index, match[0].length)) return true;
    }
    return false;
  };

  if (hasPositiveMatch(/\b(?:bukhar|fever|tap|temperature)\b/i)) symptoms.push("fever");
  if (hasPositiveMatch(/\b(?:khansi|cough)\b/i)) symptoms.push("cough");
  if (hasPositiveMatch(/\b(?:saans|breath|breathing)\b/i)) symptoms.push("respiratory");
  if (hasPositiveMatch(/\b(?:seene|chest)\b/i)) symptoms.push("chest");
  if (hasPositiveMatch(/\b(?:ulti|vomit|vomiting)\b/i)) symptoms.push("vomiting");
  if (hasPositiveMatch(/\b(?:dast|diarrhea|loose\s*motion)\b/i)) symptoms.push("diarrhea");
  if (hasPositiveMatch(/\b(?:sar\s*dard|headache)\b/i)) symptoms.push("headache");
  if (hasPositiveMatch(/\b(?:wound|chot|dressing|tanke|stitch)\b/i)) symptoms.push("wound_care");
  if (hasPositiveMatch(/\b(?:kamzori|weakness|fatigue)\b/i)) symptoms.push("weakness");
  if (hasPositiveMatch(/\b(?:stomach|abdominal|pet)\b/i)) symptoms.push("abdominal");
  if (hasPositiveMatch(/\b(?:dizz(?:y|iness)|chakkar)\b/i)) symptoms.push("dizziness");
  if (hasPositiveMatch(/\b(?:rash|itch(?:ing)?|khujli)\b/i)) symptoms.push("skin");
  if (hasPositiveMatch(/\b(?:pain|ache|dard)\b/i)) symptoms.push("pain");

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

function identifyQuestion(text) {
  const normalized = normalizeText(text);
  return QUESTION_BANK.find((question) =>
    [question.text_en, question.text_hi, question.text_hinglish]
      .some((questionText) => normalizeText(questionText) === normalized)
  );
}

function collectQuestionAnswers(conversation_history, user_input) {
  const answers = new Map();
  let pendingQuestion = null;

  for (const message of [...conversation_history, { role: "user", content: user_input }]) {
    if (message.role === "assistant" && message.is_question) {
      pendingQuestion = identifyQuestion(message.content);
    } else if (message.role === "user" && pendingQuestion) {
      answers.set(pendingQuestion.id, message.content);
      pendingQuestion = null;
    }
  }

  return answers;
}

function isYesNoAnswer(text) {
  const normalized = normalizeText(text);
  return /^(?:yes|yeah|yep|no|nope|neither|none|haan|han|nahi|bilkul nahi)\b/i.test(normalized);
}

function hasDuration(text) {
  return extractDuration(text) !== null;
}

function hasFeverSeverity(text) {
  const normalized = normalizeText(text);
  return /(?:\b(?:mild|moderate|high|very high|severe|shivering|chills|chilled|halka|halki|tez|bahut tez|zyada tez|thand|kapkapi)\b|\b\d{2,3}\s*(?:°\s*)?(?:f|c)\b|\b102\b)/i.test(normalized);
}

function hasSymptomSeverity(text, symptom) {
  const normalized = normalizeText(text);
  if (/\b(?:mild|moderate|severe|worsening|getting worse|manageable|halka|halki|madhyam|tez|badh raha|badh rahi)\b/i.test(normalized)) return true;
  if (symptom === "headache" && /\b(?:\d{1,2}\s*(?:\/\s*10|out of 10)|10\s*\/\s*10)\b/i.test(normalized)) return true;
  return false;
}

function hasExplicitBreathingOrChestStatus(text) {
  const normalized = normalizeText(text);
  const breathingMentioned = /\b(?:breath(?:ing)?|saans|respirat\w*)\b/i.test(normalized);
  const chestMentioned = /\b(?:chest|seene|chhati)\b/i.test(normalized);
  const explicitNo = /\b(?:no|not|without|nahi|nahin|nhi|neither)\b/i.test(normalized);
  return (breathingMentioned && chestMentioned && explicitNo)
    || /^(?:no|nope|neither|none|nahi|nahin|nhi)\b/i.test(normalized);
}

function hasHeadacheWarningAnswer(text) {
  const normalized = normalizeText(text);
  return isYesNoAnswer(normalized)
    || (/\b(?:sudden|weakness|confusion|vision|speech|bolne)\b/i.test(normalized)
      && /\b(?:no|not|without|nahi|nahin|nhi)\b/i.test(normalized));
}

function getRequiredQuestionIds(symptoms) {
  const requirements = [];
  if (symptoms.includes("headache")) {
    requirements.push("symptom_duration", "headache_warning_signs", "headache_severity");
  }
  if (symptoms.includes("fever")) {
    requirements.push("breathing_or_chest_check", "symptom_duration", "fever_severity");
  }
  if (symptoms.some((symptom) => ["cough", "respiratory", "chest"].includes(symptom))) {
    requirements.push("breathing_or_chest_check", "symptom_duration");
  }
  if (!symptoms.includes("headache") && !symptoms.includes("fever")
    && symptoms.some((symptom) => ["cough", "respiratory", "chest"].includes(symptom))) {
    requirements.push("symptom_severity");
  }
  if (requirements.length === 0) requirements.push("symptom_duration", "symptom_severity");
  return [...new Set(requirements)];
}

function isQuestionRequirementMet(questionId, context, answer) {
  switch (questionId) {
    case "symptom_duration":
      return hasDuration(context);
    case "breathing_or_chest_check":
      return hasExplicitBreathingOrChestStatus(context) || isYesNoAnswer(answer || "");
    case "headache_warning_signs":
      return hasHeadacheWarningAnswer(answer || "");
    case "headache_severity":
      return hasSymptomSeverity(context, "headache");
    case "fever_severity":
      return hasFeverSeverity(context);
    case "symptom_severity":
      return hasSymptomSeverity(context);
    default:
      return true;
  }
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

  const history = conversation_history || [];
  const priorQuestionMessages = history.filter((msg) => msg.role === "assistant" && msg.is_question);
  const askedQuestionIds = new Set(priorQuestionMessages.map((msg) => identifyQuestion(msg.content)?.id).filter(Boolean));
  const questionAnswers = collectQuestionAnswers(history, user_input);
  const questionsAskedCount = priorQuestionMessages.length;

  const symptoms = extractSymptoms(normalizedFull);
  const patient = extractPatientProxy(normalizedFull);
  const duration = extractDuration(normalizedFull);
  const requirements = getRequiredQuestionIds(symptoms);
  const unmetRequirements = requirements.filter((questionId) =>
    !isQuestionRequirementMet(questionId, normalizedFull, questionAnswers.get(questionId))
  );

  let followUpQuestion = null;
  let unresolvedQuestion = false;
  if (!has_emergency_red_flag && unmetRequirements.length > 0) {
    const alreadyAskedUnanswered = unmetRequirements.some((questionId) => askedQuestionIds.has(questionId));
    const nextQuestionId = alreadyAskedUnanswered
      ? null
      : unmetRequirements.find((questionId) => !askedQuestionIds.has(questionId));
    if (nextQuestionId && questionsAskedCount < MAX_QUESTION_BUDGET) {
      followUpQuestion = selectLocalizedQuestion(QUESTIONS_BY_ID.get(nextQuestionId), detectedLang);
    } else {
      unresolvedQuestion = true;
    }
  }

  const headacheWarningAnswer = questionAnswers.get("headache_warning_signs") || "";
  const breathingCheckAnswer = questionAnswers.get("breathing_or_chest_check") || "";

  return {
    raw_input: user_input,
    normalized_input: normalizedInput,
    full_text: fullConversationText,
    language: detectedLang,
    patient,
    duration,
    symptoms,
    questions_asked_count: questionsAskedCount,
    follow_up_question: followUpQuestion,
    is_ready_for_triage: unmetRequirements.length === 0,
    has_unresolved_question: unresolvedQuestion,
    affirmative_headache_warning: symptoms.includes("headache")
      && /^(?:yes|yeah|yep|haan|han)\b/i.test(normalizeText(headacheWarningAnswer)),
    affirmative_breathing_or_chest_check: /^(?:yes|yeah|yep|haan|han)\b/i.test(normalizeText(breathingCheckAnswer))
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
