export type CaregiverSlot = {
  slot_id: string
  date: string | null
  time: string
  end_time?: string
  status: string
  is_booked?: boolean
}

export type Caregiver = {
  caregiver_id: string
  name: string
  role: string
  qualification?: string
  skills: string[]
  location: { lat: number; lng: number; address?: string }
  service_radius_km?: number
  availability_slots: CaregiverSlot[]
  languages: string[]
  rating: number
  experience_years?: number
  tier?: string | null
  active: boolean
}

export type CaregiverMatch = {
  caregiver_id: string
  score: number
  reason: string
}

export type TriageRequest = {
  user_input: string
  language?: 'auto' | 'hindi' | 'english' | 'hinglish'
  location?: { lat: number; lng: number } | null
  conversation_history?: Array<{ role: string; content: string; is_question?: boolean }>
}

export type EmergencyAction = {
  call?: string
  ambulance?: string
  guidance?: string
  steps?: string[]
  primary_number?: string
  ambulance_number?: string
  instructions?: string[]
}

export type TriageDecision = {
  follow_up_question: string | null
  care_type: string | null
  urgency: string | null
  red_flags: string[]
  reasoning: string
  matched_caregivers: CaregiverMatch[]
  emergency_action?: EmergencyAction
}

export type UiTriageResponse = {
  success: true
  decision: TriageDecision
  trace: { [key: string]: unknown; latency_ms?: number; branch?: string; confidence?: number }
}

export type BookingResponse = {
  success: true
  booking: {
    booking_id: string
    caregiver_id: string
    caregiver_name: string
    slot_id: string
    slot_time: string
    patient_name: string
    status: string
    booked_at: string
  }
  notice: string
}

export type AuthUser = {
  phone: string
  profile_complete: boolean
  full_name: string
  city: string
  area: string
  pincode: string
  location: { lat: number; lng: number } | null
}

export type OtpRequestResponse = {
  success: true
  delivery_mode: 'sms' | 'development'
  development_otp?: string
  message: string
}

export type BookingHistoryItem = {
  booking_id: string
  caregiver_id: string
  caregiver_name: string
  service: string
  slot_time: string
  status: string
  booked_at: string
}

export type EscalationResponse = {
  success: true
  emergency: true
  care_type: 'emergency_referral'
  urgency: 'immediate'
  red_flags: string[]
  emergency_action: EmergencyAction
  patient_location: { lat?: number; lng?: number } | null
  message: string
}

type ApiErrorBody = {
  error?: { code?: string; message?: string; details?: Array<{ field: string; message: string }> }
}

export class CuraApiError extends Error {
  status: number
  code: string
  details?: ApiErrorBody['error']

  constructor(message: string, status: number, code: string, details?: ApiErrorBody['error']) {
    super(message)
    this.name = 'CuraApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export const CURA_API_BASE_URL = (process.env.NEXT_PUBLIC_CURA_API_URL || (process.env.NODE_ENV === 'development' ? 'http://localhost:5001' : '')).replace(/\/$/, '')

const HEALTH_CONTEXT_PATTERNS = [
  /\b(?:symptom|health|medical|ill|unwell|sick|pain|ache|fever|temperature|cough|cold|breath(?:ing)?|dizz(?:y|iness)|nausea|vomit(?:ing)?|diarrh(?:ea)?|bleed(?:ing)?|rash|weakness|fatigue|tired|numb(?:ness)?|swelling|wound|injur(?:y|ed)|cut|burn|itch(?:ing)?|sore throat|headache|migraine|chest|stomach|abdom(?:en|inal)|back pain|toothache|palpitation|seizure|convulsion|stroke|paralysis|paralysed|unresponsive|collapsed|faint(?:ed|ing)?|unconscious|allerg(?:y|ic)|anaphylaxis|throat closing|shortness of breath|trouble breathing|difficulty breathing|unable to breathe|cannot breathe|facial droop|slurred speech|cramp|constipat(?:ion|ed)|urinat(?:e|ion)|infection|discomfort)\b/i,
  /\b(?:bukhar|khansi|saans|dard|sar dard|sir dard|chakkar|ulti|dast|pet|kamzori|thakan|jalan|sujan|chot|behosh|khujli|zukam|tabiyat|takleef|ghabrahat|sunn|khoon|lakwa|daura|mirgi|jhatke|bol nahi pa|saans nahi le pa|dam ghut)\b/i,
  /(?:दर्द|बुखार|खांसी|खाँसी|सांस|श्वास|चक्कर|उल्टी|दस्त|कमज़ोरी|कमजोरी|थकान|जलन|सूजन|चोट|बेहोश|मूर्छित|खुजली|जुकाम|तबीयत|तकलीफ|तकलीफ़|खून|रक्तस्राव|सिरदर्द|सिर दर्द|पेट|लकवा|दौरा|मिर्गी|झटके|बेहोशी|सांस नहीं ले पा|दम घुट)/,
  /\b(?:not feeling well|feel(?:ing)? unwell|health concern|medical concern|having trouble|having difficulty|problem with my|problem with his|problem with her|tabiyat (?:theek nahi|kharab)|theek nahi lag)\b/i,
]
const INFORMATION_REQUEST_PATTERN = /^\s*(?:what(?:\s+is|'s)?|why|how(?:\s+(?:do|can|should|to|does|is))?|can you|could you|tell me|define|explain)\b/i
const PERSONAL_CONCERN_PATTERN = /\b(?:i|i'm|i am|my|we|our|he|she|they|mother|father|mom|dad|papa|mummy|patient|someone|my child|my son|my daughter)\b|मुझे|मेरे|मेरी|मेरा|पापा|माँ|माता|पिता|मरीज|बच्चा/i

export function isHealthConcern(text: string) {
  const normalized = text.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '').toLowerCase().trim()
  if (!normalized || /^[\s\d\p{P}\p{S}]+$/u.test(normalized) || /^\d+(?:\s*[+*/=.-]\s*\d+)+$/.test(normalized)) return false
  if (normalized.includes('?') && !PERSONAL_CONCERN_PATTERN.test(normalized)) return false
  if (INFORMATION_REQUEST_PATTERN.test(normalized) && !PERSONAL_CONCERN_PATTERN.test(normalized)) return false
  return HEALTH_CONTEXT_PATTERNS.some((pattern) => pattern.test(normalized))
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!CURA_API_BASE_URL) {
    throw new CuraApiError('The care service URL is not configured for this deployment.', 0, 'API_URL_NOT_CONFIGURED')
  }

  let response: Response
  try {
    response = await fetch(`${CURA_API_BASE_URL}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    })
  } catch {
    throw new CuraApiError('Cura is unable to reach the care service. Check that the backend is running and try again.', 0, 'NETWORK_ERROR')
  }

  const body = await response.json().catch(() => null) as (T & ApiErrorBody) | null
  if (!response.ok) {
    throw new CuraApiError(
      body?.error?.message || `Care service request failed (${response.status}).`,
      response.status,
      body?.error?.code || 'REQUEST_FAILED',
      body?.error,
    )
  }
  if (body === null) throw new CuraApiError('Care service returned an invalid response.', response.status, 'INVALID_RESPONSE')
  return body
}

export function getHealth() {
  return request<{ success: true; service: string; status: string; timestamp: string }>('/api/health')
}

export function triage(requestBody: TriageRequest) {
  return request<TriageDecision>('/api/triage', { method: 'POST', body: JSON.stringify(requestBody) })
}

export function uiTriage(requestBody: TriageRequest) {
  return request<UiTriageResponse>('/api/ui/triage', { method: 'POST', body: JSON.stringify(requestBody) })
}

export function getCaregivers(filters: { role?: string; language?: string } = {}) {
  const query = new URLSearchParams()
  if (filters.role) query.set('role', filters.role)
  if (filters.language) query.set('language', filters.language)
  const suffix = query.size ? `?${query.toString()}` : ''
  return request<{ success: true; count: number; caregivers: Caregiver[] }>(`/api/caregivers${suffix}`)
}

export function getCaregiver(caregiverId: string) {
  return request<{ success: true; caregiver: Caregiver }>(`/api/caregivers/${encodeURIComponent(caregiverId)}`)
}

export function createBooking(payload: { caregiver_id: string; slot_id: string; patient_name?: string; notes?: string }) {
  return request<BookingResponse>('/api/booking', { method: 'POST', body: JSON.stringify(payload) })
}

export function requestPhoneOtp(phone: string) {
  return request<OtpRequestResponse>('/api/auth/otp/request', { method: 'POST', body: JSON.stringify({ phone }) })
}

export function verifyPhoneOtp(phone: string, code: string) {
  return request<{ success: true; user: AuthUser; message: string }>('/api/auth/otp/verify', { method: 'POST', body: JSON.stringify({ phone, code }) })
}

export function getCurrentUser() {
  return request<{ success: true; user: AuthUser | null }>('/api/auth/me')
}

export function updateUserProfile(profile: {
  full_name: string
  city: string
  area: string
  pincode: string
  location: { lat: number; lng: number } | null
}) {
  return request<{ success: true; user: AuthUser }>('/api/auth/profile', {
    method: 'PUT',
    body: JSON.stringify(profile),
  })
}

export function logout() {
  return request<{ success: true; message: string }>('/api/auth/logout', { method: 'POST' })
}

export function getMyBookings() {
  return request<{ success: true; bookings: BookingHistoryItem[] }>('/api/bookings/me')
}

export function escalateEmergency(payload: { red_flags?: string[]; patient_location?: { lat?: number; lng?: number }; notes?: string } = {}) {
  return request<EscalationResponse>('/api/emergency/escalate', { method: 'POST', body: JSON.stringify(payload) })
}
