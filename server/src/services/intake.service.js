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
const CLARIFICATION_QUESTIONS = {
  symptom_duration: "symptom_duration_clarification",
  headache_severity: "headache_severity_clarification",
  symptom_severity: "symptom_severity_clarification",
  fever_severity: "fever_severity_clarification",
  headache_warning_signs: "headache_warning_clarification",
  breathing_or_chest_check: "breathing_or_chest_clarification"
};
const UNKNOWN_ANSWER = /\b(?:i\s+)?(?:don['’]?t\s+know|do\s+not\s+know|not\s+sure|not\s+certain|unsure|uncertain|maybe|perhaps|no\s+idea|can['’]?t\s+(?:say|remember)|cannot\s+(?:say|remember)|pata\s+nahi|malum\s+nahi|maalum\s+nahi)\b|(?:पता नहीं|नहीं पता|अनिश्चित)/i;

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
  const responses = [];
  const userTurns = [];
  const clarificationAsked = new Set();
  let pendingQuestion = null;

  for (const message of [...conversation_history, { role: "user", content: user_input }]) {
    if (message.role === "assistant" && message.is_question) {
      pendingQuestion = identifyQuestion(message.content);
      if (pendingQuestion?.clarifies_question_id) {
        clarificationAsked.add(pendingQuestion.clarifies_question_id);
      }
    } else if (message.role === "user") {
      const turn = { questionId: null, content: message.content, isClarification: false };
      if (pendingQuestion) {
        turn.questionId = pendingQuestion.clarifies_question_id || pendingQuestion.id;
        turn.isClarification = Boolean(pendingQuestion.clarifies_question_id);
        responses.push(turn);
        answers.set(turn.questionId, message.content);
        pendingQuestion = null;
      }
      userTurns.push(turn);
    }
  }

  return { answers, responses, userTurns, clarificationAsked };
}

function isYesNoAnswer(text) {
  if (UNKNOWN_ANSWER.test(text)) return false;
  const normalized = normalizeText(text);
  return /^(?:yes|yeah|yep|no|nope|neither|none|haan|han|nahi|bilkul nahi)\b/i.test(normalized);
}

function classifyYesNo(text) {
  if (UNKNOWN_ANSWER.test(text)) return null;
  const normalized = normalizeText(text);
  const yes = /\b(?:yes|yeah|yep|haan|han|bilkul)\b/i.test(normalized);
  const no = /\b(?:no|nope|neither|none|nahi|nahin|nhi)\b/i.test(normalized);
  if (yes && no) return "conflict";
  if (yes) return "yes";
  if (no) return "no";
  return null;
}

function classifySeverity(text) {
  if (UNKNOWN_ANSWER.test(text)) return null;
  const normalized = normalizeText(text);
  const severe = /\b(?:severe|very severe|worsening|getting worse|worst|intense|bahut tez|bohot tez|badh raha|badh rahi)\b/i.test(normalized);
  const explicitlyNotSevere = /\b(?:not|isn['’]?t|isnt|no longer|nahi|nahin|nhi)\b.{0,18}\b(?:very\s+)?(?:severe|intense|tez)\b|\b(?:severe|intense|tez)\b.{0,18}\b(?:nahi|nahin|nhi|not)\b/i.test(normalized);
  const numericSeverity = normalized.match(/\b(\d{1,2})\s*(?:\/\s*10|out of 10)\b/i);
  if (numericSeverity) {
    const score = Number(numericSeverity[1]);
    if (score <= 6) return "not_severe";
    if (score >= 7) return "severe";
  }
  const mildOrModerate = /\b(?:mild|moderate|manageable|halka|halki|madhyam|fine|okay|ok|improved|better|resolved|gone)\b/i.test(normalized);
  const notSevere = explicitlyNotSevere || mildOrModerate;
  if (severe && notSevere && !explicitlyNotSevere) return "conflict";
  if (severe && explicitlyNotSevere && /\b(?:but|however|lekin|par)\b/i.test(normalized)) return "conflict";
  if (severe && !explicitlyNotSevere) return "severe";
  if (notSevere) return "not_severe";
  return null;
}

function classifyCriticalAnswer(questionId, text) {
  if (questionId === "symptom_duration") {
    if (UNKNOWN_ANSWER.test(text)) return null;
    const duration = extractDuration(text);
    if (!duration) return null;
    const normalized = normalizeText(duration);
    const fixedDurations = { today: 0, yesterday: 24, "1 week": 168 };
    if (Object.hasOwn(fixedDurations, normalized)) return `duration:${fixedDurations[normalized]}`;
    const match = normalized.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|few|several)\s*(hours?|days?|weeks?|months?)\b/i);
    if (!match) return null;
    const numbers = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, few: 3, several: 4 };
    const amount = Number(match[1]) || numbers[match[1].toLowerCase()];
    const unit = match[2].toLowerCase();
    const hours = unit.startsWith("hour") ? amount : unit.startsWith("day") ? amount * 24 : unit.startsWith("week") ? amount * 168 : amount * 720;
    return `duration:${hours}`;
  }
  if (questionId === "breathing_or_chest_check" || questionId === "headache_warning_signs") {
    return classifyYesNo(text);
  }
  if (questionId === "headache_severity" || questionId === "symptom_severity") {
    return classifySeverity(text);
  }
  if (questionId === "fever_severity") {
    if (UNKNOWN_ANSWER.test(text)) return null;
    const normalized = normalizeText(text);
    const high = /\b(?:high|very high|severe|shivering|chills|chilled|102|103|104)\b/i.test(normalized);
    const low = /\b(?:mild|no fever|not high|halka|halki|thand nahi)\b/i.test(normalized);
    if (high && low) return "conflict";
    if (high) return "high";
    if (low) return "low";
  }
  return null;
}

function questionForSymptom(symptom) {
  if (symptom === "headache") return "headache_severity";
  if (symptom === "fever") return "fever_severity";
  return "symptom_severity";
}

function symptomIsDenied(text, symptom) {
  const normalized = normalizeText(text);
  const terms = {
    headache: "(?:headache|head\\s*pain|sar\\s*dard)",
    fever: "(?:fever|bukhar|tap)",
    cough: "(?:cough|khansi)",
    respiratory: "(?:breath(?:ing)?|saans)",
    chest: "(?:chest|seene|chhati)",
    vomiting: "(?:vomit(?:ing)?|ulti)",
    diarrhea: "(?:diarrhea|loose\\s*motion|dast)",
    wound_care: "(?:wound|chot|dressing|stitch)",
    weakness: "(?:weakness|kamzori|fatigue)",
    abdominal: "(?:stomach|abdominal|pet)",
    dizziness: "(?:dizziness|dizzy|chakkar)",
    skin: "(?:rash|itch(?:ing)?|khujli)",
    pain: "(?:pain|ache|dard)"
  }[symptom];
  if (!terms || UNKNOWN_ANSWER.test(normalized)) return false;
  const deniedBefore = new RegExp(`\\b(?:no|not|without|denies|don['’]?t have|do not have|doesn['’]?t have|nahi|nahin|nhi)\\b.{0,24}\\b${terms}\\b`, "i");
  const deniedAfter = new RegExp(`\\b${terms}\\b.{0,20}\\b(?:not present|not there|gone|resolved|absent|nahi|nahin|nhi|nahi hai|nahin hai)\\b`, "i");
  return deniedBefore.test(normalized) || deniedAfter.test(normalized);
}

function getAnswerContradiction(questionId, responses) {
  const relevant = responses.filter((response) => response.questionId === questionId);
  const lastClarification = relevant.reduce(
    (lastIndex, response, index) => response.isClarification ? index : lastIndex,
    -1
  );
  const answers = relevant.slice(lastClarification < 0 ? 0 : lastClarification);
  const classifications = answers
    .map((response) => classifyCriticalAnswer(questionId, response.content))
    .filter(Boolean);
  if (classifications.includes("conflict")) return true;
  return new Set(classifications).size > 1;
}

function getSeverityContradictions(userTurns, symptoms) {
  const severityIds = ["headache_severity", "fever_severity", "symptom_severity"];
  const clarificationIndex = new Map();
  userTurns.forEach((turn, index) => {
    if (turn.isClarification && severityIds.includes(turn.questionId)) {
      clarificationIndex.set(turn.questionId, index);
    }
  });
  const contradictions = [];
  for (const symptom of symptoms) {
    const questionId = questionForSymptom(symptom);
    const lastClarificationIndex = clarificationIndex.get(questionId) ?? -1;
    const signals = [];
    userTurns.forEach((turn, index) => {
      if (index <= lastClarificationIndex) return;
      const isTargetedSeverityAnswer = turn.questionId === questionId;
      const mentionsSymptom = symptom === "headache"
        ? /\b(?:headache|head\s*pain|sar\s*dard)\b/i.test(normalizeText(turn.content))
        : symptom === "fever"
          ? /\b(?:fever|bukhar|tap)\b/i.test(normalizeText(turn.content))
          : extractSymptoms(turn.content).some((item) => symptoms.includes(item));
      if (!isTargetedSeverityAnswer && !mentionsSymptom) return;
      const signal = symptomIsDenied(turn.content, symptom)
        ? "absent"
        : symptom === "fever"
          ? classifyCriticalAnswer("fever_severity", turn.content)
          : classifySeverity(turn.content);
      if (signal && signal !== "conflict") signals.push(signal);
      if (signal === "conflict") signals.push(signal);
    });
    if (signals.includes("conflict") || new Set(signals).size > 1) {
      contradictions.push(questionId);
    }
  }
  return contradictions;
}

function hasDurationContradiction(userTurns) {
  const lastClarificationIndex = userTurns.reduce(
    (lastIndex, turn, index) => turn.isClarification && turn.questionId === "symptom_duration"
      ? index
      : lastIndex,
    -1
  );
  const durations = userTurns
    .filter((turn, index) => index > lastClarificationIndex
      && (turn.questionId === "symptom_duration" || hasDuration(turn.content)))
    .map((turn) => classifyCriticalAnswer("symptom_duration", turn.content))
    .filter(Boolean);
  return new Set(durations).size > 1;
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
  if (answer !== undefined && UNKNOWN_ANSWER.test(answer)) return false;
  switch (questionId) {
    case "symptom_duration":
      return answer !== undefined ? hasDuration(answer) : hasDuration(context);
    case "breathing_or_chest_check":
      return answer !== undefined
        ? classifyYesNo(answer) !== null
        : hasExplicitBreathingOrChestStatus(context);
    case "headache_warning_signs":
      return answer !== undefined
        ? classifyYesNo(answer) !== null
        : hasHeadacheWarningAnswer(context);
    case "headache_severity":
      return answer !== undefined
        ? classifySeverity(answer) !== null
        : hasSymptomSeverity(context, "headache");
    case "fever_severity":
      return answer !== undefined ? hasFeverSeverity(answer) : hasFeverSeverity(context);
    case "symptom_severity":
      return answer !== undefined ? classifySeverity(answer) !== null : hasSymptomSeverity(context);
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
  const askedQuestionIds = new Set();
  for (const message of priorQuestionMessages) {
    const question = identifyQuestion(message.content);
    if (question) {
      askedQuestionIds.add(question.id);
      if (question.clarifies_question_id) askedQuestionIds.add(question.clarifies_question_id);
    }
  }
  const { answers: questionAnswers, responses, userTurns, clarificationAsked } = collectQuestionAnswers(history, user_input);
  const questionsAskedCount = priorQuestionMessages.length;

  const symptoms = extractSymptoms(normalizedFull);
  const patient = extractPatientProxy(normalizedFull);
  const duration = extractDuration(normalizedFull);
  const requirements = getRequiredQuestionIds(symptoms);
  const unmetRequirements = requirements.filter((questionId) =>
    !isQuestionRequirementMet(questionId, normalizedFull, questionAnswers.get(questionId))
  );
  const contradictions = [
    ...requirements.filter((questionId) => getAnswerContradiction(questionId, responses)),
    ...getSeverityContradictions(userTurns, symptoms),
    ...(hasDurationContradiction(userTurns) ? ["symptom_duration"] : [])
  ].filter((questionId, index, all) => all.indexOf(questionId) === index);

  let followUpQuestion = null;
  let unresolvedQuestion = false;
  if (!has_emergency_red_flag && contradictions.length > 0) {
    const clarificationId = CLARIFICATION_QUESTIONS[contradictions[0]];
    const shouldClarify = clarificationId && !clarificationAsked.has(contradictions[0]);
    if (shouldClarify && questionsAskedCount < MAX_QUESTION_BUDGET) {
      followUpQuestion = selectLocalizedQuestion(QUESTIONS_BY_ID.get(clarificationId), detectedLang);
    } else {
      unresolvedQuestion = true;
    }
  } else if (!has_emergency_red_flag && unmetRequirements.length > 0) {
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
    is_ready_for_triage: unmetRequirements.length === 0 && contradictions.length === 0,
    has_unresolved_question: unresolvedQuestion,
    affirmative_headache_warning: symptoms.includes("headache")
      && responses.some((response) => response.questionId === "headache_warning_signs"
        && classifyYesNo(response.content) === "yes"),
    affirmative_breathing_or_chest_check: responses.some((response) =>
      response.questionId === "breathing_or_chest_check" && classifyYesNo(response.content) === "yes")
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
