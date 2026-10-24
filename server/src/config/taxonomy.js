/**
 * CURA / CareCompass Official Taxonomy Definitions
 * As defined in CAI Problem Statement (Page 1-4) and Strategy Document §10.1
 */

const CARE_TYPES = {
  PARAMEDIC_HOME_VISIT: "paramedic_home_visit",
  NURSE_VISIT: "nurse_visit",
  GP_TELECONSULT: "gp_teleconsult",
  SPECIALIST_CONSULT: "specialist_consult",
  EMERGENCY_REFERRAL: "emergency_referral"
};

const URGENCIES = {
  ROUTINE: "routine",
  SAME_DAY: "same_day",
  IMMEDIATE: "immediate"
};

const ALLOWED_CARE_TYPES = Object.values(CARE_TYPES);
const ALLOWED_URGENCIES = Object.values(URGENCIES);

/**
 * Mapping between care_type and eligible caregiver role in dataset
 */
const CARE_ROLE_MAP = {
  [CARE_TYPES.PARAMEDIC_HOME_VISIT]: ["paramedic"],
  [CARE_TYPES.NURSE_VISIT]: ["nurse"],
  [CARE_TYPES.GP_TELECONSULT]: ["gp", "general_physician", "doctor"],
  [CARE_TYPES.SPECIALIST_CONSULT]: ["specialist", "consultant"],
  [CARE_TYPES.EMERGENCY_REFERRAL]: [] // No routine caregivers for emergencies
};

module.exports = {
  CARE_TYPES,
  URGENCIES,
  ALLOWED_CARE_TYPES,
  ALLOWED_URGENCIES,
  CARE_ROLE_MAP
};
