const { REASON, messageEnForCode } = require('./reasonCodes');
const { SUPPORTED_LOCALES } = require('../translateNews');

function normalizeLocale(locale) {
  const l = String(locale || 'en')
    .trim()
    .toLowerCase()
    .split('-')[0];
  return SUPPORTED_LOCALES.includes(l) ? l : 'en';
}

/** Локализованные тексты integrity (fallback до обновления ARB в приложении). */
const MESSAGES = {
  [REASON.GIBBERISH_NAME]: {
    en: 'The title should name the place or cleanup task only. Do not put phone numbers, card numbers, or bank details in the title — add payout or donation instructions at the end of the description.',
    ru: 'В названии укажите только место или задачу уборки. Не пишите телефон, номер карты или банковские реквизиты в названии — добавьте их в конце описания.',
    es: 'El título debe indicar solo el lugar o la tarea de limpieza. No ponga teléfono, tarjeta ni datos bancarios en el título — añádalos al final de la descripción.',
    pt: 'O título deve indicar apenas o local ou a tarefa de limpeza. Não coloque telefone, cartão ou dados bancários no título — adicione-os no final da descrição.',
    fr: 'Le titre doit indiquer uniquement le lieu ou la tâche de nettoyage. N’y mettez pas téléphone, carte ou coordonnées bancaires — ajoutez-les à la fin de la description.',
    de: 'Der Titel soll nur Ort oder Aufräumaufgabe nennen. Keine Telefonnummer, Karte oder Bankdaten im Titel — fügen Sie sie am Ende der Beschreibung hinzu.',
    ar: 'يجب أن يذكر العنوان المكان أو مهمة التنظيف فقط. لا تضع الهاتف أو البطاقة أو البيانات البنكية في العنوان — أضفها في نهاية الوصف.',
    zh: '标题应只说明地点或清理任务。请勿在标题中填写电话、卡号或银行信息——请在描述末尾添加收款说明。',
    hi: 'शीर्षक में केवल स्थान या सफाई कार्य लिखें। फ़ोन, कार्ड या बैंक विवरण शीर्षक में न रखें — विवरण के अंत में जोड़ें।',
    he: 'בכותרת ציינו רק מקום או משימת ניקוי. אל תכניסו טלפון, כרטיס או פרטי בנק לכותרת — הוסיפו בסוף התיאור.',
  },
  [REASON.GIBBERISH_DESCRIPTION]: {
    en: 'First describe where and what volunteers should clean up. If you need to share payout details (phone, Pix, bank account, card), add them after the cleanup text in this description — not in the title.',
    ru: 'Сначала опишите, где и что нужно убрать. Если нужны реквизиты для перевода (телефон, Pix, счёт, карта), добавьте их в конце этого описания — не в названии.',
    es: 'Primero describa dónde y qué deben limpiar los voluntarios. Si necesita datos de pago (teléfono, Pix, cuenta, tarjeta), añádalos al final de esta descripción, no en el título.',
    pt: 'Primeiro descreva onde e o que os voluntários devem limpar. Se precisar de dados para pagamento (telefone, Pix, conta, cartão), coloque-os no final desta descrição, não no título.',
    fr: 'Décrivez d’abord où et quoi nettoyer. Pour les coordonnées de paiement (téléphone, Pix, compte, carte), ajoutez-les à la fin de cette description, pas dans le titre.',
    de: 'Beschreiben Sie zuerst, wo und was aufgeräumt werden soll. Zahlungsdaten (Telefon, Pix, Konto, Karte) am Ende dieser Beschreibung angeben — nicht im Titel.',
    ar: 'صف أولاً أين وماذا ينظف المتطوعون. لإضافة بيانات الدفع (هاتف، Pix، حساب، بطاقة) ضعها في نهاية هذا الوصف وليس في العنوان.',
    zh: '请先说明志愿者在哪里、清理什么。如需收款信息（电话、Pix、银行账户、卡号），请写在本描述末尾，不要写在标题里。',
    hi: 'पहले बताएँ कहाँ और क्या सफाई करनी है। भुगतान विवरण (फ़ोन, Pix, खाता, कार्ड) इस विवरण के अंत में लिखें, शीर्षक में नहीं।',
    he: 'תחילה תארו איפה ומה לנקות. פרטי תשלום (טלפון, Pix, חשבון, כרטיס) — בסוף התיאור הזה, לא בכותרת.',
  },
  [REASON.PAYMENT_IN_TITLE]: {
    en: 'Payment or payout details belong in the description, not the title. Write the cleanup task in the title, then add phone, Pix, bank account or card details at the end of the description.',
    ru: 'Реквизиты и способы оплаты нужно указывать в описании, а не в названии. В названии — задача уборки, в конце описания — телефон, Pix, счёт или карта.',
    es: 'Los datos de pago van en la descripción, no en el título. Escriba la tarea en el título y los datos (teléfono, Pix, cuenta, tarjeta) al final de la descripción.',
    pt: 'Dados de pagamento ficam na descrição, não no título. Coloque a tarefa no título e telefone, Pix, conta ou cartão no final da descrição.',
    fr: 'Les coordonnées de paiement vont dans la description, pas le titre. Indiquez la tâche dans le titre, puis téléphone, Pix, compte ou carte à la fin de la description.',
    de: 'Zahlungsdaten gehören in die Beschreibung, nicht in den Titel. Aufgabe im Titel, Telefon/Pix/Konto/Karte am Ende der Beschreibung.',
    ar: 'بيانات الدفع في الوصف وليس العنوان. اكتب المهمة في العنوان، ثم الهاتف أو Pix أو الحساب أو البطاقة في نهاية الوصف.',
    zh: '收款信息应写在描述中，不要写在标题。标题写清理任务，描述末尾写电话、Pix、账户或卡号。',
    hi: 'भुगतान विवरण शीर्षक में नहीं, विवरण में लिखें। शीर्षक में कार्य, विवरण के अंत में फ़ोन/Pix/खाता/कार्ड।',
    he: 'פרטי תשלום שייכים לתיאור, לא לכותרת. בכותרת המשימה, בסוף התיאור טלפון/Pix/חשבון/כרטיס.',
  },
  [REASON.MISSING_COORDS]: {
    en: 'Set a location on the map.',
    ru: 'Укажите место на карте.',
    es: 'Indique el lugar en el mapa.',
    pt: 'Indique o local no mapa.',
    fr: 'Indiquez le lieu sur la carte.',
    de: 'Wählen Sie einen Ort auf der Karte.',
    ar: 'حدد الموقع على الخريطة.',
    zh: '请在地图上选择位置。',
    hi: 'मानचित्र पर स्थान चुनें।',
    he: 'ציינו מיקום על המפה.',
  },
  [REASON.MISSING_PHOTOS_BEFORE]: {
    en: 'Add at least one photo of the waste.',
    ru: 'Добавьте хотя бы одно фото отходов.',
    es: 'Añada al menos una foto de los residuos.',
    pt: 'Adicione pelo menos uma foto dos resíduos.',
    fr: 'Ajoutez au moins une photo des déchets.',
    de: 'Fügen Sie mindestens ein Foto des Mülls hinzu.',
    ar: 'أضف صورة واحدة على الأقل للنفايات.',
    zh: '请至少添加一张垃圾照片。',
    hi: 'कम से कम एक कचरे की फ़ोटो जोड़ें।',
    he: 'הוסיפו לפחות תמונה אחת של הפסולת.',
  },
  [REASON.MISSING_NAME]: {
    en: 'Enter a request title.',
    ru: 'Укажите название заявки.',
    es: 'Indique el título de la solicitud.',
    pt: 'Informe o título da solicitação.',
    fr: 'Indiquez le titre de la demande.',
    de: 'Geben Sie einen Titel ein.',
    ar: 'أدخل عنوان الطلب.',
    zh: '请输入申请标题。',
    hi: 'अनुरोध का शीर्षक दर्ज करें।',
    he: 'הזינו כותרת לבקשה.',
  },
  [REASON.MISSING_DESCRIPTION]: {
    en: 'Describe the cleanup or event.',
    ru: 'Добавьте описание уборки или события.',
    es: 'Describa la limpieza o el evento.',
    pt: 'Descreva a limpeza ou o evento.',
    fr: 'Décrivez le nettoyage ou l’événement.',
    de: 'Beschreiben Sie die Aufräumaktion oder das Event.',
    ar: 'صف عملية التنظيف أو الحدث.',
    zh: '请描述清理或活动。',
    hi: 'सफाई या कार्यक्रम का विवरण लिखें।',
    he: 'תארו את הניקוי או האירוע.',
  },
};

function messageForCodeAndLocale(code, locale) {
  const loc = normalizeLocale(locale);
  const row = MESSAGES[code];
  if (!row) return messageEnForCode(code);
  return row[loc] || row.en || messageEnForCode(code);
}

module.exports = { MESSAGES, messageForCodeAndLocale };
