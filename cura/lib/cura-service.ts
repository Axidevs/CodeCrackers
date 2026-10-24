export type CareRecommendation = {
  careType: string
  urgency: 'Routine' | 'Soon' | 'Urgent'
  timing: string
  reasoning: string[]
  redFlags: string[]
  nextStep: string
}

export function getMockRecommendation(symptoms: string): CareRecommendation {
  const urgent = /breath|chest|faint|unconscious|severe bleeding/i.test(symptoms)
  if (urgent) {
    return {
      careType: 'Emergency help', urgency: 'Urgent', timing: 'Now',
      reasoning: ['The symptoms you shared may need immediate in-person assessment.', 'Cura is designed to be cautious when urgent warning signs are mentioned.'],
      redFlags: ['Trouble breathing, chest pressure, fainting, or heavy bleeding'],
      nextStep: 'Call your local emergency number or go to the nearest emergency department. Do not wait for a caregiver booking.',
    }
  }
  return {
    careType: 'Home visit from a caregiver', urgency: 'Soon', timing: 'Today or tomorrow',
    reasoning: ['Your symptoms sound appropriate for a supportive in-person check-in.', 'A trained caregiver can observe how you are doing and help coordinate next steps if needed.'],
    redFlags: ['Symptoms getting suddenly worse', 'New trouble breathing, confusion, fainting, or severe pain'],
    nextStep: 'Choose a caregiver who speaks your preferred language and is available near you.',
  }
}
