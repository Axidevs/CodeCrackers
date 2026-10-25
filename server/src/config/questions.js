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
    id: "headache_warning_signs",
    category: "red_flag_check",
    text_en: "Did the headache start suddenly and severely, or come with new weakness, confusion, vision changes, or trouble speaking?",
    text_hi: "क्या सिरदर्द अचानक और बहुत तेज़ शुरू हुआ, या इसके साथ नई कमजोरी, भ्रम, नज़र में बदलाव या बोलने में परेशानी है?",
    text_hinglish: "Kya sir dard achanak aur bahut tez shuru hua, ya nayi kamzori, confusion, nazar me badlav ya bolne me dikkat hai?",
    options: ["No", "Yes"]
  },
  {
    id: "headache_severity",
    category: "severity",
    text_en: "How severe is the headache, from mild to severe or 0 to 10?",
    text_hi: "सिरदर्द कितना तेज़ है—हल्का, मध्यम, तेज़, या 0 से 10 तक?",
    text_hinglish: "Sir dard kitna tez hai—halka, medium, severe, ya 0 se 10 tak?",
    options: ["Mild", "Moderate", "Severe"]
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
  },
  {
    id: "symptom_severity",
    category: "severity",
    text_en: "How severe is the main symptom, and is it getting worse?",
    text_hi: "मुख्य लक्षण कितना गंभीर है, और क्या यह बढ़ रहा है?",
    text_hinglish: "Main symptom kitna severe hai, aur kya yeh badh raha hai?",
    options: ["Mild", "Moderate", "Severe", "Getting worse"]
  },
  {
    id: "symptom_duration_clarification",
    clarifies_question_id: "symptom_duration",
    category: "clarification",
    text_en: "You mentioned different symptom durations. How long have these symptoms been present?",
    text_hi: "आपने लक्षणों की अवधि के बारे में अलग जवाब दिए हैं। ये लक्षण कब से हैं?",
    text_hinglish: "Aapne symptom duration ke baare me alag jawab diye. Ye kab se hain?",
    options: ["Few hours", "1-2 days", "3-5 days", "More than a week", "Not sure"]
  },
  {
    id: "headache_severity_clarification",
    clarifies_question_id: "headache_severity",
    category: "clarification",
    text_en: "You described the headache as severe, but later said it was mild or no longer present. How is it now?",
    text_hi: "आपने सिरदर्द को तेज़ बताया, लेकिन बाद में हल्का या ठीक बताया। अभी यह कैसा है?",
    text_hinglish: "Aapne headache ko severe bataya, par baad me mild ya theek kaha. Abhi kaisa hai?",
    options: ["Mild", "Moderate", "Severe", "Not sure"]
  },
  {
    id: "symptom_severity_clarification",
    clarifies_question_id: "symptom_severity",
    category: "clarification",
    text_en: "You gave different answers about the main symptom's severity. How severe is it now?",
    text_hi: "आपने मुख्य लक्षण की गंभीरता के बारे में अलग-अलग जवाब दिए हैं। अभी यह कितना गंभीर है?",
    text_hinglish: "Aapne main symptom ki severity ke baare me alag jawab diye. Abhi yeh kitna severe hai?",
    options: ["Mild", "Moderate", "Severe", "Not sure"]
  },
  {
    id: "fever_severity_clarification",
    clarifies_question_id: "fever_severity",
    category: "clarification",
    text_en: "You gave different answers about the fever's severity. Is it high or mild now?",
    text_hi: "आपने बुखार की गंभीरता के बारे में अलग-अलग जवाब दिए हैं। अभी बुखार तेज़ है या हल्का?",
    text_hinglish: "Aapne fever ki severity ke baare me alag jawab diye. Abhi fever tez hai ya halka?",
    options: ["Mild", "High", "Not sure"]
  },
  {
    id: "headache_warning_clarification",
    clarifies_question_id: "headache_warning_signs",
    category: "clarification",
    text_en: "You gave different answers about sudden severe headache or new weakness, confusion, vision, or speech changes. Is any of these present?",
    text_hi: "आपने अचानक तेज़ सिरदर्द या नई कमजोरी, भ्रम, नज़र या बोलने में बदलाव के बारे में अलग जवाब दिए हैं। क्या इनमें से कुछ है?",
    text_hinglish: "Aapne achanak severe headache ya nayi weakness, confusion, vision ya speech change par alag jawab diye. Kya inme se kuch hai?",
    options: ["Yes", "No", "Not sure"]
  },
  {
    id: "breathing_or_chest_clarification",
    clarifies_question_id: "breathing_or_chest_check",
    category: "clarification",
    text_en: "You gave different answers about breathing difficulty or chest pain. Is either present now?",
    text_hi: "आपने सांस की तकलीफ या सीने के दर्द के बारे में अलग जवाब दिए हैं। क्या अभी इनमें से कुछ है?",
    text_hinglish: "Aapne saans ki takleef ya chest pain par alag jawab diye. Kya abhi inme se kuch hai?",
    options: ["Yes", "No", "Not sure"]
  }
];

module.exports = {
  QUESTION_BANK
};
