const { normalizeText } = require("./textNormalizer");

const HEALTH_CONTEXT_PATTERNS = [
  /\b(?:symptom|health|medical|ill|unwell|sick|pain|ache|fever|temperature|cough|cold|breath(?:ing)?|dizz(?:y|iness)|nausea|vomit(?:ing)?|diarrh(?:ea)?|bleed(?:ing)?|rash|weakness|fatigue|tired|numb(?:ness)?|swelling|wound|injur(?:y|ed)|cut|burn|itch(?:ing)?|sore throat|headache|migraine|chest|stomach|abdom(?:en|inal)|back pain|toothache|palpitation|seizure|convulsion|stroke|paralysis|paralysed|unresponsive|collapsed|faint(?:ed|ing)?|unconscious|allerg(?:y|ic)|anaphylaxis|throat closing|shortness of breath|trouble breathing|difficulty breathing|unable to breathe|cannot breathe|facial droop|slurred speech|cramp|constipat(?:ion|ed)|urinat(?:e|ion)|infection|discomfort)\b/i,
  /\b(?:bukhar|khansi|saans|dard|sar dard|sir dard|chakkar|ulti|dast|pet|kamzori|thakan|jalan|sujan|chot|behosh|khujli|zukam|tabiyat|takleef|ghabrahat|sunn|khoon|lakwa|daura|mirgi|jhatke|bol nahi pa|saans nahi le pa|dam ghut)\b/i,
  /(?:दर्द|बुखार|खांसी|खाँसी|सांस|श्वास|चक्कर|उल्टी|दस्त|कमज़ोरी|कमजोरी|थकान|जलन|सूजन|चोट|बेहोश|मूर्छित|खुजली|जुकाम|तबीयत|तकलीफ|तकलीफ़|खून|रक्तस्राव|सिरदर्द|सिर दर्द|पेट|लकवा|दौरा|मिर्गी|झटके|बेहोशी|सांस नहीं ले पा|दम घुट)/,
  /\b(?:not feeling well|feel(?:ing)? unwell|health concern|medical concern|having trouble|having difficulty|problem with my|problem with his|problem with her|tabiyat (?:theek nahi|kharab)|theek nahi lag)\b/i
];

const INVALID_ONLY_PATTERNS = [
  /^[\s\d\p{P}\p{S}]+$/u,
  /^\s*\d+(?:\s*[+*/=.-]\s*\d+)+\s*$/u
];
const INFORMATION_REQUEST_PATTERN = /^\s*(?:what(?:\s+is|'s)?|why|how(?:\s+(?:do|can|should|to|does|is))?|can you|could you|tell me|define|explain)\b/i;
const PERSONAL_CONCERN_PATTERN = /\b(?:i|i'm|i am|my|we|our|he|she|they|mother|father|mom|dad|papa|mummy|patient|someone|my child|my son|my daughter)\b|मुझे|मेरे|मेरी|मेरा|पापा|माँ|माता|पिता|मरीज|बच्चा/i;

function isHealthConcern(text) {
  if (typeof text !== "string") return false;
  const normalized = normalizeText(text);
  if (!normalized || INVALID_ONLY_PATTERNS.some((pattern) => pattern.test(normalized))) return false;
  if (normalized.includes("?") && !PERSONAL_CONCERN_PATTERN.test(normalized)) return false;
  if (INFORMATION_REQUEST_PATTERN.test(normalized) && !PERSONAL_CONCERN_PATTERN.test(normalized)) return false;
  return HEALTH_CONTEXT_PATTERNS.some((pattern) => pattern.test(normalized));
}

function hasHealthConcernInConversation(userInput, conversationHistory = []) {
  const userTexts = (conversationHistory || [])
    .filter((message) => message && message.role === "user" && typeof message.content === "string")
    .map((message) => message.content);
  return isHealthConcern([ ...userTexts, userInput ].join(" "));
}

module.exports = { isHealthConcern, hasHealthConcernInConversation };