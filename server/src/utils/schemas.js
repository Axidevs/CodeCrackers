/**
 * CURA API Request and Response Schemas using Zod
 * Implements the official JSON schema as described in CAI Problem Statement (Page 4).
 */

const { z } = require("zod");
const { ALLOWED_CARE_TYPES, ALLOWED_URGENCIES } = require("../config/taxonomy");

/**
 * Schema for incoming POST /api/triage and POST /api/ui/triage requests
 */
const TriageRequestSchema = z.object({
  user_input: z
    .string({ required_error: "user_input is required" })
    .trim()
    .min(1, "user_input cannot be empty or whitespace only")
    .max(2000, "user_input exceeds maximum allowed length of 2000 characters"),
  language: z.enum(["auto", "hindi", "english", "hinglish"]).optional().default("auto"),
  location: z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180)
    })
    .optional()
    .nullable(),
  conversation_history: z
    .array(
      z.object({
        role: z.string(),
        content: z.string(),
        is_question: z.boolean().optional()
      })
    )
    .optional()
    .default([])
});

/**
 * Schema for demo booking POST /api/booking
 */
const BookingRequestSchema = z.object({
  caregiver_id: z.string({ required_error: "caregiver_id is required" }).min(1),
  slot_id: z.string({ required_error: "slot_id is required" }).min(1),
  caregiver_name: z.string().optional(),
  slot_time: z.string().optional(),
  patient_name: z.string().optional().default("Demo Patient"),
  notes: z.string().optional().default("Demo booking via CURA")
});

/**
 * Schema for emergency escalation POST /api/emergency/escalate
 */
const EmergencyEscalationSchema = z.object({
  red_flags: z.array(z.string()).optional().default([]),
  patient_location: z
    .object({
      lat: z.number().optional(),
      lng: z.number().optional()
    })
    .optional(),
  notes: z.string().optional()
});

module.exports = {
  TriageRequestSchema,
  BookingRequestSchema,
  EmergencyEscalationSchema
};
