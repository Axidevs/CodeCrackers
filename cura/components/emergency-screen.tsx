'use client'

import { useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, Building2, Check, Copy, Phone, UsersRound } from 'lucide-react'

const focusRing = 'outline-none focus-visible:ring-2 focus-visible:ring-[#b3402a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#fbfcf8]'

const steps = [
  { icon: Phone, title: 'Call your local emergency number', body: 'Tell them what you are feeling and where you are. Stay on the line and follow their instructions.' },
  { icon: Building2, title: 'Or go to the nearest emergency department', body: 'If you can get there safely, go now. Do not drive yourself if you feel faint, confused or unwell.' },
  { icon: UsersRound, title: 'Ask someone you trust to stay with you', body: 'Let a family member, friend or neighbour know what is happening so you are not alone.' },
]

const warningSigns = [
  'Trouble breathing or chest pressure',
  'Fainting, severe confusion, or sudden weakness',
  'Heavy bleeding or severe, rapidly worsening pain',
]

const trustedMessage = 'I am not feeling well and may need urgent medical help. Can you come and stay with me, or call me as soon as you see this?'

type CopyState = 'idle' | 'copied' | 'failed'

function TrustedPersonMessage() {
  const [copyState, setCopyState] = useState<CopyState>('idle')
  const textRef = useRef<HTMLTextAreaElement>(null)

  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(trustedMessage)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
      textRef.current?.focus()
      textRef.current?.select()
    }
  }

  return <section aria-labelledby="trusted-message-heading" className="rounded-3xl border border-[#dfe5dd] bg-white p-5 sm:p-6">
    <h2 id="trusted-message-heading" className="font-semibold text-[#174a39]">Message someone you trust</h2>
    <p className="mt-1 text-sm leading-6 text-[#64736b]">Copy this message and paste it into a text or chat app.</p>
    <label htmlFor="trusted-message" className="sr-only">Message for someone you trust</label>
    <textarea id="trusted-message" ref={textRef} readOnly value={trustedMessage} rows={3} onFocus={e => e.currentTarget.select()} className={`mt-4 w-full resize-none rounded-2xl border border-[#dfe5dd] bg-[#f6f8f4] p-4 text-sm leading-6 text-[#2c3c34] ${focusRing}`} />
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <button type="button" onClick={copyMessage} className={`flex min-h-11 items-center gap-2 rounded-2xl bg-[#174a39] px-4 text-sm font-semibold text-white transition hover:bg-[#24634d] ${focusRing}`}>
        {copyState === 'copied' ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
        {copyState === 'copied' ? 'Copied' : 'Copy message'}
      </button>
      <p role="status" aria-live="polite" className="text-sm text-[#4f6358]">
        {copyState === 'copied' && 'Copied to your clipboard. It has not been sent.'}
        {copyState === 'failed' && 'Could not copy automatically. The message is selected, so you can copy it manually.'}
      </p>
    </div>
  </section>
}

export function EmergencyScreen({ onReturn }: { onReturn: () => void }) {
  return <div className="mx-auto w-full max-w-[1080px] px-5 pb-16 pt-6 sm:px-10 sm:pt-10">
    <div className="flex flex-col gap-5 rounded-[28px] border border-[#ebd6cf] bg-[#fff8f5] p-6 sm:flex-row sm:items-start sm:gap-6 sm:p-8">
      <div className="grid size-14 shrink-0 place-items-center rounded-2xl bg-[#b3402a] text-white sm:size-16" aria-hidden="true"><AlertTriangle size={28} /></div>
      <div>
        <p className="text-xs font-bold uppercase tracking-[.16em] text-[#9a3a26]">Please act now</p>
        <h1 className="mt-2 font-display text-[clamp(2rem,5vw,3.25rem)] font-medium leading-[1.05] tracking-[-.04em] text-[#174a39] text-balance">You may need urgent help.</h1>
        <p className="mt-4 max-w-[600px] text-base leading-7 text-[#4f5f57] sm:text-lg sm:leading-8 text-pretty">Please call your local emergency number or go to the nearest emergency department. If possible, ask someone you trust to stay with you.</p>
      </div>
    </div>

    <div className="mt-8 grid gap-8 lg:grid-cols-[1.15fr_.85fr] lg:gap-10">
      <section aria-labelledby="next-steps-heading">
        <h2 id="next-steps-heading" className="font-display text-2xl font-medium tracking-[-.02em] text-[#174a39]">What to do next</h2>
        <ol className="mt-4 flex flex-col gap-3">
          {steps.map(({ icon: Icon, title, body }, index) => <li key={title} className={`flex gap-4 rounded-3xl border p-5 ${index === 0 ? 'border-[#e3b9ac] bg-white shadow-[0_6px_20px_rgba(179,64,42,.08)]' : 'border-[#dfe5dd] bg-white'}`}>
            <div className="flex shrink-0 flex-col items-center gap-2">
              <span className={`grid size-11 place-items-center rounded-2xl ${index === 0 ? 'bg-[#b3402a] text-white' : 'bg-[#edf3ed] text-[#174a39]'}`} aria-hidden="true"><Icon size={20} /></span>
              <span className="text-xs font-bold text-[#7a8880]"><span className="sr-only">Step </span>{index + 1}</span>
            </div>
            <div>
              <h3 className="font-semibold leading-6 text-[#1e3b30]">{title}</h3>
              <p className="mt-1 text-sm leading-6 text-[#5a6a62]">{body}</p>
            </div>
          </li>)}
        </ol>
      </section>

      <div className="flex flex-col gap-5">
        <section aria-labelledby="warning-signs-heading" className="rounded-3xl border-l-4 border-[#b3402a] bg-[#fff4f0] p-5 sm:p-6">
          <h2 id="warning-signs-heading" className="font-semibold text-[#6f2b1d]">Do not wait for a caregiver booking if you have:</h2>
          <ul className="mt-3 flex flex-col gap-2.5">
            {warningSigns.map(sign => <li key={sign} className="flex gap-3 text-sm leading-6 text-[#5e3a30]"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-[#b3402a]" aria-hidden="true" />{sign}</li>)}
          </ul>
        </section>
        <TrustedPersonMessage />
      </div>
    </div>

    <div className="mt-10 flex flex-col items-start gap-3 border-t border-[#e4e9e2] pt-6 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-xs leading-5 text-[#6b7a72]">Cura gives general guidance only and cannot contact emergency services for you.</p>
      <button type="button" onClick={onReturn} className={`flex min-h-12 items-center gap-2 rounded-2xl border border-[#dfe5dd] px-5 text-sm font-semibold text-[#174a39] hover:bg-[#edf3ed] ${focusRing}`}><ArrowLeft size={16} aria-hidden="true" /> Return to Cura</button>
    </div>
  </div>
}
