export type LeadScoringInput = {
  budget?: string
  company?: string
  contact: { email?: string; phone?: string }
  country?: string
  hasDrawings?: boolean
  productInterest?: string
  procurementPlan?: string
  projectStage?: 'concept' | 'design' | 'procurement' | 'tender'
  quantitySquareMeters?: number
  timeline?: 'exploring' | 'within_3_months' | 'within_6_months' | 'within_12_months'
}

export type LeadQualificationField =
  | 'budget'
  | 'company'
  | 'contact'
  | 'country'
  | 'drawings'
  | 'projectStage'
  | 'quantity'
  | 'timeline'

export type LeadIntentScore = {
  handoffRecommended: boolean
  level: 'a' | 'b' | 'c'
  missingFields: LeadQualificationField[]
  reasons: string[]
  score: number
}

export const scoreLeadIntent = (input: LeadScoringInput): LeadIntentScore => {
  let score = 0
  const reasons: string[] = []
  const missingFields: LeadIntentScore['missingFields'] = []

  if (input.country?.trim()) {
    score += 10
    reasons.push('target_country')
  } else {
    missingFields.push('country')
  }
  if (input.company?.trim()) {
    score += 10
    reasons.push('company_identified')
  } else {
    missingFields.push('company')
  }
  if (input.contact.email?.trim()) {
    score += input.contact.phone?.trim() ? 15 : 10
    reasons.push('contact_available')
  } else {
    if (input.contact.phone?.trim()) {
      score += 5
      reasons.push('phone_available_email_required')
    }
    missingFields.push('contact')
  }
  if (input.productInterest?.trim()) {
    score += 10
    reasons.push('product_interest')
  }
  if (input.projectStage) {
    score += input.projectStage === 'tender' || input.projectStage === 'procurement' ? 20 : 10
    reasons.push('project_stage')
  } else {
    missingFields.push('projectStage')
  }
  if (Number.isFinite(input.quantitySquareMeters) && (input.quantitySquareMeters ?? 0) > 0) {
    const quantity = input.quantitySquareMeters ?? 0
    score += quantity >= 1_000 ? 20 : quantity >= 200 ? 15 : 8
    reasons.push('project_quantity')
  } else {
    missingFields.push('quantity')
  }
  if (input.hasDrawings) {
    score += 10
    reasons.push('drawings_available')
  } else if (input.hasDrawings === undefined) {
    missingFields.push('drawings')
  } else {
    reasons.push('drawings_unavailable')
  }
  if (input.budget?.trim() || input.procurementPlan?.trim()) {
    score += 5
    reasons.push('budget_or_procurement_plan')
  } else {
    missingFields.push('budget')
  }
  if (input.timeline && input.timeline !== 'exploring') {
    score += input.timeline === 'within_3_months' ? 15 : 8
    reasons.push('purchase_timeline')
  } else {
    missingFields.push('timeline')
  }

  const normalizedScore = Math.min(score, 100)
  const level = normalizedScore >= 70 ? 'a' : normalizedScore >= 40 ? 'b' : 'c'
  return {
    handoffRecommended: level === 'a',
    level,
    missingFields,
    reasons,
    score: normalizedScore,
  }
}
