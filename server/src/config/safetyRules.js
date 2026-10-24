/**
 * CURA Emergency Safety Gate Rules & Patterns
 * Independent, deterministic safety layer for critical red-flag detection.
 * Supports English, Hindi (Devanagari), and Hinglish with negation and ability detection.
 */

const RED_FLAGS = [
  {
    id: "chest_pain",
    name: "Chest Pain / Cardiac Symptoms",
    patterns: [
      // English
      /\bchest\s*(?:pain|pressure|tightness|heaviness|crushing|squeezing)\b/i,
      /\bheart\s*(?:attack|arrest)\b/i,
      /\bpain\s*in\s*(?:my\s*)?chest\b/i,
      /\bangina\b/i,
      // Hinglish
      /\b(?:seene|sine|chhati|chati)\s*(?:me|mai|mein)\s*(?:(?:bohot|bahut|tez|zyada|jyada|halka|bada|asahanie)\s*)*(?:dard|takleef|jalan|dabav|bojh)\b/i,
      /\bchhati\s*phat\s*rahi\b/i,
      /\bdil\s*ka\s*daura\b/i,
      /\bdil\s*(?:me|mai)\s*(?:(?:bohot|bahut|tez|zyada|jyada)\s*)*dard\b/i,
      // Devanagari
      /सीने\s*में\s*(?:(?:बहुत|तेज़|तेज|काफी|असहनीय)\s*)?(?:दर्द|जलन|दबाव|भारीपन)/,
      /छाती\s*में\s*(?:(?:बहुत|तेज़|तेज|काफी|असहनीय)\s*)?(?:दर्द|जलन)/,
      /दिल\s*का\s*दौरा/
    ],
    reason: "Severe chest pain or cardiac distress reported"
  },
  {
    id: "severe_breathlessness",
    name: "Severe Respiratory Distress",
    patterns: [
      // English
      /\b(?:severe\s*)?(?:shortness\s*of\s*breath|difficulty\s*breathing|trouble\s*breathing)\b/i,
      /\b(?:gasping|choking|suffocating|cannot\s*breathe|unable\s*to\s*breathe)\b/i,
      /\bturning\s*blue\b/i,
      // Hinglish
      /\bsaans\s*(?:phool|fool)\s*rahi\b/i,
      /\bsaans\s*(?:lene\s*me|chadh)\s*(?:takleef|dikkat|pareshani)\b/i,
      /\bdam\s*ghut\s*raha\b/i,
      /\bsaans\s*atak\s*rahi\b/i,
      // Devanagari
      /सांस\s*(?:फूल\s*रही|लेने\s*में\s*तकलीफ|घुट\s*रहा)/,
      /दम\s*घुट\s*रहा/
    ],
    reason: "Acute respiratory distress or severe breathlessness reported"
  },
  {
    id: "unconsciousness_unresponsive",
    name: "Loss of Consciousness / Unresponsiveness",
    patterns: [
      // English
      /\b(?:unconscious|passed\s*out|blacked\s*out|fainted|unresponsive|collapsed)\b/i,
      /\bloss\s*of\s*consciousness\b/i,
      // Hinglish
      /\bbehosh\b/i,
      /\bchakkar\s*kha\s*kar\s*gir\b/i,
      /\bsudh\s*budh\s*kho\b/i,
      /\baankh\s*nahi\s*khol\s*raha\b/i,
      // Devanagari
      /बेहोश/,
      /मूर्छित/,
      /चक्कर\s*खाकर\s*गिर/
    ],
    reason: "Unresponsiveness or loss of consciousness reported"
  },
  {
    id: "severe_bleeding",
    name: "Severe Hemorrhage / Uncontrolled Bleeding",
    patterns: [
      // English
      /\b(?:severe|heavy|uncontrolled|profuse)\s*bleeding\b/i,
      /\bcoughing\s*up\s*blood\b/i,
      /\bvomiting\s*blood\b/i,
      // Hinglish
      /\bkhoon\s*(?:ki\s*ulti|beh\s*raha|nikal\s*raha)\b/i,
      /\bbahut\s*(?:jyada|zyada)\s*khoon\b/i,
      // Devanagari
      /खून\s*(?:की\s*उल्टी|बह\s*रहा)/,
      /अत्यधिक\s*रक्तस्राव/
    ],
    reason: "Severe or uncontrolled bleeding reported"
  },
  {
    id: "stroke_symptoms",
    name: "Neurological Deficit / Stroke Indicators",
    patterns: [
      // English
      /\b(?:stroke|facial\s*droop|slurred\s*speech|sudden\s*numbness|sudden\s*paralysis)\b/i,
      /\bweakness\s*on\s*one\s*side\b/i,
      // Hinglish
      /\blakwa\b/i,
      /\bmuh\s*tedha\b/i,
      /\bbol\s*nahi\s*pa\s*rah[aei]\b/i,
      /\bek\s*taraf\s*(?:kamzori|sunn)\b/i,
      // Devanagari
      /लकवा/,
      /पक्षाघात/,
      /मुंह\s*टेढ़ा/
    ],
    reason: "Signs consistent with acute neurological deficit or stroke"
  },
  {
    id: "seizures_convulsions",
    name: "Seizures / Convulsions",
    patterns: [
      // English
      /\b(?:seizure|convulsions|epileptic\s*fit)\b/i,
      // Hinglish
      /\b(?:daura|daure|mirgi|jhatke)\b/i,
      // Devanagari
      /दौरा/,
      /मिर्गी/,
      /झटके\s*आना/
    ],
    reason: "Active convulsions or seizure reported"
  },
  {
    id: "severe_allergy_anaphylaxis",
    name: "Anaphylaxis / Severe Allergy",
    patterns: [
      // English
      /\b(?:anaphylaxis|throat\s*closing|swollen\s*throat|allergic\s*shock)\b/i,
      // Hinglish
      /\bgale\s*me\s*sujan.*saans\b/i,
      /\bhoth\s*aur\s*gala\s*sooj\b/i,
      // Devanagari
      /गले\s*में\s*सूजन.*सांस/
    ],
    reason: "Signs of severe allergic reaction or airway compromise"
  }
];

/**
 * Standard negation tokens
 */
const NEGATION_PATTERNS = {
  // Negators that precede symptoms (typical in English: "no chest pain")
  PRECEDING: /\b(?:no|not|without|denies|negative\s*for|never\s*had)\b/i,
  // Negators that follow or surround symptoms (typical in Hindi/Hinglish: "dard nahi hai")
  FOLLOWING_OR_GENERAL: /\b(?:nahi|nahin|nhi|na|bina|koi\s*(?:bhi)?\s*(?:nahi|nahin|nhi))\b/i,
  // Devanagari negation
  DEVANAGARI: /(?:नहीं|ना|बिना|कोई\s*नहीं)/
};

/**
 * Inverse-Negation Patterns: Inability expressions where "nahi" indicates a severe symptom rather than absence.
 * E.g., "saans nahi le pa raha" = CANNOT BREATHE -> Critical Emergency!
 */
const INVERSE_NEGATION_PATTERNS = [
  {
    flag_id: "severe_breathlessness",
    pattern: /\bsaans\s*(?:nahi|nahin|nhi|ni)\s*(?:le\s*pa\s*rah[aei]|aa\s*rah[aei])\b/i,
    devanagari: /सांस\s*(?:नहीं|ना)\s*ले\s*पा\s*रह[ाेी]/,
    reason: "Patient reported inability to breathe (respiratory failure)"
  },
  {
    flag_id: "unconsciousness_unresponsive",
    pattern: /\bhosh\s*(?:me\s*)?(?:nahi|nahin|nhi)\s*(?:hai|tha)\b/i,
    devanagari: /होश\s*(?:में\s*)?(?:नहीं|ना)\s*(?:है|था)/,
    reason: "Patient is not conscious or unresponsive"
  },
  {
    flag_id: "stroke_symptoms",
    pattern: /\b(?:bol|baat)\s*(?:nahi|nahin|nhi)\s*pa\s*rah[aei]\b/i,
    devanagari: /बोल\s*(?:नहीं|ना)\s*पा\s*रह[ाेी]/,
    reason: "Patient unable to speak (speech impairment)"
  },
  {
    flag_id: "unconsciousness_unresponsive",
    pattern: /\baankh(?:ein)?\s*(?:nahi|nahin|nhi)\s*khol\s*rah[aei]\b/i,
    devanagari: /आंख(?:ें)?\s*(?:नहीं|ना)\s*खोल\s*रह[ाेी]/,
    reason: "Patient not opening eyes or responding"
  }
];

/**
 * Emergency contact and protocol details
 */
const EMERGENCY_PROTOCOL = {
  primary_number: "112",
  ambulance_number: "108",
  steps: [
    "Call 112 immediately for emergency medical assistance.",
    "Do not give any food or liquid if patient is having difficulty breathing or swallowing.",
    "Keep the patient in a comfortable position, loosen tight clothing, and stay with them.",
    "If available, arrange immediate transit to the nearest hospital emergency department."
  ]
};

module.exports = {
  RED_FLAGS,
  NEGATION_PATTERNS,
  INVERSE_NEGATION_PATTERNS,
  EMERGENCY_PROTOCOL
};
