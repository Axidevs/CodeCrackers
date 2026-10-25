'use client'

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { AlertTriangle, ArrowLeft, ArrowRight, CalendarDays, Check, ChevronRight, CircleHelp, HeartPulse, History, Languages, LogOut, MapPin, Mic, Phone, RotateCcw, ShieldCheck, Sparkles, Star, Stethoscope, UserRound } from 'lucide-react'
import { getCaregivers, uiTriage, createBooking, escalateEmergency, isHealthConcern, CuraApiError, requestPhoneOtp, verifyPhoneOtp, getCurrentUser, updateUserProfile, logout, getMyBookings, type AuthUser, type BookingHistoryItem, type Caregiver, type CaregiverMatch, type CaregiverSlot, type TriageDecision, type EmergencyAction, type BookingResponse } from '@/lib/cura-service'
import { EmergencyScreen } from './emergency-screen'

type Screen = 'home' | 'onboarding' | 'intake' | 'questions' | 'loading' | 'recommendation' | 'caregivers' | 'booking' | 'success' | 'history' | 'emergency' | 'error'
type AuthMode = 'login' | 'signup' | 'account' | null
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

function Logo() { return <div className="cura-brand"><span className="cura-brand-mark"><HeartPulse size={20} strokeWidth={2.2} aria-hidden="true" /></span><span className="cura-brand-name">Cura</span><span className="cura-brand-tagline">Care, with clarity</span></div> }
function formatBookingDate(value: string) {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
}
function Header({ onEmergency, onReset, showBack, onBack, conversation }: { onEmergency: () => void; onReset: () => void; showBack?: boolean; onBack?: () => void; conversation?: Array<{ role: string; content: string; is_question?: boolean }> }) {
  return <>
    <header className="cura-app-header"><div className="flex items-center gap-3">{showBack && <button aria-label="Go back" onClick={onBack} className="cura-icon-button"><ArrowLeft size={18} /></button>}<Logo /></div><div className="flex items-center gap-2"><button onClick={onReset} className="cura-header-reset"><RotateCcw size={15} aria-hidden="true" /> Restart</button><button onClick={onEmergency} className="cura-emergency-button"><Phone size={15} aria-hidden="true" /> <span>Emergency help</span></button></div></header>
    {conversation && conversation.length > 0 && <section className="cura-conversation" aria-label="Conversation so far" aria-live="polite">{conversation.filter((message, index) => !(index === conversation.length - 1 && message.role === 'assistant' && message.is_question)).map((message, index) => <div key={`${message.role}-${index}`} className={`cura-message ${message.role === 'user' ? 'cura-message-user' : 'cura-message-assistant'}`}><span className="cura-message-label">{message.role === 'user' ? 'You' : 'CURA'}</span><p>{message.content}</p></div>)}</section>}
  </>
}
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

function PhoneAuthDialog({ mode, user, statusMessage, onClose, onModeChange, onAuthenticated, onHistory, onLogout, onEditProfile }: {
  mode: Exclude<AuthMode, null>
  user: AuthUser | null
  statusMessage: string
  onClose: () => void
  onModeChange: (mode: 'login' | 'signup') => void
  onAuthenticated: (user: AuthUser) => void
  onHistory: () => void
  onLogout: () => Promise<void>
  onEditProfile: () => void
}) {
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [otpResult, setOtpResult] = useState<Awaited<ReturnType<typeof requestPhoneOtp>> | null>(null)
  const [error, setError] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const [isVerifying, setIsVerifying] = useState(false)

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    document.querySelector<HTMLButtonElement>('.cura-auth-dialog .cura-dialog-close')?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'Tab') {
        const controls = document.querySelectorAll<HTMLElement>('.cura-auth-dialog button:not(:disabled), .cura-auth-dialog input:not(:disabled)')
        const first = controls[0]
        const last = controls[controls.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first?.focus()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      previousFocus?.focus()
    }
  }, [onClose])

  const requestCode = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault()
    setError('')
    setIsBusy(true)
    try {
      setOtpResult(await requestPhoneOtp(phone))
      setCode('')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not request a verification code.')
    } finally {
      setIsBusy(false)
    }
  }

  const verifyCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setIsVerifying(true)
    try {
      const result = await verifyPhoneOtp(phone, code)
      onAuthenticated(result.user)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The verification code could not be checked.')
    } finally {
      setIsVerifying(false)
    }
  }

  const signOut = async () => {
    setError('')
    setIsBusy(true)
    try {
      await onLogout()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not sign out.')
    } finally {
      setIsBusy(false)
    }
  }

  return <div className="cura-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="cura-auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-dialog-title">
      <button type="button" className="cura-dialog-close" aria-label="Close dialog" onClick={onClose}>×</button>
      <span className="cura-dialog-icon"><HeartPulse size={23} aria-hidden="true" /></span>
      {mode === 'account' && user ? <>
        <p className="cura-kicker">My account</p>
        <h2 id="auth-dialog-title" className="font-display">Your CURA account</h2>
        <p>Signed in with <strong>{user.phone}</strong>.</p>
        <div className="cura-account-actions"><button type="button" className="cura-primary-cta" onClick={onHistory}><History size={17} /> View my bookings</button><button type="button" className="cura-signout-button" onClick={onEditProfile}><MapPin size={16} /> Edit profile and location</button><button type="button" className="cura-signout-button" disabled={isBusy} onClick={signOut}><LogOut size={16} /> {isBusy ? 'Signing out…' : 'Sign out'}</button></div>
      </> : <>
        <p className="cura-kicker">{mode === 'login' ? 'Welcome back' : 'Join CURA'}</p>
        <h2 id="auth-dialog-title" className="font-display">{otpResult ? 'Verify your phone' : mode === 'login' ? 'Log in to CURA' : 'Create your CURA account'}</h2>
        <p>{otpResult ? 'Enter the six-digit code to continue. Login and sign-up use the same verified phone flow.' : 'Use your phone number to sign in or create an account. No password is needed.'}</p>
        {statusMessage && <p role="status" className="cura-auth-status">{statusMessage}</p>}
        {!otpResult ? <form onSubmit={requestCode}>
          <label className="cura-auth-label" htmlFor="cura-phone">Phone number</label>
          <input id="cura-phone" type="tel" autoComplete="tel" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+91 98765 43210" required minLength={8} maxLength={32} />
          <button type="submit" className="cura-primary-cta" disabled={isBusy || !phone.trim()}>{isBusy ? 'Requesting code…' : 'Request verification code'} <ArrowRight size={17} /></button>
        </form> : <form onSubmit={verifyCode}>
          {otpResult.delivery_mode === 'development' && otpResult.development_otp && <div className="cura-dev-otp" role="status"><strong>Development only — no SMS was sent.</strong><span>Enter this one-time code: <b>{otpResult.development_otp}</b></span></div>}
          {otpResult.delivery_mode === 'sms' && <p className="cura-auth-status">{otpResult.message}</p>}
          <label className="cura-auth-label" htmlFor="cura-otp">Six-digit verification code</label>
          <input id="cura-otp" type="text" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="123456" required minLength={6} maxLength={6} />
          <button type="submit" className="cura-primary-cta" disabled={isVerifying || code.length !== 6}>{isVerifying ? 'Verifying…' : 'Verify and continue'} <ArrowRight size={17} /></button>
          <button type="button" className="cura-auth-switch" disabled={isBusy} onClick={() => void requestCode()}>{isBusy ? 'Requesting another code…' : 'Resend code'}</button>
          <button type="button" className="cura-auth-switch" onClick={() => { setOtpResult(null); setCode(''); setError('') }}>Use a different phone number</button>
        </form>}
        {error && <p className="cura-auth-error" role="alert">{error}</p>}
        <div className="cura-auth-notice"><ShieldCheck size={18} aria-hidden="true" /><span>Your session is protected by an HttpOnly cookie.</span></div>
        {!otpResult && <button type="button" className="cura-auth-switch" onClick={() => { setError(''); onModeChange(mode === 'login' ? 'signup' : 'login') }}>{mode === 'login' ? 'Need an account? Create account' : 'Already registered? Log in'}</button>}
      </>}
    </section>
  </div>
}

function BookingHistoryScreen({ user, isCheckingSession, authStatus, onBack, onLogin, onEmergency, onSessionExpired }: {
  user: AuthUser | null
  isCheckingSession: boolean
  authStatus: string
  onBack: () => void
  onLogin: () => void
  onEmergency: () => void
  onSessionExpired: () => void
}) {
  const [bookings, setBookings] = useState<BookingHistoryItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [retryCount, setRetryCount] = useState(0)

  useEffect(() => {
    if (!user || isCheckingSession) return
    let cancelled = false
    setIsLoading(true)
    setError('')
    getMyBookings().then((result) => {
      if (!cancelled) setBookings(result.bookings)
    }).catch((requestError) => {
      if (!cancelled && requestError instanceof CuraApiError && requestError.status === 401) {
        onSessionExpired()
      } else if (!cancelled) {
        setError(requestError instanceof Error ? requestError.message : 'Booking history could not be loaded.')
      }
    }).finally(() => {
      if (!cancelled) setIsLoading(false)
    })
    return () => { cancelled = true }
  }, [user, isCheckingSession, retryCount, onSessionExpired])

  return <main className="min-h-screen bg-[#fbfcf8]">
    <Header onEmergency={onEmergency} onReset={onBack} showBack onBack={onBack} />
    <div className="cura-history-page">
      <p className="cura-kicker">My account</p>
      <h1 className="font-display">My bookings</h1>
      {isCheckingSession ? <p className="cura-history-message" role="status">Checking your sign-in…</p> : !user ? <section className="cura-history-empty"><History size={30} aria-hidden="true" /><h2>Sign in to view your bookings</h2><p>Your booking history is only visible to the account that created each booking.</p>{authStatus && <p role="status" className="cura-auth-error">{authStatus}</p>}<button type="button" className="cura-primary-cta" onClick={onLogin}>Log in with your phone <ArrowRight size={17} /></button></section> : isLoading ? <p className="cura-history-message" role="status">Loading your bookings…</p> : error ? <section className="cura-history-empty"><p role="alert">{error}</p><button type="button" className="cura-outline-cta" onClick={() => setRetryCount((count) => count + 1)}>Try again <RotateCcw size={16} /></button></section> : bookings.length === 0 ? <section className="cura-history-empty"><History size={30} aria-hidden="true" /><h2>No bookings yet</h2><p>Confirmed caregiver bookings made while signed in will appear here.</p><button type="button" className="cura-primary-cta" onClick={onBack}>Explore care <ArrowRight size={17} /></button></section> : <div className="cura-booking-list">{bookings.map((booking) => <article className="cura-booking-card" key={booking.booking_id}><div><p className="cura-kicker">{booking.service}</p><h2>{booking.caregiver_name}</h2><p className="cura-history-appointment"><CalendarDays size={15} aria-hidden="true" /> {booking.slot_time}</p><span>Booking ID · {booking.booking_id} · Booked {formatBookingDate(booking.booked_at)}</span></div><span className={`cura-booking-status ${booking.status.toLowerCase()}`}>{booking.status}</span></article>)}</div>}
    </div>
  </main>
}

function ProfileOnboarding({ user, onComplete, onCancel, onSignOut }: {
  user: AuthUser
  onComplete: (user: AuthUser) => void
  onCancel: () => void
  onSignOut: () => Promise<void>
}) {
  const [fullName, setFullName] = useState(user.full_name)
  const [city, setCity] = useState(user.city)
  const [area, setArea] = useState(user.area)
  const [pincode, setPincode] = useState(user.pincode)
  const [location, setLocation] = useState(user.location)
  const [isLocating, setIsLocating] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [error, setError] = useState('')
  const [locationMessage, setLocationMessage] = useState('')

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      setLocationMessage('Location is unavailable in this browser. You can continue without GPS.')
      return
    }
    setIsLocating(true)
    setLocationMessage('')
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocation({ lat: coords.latitude, lng: coords.longitude })
        setLocationMessage('Current coordinates added for caregiver distance matching.')
        setIsLocating(false)
      },
      () => {
        setLocationMessage('Location permission was not granted. You can continue without GPS.')
        setIsLocating(false)
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    )
  }

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setIsSaving(true)
    try {
      const result = await updateUserProfile({ full_name: fullName, city, area, pincode, location })
      onComplete(result.user)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Your profile could not be saved.')
    } finally {
      setIsSaving(false)
    }
  }

  const signOut = async () => {
    setIsSigningOut(true)
    setError('')
    try {
      await onSignOut()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not sign out.')
      setIsSigningOut(false)
    }
  }

  return <main className="min-h-screen bg-[#f7f8f4] px-4 py-8 text-[#193c3b] sm:px-8 sm:py-14">
    <div className="mx-auto w-full max-w-[720px]">
      <div className="flex items-center justify-between">
        <Logo />
        {user.profile_complete && <button type="button" onClick={onCancel} className="min-h-11 rounded-xl border border-[#dfe5dd] px-4 text-sm font-semibold text-[#315443] hover:bg-white">Cancel</button>}
      </div>
      <section className="mt-8 rounded-[28px] border border-[#e4e9e1] bg-white p-5 shadow-[0_18px_55px_rgba(31,65,48,.08)] sm:mt-12 sm:p-9">
        <p className="text-xs font-bold uppercase tracking-[.18em] text-[#6e9277]">{user.profile_complete ? 'Your profile' : 'A quick introduction'}</p>
        <h1 className="mt-3 font-display text-3xl font-medium tracking-[-.04em] sm:text-4xl">{user.profile_complete ? 'Update your service location.' : 'Let’s make care feel closer.'}</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-[#64736b]">Your verified phone is saved to your account. Add your name and general service area; you won’t need to enter a home address here.</p>
        <form className="mt-7 grid gap-4 sm:grid-cols-2" onSubmit={saveProfile}>
          <label className="grid gap-2 text-sm font-semibold text-[#315443] sm:col-span-2">Full name
            <input autoComplete="name" required minLength={2} maxLength={100} value={fullName} onChange={(event) => setFullName(event.target.value)} className="min-h-12 rounded-xl border border-[#dfe5dd] px-4 font-normal outline-none focus:border-[#6e9277] focus:ring-4 focus:ring-[#e7f0e5]" />
          </label>
          <label className="grid gap-2 text-sm font-semibold text-[#315443] sm:col-span-2">Verified phone number
            <input type="tel" value={user.phone} readOnly aria-readonly="true" className="min-h-12 rounded-xl border border-[#e4e9e1] bg-[#f7f8f4] px-4 font-normal text-[#64736b]" />
          </label>
          <label className="grid gap-2 text-sm font-semibold text-[#315443]">City
            <input autoComplete="address-level2" required minLength={2} maxLength={100} value={city} onChange={(event) => setCity(event.target.value)} className="min-h-12 rounded-xl border border-[#dfe5dd] px-4 font-normal outline-none focus:border-[#6e9277] focus:ring-4 focus:ring-[#e7f0e5]" />
          </label>
          <label className="grid gap-2 text-sm font-semibold text-[#315443]">Area / locality
            <input autoComplete="address-level3" required minLength={2} maxLength={120} value={area} onChange={(event) => setArea(event.target.value)} className="min-h-12 rounded-xl border border-[#dfe5dd] px-4 font-normal outline-none focus:border-[#6e9277] focus:ring-4 focus:ring-[#e7f0e5]" />
          </label>
          <label className="grid gap-2 text-sm font-semibold text-[#315443] sm:col-span-2">PIN code
            <input autoComplete="postal-code" inputMode="numeric" pattern="[1-9][0-9]{5}" required minLength={6} maxLength={6} value={pincode} onChange={(event) => setPincode(event.target.value.replace(/\D/g, '').slice(0, 6))} className="min-h-12 rounded-xl border border-[#dfe5dd] px-4 font-normal outline-none focus:border-[#6e9277] focus:ring-4 focus:ring-[#e7f0e5]" />
            <span className="text-xs font-normal text-[#849188]">Enter a valid six-digit Indian PIN code.</span>
          </label>
          <div className="sm:col-span-2">
            <div className="rounded-2xl border border-[#e2ebe1] bg-[#f7faf6] p-4">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                <div><p className="flex items-center gap-2 text-sm font-semibold text-[#315443]"><MapPin size={16} aria-hidden="true" /> Optional: use current location</p><p className="mt-1 text-xs leading-5 text-[#738178]">Only shared after you choose; coordinates help the existing caregiver distance filter.</p></div>
                <button type="button" onClick={useCurrentLocation} disabled={isLocating} className="min-h-11 shrink-0 rounded-xl border border-[#cbdacb] bg-white px-4 text-sm font-semibold text-[#315443] hover:bg-[#edf3ed] disabled:opacity-60">{isLocating ? 'Getting location…' : location ? 'Refresh GPS location' : 'Use my location'}</button>
              </div>
              {location && <div className="mt-3 flex items-center justify-between gap-3 border-t border-[#e2ebe1] pt-3 text-xs text-[#64736b]"><span>GPS coordinates saved for matching.</span><button type="button" onClick={() => { setLocation(null); setLocationMessage('GPS location removed.') }} className="font-semibold text-[#315443] underline underline-offset-2">Remove</button></div>}
              {locationMessage && <p role="status" className="mt-3 text-xs text-[#597065]">{locationMessage}</p>}
            </div>
          </div>
          <p className="text-xs leading-5 text-[#849188] sm:col-span-2">City, area, and PIN code are saved to your profile. They do not by themselves confirm caregiver coverage. No exact home address is requested.</p>
          {error && <p role="alert" className="text-sm text-[#9a4d39] sm:col-span-2">{error}</p>}
          <div className="flex flex-col gap-3 pt-1 sm:col-span-2 sm:flex-row sm:items-center">
            <button type="submit" disabled={isSaving || isLocating} className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-[#174a39] px-5 text-sm font-semibold text-white hover:bg-[#24634d] disabled:opacity-60">{isSaving ? 'Saving profile…' : user.profile_complete ? 'Save profile' : 'Save and continue'} <ArrowRight size={17} /></button>
            {!user.profile_complete && <button type="button" disabled={isSigningOut} onClick={() => void signOut()} className="min-h-12 rounded-xl border border-[#dfe5dd] px-5 text-sm font-semibold text-[#315443] hover:bg-[#f7f8f4]">{isSigningOut ? 'Signing out…' : 'Continue without an account'}</button>}
          </div>
        </form>
      </section>
    </div>
  </main>
}

function LivingHome({ onStart, onEmergency, user, isCheckingSession, authMode, authStatus, onAuthModeChange, onAuthenticated, onHistory, onLogout, onEditProfile }: {
  onStart: () => void
  onEmergency: () => void
  user: AuthUser | null
  isCheckingSession: boolean
  authMode: AuthMode
  authStatus: string
  onAuthModeChange: (mode: AuthMode) => void
  onAuthenticated: (user: AuthUser) => void
  onHistory: () => void
  onLogout: () => Promise<void>
  onEditProfile: () => void
}) {
  const [active, setActive] = useState(0)
  const closeAuth = useCallback(() => onAuthModeChange(null), [onAuthModeChange])
  useEffect(() => {
    const observer = new IntersectionObserver(entries => entries.forEach(entry => { if (entry.isIntersecting) setActive(Number((entry.target as HTMLElement).dataset.step)) }), { threshold: 0.45 })
    document.querySelectorAll('[data-step]').forEach(section => observer.observe(section))
    return () => observer.disconnect()
  }, [])
  const jump = (id: string, step: number) => {
    setActive(step)
    document.getElementById(id)?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      block: 'start'
    })
  }
  return <main className="cura-living min-h-screen overflow-hidden bg-[#f7f8f4] text-[#193c3b]">
    <header className="cura-living-header"><a href="#living-top" className="cura-home-brand" aria-label="Cura home"><span className="cura-brand-mark"><HeartPulse size={20} strokeWidth={2.2} aria-hidden="true" /></span><span className="cura-brand-name">Cura</span></a><nav className="cura-home-links" aria-label="Main navigation"><a href="#how-it-works">How it works</a><a href="#about-cura">About</a><a href="#caregiver-support">Caregiver support</a><a href="#help-cura">Help</a></nav><div className="cura-header-actions">{isCheckingSession ? <span className="cura-auth-checking" role="status">Checking account…</span> : user ? <><button type="button" className="cura-login-link" aria-haspopup="dialog" onClick={() => onAuthModeChange('account')}>My account</button><button type="button" className="cura-account-button" onClick={onHistory}><History size={15} aria-hidden="true" /> History</button></> : <><button type="button" className="cura-login-link" aria-haspopup="dialog" onClick={() => onAuthModeChange('login')}>Log in</button><button type="button" className="cura-account-button" aria-haspopup="dialog" onClick={() => onAuthModeChange('signup')}>Create account</button><button type="button" className="cura-history-link" onClick={onHistory}><History size={15} aria-hidden="true" /> History</button></>}<button onClick={onEmergency} className="cura-urgent"><Phone size={15} aria-hidden="true" /> Urgent help</button></div></header>
    {authStatus && <p className="cura-auth-page-status" role="status">{authStatus}</p>}
    <section id="living-top" className="cura-living-hero"><div className="cura-hero-copy"><p className="cura-kicker"><span className="cura-kicker-dot" /> Compassionate guidance, one step at a time</p><h1 className="font-display">Care starts<br /><em>with listening.</em></h1><p className="cura-hero-intro">Tell us what’s going on, in your own words. CURA can help you explore a next step and connect with care that fits.</p><div className="cura-hero-actions"><button onClick={onStart} className="cura-primary-cta">Start your care journey <ArrowRight size={18} aria-hidden="true" /></button><button onClick={onEmergency} className="cura-text-cta"><Phone size={15} aria-hidden="true" /> I need urgent help</button></div><div className="cura-trust-note"><ShieldCheck size={18} aria-hidden="true" /><span>Clear guidance. Human care. You stay in control.</span></div></div><div className="cura-hero-illustration" role="img" aria-label="Illustration of a patient talking with a caregiver"><div className="cura-illustration-note"><HeartPulse size={16} aria-hidden="true" /> A little support can go a long way</div><svg viewBox="0 0 560 430" fill="none" xmlns="http://www.w3.org/2000/svg"><path className="cura-illustration-orbit" d="M55 325C24 164 155 47 305 58C459 70 545 185 508 322" /><path className="cura-illustration-path" d="M73 321C158 265 172 166 245 190C305 210 296 300 369 270C421 249 418 174 488 135" /><circle className="cura-illustration-node" cx="245" cy="190" r="10" /><circle className="cura-illustration-node" cx="369" cy="270" r="10" /><circle className="cura-illustration-node" cx="488" cy="135" r="10" /><path className="cura-person-shadow" d="M82 368C91 310 124 276 169 276C216 276 249 310 257 368" /><path className="cura-person-body" d="M97 361C104 316 129 289 169 289C207 289 232 318 240 361" /><path className="cura-person-head" d="M139 238C139 207 158 184 184 184C210 184 228 207 228 238C228 270 210 291 184 291C158 291 139 270 139 238Z" /><path className="cura-person-hair" d="M139 235C135 201 158 176 185 176C211 176 232 197 229 232C218 221 214 207 212 197C194 213 172 221 146 222" /><path className="cura-person-shadow" d="M315 368C323 305 356 264 410 264C465 264 496 307 504 368" /><path className="cura-caregiver-body" d="M333 360C342 311 369 279 410 279C450 279 478 312 486 360" /><path className="cura-caregiver-head" d="M374 226C374 193 393 171 419 171C445 171 464 193 464 226C464 258 445 279 419 279C393 279 374 258 374 226Z" /><path className="cura-caregiver-hair" d="M374 223C369 188 392 162 420 162C447 162 469 184 464 222C453 208 449 194 447 183C429 201 406 208 380 210" /><path className="cura-caregiver-coat" d="M383 292L409 327L438 292M408 327V361" /><path className="cura-heart-mark" d="M279 119C269 104 246 108 246 126C246 142 279 160 279 160C279 160 312 142 312 126C312 108 289 104 279 119Z" /><path className="cura-heart-line" d="M255 132H269L276 121L286 143L293 132H304" /></svg><span className="cura-figure-label">Listen · understand · connect</span></div></section>
    <nav className="cura-path-nav" aria-label="Care journey">{[['Listen','living-listen'],['Understand','how-it-works'],['Connect','caregiver-support']].map(([label,id], i) => <a key={id} href={`#${id}`} onClick={() => setActive(i)} className={active === i ? 'is-active' : ''}><span>0{i + 1}</span>{label}<ChevronRight size={15} aria-hidden="true" /></a>)}</nav>
    <section id="living-listen" data-step="0" className="cura-living-section cura-listen"><div className="cura-section-number">01</div><div><p className="cura-kicker">01 / Tell your story</p><h2 className="font-display">Start where you are.</h2><p>Describe what you or someone you care for is experiencing. There’s no perfect way to say it; we’ll take it one step at a time.</p><button onClick={onStart} className="cura-outline-cta">Start your care journey <ArrowRight size={17} aria-hidden="true" /></button></div><div className="cura-section-art" aria-hidden="true"><div className="cura-art-circle"><HeartPulse size={42} /></div><span>Listen first</span></div></section>
    <section id="how-it-works" data-step="1" className="cura-living-section cura-understand"><div className="cura-section-number">02</div><div><p className="cura-kicker">How CURA works</p><h2 className="font-display">A clearer next step, one conversation at a time.</h2><p>Share a concern, answer relevant follow-up questions, then review the care-navigation response. Urgent concerns are handled first.</p><a className="cura-section-link" href="#about-cura">Learn more about CURA <ArrowRight size={16} aria-hidden="true" /></a></div><div className="cura-question-stack"><span><HeartPulse size={17} aria-hidden="true" /><b>01</b> Describe what’s happening</span><span><CircleHelp size={17} aria-hidden="true" /><b>02</b> Answer relevant questions</span><span><UserRound size={17} aria-hidden="true" /><b>03</b> Explore a care next step</span></div></section>
    <section id="caregiver-support" data-step="2" className="cura-living-section cura-connect"><div className="cura-section-number">03</div><div><p className="cura-kicker">Caregiver support</p><h2 className="font-display">Explore available human support.</h2><p>After triage, CURA can show caregiver matches returned by the care service. Availability varies; demo booking is confirmed by the backend.</p><button onClick={onStart} className="cura-primary-cta">Check care options <ArrowRight size={18} aria-hidden="true" /></button></div><div className="cura-connect-mark"><HeartPulse size={42} aria-hidden="true" /><span>Care is a human connection</span></div></section>
    <section id="about-cura" className="cura-about-section"><div className="cura-about-copy"><p className="cura-kicker">About CURA</p><h2 className="font-display">Care navigation that starts by listening.</h2><p>CURA helps people describe a health concern in their own words, considers their answers to follow-up questions, and suggests a possible care pathway. When matches are available, people can explore caregiver details and demo visit times.</p><p>It is designed for people seeking support for themselves or someone they care for. It does not confirm a diagnosis or replace advice from a qualified healthcare professional.</p></div><div className="cura-about-aside"><ShieldCheck size={25} aria-hidden="true" /><h3>Know what to expect</h3><p>Your responses shape the conversation. If there isn’t enough information to suggest a safe next step, CURA says so and recommends professional evaluation.</p><a href="#help-cura">Read help & safety information <ArrowRight size={16} aria-hidden="true" /></a></div></section>
    <section id="help-cura" className="cura-help-section"><div><p className="cura-kicker">Help & safety</p><h2 className="font-display">A few things to know.</h2></div><div className="cura-help-list"><article><h3>Is this a diagnosis?</h3><p>No. CURA provides general care-navigation guidance, not a confirmed diagnosis.</p></article><article><h3>What if I need urgent help?</h3><p>Use the urgent-help option for guidance. CURA cannot contact emergency services for you.</p><button onClick={onEmergency}>Open urgent-help guidance <ArrowRight size={16} aria-hidden="true" /></button></article><article><h3>Can I book a caregiver?</h3><p>If the care service returns caregiver matches and open demo slots, you can review them and submit a booking for backend confirmation.</p></article></div></section>
    <section className="cura-safety-note" aria-label="Important care information"><ShieldCheck size={21} aria-hidden="true" /><p>CURA offers general care-navigation guidance, not a diagnosis. If someone may be in immediate danger, contact local emergency services.</p><button onClick={onEmergency}>Urgent help <ArrowRight size={16} aria-hidden="true" /></button></section>
    <footer className="cura-living-footer"><a href="#living-top" className="cura-footer-brand">Cura <span>Care, with clarity.</span></a><nav aria-label="Footer navigation"><a href="#about-cura">About CURA</a><a href="#help-cura">Help & safety</a><button type="button" onClick={onHistory}>History</button><button type="button" aria-haspopup="dialog" onClick={() => onAuthModeChange(user ? 'account' : 'login')}>{user ? 'My account' : 'Log in'}</button></nav><button onClick={onEmergency}>Emergency support</button></footer>
    {authMode && <PhoneAuthDialog mode={authMode} user={user} statusMessage={authStatus} onClose={closeAuth} onModeChange={onAuthModeChange} onAuthenticated={onAuthenticated} onHistory={onHistory} onLogout={onLogout} onEditProfile={onEditProfile} />}
  </main>
}

export default function CuraApp() {
  const [screen, setScreen] = useState<Screen>('home')
  const [authMode, setAuthMode] = useState<AuthMode>(null)
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)
  const [isCheckingSession, setIsCheckingSession] = useState(true)
  const [authStatus, setAuthStatus] = useState('')
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

  useEffect(() => {
    let cancelled = false
    getCurrentUser().then((result) => {
      if (!cancelled) {
        setAuthUser(result.user)
        if (result.user && !result.user.profile_complete) setScreen('onboarding')
      }
    }).catch((requestError) => {
      if (!cancelled) setAuthStatus(requestError instanceof Error ? requestError.message : 'Your sign-in status could not be checked.')
    }).finally(() => {
      if (!cancelled) setIsCheckingSession(false)
    })
    return () => { cancelled = true }
  }, [])

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
      const result = await uiTriage({ user_input: input, language: languageCode, conversation_history: [], location: authUser?.location || undefined })
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
      const result = await uiTriage({ user_input: answer, language: languageCode, conversation_history: conversationHistory, location: authUser?.location || undefined })
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

    const SpeechRecognition = (window as SpeechRecognitionWindow).SpeechRecognition
      || (window as SpeechRecognitionWindow).webkitSpeechRecognition
    if (!SpeechRecognition) return

    const recognition = new SpeechRecognition()
    recognition.lang = language === 'Hindi' ? 'hi-IN' : 'en-IN'
    recognition.continuous = false
    recognition.interimResults = false
    recognition.onresult = event => {
      const transcript = event.results[event.resultIndex]?.[0]?.transcript
      if (transcript) setAnswerDraft(previous => `${previous} ${transcript}`.trim())
    }
    recognition.onerror = () => setFollowupVoiceError('Voice input was not available. You can type your answer instead.')
    recognition.onend = () => {
      setIsFollowupListening(false)
      followupRecognition.current = null
    }
    followupRecognition.current = recognition
    setFollowupVoiceError('')
    setIsFollowupListening(true)
    recognition.start()
  }
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
  const openHistory = () => {
    setAuthMode(null)
    setScreen('history')
  }
  const signOut = async () => {
    await logout()
    setAuthUser(null)
    setAuthStatus('')
    setAuthMode(null)
    setScreen('home')
  }
  const layoutClass = 'mx-auto flex min-h-[calc(100vh-82px)] w-full max-w-[1180px] flex-col px-5 pb-10 sm:px-10'
  if (screen === 'onboarding' && authUser) return <ProfileOnboarding
    user={authUser}
    onComplete={(user) => { setAuthUser(user); setScreen('home'); setAuthStatus('') }}
    onCancel={() => setScreen('home')}
    onSignOut={signOut}
  />
  if (screen === 'home') return <LivingHome
    onStart={beginAssessment}
    onEmergency={emergency}
    user={authUser}
    isCheckingSession={isCheckingSession}
    authMode={authMode}
    authStatus={authStatus}
    onAuthModeChange={setAuthMode}
    onAuthenticated={(user) => { setAuthUser(user); setAuthStatus(''); setAuthMode(null); if (!user.profile_complete) setScreen('onboarding') }}
    onHistory={openHistory}
    onLogout={signOut}
    onEditProfile={() => { setAuthMode(null); setScreen('onboarding') }}
  />
  if (screen === 'history') return <BookingHistoryScreen
    user={authUser}
    isCheckingSession={isCheckingSession}
    authStatus={authStatus}
    onBack={() => setScreen('home')}
    onLogin={() => { setScreen('home'); setAuthMode('login') }}
    onEmergency={emergency}
    onSessionExpired={() => { setAuthUser(null); setAuthStatus('Your sign-in session expired. Log in again to view booking history.') }}
  />
  if (screen === 'success' && !bookingConfirmation) return <main className="min-h-screen bg-[#fbfcf8]"><Header onEmergency={emergency} onReset={reset} showBack onBack={reset} /><div className="mx-auto max-w-[680px] px-5 py-16 text-center"><p role="alert" className="text-sm text-[#9a4d39]">No booking confirmation was received. The visit is not shown as booked.</p><button onClick={reset} className="mt-7 min-h-12 rounded-2xl border border-[#dfe5dd] px-5 text-sm font-semibold text-[#174a39]">Return to Cura</button></div></main>
  if (screen === 'success' && bookingConfirmation) return <main className="min-h-screen bg-[#fbfcf8]"><Header onEmergency={emergency} onReset={reset} /><div className="flex min-h-[calc(100vh-82px)] flex-col items-center justify-center px-5 text-center"><div className="grid size-20 place-items-center rounded-[28px] bg-[#e7f0e5] text-[#4f8062]"><Check size={38} /></div><p className="mt-8 text-sm font-semibold uppercase tracking-[.16em] text-[#6e9277]">Booking confirmed</p><h1 className="mt-3 font-display text-4xl font-medium tracking-[-.04em] text-[#174a39]">Your demo visit is booked.</h1><p className="mt-4 text-[#64736b]">{bookingConfirmation.booking.caregiver_name} · {bookingConfirmation.booking.slot_time}</p><p className="mt-2 text-xs text-[#849188]">Confirmation {bookingConfirmation.booking.booking_id}</p><p className="mt-5 max-w-lg text-sm text-[#64736b]">{bookingConfirmation.notice}</p><div className="mt-8 flex flex-col gap-3 sm:flex-row"><button onClick={reset} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[#174a39] px-5 text-sm font-semibold text-white hover:bg-[#24634d]">Start over <RotateCcw size={16} /></button><button onClick={() => setScreen('caregivers')} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-[#dfe5dd] px-5 text-sm font-semibold text-[#315443] hover:bg-[#edf3ed]">View caregivers</button></div></div></main>
  if (screen === 'emergency' && isEscalatingEmergency) return <main className="min-h-screen bg-[#fbfcf8]"><Header onEmergency={emergency} onReset={reset} showBack onBack={reset} /><div className="mx-auto flex max-w-[680px] flex-col items-center px-5 py-12 text-center sm:py-20"><div className="grid size-20 place-items-center rounded-[28px] bg-[#fff0eb] text-[#ad5b43]"><AlertTriangle size={37} /></div><p className="mt-8 text-sm font-semibold uppercase tracking-[.16em] text-[#ad5b43]">Emergency response</p><h1 className="mt-3 font-display text-4xl font-medium tracking-[-.04em] text-[#174a39] sm:text-5xl">Please act now.</h1>{emergencyError ? <p role="alert" className="mt-5 max-w-[520px] text-lg leading-8 text-[#9a4d39]">{emergencyError} The request was not confirmed.</p> : <p className="mt-5 text-[#64736b]">Loading emergency guidance…</p>}<button onClick={reset} className="mt-8 flex min-h-12 items-center gap-2 rounded-2xl border border-[#dfe5dd] px-5 text-sm font-semibold text-[#174a39] hover:bg-[#edf3ed]"><ArrowLeft size={16} /> Return to Cura</button></div></main>
  if (screen === 'emergency') return <EmergencyScreen onReturn={reset} emergencyAction={emergencyAction} redFlags={emergencyRedFlags} />
  if (screen === 'intake') return <main className="min-h-screen bg-[#fbfcf8]"><Header onEmergency={emergency} onReset={reset} showBack onBack={reset} /><div className={layoutClass}><div className="mx-auto w-full max-w-[720px] pt-8 sm:pt-14"><DemoNote /><div className="mt-10 flex items-center justify-between"><div><p className="text-sm font-semibold text-[#6e9277]">Step 1 of 4</p><h1 className="mt-2 font-display text-4xl font-medium tracking-[-.04em] text-[#174a39]">How are you feeling?</h1></div><Languages className="text-[#8bae91]" size={29} /></div><p className="mt-4 text-[#64736b]">Share in your own words. There are no wrong answers.</p><div className="mt-8 flex gap-2" role="group" aria-label="Language"><span className="mr-1 self-center text-xs font-semibold text-[#849188]">Language:</span>{['English', 'Hindi', 'Hinglish'].map(item => <button key={item} onClick={() => setLanguage(item)} className={`rounded-full px-3.5 py-2 text-xs font-semibold transition ${language === item ? 'bg-[#174a39] text-white' : 'border border-[#dfe5dd] text-[#64736b] hover:bg-[#edf3ed]'}`}>{item}</button>)}</div><div className="relative mt-7"><textarea aria-label="Describe your symptoms" value={symptoms} onChange={e => { setSymptoms(e.target.value); setInputError('') }} placeholder={language === 'Hindi' ? 'आप कैसा महसूस कर रहे हैं?' : 'For example, “I have had a headache since yesterday…”'} className="min-h-44 w-full resize-none rounded-3xl border border-[#dce5dd] bg-white p-5 pr-14 text-base leading-7 text-[#274a3a] outline-none transition placeholder:text-[#a2afa6] focus:border-[#77a687] focus:ring-4 focus:ring-[#e3f0e5]" /><button aria-label="Use microphone" onClick={startListening} className={`absolute bottom-4 right-4 grid size-11 place-items-center rounded-2xl ${isListening ? 'bg-[#ad5b43] text-white' : 'bg-[#e9f3e9] text-[#4f8062]'} transition hover:bg-[#dcecdf]`}><Mic size={19} /></button></div>{inputError && <p role="alert" className="mt-3 text-sm leading-6 text-[#9a4d39]">{inputError}</p>}<div className="mt-5 flex flex-wrap gap-2"><span className="mr-1 py-2 text-xs text-[#849188]">Common:</span>{['Headache', 'Fever', 'Body pain', 'Tiredness', 'Stomach discomfort'].map(item => <button key={item} onClick={() => { setSymptoms(prev => prev ? `${prev}, ${item.toLowerCase()}` : item); setInputError('') }} className="rounded-full border border-[#dfe5dd] bg-white px-3.5 py-2 text-xs font-medium text-[#64736b] hover:border-[#9bbb9f] hover:text-[#174a39]">{item}</button>)}</div><div className="mt-10 flex justify-end"><button onClick={submitSymptoms} disabled={!symptoms.trim() || isLoading} className="flex min-h-13 items-center gap-3 rounded-2xl bg-[#174a39] px-6 font-semibold text-white transition hover:bg-[#24634d] disabled:cursor-not-allowed disabled:opacity-40">{isLoading ? 'Checking…' : 'Continue'} <ArrowRight size={18} /></button></div></div></div></main>
  if (screen === 'questions') return <main className="cura-question-page min-h-screen bg-[#fbfcf8]">
    <Header onEmergency={emergency} onReset={reset} showBack onBack={() => { setAnswerDraft(''); setScreen('intake') }} conversation={conversationHistory} />
    <div className={layoutClass}>
      <div className="cura-question-content mx-auto w-full max-w-[680px] pt-10 sm:pt-16">
        <div className="cura-question-heading">
          <span className="cura-step-label"><span /> A quick follow-up</span>
          <h1 className="mt-4 font-display text-4xl font-medium leading-tight tracking-[-.045em] text-[#174a39] sm:text-5xl">{recommendation?.follow_up_question}</h1>
          <p className="mt-4 text-[#64736b]">Your answer helps clarify the next step. Share as much or as little as you can.</p>
        </div>
        <section className="cura-question-card" aria-label="Your answer">
          <div className="flex gap-2" role="group" aria-label="Voice input language">
            {(['English', 'Hindi', 'Hinglish'] as const).map((option) => <button key={option} type="button" aria-pressed={language === option} onClick={() => setLanguage(option)} className={`cura-language-option ${language === option ? 'is-selected' : ''}`}>{option}</button>)}
          </div>
          <div className="cura-answer-composer">
            <textarea aria-label="Answer follow-up question" value={answerDraft} onChange={(event) => setAnswerDraft(event.target.value)} placeholder="Type your answer here…" />
            <button type="button" aria-label={isFollowupListening ? 'Stop voice typing' : 'Start voice typing'} title={isFollowupListening ? 'Stop voice typing' : 'Start voice typing'} aria-pressed={isFollowupListening} onClick={toggleFollowupListening} className={`cura-mic-button ${isFollowupListening ? 'is-listening' : ''}`}><Mic size={19} aria-hidden="true" /></button>
          </div>
          {isFollowupListening && <p role="status" className="cura-status-message">Listening… speak your answer, then edit it if needed.</p>}
          {followupVoiceError && <p role="status" className="cura-error-message">{followupVoiceError}</p>}
          {error && <p role="alert" className="cura-error-message">{error}</p>}
          <div className="cura-composer-actions"><span><ShieldCheck size={15} aria-hidden="true" /> Your response guides the next question</span><button onClick={() => chooseAnswer(answerDraft)} disabled={!answerDraft.trim() || isLoading} className="cura-primary-cta">Continue <ArrowRight size={17} aria-hidden="true" /></button></div>
        </section>
      </div>
    </div>
  </main>

  if (screen === 'error') return <main className="min-h-screen bg-[#fbfcf8]"><Header onEmergency={emergency} onReset={reset} showBack onBack={reset} /><div className="mx-auto flex max-w-[680px] flex-col items-center px-5 py-16 text-center"><div className="grid size-16 place-items-center rounded-[24px] bg-[#fff0eb] text-[#ad5b43]"><CircleHelp size={30} /></div><h1 className="mt-7 font-display text-3xl font-medium text-[#174a39]">Care service unavailable</h1><p role="alert" className="mt-4 text-base leading-7 text-[#64736b]">{error}</p><button onClick={reset} className="mt-7 flex min-h-12 items-center gap-2 rounded-2xl border border-[#dfe5dd] px-5 text-sm font-semibold text-[#174a39] hover:bg-[#edf3ed]">Return to Cura</button></div></main>

  if (screen === 'recommendation' && recommendation) return <main className="min-h-screen bg-[#fbfcf8]"><Header onEmergency={emergency} onReset={reset} showBack onBack={() => setScreen('intake')} /><div className={layoutClass}><div className="mx-auto w-full max-w-[820px] pt-8 sm:pt-12"><DemoNote /><div className="mt-9 flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><p className="text-sm font-semibold text-[#6e9277]">Your suggested next step</p><h1 className="mt-2 font-display text-4xl font-medium tracking-[-.045em] text-[#174a39] sm:text-5xl">Support that fits your needs.</h1></div><span className="w-fit rounded-full bg-[#e6f1e6] px-3.5 py-2 text-xs font-bold text-[#47785c]">Backend recommendation</span></div><div className="mt-8 grid gap-4 md:grid-cols-[1.15fr_.85fr]"><div className="rounded-3xl bg-[#174a39] p-6 text-white sm:p-8"><div className="flex items-start justify-between"><div><p className="text-sm text-[#bdd7c2]">Recommended care type</p><h2 className="mt-3 font-display text-3xl font-medium tracking-[-.04em]">{recommendation.care_type}</h2></div><div className="grid size-12 place-items-center rounded-2xl bg-white/10"><UserRound size={24} /></div></div><div className="mt-9 flex gap-8 border-t border-white/15 pt-5"><div><p className="text-xs text-[#bdd7c2]">Urgency</p><p className="mt-1 font-semibold">{recommendation.urgency}</p></div>{confidence !== null && <div><p className="text-xs text-[#bdd7c2]">Confidence</p><p className="mt-1 font-semibold">{Math.round(confidence * 100)}%</p></div>}</div></div><div className="rounded-3xl border border-[#dfe8dc] bg-[#f3f8f0] p-6"><div className="flex items-center gap-2 text-sm font-bold text-[#315443]"><CircleHelp size={17} /> Why this suggestion?</div><p className="mt-4 text-sm leading-6 text-[#64736b]">{recommendation.reasoning}</p></div></div><div className="mt-5 flex flex-col items-start justify-between gap-4 rounded-3xl border border-[#dfe5dd] bg-white p-6 sm:flex-row sm:items-center"><div><p className="text-xs font-semibold uppercase tracking-[.12em] text-[#849188]">Matched caregivers</p><p className="mt-1 text-sm text-[#52665a]">{recommendation.matched_caregivers.length} backend match{recommendation.matched_caregivers.length === 1 ? '' : 'es'}</p></div><button onClick={() => setScreen('caregivers')} disabled={isLoadingCaregivers} className="flex min-h-12 shrink-0 items-center gap-2 rounded-2xl bg-[#174a39] px-5 text-sm font-semibold text-white hover:bg-[#24634d] disabled:opacity-50">{isLoadingCaregivers ? 'Loading matches…' : 'See caregiver matches'} <ArrowRight size={17} /></button></div>{error && <p role="alert" className="mt-4 text-sm text-[#9a4d39]">{error}</p>}</div></div></main>
  if (screen === 'caregivers') return <main className="min-h-screen bg-[#fbfcf8]"><Header onEmergency={emergency} onReset={reset} showBack onBack={() => setScreen('recommendation')} /><div className={layoutClass}><div className="mx-auto w-full max-w-[820px] pt-8 sm:pt-12"><p className="text-sm font-semibold text-[#6e9277]">Caregiver matches</p><div className="mt-2 flex items-end justify-between gap-4"><div><h1 className="font-display text-4xl font-medium tracking-[-.045em] text-[#174a39]">People who can help.</h1><p className="mt-3 text-[#64736b]">Matches and availability returned by the care service.</p></div><UserRound className="hidden text-[#8bae91] sm:block" size={32} /></div>{isLoadingCaregivers ? <p role="status" className="mt-8 text-sm text-[#64736b]">Loading caregiver matches…</p> : error ? <p role="alert" className="mt-8 text-sm text-[#9a4d39]">{error}</p> : caregivers.length === 0 ? <p className="mt-8 rounded-3xl border border-[#dfe5dd] bg-white p-6 text-sm leading-6 text-[#64736b]">No active caregivers matched this recommendation.</p> : <div className="mt-8 space-y-3">{caregivers.map((person, index) => <article key={person.caregiver_id} className={`rounded-3xl border bg-white p-5 transition ${selectedCaregiver?.caregiver_id === person.caregiver_id ? 'border-[#6f9d7c] ring-4 ring-[#e5f0e5]' : 'border-[#dfe5dd]'}`}><div className="flex flex-col gap-5 sm:flex-row sm:items-center"><div className={`grid size-14 shrink-0 place-items-center rounded-2xl text-lg font-semibold text-[#315443] ${person.color}`}>{person.initials}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="font-display text-xl font-semibold text-[#234d3b]">{person.name}</h2>{index === 0 && <span className="rounded-full bg-[#e8f2e8] px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[#4d7c5c]">Best match</span>}</div><p className="mt-1 text-sm text-[#64736b]">{person.role}{person.qualification ? ` · ${person.qualification}` : ''}</p><div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-[#77877d]">{person.location?.address && <span className="flex items-center gap-1"><MapPin size={13} />{person.location.address}</span>}<span className="flex items-center gap-1"><Languages size={13} />{person.languages.join(' · ')}</span><span className="flex items-center gap-1"><Star size={13} />{person.rating}</span></div></div><div className="flex items-center justify-between gap-4 sm:block sm:text-right"><span className="text-sm font-semibold text-[#315443]">{Math.round(person.score * 100)}% match</span><button onClick={() => { setSelectedCaregiver(person); setSelectedSlot(null); setError(''); setScreen('booking') }} className="mt-2 flex min-h-11 items-center gap-2 rounded-xl bg-[#edf5eb] px-4 text-sm font-semibold text-[#315443] hover:bg-[#deedde]">View & book <ChevronRight size={15} /></button></div></div><div className="mt-4 flex items-start gap-2 border-t border-[#edf0eb] pt-4 text-xs leading-5 text-[#6a7b70]"><Sparkles size={14} className="mt-0.5 shrink-0 text-[#6e9277]" /><span><b className="text-[#4b6655]">Why this match?</b> {person.reason}</span></div></article>)}</div>}</div></div></main>
  if (screen === 'booking' && selectedCaregiver) return <main className="min-h-screen bg-[#fbfcf8]"><Header onEmergency={emergency} onReset={reset} showBack onBack={() => { setError(''); setScreen('caregivers') }} /><div className={layoutClass}><div className="mx-auto w-full max-w-[680px] pt-8 sm:pt-12"><p className="text-sm font-semibold text-[#6e9277]">Book a demo visit</p><h1 className="mt-2 font-display text-4xl font-medium tracking-[-.045em] text-[#174a39]">Choose a time with {selectedCaregiver.name.split(' ')[0]}.</h1><div className="mt-8 rounded-3xl border border-[#dfe5dd] bg-white p-5 sm:p-6"><div className="flex items-center gap-4"><div className={`grid size-14 place-items-center rounded-2xl text-lg font-semibold text-[#315443] ${selectedCaregiver.color}`}>{selectedCaregiver.initials}</div><div><p className="font-semibold text-[#234d3b]">{selectedCaregiver.name}</p><p className="mt-1 text-sm text-[#64736b]">{selectedCaregiver.role}</p></div></div><div className="mt-7"><p className="text-sm font-semibold text-[#315443]">Available times</p>{selectedCaregiver.availability_slots.filter((slot) => slot.status === 'available' && !slot.is_booked).length === 0 ? <p className="mt-3 text-sm text-[#64736b]">No available slots were returned.</p> : <div className="mt-3 grid gap-2 sm:grid-cols-2">{selectedCaregiver.availability_slots.filter((slot) => slot.status === 'available' && !slot.is_booked).map((slot) => { const label = [slot.date, slot.time, slot.end_time ? `until ${slot.end_time}` : ''].filter(Boolean).join(' · '); return <button key={slot.slot_id} onClick={() => setSelectedSlot(slot)} className={`flex min-h-12 items-center gap-3 rounded-xl border px-4 text-left text-sm font-medium transition ${selectedSlot?.slot_id === slot.slot_id ? 'border-[#679379] bg-[#edf5eb] text-[#315443]' : 'border-[#e3e8e1] text-[#64736b] hover:border-[#9bbb9f]'}`}><CalendarDays size={16} />{label}{selectedSlot?.slot_id === slot.slot_id && <Check size={15} className="ml-auto" />}</button> })}</div>}</div></div><div className="mt-4 rounded-2xl bg-[#f3f8f0] px-4 py-3 text-xs leading-5 text-[#64736b]">Demo booking only. The backend confirms whether the booking was saved.</div>{error && <p role="alert" className="mt-4 text-sm text-[#9a4d39]">{error}</p>}<button onClick={confirmBooking} disabled={!selectedSlot || isBooking} className="mt-7 flex min-h-13 w-full items-center justify-center gap-2 rounded-2xl bg-[#174a39] font-semibold text-white hover:bg-[#24634d] disabled:cursor-not-allowed disabled:opacity-40">{isBooking ? 'Confirming…' : 'Confirm demo booking'} <Check size={18} /></button></div></div></main>

}
function LockIcon() { return <span className="grid size-4 place-items-center rounded-full border border-[#9caf9f] text-[9px]">✓</span> }
