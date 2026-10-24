/**
 * CURA Caregiver Matching Weights and Parameters
 * Based on CAI Strategy Document §10.2 and §10.3
 */

const MATCHING_CONFIG = {
  WEIGHTS: {
    ROLE_SKILL_FIT: 0.35,
    AVAILABILITY: 0.25,
    DISTANCE: 0.20,
    LANGUAGE: 0.10,
    RATING: 0.10
  },
  DISTANCE_SCALE_KM: 5.0, // d0 in 1 / (1 + d/d0)
  DEFAULT_MAX_DISTANCE_KM: 15.0, // Default search radius for in-person/home visits
  MAX_RECOMMENDATIONS: 3, // Top K caregivers to return
  MIN_MATCH_SCORE: 0.30 // Floor score below which match is rejected
};

module.exports = MATCHING_CONFIG;
