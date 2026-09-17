import type {
  ChatLocale,
  ChatMessage,
  ChatService,
} from '@/modules/conversations/contracts'

export const createMockChatService = (initialLocale: ChatLocale = 'en'): Pick<
  ChatService,
  'getSession' | 'requestHandoff' | 'retryMessage' | 'sendMessage' | 'startSession'
> => {
  let sessionMessages: ChatMessage[] = []
  let handoffStatus: 'ai_active' | 'handoff_requested' = 'ai_active'
  const sessionId = 'mock-session-dev'
  let currentLocale: ChatLocale = initialLocale

  const getAiResponse = (query: string, loc: string): string => {
    const isAr = loc === 'ar'
    const q = query.toLowerCase()

    if (q.includes('perforated') || query.includes('مثقوبة')) {
      return isAr
        ? 'نعم، تتخصص IVYBM في تصنيع ألواح الألمنيوم المعمارية المثقوبة بدقة عالية وفق مخططات CAD/BIM، بنسب تخريم تتراوح بين 15% و65%، مع طلاء PVDF عالي التحمل أو أنودة معمارية مناسبة للواجهات الخارجية. ما هي أبعاد الألواح ومتطلبات المشروع لديكم؟'
        : 'Yes, IVYBM specializes in precision architectural perforated aluminum panels tailored to CAD/BIM facade drawings. We offer perforation ratios from 15% to 65% with 2–3 coat PVDF or architectural anodized finishes. What are your project dimensions and acoustic or shading requirements?'
    }

    if (q.includes('finish') || q.includes('surface') || query.includes('تشطيب')) {
      return isAr
        ? 'نوفر خيارات تشطيب متنوعة متوافقة مع مواصفات AAMA 2605: طلاء فلوروكربوني PVDF (ضمان 15-20 عامًا)، والأنودة المعمارية (15-25 ميكرون)، والطلاء بالبودرة عالي المتانة، وأنماط التسامي الخشبية والحجرية. ما هو التشطيب المحدد لمشروعكم؟'
        : 'We offer high-performance finishes compliant with AAMA 2605: 2/3-coat PVDF fluorocarbon coatings (15–20 year warranty), architectural anodizing (15–25 microns), architectural powder coating, and custom sublimation wood/stone grain patterns. Which finish does your specification require?'
    }

    if (q.includes('lead time') || q.includes('time') || query.includes('مدة التوريد')) {
      return isAr
        ? 'مدة التوريد المعتادة للمشاريع الخارجية هي 2–3 أسابيع لاعتماد العينات والمخططات التنفيذية، و4–6 أسابيع للإنتاج والشحن في الميناء (FOB/CIF). متى موعد التسليم المستهدف لموقع المشروع؟'
        : 'Standard lead times for overseas projects are typically 2–3 weeks for shop drawings and mock-up sample approval, and 4–6 weeks for mass fabrication and FOB/CIF delivery, with expedited air delivery available for urgent mock-ups. What is your required jobsite handover date?'
    }

    return isAr
      ? `شكرًا لتزويدنا بهذه التفاصيل (${query}). بالنسبة لواجهات الألمنيوم المصمتة والمثقوبة، يمكن لفريقنا الهندسي إعداد دراسة المخططات وحسابات أحمال الرياح وتقديم عرض أسعار أولي خلال 24–48 ساعة. هل ترغب في إرسال الرسومات أو التواصل مع مهندس الواجهات لدينا؟`
      : `Thank you for sharing your project inquiry ("${query}"). For architectural aluminum facade panels, our engineering team can review your shop drawings, assess wind-load calculations, and prepare a preliminary quotation within 24–48 hours. Would you like to share drawings or connect with our facade specialist?`
  }

  return {
    getSession: async (id) => ({
      allowedActions: handoffStatus === 'ai_active' ? ['send_message', 'request_handoff'] : ['send_message'],
      channel: 'website',
      handoffStatus,
      id: String(id),
      locale: currentLocale,
      messages: sessionMessages,
      requestId: `mock-req-${Date.now()}`,
      revision: sessionMessages.length,
    }),
    requestHandoff: async () => {
      await new Promise((resolve) => setTimeout(resolve, 500))
      handoffStatus = 'handoff_requested'
      return {
        allowedActions: ['send_message'],
        channel: 'website',
        handoffStatus,
        id: sessionId,
        locale: currentLocale,
        messages: sessionMessages,
        requestId: `mock-req-${Date.now()}`,
        revision: sessionMessages.length + 1,
      }
    },
    retryMessage: async () => {
      throw new Error('Not implemented in mock')
    },
    sendMessage: async ({ text }) => {
      await new Promise((resolve) => setTimeout(resolve, 900))
      const visitorMsg: ChatMessage = {
        author: 'visitor',
        content: text,
        createdAt: new Date().toISOString(),
        id: `mock-m-${Date.now()}-visitor`,
        status: 'sent',
      }
      const aiMsg: ChatMessage = {
        author: 'ai',
        content: getAiResponse(text, currentLocale),
        createdAt: new Date().toISOString(),
        id: `mock-m-${Date.now()}-ai`,
        status: 'sent',
      }
      sessionMessages = [...sessionMessages, visitorMsg, aiMsg]
      return {
        allowedActions: handoffStatus === 'ai_active' ? ['send_message', 'request_handoff'] : ['send_message'],
        channel: 'website',
        handoffStatus,
        id: sessionId,
        locale: currentLocale,
        messages: sessionMessages,
        requestId: `mock-req-${Date.now()}`,
        revision: sessionMessages.length,
      }
    },
    startSession: async ({ locale }) => {
      currentLocale = locale || currentLocale
      sessionMessages = []
      handoffStatus = 'ai_active'
      return {
        allowedActions: ['send_message', 'request_handoff'],
        channel: 'website',
        handoffStatus,
        id: sessionId,
        locale: currentLocale,
        messages: [],
        requestId: `mock-req-${Date.now()}`,
        revision: 1,
      }
    },
  }
}
