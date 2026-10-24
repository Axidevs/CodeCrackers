'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, ArrowRight, CalendarDays, Check, ChevronRight, CircleHelp, HeartPulse, Languages, MapPin, Mic, Phone, RotateCcw, ShieldCheck, Sparkles, Star, Stethoscope, UserRound } from 'lucide-react'
import { getCaregivers, uiTriage, createBooking, escalateEmergency, isHealthConcern, CuraApiError, type Caregiver, type CaregiverMatch, type CaregiverSlot, type TriageDecision, type EmergencyAction, type BookingResponse } from '@/lib/cura-service'
import { EmergencyScreen } from './emergency-screen'

type Screen = 'home' | 'intake' | 'questions' | 'loading' | 'recommendation' | 'caregivers' | 'booking' | 'success' | 'emergency' | 'error'
type DisplayCaregiver = Caregiver & CaregiverMatch & { initials: string; color: string }
type RecognitionEventLike = { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }>> }
type RecognitionErrorLike = { error: string }
type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: RecognitionEventLike) => void) | null
  onerror: ((event: RecognitionErrorLike) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}
type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: new () => SpeechRecognitionLike
  webkitSpeechRecognition?: new () => SpeechRecognitionLike
}

function Logo() { return <div className="flex items-center gap-2.5"><div className="grid size-9 place-items-center rounded-xl bg-[#174a39] text-white"><HeartPulse size={19} strokeWidth={2.4} /></div><span className="font-display text-[21px] font-semibold tracking-[-0.03em] text-[#174a39]">Cura</span></div> }
function Header({ onEmergency, onReset, showBack, onBack }: { onEmergency: () => void; onReset: () => void; showBack?: boolean; onBack?: () => void }) { return <header className="flex items-center justify-between px-5 py-5 sm:px-10"><div className="flex items-center gap-3">{showBack && <button aria-label="Go back" onClick={onBack} className="mr-1 grid size-10 place-items-center rounded-full border border-[#dfe5dd] text-[#174a39] transition hover:bg-[#edf3ed]"><ArrowLeft size={18} /></button>}<Logo /></div><div className="flex items-center gap-2"><button onClick={onReset} className="hidden items-center gap-2 rounded-full px-3 py-2 text-sm font-medium text-[#64736b] hover:bg-[#edf3ed] sm:flex"><RotateCcw size={15} /> Restart</button><button onClick={onEmergency} className="flex items-center gap-2 rounded-full border border-[#ebcfc5] bg-[#fff8f5] px-3.5 py-2 text-sm font-semibold text-[#9a4d39] hover:bg-[#fff0eb]"><Phone size={15} /> <span className="hidden sm:inline">Emergency help</span></button></div></header> }
function DemoNote() { return <div className="flex items-center gap-2 rounded-xl border border-[#dae8dc] bg-[#f4f8f2] px-3.5 py-2.5 text-xs text-[#597065]"><Sparkles size={14} className="text-[#5e8a70]" /> Demo mode · recommendations are for navigation only, not a diagnosis</div> }

function EditorialHome({ onStart, onEmergency }: { onStart: () => void; onEmergency: () => void }) {
  return <main className="cura-editorial min-h-screen overflow-hidden bg-[#fff8f0] text-[#35152f]">
    <header className="mx-auto flex max-w-[1400px] items-center justify-between border-b border-[#ded3cc] px-6 py-5 sm:px-10 lg:px-16"><a href="#top" className="flex items-center gap-3" aria-label="Cura home"><span className="cura-mark" aria-hidden="true"><span /></span><span className="font-display text-3xl font-semibold tracking-[-.08em]">Cura</span></a><span className="hidden text-[10px] font-bold uppercase tracking-[.28em] text-[#9b8b91] sm:block">A calmer way forward / 2024</span><button onClick={onEmergency} className="text-xs font-bold uppercase tracking-[.13em] text-[#f0523d] hover:text-[#35152f]">Urgent help</button></header>
    <section id="top" className="mx-auto max-w-[1400px] px-6 pb-16 pt-8 sm:px-10 sm:pt-12 lg:px-16 lg:pb-24">
      <div className="flex flex-col"><div className="flex items-end justify-between gap-6"><p className="max-w-[150px] text-xs font-bold uppercase leading-5 tracking-[.2em] text-[#f0523d]">Personal care, without the noise.</p><p className="hidden text-[10px] font-bold uppercase tracking-[.28em] text-[#9b8b91] md:block">Scroll to begin ↓</p></div><h1 className="cura-hero-headline mt-12 max-w-[1180px] font-display text-[clamp(3.2rem,10.5vw,10rem)] font-medium leading-[.78] tracking-[-.085em]">Your body<br /><span className="ml-[12vw] text-[#f0523d]">has a story.</span></h1><div className="mt-12 grid gap-8 border-t border-[#ded3cc] pt-7 md:grid-cols-[1fr_1.2fr_1fr] md:items-end"><p className="max-w-[260px] text-base leading-6 text-[#6d6269]">Cura helps you make sense of what you&apos;re feeling, then find the human support that fits.</p><div className="relative h-32 overflow-hidden bg-[#35152f] p-5 text-[#fff8f0] md:h-44"><span className="text-[10px] font-bold uppercase tracking-[.2em] text-[#e8a08f]">A small first step</span><p className="mt-8 max-w-[300px] font-display text-2xl leading-none sm:text-3xl">Start with what you know.</p><span className="absolute bottom-4 right-5 text-3xl text-[#f0523d]">↘</span></div><div className="flex flex-col items-start gap-4 md:pl-4"><button onClick={onStart} className="group flex min-h-14 items-center gap-5 bg-[#f0523d] px-7 text-sm font-bold uppercase tracking-[.12em] text-[#fff8f0] transition hover:bg-[#35152f]">Let&apos;s start <span className="text-xl transition group-hover:translate-x-1">→</span></button><button onClick={onEmergency} className="text-sm font-semibold text-[#35152f] underline decoration-[#f0523d] underline-offset-4">I need urgent help</button></div></div></div>
      <div className="mt-14 bg-[#c9ddc8] px-5 py-7 sm:px-10 sm:py-10"><div className="mb-5 flex items-center justify-between text-[10px] font-bold uppercase tracking-[.2em] text-[#597065]"><span>The care map</span><span>01 — 03</span></div><div className="cura-map-art" aria-hidden="true"><svg viewBox="0 0 1200 250" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-auto w-full"><path d="M5 180C150 45 260 232 410 130C555 31 617 225 770 132C922 40 1002 221 1195 54" stroke="#f0523d" strokeWidth="7" strokeLinecap="round"/><path d="M4 180C150 45 260 232 410 130C555 31 617 225 770 132C922 40 1002 221 1195 54" stroke="#fff8f0" strokeWidth="2" strokeDasharray="2 16" strokeLinecap="round"/><circle cx="5" cy="180" r="14" fill="#35152f"/><circle cx="410" cy="130" r="14" fill="#f0523d"/><circle cx="770" cy="132" r="14" fill="#35152f"/><circle cx="1195" cy="54" r="14" fill="#f0523d"/><path d="M106 170v-34h34v34M1050 88v-34h34v34" stroke="#35152f" strokeWidth="3"/></svg></div><div className="mt-4 grid grid-cols-4 text-[10px] font-bold uppercase tracking-[.16em] text-[#597065]"><span>Listen</span><span className="text-center">Understand</span><span className="text-center">Connect</span><span className="text-right">Move forward</span></div></div>
    </section>
    <section id="journey" className="bg-[#35152f] px-6 py-20 text-[#fff8f0] sm:px-10 lg:px-16"><div className="mx-auto grid max-w-[1400px] gap-12 md:grid-cols-[.8fr_1.2fr]"><div><p className="text-xs font-bold uppercase tracking-[.24em] text-[#e8a08f]">The Cura way</p><h2 className="mt-5 max-w-[440px] font-display text-5xl leading-[.88] tracking-[-.06em] sm:text-6xl">No guesswork. Just the next right step.</h2></div><div className="grid gap-0 sm:grid-cols-3">{[['01','Tell your story'],['02','Find your direction'],['03','Choose your next step']].map(([number,title], index) => <div key={number} className="cura-stage border-t border-[#806170] py-5 sm:border-l sm:border-t-0 sm:px-6"><span className="font-display text-4xl text-[#e8a08f]">{number}</span><h3 className="mt-10 font-display text-2xl leading-none">{title}</h3><p className="mt-4 text-sm leading-6 text-[#c8b8bc]">{index === 0 ? 'In your own words, at your own pace.' : index === 1 ? 'Thoughtful guidance, without the guesswork.' : 'A human next step that feels right for you.'}</p></div>)}</div></div></section>
  </main>
}

function LivingHome({ onStart, onEmergency }: { onStart: () => void; onEmergency: () => void }) {
  const [active, setActive] = useState(0)
  useEffect(() => {
    const observer = new IntersectionObserver(entries => entries.forEach(entry => { if (entry.isIntersecting) setActive(Number((entry.target as HTMLElement).dataset.step)) }), { threshold: 0.45 })
    document.querySelectorAll('[data-step]').forEach(section => observer.observe(section))
    return () => observer.disconnect()
  }, [])
  const jump = (id: string, step: number) => { setActive(step); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }) }
  return <main className="cura-living min-h-screen overflow-hidden bg-[#fff8f0] text-[#35152f]">
    <header className="cura-living-header"><a href="#living-top" className="flex items-center gap-3" aria-label="Cura home"><span className="cura-mark" aria-hidden="true"><span /></span><span className="font-display text-3xl font-semibold tracking-[-.08em]">Cura</span></a><span className="hidden text-[10px] font-bold uppercase tracking-[.28em] text-[#9b8b91] sm:block">A living path to care</span><button onClick={onEmergency} className="cura-urgent">Urgent help</button></header>
    <section id="living-top" className="cura-living-hero"><div className="cura-hero-copy"><p className="cura-kicker">A calmer way forward</p><h1 className="font-display">Your body<br /><em>has a story.</em></h1><p className="cura-hero-intro">You don&apos;t have to understand it all at once. Start with what you notice. Cura helps you listen, make sense of it, and find the right human next step.</p><div className="flex flex-wrap items-center gap-5"><button onClick={onStart} className="cura-primary-cta">Let&apos;s start <ArrowRight size={18} /></button><button onClick={onEmergency} className="cura-text-cta">I need urgent help</button></div></div><div className="cura-hero-illustration" aria-hidden="true"><svg viewBox="0 0 560 430" fill="none"><path className="cura-path-line" d="M30 360C100 300 90 210 170 220C250 230 245 330 320 300C395 270 350 130 455 125C490 123 512 95 532 45" /><path className="cura-contour" d="M0 330C120 250 110 170 210 185C295 198 290 285 350 265C425 240 400 80 560 80" /><path className="cura-contour" d="M0 390C140 320 155 240 220 250C300 263 300 350 385 320C470 290 450 160 560 150" /><circle cx="170" cy="220" r="11" /><circle cx="320" cy="300" r="11" /><circle cx="455" cy="125" r="11" /></svg><span className="cura-figure-label">notice → meaning → support</span></div></section>
    <nav className="cura-path-nav" aria-label="Care journey">{[['Listen','living-listen'],['Understand','living-understand'],['Connect','living-connect']].map(([label,id], i) => <button key={id} onClick={() => jump(id, i)} className={active === i ? 'is-active' : ''}><span>0{i + 1}</span>{label}<ChevronRight size={15} /></button>)}</nav>
    <section id="living-listen" data-step="0" className="cura-living-section cura-listen"><div className="cura-section-number">01</div><div><p className="cura-kicker">Listen</p><h2 className="font-display">Begin with the signal, not the noise.</h2><p>Tell us what is happening in your own words. No perfect description needed. A few honest details are enough to begin.</p><button onClick={onStart} className="cura-outline-cta">Tell your story <ArrowRight size={17} /></button></div><div className="cura-waveform" aria-hidden="true">{Array.from({ length: 18 }).map((_, i) => <i key={i} style={{ height: `${28 + ((i * 17) % 65)}%` }} />)}</div></section>
    <section id="living-understand" data-step="1" className="cura-living-section cura-understand"><div className="cura-section-number">02</div><div><p className="cura-kicker">Understand</p><h2 className="font-display">Good questions create a clearer picture.</h2><p>We&apos;ll ask a few gentle follow-ups about timing, daily impact and the support you need before suggesting what comes next.</p></div><div className="cura-question-stack"><span>How long has this been going on?</span><span>How is it affecting your day?</span><span>What kind of support feels right?</span></div></section>
    <section id="living-connect" data-step="2" className="cura-living-section cura-connect"><div className="cura-section-number">03</div><div><p className="cura-kicker">Connect</p><h2 className="font-display">A next step you can actually take.</h2><p>When you&apos;re ready, Cura helps connect you with appropriate care and human support. You stay in control throughout.</p><button onClick={onStart} className="cura-primary-cta">Find my next step <ArrowRight size={18} /></button></div><div className="cura-connect-mark"><HeartPulse size={42} /><span>care, made human</span></div></section>
    <footer className="cura-living-footer"><span>Cura / care begins with listening.</span><button onClick={onEmergency}>Urgent help is always available</button></footer>
  </main>
}

export default function CuraApp() {
  const [screen, setScreen] = useState<Screen>('home')
  const [language, setLanguage] = useState('English')
  const [symptoms, setSymptoms] = useState('')
    const [inputError, setInputError] = useState('')
  const [answerDraft, setAnswerDraft] = useState('')
  const [recommendation, setRecommendation] = useState<TriageDecision | null>(null)
  const [confidence, setConfidence] = useState<number | null>(null)
  const [caregivers, setCaregivers] = useState<DisplayCaregiver[]>([])
  const [isLoadingCaregivers, setIsLoadingCaregivers] = useState(false)
  const [selectedCaregiver, setSelectedCaregiver] = useState<DisplayCaregiver | null>(null)
  const [selectedSlot, setSelectedSlot] = useState<CaregiverSlot | null>(null)
  const [conversationHistory, setConversationHistory] = useState<Array<{ role: string; content: string; is_question?: boolean }>>([])
  const [isListening, setIsListening] = useState(false)
  const [isFollowupListening, setIsFollowupListening] = useState(false)
  const [followupVoiceError, setFollowupVoiceError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isBooking, setIsBooking] = useState(false)
  const [error, setError] = useState('')
  const [emergencyAction, setEmergencyAction] = useState<EmergencyAction | null>(null)
  const [emergencyRedFlags, setEmergencyRedFlags] = useState<string[]>([])
  const [emergencyError, setEmergencyError] = useState('')
  const [isEscalatingEmergency, setIsEscalatingEmergency] = useState(false)
  const [bookingConfirmation, setBookingConfirmation] = useState<BookingResponse | null>(null)
  const triageInFlight = useRef(false)
  const emergencyInFlight = useRef(false)
  const bookingInFlight = useRef(false)
  const followupRecognition = useRef<SpeechRecognitionLike | null>(null)

  useEffect(() => () => followupRecognition.current?.abort(), [])

  const reset = () => {
    setScreen('home'); setSymptoms(''); setInputError(''); setAnswerDraft(''); setRecommendation(null); setConfidence(null)
    setCaregivers([]); setSelectedCaregiver(null); setSelectedSlot(null); setConversationHistory([])
    setIsLoadingCaregivers(false)
    setError(''); setEmergencyAction(null); setEmergencyRedFlags([]); setEmergencyError(''); setIsEscalatingEmergency(false); setBookingConfirmation(null)
  }

  const emergency = async () => {
    if (emergencyInFlight.current) return
    emergencyInFlight.current = true
    setScreen('emergency'); setEmergencyError(''); setEmergencyAction(null); setEmergencyRedFlags([]); setIsEscalatingEmergency(true)
    try {
      const result = await escalateEmergency()
      setEmergencyAction(result.emergency_action)
      setEmergencyRedFlags(result.red_flags)
    } catch (requestError) {
      setEmergencyError(requestError instanceof Error ? requestError.message : 'Emergency service is unavailable. Contact local emergency services directly.')
    } finally {
      emergencyInFlight.current = false
      setIsEscalatingEmergency(false)
    }
  }

  const languageCode = language.toLowerCase() as 'english' | 'hindi' | 'hinglish'
  const showDecision = async (decision: TriageDecision, history: Array<{ role: string; content: string; is_question?: boolean }>, decisionConfidence?: number) => {
    setRecommendation(decision)
    setConfidence(typeof decisionConfidence === 'number' ? decisionConfidence : null)
    setError('')
    if (decision.care_type === 'emergency_referral' || decision.urgency === 'immediate') {
      setEmergencyAction(decision.emergency_action || null)
      setEmergencyRedFlags(decision.red_flags || [])
      setScreen('emergency')
      return
    }
    if (decision.follow_up_question) {
      setConversationHistory([...history, { role: 'assistant', content: decision.follow_up_question, is_question: true }])
      setScreen('questions')
      return
    }
    setConversationHistory(history)
    setScreen('recommendation')
    if (decision.matched_caregivers.length === 0) {
      setCaregivers([])
      return
    }
    setIsLoadingCaregivers(true)
    try {
      const directory = await getCaregivers()
      const activeIds = new Set(directory.caregivers.map((caregiver) => caregiver.caregiver_id))
      const profileById = new Map(directory.caregivers.map((caregiver) => [caregiver.caregiver_id, caregiver]))
      setCaregivers(decision.matched_caregivers.flatMap((match, index) => {
        const profile = profileById.get(match.caregiver_id)
        return profile && activeIds.has(profile.caregiver_id) ? [{ ...profile, ...match, initials: profile.name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase(), color: ['bg-[#dcebe3]', 'bg-[#e8e4d8]', 'bg-[#e9dfe1]'][index % 3] }] : []
      }))
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Caregiver details could not be loaded.')
      setCaregivers([])
    } finally {
      setIsLoadingCaregivers(false)
    }
  }

  const submitSymptoms = async () => {
    const input = symptoms.trim()
    if (triageInFlight.current) return
    if (!isHealthConcern(input)) {
      setInputError('Please describe a health concern or symptom so CURA can assist you. You can describe what you or someone else is experiencing in English, Hindi, or Hinglish.')
      return
    }
    setInputError('')
    triageInFlight.current = true
    setError(''); setScreen('loading'); setIsLoading(true)
    try {
      const result = await uiTriage({ user_input: input, language: languageCode, conversation_history: [] })
      await showDecision(result.decision, [{ role: 'user', content: input }], result.trace.confidence)
    } catch (requestError) {
      if (requestError instanceof CuraApiError && requestError.code === 'INVALID_HEALTH_INPUT') {
        setInputError(requestError.message)
        setScreen('intake')
        return
      }
      setError(requestError instanceof Error ? requestError.message : 'Triage service is unavailable.')
      setScreen('error')
    } finally {
      triageInFlight.current = false
      setIsLoading(false)
    }
  }

  const chooseAnswer = async (answer: string) => {
    if (triageInFlight.current || !recommendation?.follow_up_question) return
    triageInFlight.current = true
    const history = [...conversationHistory, { role: 'user', content: answer }]
    if (!isHealthConcern([...history.filter((message) => message.role === 'user').map((message) => message.content)].join(' '))) {
      triageInFlight.current = false
      setFollowupVoiceError('Please answer in the context of the health concern so CURA can assist you.')
      return
    }
    setFollowupVoiceError('')
    setError(''); setScreen('loading'); setIsLoading(true)
    try {
      const result = await uiTriage({ user_input: answer, language: languageCode, conversation_history: conversationHistory })
      await showDecision(result.decision, history, result.trace.confidence)
      setAnswerDraft('')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Triage service is unavailable.')
      setScreen('error')
    } finally {
      triageInFlight.current = false
      setIsLoading(false)
    }
  }

  const toggleFollowupListening = () => {
    if (isFollowupListening) {
      followupRecognition.current?.stop()
      return
    }

    const SpeechRecognition = (window as unknown as { webkitSpeechRecognition?: new () => { lang: string; start: () => void; onresult: (e: { results: { [key: number]: { [key: number]: { transcript: string } } } }) => void; onend: () => void } }).webkitSpeechRecognition; if (!SpeechRecognition) return; const recognition = new SpeechRecognition(); recognition.lang = language === 'Hindi' ? 'hi-IN' : 'en-IN'; recognition.onresult = e => setSymptoms(prev => `${prev} ${e.results[0][0].transcript}`.trim()); recognition.onend = () => setIsListening(false); setIsListening(true); recognition.start() }
  const confirmBooking = async () => {
    if (!selectedCaregiver || !selectedSlot || bookingInFlight.current) return
    bookingInFlight.current = true
    setError(''); setIsBooking(true)
    try {
      const confirmation = await createBooking({ caregiver_id: selectedCaregiver.caregiver_id, slot_id: selectedSlot.slot_id })
      setBookingConfirmation(confirmation)
      setScreen('success')
      try {
        const directory = await getCaregivers()
        const refreshed = directory.caregivers.find((caregiver) => caregiver.caregiver_id === selectedCaregiver.caregiver_id)
        if (refreshed) setSelectedCaregiver({ ...selectedCaregiver, availability_slots: refreshed.availability_slots })
      } catch {
        // A refresh failure does not change the backend-confirmed booking result.
      }
    } catch (requestError) {
      setError(requestError instanceof CuraApiError && requestError.status === 409
        ? 'This time was just booked. Choose another available slot.'
        : requestError instanceof Error ? requestError.message : 'Booking could not be confirmed.')
    } finally {
      bookingInFlight.current = false
      setIsBooking(false)
    }
  }

  const startListening = () => { const SpeechRecognition = (window as unknown as { webkitSpeechRecognition?: new () => { lang: string; start: () => void; onresult: (e: { results: { [key: number]: { [key: number]: { transcript: string } } } }) => void; onend: () => void } }).webkitSpeechRecognition; if (!SpeechRecognition) return; const recognition = new SpeechRecognition(); recognition.lang = language === 'Hindi' ? 'hi-IN' : 'en-IN'; recognition.onresult = e => setSymptoms(prev => `${prev} ${e.results[0][0].transcript}`.trim()); recognition.onend = () => setIsListening(false); setIsListening(true); recognition.start() }
  const beginAssessment = () => setScreen('intake')
  const layoutClass = 'mx-auto flex min-h-[calc(100vh-82px)] w-full max-w-[1180px] flex-col px-5 pb-10 sm:px-10'
    if (screen === 'home') return <LivingHome onStart={beginAssessment} onEmergency={emergency} />
  if (screen === 'success' && !bookingConfirmation) return <main className="min-h-screen bg-[#fbfcf8]"><Header onEmergency={emergency} onReset={reset} showBack onBack={reset} /><div className="mx-auto max-w-[680px] px-5 py-16 text-center"><p role="alert" className="text-sm text-[#9a4d39]">No booking confirmation was received. The visit is not shown as booked.</p><button onClick={reset} className="mt-7 min-h-12 rounded-2xl border border-[#dfe5dd] px-5 text-sm font-semibold text-[#174a39]">Return to Cura</button></div></main>
  if (screen === 'success' && bookingConfirmation) return <main className="min-h-screen bg-[#fbfcf8]"><Header onEmergency={emergency} onReset={reset} /><div className="flex min-h-[calc(100vh-82px)] flex-col items-center justify-center px-5 text-center"><div className="grid size-20 place-items-center rounded-[28px] bg-[#e7f0e5] text-[#4f8062]"><Check size={38} /></div><p className="mt-8 text-sm font-semibold uppercase tracking-[.16em] text-[#6e9277]">Booking confirmed</p><h1 className="mt-3 font-display text-4xl font-medium tracking-[-.04em] text-[#174a39]">Your demo visit is booked.</h1><p className="mt-4 text-[#64736b]">{bookingConfirmation.booking.caregiver_name} · {bookingConfirmation.booking.slot_time}</p><p className="mt-2 text-xs text-[#849188]">Confirmation {bookingConfirmation.booking.booking_id}</p><p className="mt-5 max-w-lg text-sm text-[#64736b]">{bookingConfirmation.notice}</p><div className="mt-8 flex flex-col gap-3 sm:flex-row"><button onClick={reset} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[#174a39] px-5 text-sm font-semibold text-white hover:bg-[#24634d]">Start over <RotateCcw size={16} /></button><button onClick={() => setScreen('caregivers')} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-[#dfe5dd] px-5 text-sm font-semibold text-[#315443] hover:bg-[#edf3ed]">View caregivers</button></div></div></main>
  if (screen === 'emergency' && isEscalatingEmergency) return <main className="min-h-screen bg-[#fbfcf8]"><Header onEmergency={emergency} onReset={reset} showBack onBack={reset} /><div className="mx-auto flex max-w-[680px] flex-col items-center px-5 py-12 text-center sm:py-20"><div className="grid size-20 place-items-center rounded-[28px] bg-[#fff0eb] text-[#ad5b43]"><AlertTriangle size={37} /></div><p className="mt-8 text-sm font-semibold uppercase tracking-[.16em] text-[#ad5b43]">Emergency response</p><h1 className="mt-3 font-display text-4xl font-medium tracking-[-.04em] text-[#174a39] sm:text-5xl">Please act now.</h1>{emergencyError ? <p role="alert" className="mt-5 max-w-[520px] text-lg leading-8 text-[#9a4d39]">{emergencyError} The request was not confirmed.</p> : <p className="mt-5 text-[#64736b]">Loading emergency guidance…</p>}<button onClick={reset} className="mt-8 flex min-h-12 items-center gap-2 rounded-2xl border border-[#dfe5dd] px-5 text-sm font-semibold text-[#174a39] hover:bg-[#edf3ed]"><ArrowLeft size={16} /> Return to Cura</button></div></main>
  if (screen === 'emergency') return <EmergencyScreen onReturn={reset} emergencyAction={emergencyAction} redFlags={emergencyRedFlags} />
  if (screen === 'intake') return <main className="min-h-screen bg-[#fbfcf8]"><Header onEmergency={emergency} onReset={reset} showBack onBack={reset} /><div className={layoutClass}><div className="mx-auto w-full max-w-[720px] pt-8 sm:pt-14"><DemoNote /><div className="mt-10 flex items-center justify-between"><div><p className="text-sm font-semibold text-[#6e9277]">Step 1 of 4</p><h1 className="mt-2 font-display text-4xl font-medium tracking-[-.04em] text-[#174a39]">How are you feeling?</h1></div><Languages className="text-[#8bae91]" size={29} /></div><p className="mt-4 text-[#64736b]">Share in your own words. There are no wrong answers.</p><div className="mt-8 flex gap-2" role="group" aria-label="Language"><span className="mr-1 self-center text-xs font-semibold text-[#849188]">Language:</span>{['English', 'Hindi', 'Hinglish'].map(item => <button key={item} onClick={() => setLanguage(item)} className={`rounded-full px-3.5 py-2 text-xs font-semibold transition ${language === item ? 'bg-[#174a39] text-white' : 'border border-[#dfe5dd] text-[#64736b] hover:bg-[#edf3ed]'}`}>{item}</button>)}</div><div className="relative mt-7"><textarea aria-label="Describe your symptoms" value={symptoms} onChange={e => { setSymptoms(e.target.value); setInputError('') }} placeholder={language === 'Hindi' ? 'आप कैसा महसूस कर रहे हैं?' : 'For example, “I have had a headache since yesterday…”'} className="min-h-44 w-full resize-none rounded-3xl border border-[#dce5dd] bg-white p-5 pr-14 text-base leading-7 text-[#274a3a] outline-none transition placeholder:text-[#a2afa6] focus:border-[#77a687] focus:ring-4 focus:ring-[#e3f0e5]" /><button aria-label="Use microphone" onClick={startListening} className={`absolute bottom-4 right-4 grid size-11 place-items-center rounded-2xl ${isListening ? 'bg-[#ad5b43] text-white' : 'bg-[#e9f3e9] text-[#4f8062]'} transition hover:bg-[#dcecdf]`}><Mic size={19} /></button></div>{inputError && <p role="alert" className="mt-3 text-sm leading-6 text-[#9a4d39]">{inputError}</p>}<div className="mt-5 flex flex-wrap gap-2"><span className="mr-1 py-2 text-xs text-[#849188]">Common:</span>{['Headache', 'Fever', 'Body pain', 'Tiredness', 'Stomach discomfort'].map(item => <button key={item} onClick={() => { setSymptoms(prev => prev ? `${prev}, ${item.toLowerCase()}` : item); setInputError('') }} className="rounded-full border border-[#dfe5dd] bg-white px-3.5 py-2 text-xs font-medium text-[#64736b] hover:border-[#9bbb9f] hover:text-[#174a39]">{item}</button>)}</div><div className="mt-10 flex justify-end"><button onClick={submitSymptoms} disabled={!symptoms.trim() || isLoading} className="flex min-h-13 items-center gap-3 rounded-2xl bg-[#174a39] px-6 font-semibold text-white transition hover:bg-[#24634d] disabled:cursor-not-allowed disabled:opacity-40">{isLoading ? 'Checking…' : 'Continue'} <ArrowRight size={18} /></button></div></div></div></main>
  if (screen === 'questions') return <main className="min-h-screen bg-[#fbfcf8]"><Header onEmergency={emergency} onReset={reset} showBack onBack={() => { setAnswerDraft(''); setScreen('intake') }} /><div className={layoutClass}><div className="mx-auto w-full max-w-[680px] pt-10 sm:pt-20"><p className="mt-9 text-sm font-semibold text-[#6e9277]">A quick follow-up</p><h1 className="mt-4 font-display text-4xl font-medium leading-tight tracking-[-.045em] text-[#174a39] sm:text-5xl">{recommendation?.follow_up_question}</h1><p className="mt-4 text-[#64736b]">Your answer helps clarify the next step.</p><div className="mt-6 flex gap-2" role="group" aria-label="Voice input language">{(['English', 'Hindi', 'Hinglish'] as const).map((option) => <button key={option} type="button" aria-pressed={language === option} onClick={() => setLanguage(option)} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${language === option ? 'bg-[#174a39] text-white' : 'border border-[#dfe5dd] text-[#64736b]'}`}>{option}</button>)}</div><div className="mt-3 flex items-start gap-2"><textarea aria-label="Answer follow-up question" value={answerDraft} onChange={(event) => setAnswerDraft(event.target.value)} className="min-h-32 w-full flex-1 resize-y rounded-3xl border border-[#dce5dd] bg-white p-5 text-base leading-7 text-[#274a3a] outline-none focus:border-[#77a687]" /><button type="button" aria-label={isFollowupListening ? 'Stop voice typing' : 'Start voice typing'} title={isFollowupListening ? 'Stop voice typing' : 'Start voice typing'} aria-pressed={isFollowupListening} onClick={toggleFollowupListening} className={`mt-2 grid size-11 shrink-0 place-items-center rounded-2xl ${isFollowupListening ? 'bg-[#ad5b43] text-white' : 'bg-[#e9f3e9] text-[#4f8062]'} transition`}><Mic size={19} /></button></div>{isFollowupListening && <p role="status" className="mt-2 text-sm text-[#6e9277]">Listening… speak your answer, then edit it if needed.</p>}{followupVoiceError && <p role="status" className="mt-2 text-sm text-[#9a4d39]">{followupVoiceError}</p>}<button onClick={() => chooseAnswer(answerDraft)} disabled={!answerDraft.trim() || isLoading} className="mt-5 flex min-h-12 items-center gap-2 rounded-2xl bg-[#174a39] px-5 font-semibold text-white hover:bg-[#24634d] disabled:cursor-not-allowed disabled:opacity-40">Continue <ArrowRight size={17} /></button>{error && <p role="alert" className="mt-4 text-sm text-[#9a4d39]">{error}</p>}</div></div></main>

  if (screen === 'error') return <main className="min-h-screen bg-[#fbfcf8]"><Header onEmergency={emergency} onReset={reset} showBack onBack={reset} /><div className="mx-auto flex max-w-[680px] flex-col items-center px-5 py-16 text-center"><div className="grid size-16 place-items-center rounded-[24px] bg-[#fff0eb] text-[#ad5b43]"><CircleHelp size={30} /></div><h1 className="mt-7 font-display text-3xl font-medium text-[#174a39]">Care service unavailable</h1><p role="alert" className="mt-4 text-base leading-7 text-[#64736b]">{error}</p><button onClick={reset} className="mt-7 flex min-h-12 items-center gap-2 rounded-2xl border border-[#dfe5dd] px-5 text-sm font-semibold text-[#174a39] hover:bg-[#edf3ed]">Return to Cura</button></div></main>

  if (screen === 'recommendation' && recommendation) return <main className="min-h-screen bg-[#fbfcf8]"><Header onEmergency={emergency} onReset={reset} showBack onBack={() => setScreen('intake')} /><div className={layoutClass}><div className="mx-auto w-full max-w-[820px] pt-8 sm:pt-12"><DemoNote /><div className="mt-9 flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><p className="text-sm font-semibold text-[#6e9277]">Your suggested next step</p><h1 className="mt-2 font-display text-4xl font-medium tracking-[-.045em] text-[#174a39] sm:text-5xl">Support that fits your needs.</h1></div><span className="w-fit rounded-full bg-[#e6f1e6] px-3.5 py-2 text-xs font-bold text-[#47785c]">Backend recommendation</span></div><div className="mt-8 grid gap-4 md:grid-cols-[1.15fr_.85fr]"><div className="rounded-3xl bg-[#174a39] p-6 text-white sm:p-8"><div className="flex items-start justify-between"><div><p className="text-sm text-[#bdd7c2]">Recommended care type</p><h2 className="mt-3 font-display text-3xl font-medium tracking-[-.04em]">{recommendation.care_type}</h2></div><div className="grid size-12 place-items-center rounded-2xl bg-white/10"><UserRound size={24} /></div></div><div className="mt-9 flex gap-8 border-t border-white/15 pt-5"><div><p className="text-xs text-[#bdd7c2]">Urgency</p><p className="mt-1 font-semibold">{recommendation.urgency}</p></div>{confidence !== null && <div><p className="text-xs text-[#bdd7c2]">Confidence</p><p className="mt-1 font-semibold">{Math.round(confidence * 100)}%</p></div>}</div></div><div className="rounded-3xl border border-[#dfe8dc] bg-[#f3f8f0] p-6"><div className="flex items-center gap-2 text-sm font-bold text-[#315443]"><CircleHelp size={17} /> Why this suggestion?</div><p className="mt-4 text-sm leading-6 text-[#64736b]">{recommendation.reasoning}</p></div></div><div className="mt-5 flex flex-col items-start justify-between gap-4 rounded-3xl border border-[#dfe5dd] bg-white p-6 sm:flex-row sm:items-center"><div><p className="text-xs font-semibold uppercase tracking-[.12em] text-[#849188]">Matched caregivers</p><p className="mt-1 text-sm text-[#52665a]">{recommendation.matched_caregivers.length} backend match{recommendation.matched_caregivers.length === 1 ? '' : 'es'}</p></div><button onClick={() => setScreen('caregivers')} disabled={isLoadingCaregivers} className="flex min-h-12 shrink-0 items-center gap-2 rounded-2xl bg-[#174a39] px-5 text-sm font-semibold text-white hover:bg-[#24634d] disabled:opacity-50">{isLoadingCaregivers ? 'Loading matches…' : 'See caregiver matches'} <ArrowRight size={17} /></button></div>{error && <p role="alert" className="mt-4 text-sm text-[#9a4d39]">{error}</p>}</div></div></main>
  if (screen === 'caregivers') return <main className="min-h-screen bg-[#fbfcf8]"><Header onEmergency={emergency} onReset={reset} showBack onBack={() => setScreen('recommendation')} /><div className={layoutClass}><div className="mx-auto w-full max-w-[820px] pt-8 sm:pt-12"><p className="text-sm font-semibold text-[#6e9277]">Caregiver matches</p><div className="mt-2 flex items-end justify-between gap-4"><div><h1 className="font-display text-4xl font-medium tracking-[-.045em] text-[#174a39]">People who can help.</h1><p className="mt-3 text-[#64736b]">Matches and availability returned by the care service.</p></div><UserRound className="hidden text-[#8bae91] sm:block" size={32} /></div>{isLoadingCaregivers ? <p role="status" className="mt-8 text-sm text-[#64736b]">Loading caregiver matches…</p> : error ? <p role="alert" className="mt-8 text-sm text-[#9a4d39]">{error}</p> : caregivers.length === 0 ? <p className="mt-8 rounded-3xl border border-[#dfe5dd] bg-white p-6 text-sm leading-6 text-[#64736b]">No active caregivers matched this recommendation.</p> : <div className="mt-8 space-y-3">{caregivers.map((person, index) => <article key={person.caregiver_id} className={`rounded-3xl border bg-white p-5 transition ${selectedCaregiver?.caregiver_id === person.caregiver_id ? 'border-[#6f9d7c] ring-4 ring-[#e5f0e5]' : 'border-[#dfe5dd]'}`}><div className="flex flex-col gap-5 sm:flex-row sm:items-center"><div className={`grid size-14 shrink-0 place-items-center rounded-2xl text-lg font-semibold text-[#315443] ${person.color}`}>{person.initials}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="font-display text-xl font-semibold text-[#234d3b]">{person.name}</h2>{index === 0 && <span className="rounded-full bg-[#e8f2e8] px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[#4d7c5c]">Best match</span>}</div><p className="mt-1 text-sm text-[#64736b]">{person.role}{person.qualification ? ` · ${person.qualification}` : ''}</p><div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-[#77877d]">{person.location?.address && <span className="flex items-center gap-1"><MapPin size={13} />{person.location.address}</span>}<span className="flex items-center gap-1"><Languages size={13} />{person.languages.join(' · ')}</span><span className="flex items-center gap-1"><Star size={13} />{person.rating}</span></div></div><div className="flex items-center justify-between gap-4 sm:block sm:text-right"><span className="text-sm font-semibold text-[#315443]">{Math.round(person.score * 100)}% match</span><button onClick={() => { setSelectedCaregiver(person); setSelectedSlot(null); setError(''); setScreen('booking') }} className="mt-2 flex min-h-11 items-center gap-2 rounded-xl bg-[#edf5eb] px-4 text-sm font-semibold text-[#315443] hover:bg-[#deedde]">View & book <ChevronRight size={15} /></button></div></div><div className="mt-4 flex items-start gap-2 border-t border-[#edf0eb] pt-4 text-xs leading-5 text-[#6a7b70]"><Sparkles size={14} className="mt-0.5 shrink-0 text-[#6e9277]" /><span><b className="text-[#4b6655]">Why this match?</b> {person.reason}</span></div></article>)}</div>}</div></div></main>
  if (screen === 'booking' && selectedCaregiver) return <main className="min-h-screen bg-[#fbfcf8]"><Header onEmergency={emergency} onReset={reset} showBack onBack={() => { setError(''); setScreen('caregivers') }} /><div className={layoutClass}><div className="mx-auto w-full max-w-[680px] pt-8 sm:pt-12"><p className="text-sm font-semibold text-[#6e9277]">Book a demo visit</p><h1 className="mt-2 font-display text-4xl font-medium tracking-[-.045em] text-[#174a39]">Choose a time with {selectedCaregiver.name.split(' ')[0]}.</h1><div className="mt-8 rounded-3xl border border-[#dfe5dd] bg-white p-5 sm:p-6"><div className="flex items-center gap-4"><div className={`grid size-14 place-items-center rounded-2xl text-lg font-semibold text-[#315443] ${selectedCaregiver.color}`}>{selectedCaregiver.initials}</div><div><p className="font-semibold text-[#234d3b]">{selectedCaregiver.name}</p><p className="mt-1 text-sm text-[#64736b]">{selectedCaregiver.role}</p></div></div><div className="mt-7"><p className="text-sm font-semibold text-[#315443]">Available times</p>{selectedCaregiver.availability_slots.filter((slot) => slot.status === 'available' && !slot.is_booked).length === 0 ? <p className="mt-3 text-sm text-[#64736b]">No available slots were returned.</p> : <div className="mt-3 grid gap-2 sm:grid-cols-2">{selectedCaregiver.availability_slots.filter((slot) => slot.status === 'available' && !slot.is_booked).map((slot) => { const label = [slot.date, slot.time, slot.end_time ? `until ${slot.end_time}` : ''].filter(Boolean).join(' · '); return <button key={slot.slot_id} onClick={() => setSelectedSlot(slot)} className={`flex min-h-12 items-center gap-3 rounded-xl border px-4 text-left text-sm font-medium transition ${selectedSlot?.slot_id === slot.slot_id ? 'border-[#679379] bg-[#edf5eb] text-[#315443]' : 'border-[#e3e8e1] text-[#64736b] hover:border-[#9bbb9f]'}`}><CalendarDays size={16} />{label}{selectedSlot?.slot_id === slot.slot_id && <Check size={15} className="ml-auto" />}</button> })}</div>}</div></div><div className="mt-4 rounded-2xl bg-[#f3f8f0] px-4 py-3 text-xs leading-5 text-[#64736b]">Demo booking only. The backend confirms whether the booking was saved.</div>{error && <p role="alert" className="mt-4 text-sm text-[#9a4d39]">{error}</p>}<button onClick={confirmBooking} disabled={!selectedSlot || isBooking} className="mt-7 flex min-h-13 w-full items-center justify-center gap-2 rounded-2xl bg-[#174a39] font-semibold text-white hover:bg-[#24634d] disabled:cursor-not-allowed disabled:opacity-40">{isBooking ? 'Confirming…' : 'Confirm demo booking'} <Check size={18} /></button></div></div></main>

}
function LockIcon() { return <span className="grid size-4 place-items-center rounded-full border border-[#9caf9f] text-[9px]">✓</span> }
