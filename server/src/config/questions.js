/**
 * CURA Follow-up Disambiguation Question Bank
 * Provides multilingual (English, Hindi, Hinglish) targeted follow-ups with quick-reply options.
 */

const QUESTION_BANK = [
  {
    id: "breathing_or_chest_check",
    category: "red_flag_check",
    text_en: "Are you or the patient experiencing any breathing difficulty or chest pain?",
    text_hi: "क्या सांस लेने में कोई तकलीफ या सीने में दर्द महसूस हो रहा है?",
    text_hinglish: "Kya saans lene me koi takleef ya seene me dard ho raha hai?",
    options: ["No, neither", "Yes, breathing difficulty", "Yes, chest pain"]
  },
  {
    id: "symptom_duration",
    category: "duration",
    text_en: "How long have these symptoms been present?",
    text_hi: "यह लक्षण कितने समय से हैं?",
    text_hinglish: "Ye dikkat kitne samay se hai?",
    options: ["Few hours", "1-2 days", "3-5 days", "More than a week"]
  },
  {
    id: "fever_severity",
    category: "severity",
    text_en: "Is the fever very high (above 102°F) or accompanied by shivering?",
    text_hi: "क्या बुखार बहुत तेज़ है (102°F से अधिक) या कंपकंपी हो रही है?",
    text_hinglish: "Kya bukhar bohot tez hai (102°F se zyada) ya thand lag rahi hai?",
    options: ["Mild fever", "High fever", "Fever with chills", "No fever now"]
  },
  {
    id: "patient_mobility",
    category: "care_setting",
    text_en: "Can the patient comfortably travel to a clinic, or is a home visit needed?",
    text_hi: "क्या मरीज़ क्लिनिक जा सकते हैं या घर पर देखभाल की ज़रूरत है?",
    text_hinglish: "Kya patient clinic ja sakte hain ya ghar par visit chahiye?",
    options: ["Can travel to clinic", "Need home visit", "Online consult preferred"]
  }
];

module.exports = {
  QUESTION_BANK
};
