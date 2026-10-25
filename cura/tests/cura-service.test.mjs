import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const serviceUrl = pathToFileURL(path.join(import.meta.dirname, '../lib/cura-service.ts')).href
process.env.NEXT_PUBLIC_CURA_API_URL = 'http://cura.test'
const service = await import(serviceUrl)
const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

test('triage posts the actual API request and returns the official decision contract', async () => {
  let captured
  const decision = { follow_up_question: null, care_type: 'gp_teleconsult', urgency: 'routine', red_flags: [], reasoning: 'Backend reasoning', matched_caregivers: [] }
  globalThis.fetch = async (url, options) => {
    captured = { url, options }
    return Response.json(decision)
  }

  assert.deepEqual(await service.triage({ user_input: 'headache', language: 'english' }), decision)
  assert.equal(captured.url, `${service.CURA_API_BASE_URL}/api/triage`)
  assert.equal(captured.options.method, 'POST')
  assert.deepEqual(JSON.parse(captured.options.body), { user_input: 'headache', language: 'english' })
})

test('UI triage preserves its success, decision, and trace envelope', async () => {
  const body = { success: true, decision: { follow_up_question: 'How long?', care_type: null, urgency: null, red_flags: [], reasoning: '', matched_caregivers: [] }, trace: { branch: 'follow_up' } }
  globalThis.fetch = async () => Response.json(body)
  assert.deepEqual(await service.uiTriage({ user_input: 'fever' }), body)
})

test('caregiver list supports filters and empty results without fabricating entries', async () => {
  let capturedUrl
  globalThis.fetch = async (url) => {
    capturedUrl = String(url)
    return Response.json({ success: true, count: 0, caregivers: [] })
  }
  const result = await service.getCaregivers({ role: 'medic', language: 'Hindi' })
  assert.match(capturedUrl, /role=medic/)
  assert.match(capturedUrl, /language=Hindi/)
  assert.deepEqual(result.caregivers, [])
})

test('caregiver details, booking, and emergency escalation use the actual route contracts', async () => {
  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options })
    if (String(url).includes('/api/caregivers/')) return Response.json({ success: true, caregiver: { caregiver_id: 'CG_001' } })
    if (String(url).endsWith('/api/booking')) return Response.json({ success: true, booking: { booking_id: 'BK_1', status: 'confirmed' }, notice: 'confirmed' }, { status: 201 })
    return Response.json({ success: true, emergency: true, care_type: 'emergency_referral', urgency: 'immediate', red_flags: [], emergency_action: { primary_number: '112' }, patient_location: null, message: 'Contact emergency services immediately.' })
  }
  assert.equal((await service.getCaregiver('CG_001')).caregiver.caregiver_id, 'CG_001')
  const booking = await service.createBooking({ caregiver_id: 'CG_001', slot_id: 'CG_001_1000' })
  assert.equal(booking.booking.status, 'confirmed')
  assert.deepEqual(JSON.parse(calls[1].options.body), { caregiver_id: 'CG_001', slot_id: 'CG_001_1000' })
  assert.equal(calls[1].options.credentials, 'include')
  assert.equal((await service.escalateEmergency({ red_flags: ['chest_pain'] })).emergency, true)
  assert.equal(calls[2].url, `${service.CURA_API_BASE_URL}/api/emergency/escalate`)
})

test('phone authentication and booking history use cookie-backed API requests', async () => {
  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options })
    if (String(url).endsWith('/api/auth/otp/request')) return Response.json({ success: true, delivery_mode: 'development', development_otp: '821563', message: 'No SMS sent' })
    if (String(url).endsWith('/api/auth/otp/verify')) return Response.json({ success: true, user: { phone: '+919876543210' }, message: 'Verified' })
    if (String(url).endsWith('/api/auth/me')) return Response.json({ success: true, user: null })
    if (String(url).endsWith('/api/auth/profile')) return Response.json({ success: true, user: { phone: '+919876543210', profile_complete: true } })
    if (String(url).endsWith('/api/auth/logout')) return Response.json({ success: true, message: 'Signed out' })
    return Response.json({ success: true, bookings: [] })
  }

  const otp = await service.requestPhoneOtp('+919876543210')
  assert.equal(otp.delivery_mode, 'development')
  assert.equal((await service.verifyPhoneOtp('+919876543210', otp.development_otp)).user.phone, '+919876543210')
  assert.equal((await service.getCurrentUser()).user, null)
  const profile = { full_name: 'Anita Sharma', city: 'Delhi', area: 'Lajpat Nagar', pincode: '110024', location: null }
  assert.equal((await service.updateUserProfile(profile)).user.profile_complete, true)
  assert.deepEqual((await service.getMyBookings()).bookings, [])
  await service.logout()
  assert.deepEqual(calls.map(({ url }) => url.replace(service.CURA_API_BASE_URL, '')), [
    '/api/auth/otp/request',
    '/api/auth/otp/verify',
    '/api/auth/me',
    '/api/auth/profile',
    '/api/bookings/me',
    '/api/auth/logout',
  ])
  assert.ok(calls.every(({ options }) => options.credentials === 'include'))
  assert.equal(calls[3].options.method, 'PUT')
  assert.deepEqual(JSON.parse(calls[3].options.body), profile)
})

test('structured HTTP errors preserve status and code for conflicts and persistence failures', async () => {
  globalThis.fetch = async () => Response.json({ success: false, error: { code: 'CONFLICT', message: 'Slot already booked' } }, { status: 409 })
  await assert.rejects(service.createBooking({ caregiver_id: 'CG_001', slot_id: 'slot' }), (error) => error.status === 409 && error.code === 'CONFLICT')

  globalThis.fetch = async () => Response.json({ success: false, error: { code: 'BOOKING_PERSISTENCE_FAILED', message: 'Could not save' } }, { status: 500 })
  await assert.rejects(service.createBooking({ caregiver_id: 'CG_001', slot_id: 'slot' }), (error) => error.status === 500 && error.code === 'BOOKING_PERSISTENCE_FAILED')
})

test('network failures report backend unavailable without returning mock data', async () => {
  globalThis.fetch = async () => { throw new TypeError('offline') }
  await assert.rejects(service.triage({ user_input: 'fever' }), (error) => error.status === 0 && error.code === 'NETWORK_ERROR')
})

test('health concern validation rejects meaningless text and accepts multilingual symptoms', () => {
  for (const input of ['2+2', 'hello', 'asdfghjkl', 'ieoepep', '123456', '!!!@@@', '   ', 'What is the weather tomorrow?', 'What is fever?', 'Does fever cause cough?']) {
    assert.equal(service.isHealthConcern(input), false, input)
  }
  for (const input of [
    'I have a headache',
    'I have fever since yesterday',
    'I have a fever, what should I do?',
    'Mujhe sir dard ho raha hai',
    'Mujhe kal se bukhar hai',
    'Mere pet mein bahut dard hai',
    'I am having difficulty breathing',
    'My mother is feeling dizzy',
    'I do not have fever',
    'Mujhe saans lene mein dikkat ho rahi hai',
    'I have severe chest pain.',
    'I am unable to breathe',
    'Patient is unconscious',
    'Why am I dizzy?',
  ]) {
    assert.equal(service.isHealthConcern(input), true, input)
  }
})
