/**
 * CURA Explainable Caregiver Matching Engine
 * Implements hard eligibility filtering, multi-factor ranking,
 * and transparent, evidence-based reasoning generation.
 */

const { CARE_ROLE_MAP, CARE_TYPES, URGENCIES } = require("../config/taxonomy");
const MATCHING_CONFIG = require("../config/matchingWeights");
const { calculateDistanceKm } = require("../utils/distance");
const caregiverDataService = require("./caregiverData.service");
const bookingService = require("./booking.service");

/**
 * Matches caregivers based on care type, urgency, location, and language
 * @param {object} params
 * @param {string} params.care_type - e.g. 'paramedic_home_visit', 'nurse_visit', 'gp_teleconsult'
 * @param {string} params.urgency - 'routine', 'same_day', 'immediate'
 * @param {object} [params.user_location] - { lat, lng }
 * @param {string} [params.language] - 'hindi', 'english', 'hinglish', 'auto'
 * @param {string[]} [params.required_skills] - optional required skill tags
 * @returns {Array<object>} Ranked caregiver recommendations with reasons
 */
function matchCaregivers({ care_type, urgency, user_location, language = "auto", required_skills = [] }) {
  // CRITICAL RULE: Emergency cases MUST NEVER receive routine caregiver matching
  if (care_type === CARE_TYPES.EMERGENCY_REFERRAL || urgency === URGENCIES.IMMEDIATE) {
    return [];
  }

  // 1. Identify eligible roles for the requested care type
  const eligibleRoles = CARE_ROLE_MAP[care_type] || [];
  if (eligibleRoles.length === 0) {
    return [];
  }

  const isTeleconsult = care_type === CARE_TYPES.GP_TELECONSULT;
  const hasLocation = user_location !== undefined && user_location !== null;
  const validUserLocation = Number.isFinite(user_location?.lat) && user_location.lat >= -90 && user_location.lat <= 90 &&
    Number.isFinite(user_location?.lng) && user_location.lng >= -180 && user_location.lng <= 180;
  if (!isTeleconsult && hasLocation && !validUserLocation) return [];

  const allCaregivers = caregiverDataService.getAll();
  const eligibleCandidates = [];

  // 2. Apply Hard Filters (never relaxed)
  for (const cg of allCaregivers) {
    if (cg.active === false) continue;

    const caregiverLat = cg.location?.lat;
    const caregiverLng = cg.location?.lng;
    if (!isTeleconsult) {
      if (!Number.isFinite(caregiverLat) || caregiverLat < -90 || caregiverLat > 90 ||
          !Number.isFinite(caregiverLng) || caregiverLng < -180 || caregiverLng > 180) {
        continue;
      }
    }

    // Hard Filter 1: Role Compatibility
    const roleMatches = eligibleRoles.some((r) => r.toLowerCase() === (cg.role || "").toLowerCase());
    if (!roleMatches) {
      continue;
    }

    // Hard Filter 2: Free Slot in Urgency Window (minus booked slots)
    const availableSlots = (cg.availability_slots || []).filter(
      (slot) => slot.status === "available" && bookingService.isSlotAvailable(slot.slot_id)
    );
    availableSlots.sort((a, b) => {
      const dateA = a.date || "9999-12-31";
      const dateB = b.date || "9999-12-31";
      return dateA.localeCompare(dateB) || (a.time || "99:99").localeCompare(b.time || "99:99");
    });

    if (availableSlots.length === 0) {
      // Ineligible: No free slots
      continue;
    }

    // Hard Filter 3: Skill match (if specific skills strictly required)
    if (required_skills && required_skills.length > 0) {
      const hasAllSkills = required_skills.every((skill) => (cg.skills || []).includes(skill));
      if (!hasAllSkills) {
        continue;
      }
    }

    if (!isTeleconsult && validUserLocation) {
      const distance = calculateDistanceKm(user_location.lat, user_location.lng, caregiverLat, caregiverLng);
      const configuredRadius = cg.service_radius_km;
      if (!Number.isFinite(configuredRadius) || configuredRadius <= 0) continue;
      const maximumDistance = Math.min(MATCHING_CONFIG.DEFAULT_MAX_DISTANCE_KM, configuredRadius);
      if (distance === null || distance > maximumDistance) continue;
    }

    eligibleCandidates.push({
      caregiver: cg,
      availableSlots
    });
  }

  // If no caregivers pass hard filters, return an honest empty result
  if (eligibleCandidates.length === 0) {
    return [];
  }

  // 3. Compute Soft Multi-Criteria Factor Scores
  const scoredCandidates = eligibleCandidates.map(({ caregiver, availableSlots }) => {
    // a. Role / Skill Fit (0 to 1.0)
    const f_role = 1.0;

    // b. Availability Factor: Earliest slot
    const earliestSlot = availableSlots[0];
    const isSameDaySlot = earliestSlot.date === new Date().toISOString().split("T")[0];
    const f_avail = urgency === URGENCIES.SAME_DAY ? (isSameDaySlot ? 1.0 : 0.6) : 0.9;

    // c. Distance Factor
    let distanceKm = null;
    let f_dist = 1.0;

    if (!isTeleconsult && validUserLocation) {
      distanceKm = calculateDistanceKm(user_location.lat, user_location.lng, caregiver.location.lat, caregiver.location.lng);
      if (distanceKm !== null) {
        // Haversine km -> 1 / (1 + d / d0)
        f_dist = 1.0 / (1.0 + distanceKm / MATCHING_CONFIG.DISTANCE_SCALE_KM);
      }
    } else if (isTeleconsult) {
      f_dist = 1.0; // Distance does not penalize teleconsultations
    } else {
      f_dist = 0.7; // Location not provided
    }

    // d. Language Match Factor
    const normalizedLang = (language || "auto").toLowerCase();
    const cgLangs = (caregiver.languages || []).map((l) => l.toLowerCase());
    let f_lang = 0.5;
    let speaksPreferred = false;

    if (normalizedLang === "hindi" || normalizedLang === "hinglish") {
      speaksPreferred = cgLangs.includes("hindi");
      f_lang = speaksPreferred ? 1.0 : 0.4;
    } else if (normalizedLang === "english") {
      speaksPreferred = cgLangs.includes("english");
      f_lang = speaksPreferred ? 1.0 : 0.4;
    } else {
      // Auto: if speaks Hindi or English, full credit
      speaksPreferred = cgLangs.includes("hindi") || cgLangs.includes("english");
      f_lang = speaksPreferred ? 1.0 : 0.7;
    }

    // e. Rating Factor (Normalised to 1.0)
    const f_rating = caregiver.rating ? Math.min(1.0, caregiver.rating / 5.0) : 0.7;

    // Composite Weighted Ranking Score
    const W = MATCHING_CONFIG.WEIGHTS;
    const rawScore =
      W.ROLE_SKILL_FIT * f_role +
      W.AVAILABILITY * f_avail +
      W.DISTANCE * f_dist +
      W.LANGUAGE * f_lang +
      W.RATING * f_rating;

    const finalScore = Math.round(rawScore * 100) / 100;

    // 4. Generate Grounded, Explainable Reasons
    const reasonParts = [];
    if (speaksPreferred) {
      const langName = normalizedLang === "english" ? "English" : "Hindi";
      reasonParts.push(`${langName}-speaking`);
    } else if (normalizedLang === "hindi" || normalizedLang === "hinglish" || normalizedLang === "english") {
      reasonParts.push(`No ${normalizedLang === "hinglish" ? "Hindi" : normalizedLang} language match`);
    }

    if (distanceKm !== null && !isTeleconsult) {
      reasonParts.push(`${distanceKm} km away`);
    } else if (isTeleconsult) {
      reasonParts.push("available for video/phone teleconsult");
    }

    if (earliestSlot) {
      reasonParts.push(`free at ${earliestSlot.time}`);
      if (earliestSlot.end_time) reasonParts.push(`available until ${earliestSlot.end_time}`);
    }

    const reason = reasonParts.join(", ");

    return {
      caregiver_id: caregiver.caregiver_id,
      name: caregiver.name,
      role: caregiver.role,
      score: finalScore,
      distance_km: distanceKm,
      earliest_slot: earliestSlot,
      languages: caregiver.languages,
      rating: caregiver.rating,
      reason
    };
  });

  const eligibleByScore = scoredCandidates.filter((candidate) => candidate.score >= MATCHING_CONFIG.MIN_MATCH_SCORE);

  // 5. Sort by score descending; tie-break by earliest slot, then caregiver_id
  eligibleByScore.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    const timeA = a.earliest_slot?.time || "99:99";
    const timeB = b.earliest_slot?.time || "99:99";
    if (timeA !== timeB) {
      return timeA.localeCompare(timeB);
    }
    return a.caregiver_id.localeCompare(b.caregiver_id);
  });

  // Return Top K recommendations
  return eligibleByScore.slice(0, MATCHING_CONFIG.MAX_RECOMMENDATIONS);
}

module.exports = {
  matchCaregivers
};
