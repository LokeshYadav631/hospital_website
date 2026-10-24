'use strict';
// Seed content. NOTHING here asserts unverified facts: every department/service starts as
// "to_be_confirmed", there are no doctors, no opening hours, no founding year/registrations/awards.

const S = 'to_be_confirmed';
const D = (slug, name_en, name_hi, desc_en, desc_hi, services, extra = {}) => ({ slug, name_en, name_hi, desc_en, desc_hi, services, ...extra });
const V = (name_en, name_hi, extra = {}) => ({ name_en, name_hi, ...extra });

const departments = [
  D('general-surgery', 'General Surgery', 'सर्जरी विभाग',
    'The surgery department provides consultation for conditions that may need surgical evaluation or treatment. Which procedures are offered will be confirmed by the hospital.',
    'सर्जरी विभाग उन रोगों के परामर्श से जुड़ा है जिनमें शल्य-चिकित्सा द्वारा जाँच या उपचार की आवश्यकता हो सकती है। कौन-सी प्रक्रियाएँ उपलब्ध हैं, इसकी पुष्टि अस्पताल द्वारा की जाएगी।',
    [V('Surgical consultation', 'सर्जिकल परामर्श'), V('Pre-operative evaluation', 'ऑपरेशन से पहले की जाँच'), V('Post-operative follow-up', 'ऑपरेशन के बाद फॉलो-अप')]),
  D('gynecology', 'Gynecology', 'स्त्री रोग विभाग',
    "The gynecology department provides consultation on women's health concerns. Available services will be confirmed by the hospital.",
    'स्त्री रोग विभाग महिलाओं के स्वास्थ्य से जुड़ी समस्याओं के लिए परामर्श उपलब्ध कराता है। उपलब्ध सेवाओं की पुष्टि अस्पताल द्वारा की जाएगी।',
    [V('Gynecological consultation', 'स्त्री रोग परामर्श'), V('Antenatal consultation', 'प्रसव-पूर्व परामर्श')]),
  D('pediatrics', 'Pediatrics', 'शिशु रोग विभाग',
    "The pediatrics department provides consultation for infants and children. Available services will be confirmed by the hospital.",
    'शिशु रोग विभाग शिशुओं और बच्चों के लिए परामर्श उपलब्ध कराता है। उपलब्ध सेवाओं की पुष्टि अस्पताल द्वारा की जाएगी।',
    [V('Child health consultation', 'बाल स्वास्थ्य परामर्श'), V('Newborn and infant check-up consultation', 'नवजात एवं शिशु जाँच परामर्श')]),
  D('urology', 'Urology', 'यूरोलॉजी रोग विभाग',
    'The urology department provides consultation for conditions of the urinary tract. Available services will be confirmed by the hospital.',
    'यूरोलॉजी विभाग मूत्र मार्ग से जुड़े रोगों के लिए परामर्श उपलब्ध कराता है। उपलब्ध सेवाओं की पुष्टि अस्पताल द्वारा की जाएगी।',
    [V('Urology consultation', 'यूरोलॉजी परामर्श'), V('Urinary tract condition evaluation', 'मूत्र मार्ग रोगों की जाँच')]),
  D('physiotherapy', 'Physiotherapy', 'फिजियोथेरेपी की सुविधा',
    'Physiotherapy supports recovery of movement and function. Session availability and timings will be confirmed by the hospital.',
    'फिजियोथेरेपी चलने-फिरने और शारीरिक क्षमता को वापस पाने में सहायता करती है। सत्रों की उपलब्धता और समय की पुष्टि अस्पताल द्वारा की जाएगी।',
    [V('Physiotherapy assessment', 'फिजियोथेरेपी मूल्यांकन'), V('Rehabilitation sessions', 'पुनर्वास सत्र')], { is_facility: 1 }),
  D('orthopedics', 'Orthopedics and Joint Care', 'हड्डी एवं जोड़ रोग विभाग',
    'The orthopedics department provides consultation for bone and joint conditions. Available services will be confirmed by the hospital.',
    'हड्डी एवं जोड़ रोग विभाग हड्डियों और जोड़ों से जुड़े रोगों के लिए परामर्श उपलब्ध कराता है। उपलब्ध सेवाओं की पुष्टि अस्पताल द्वारा की जाएगी।',
    [V('Orthopedic consultation', 'हड्डी रोग परामर्श'), V('Bone and joint condition evaluation', 'हड्डी एवं जोड़ रोगों की जाँच')]),
  D('blood-bank', 'Blood Bank / Blood Availability', 'ब्लड बैंक की सुविधा',
    'Blood-related services are listed on the hospital poster. The exact nature of the service is being verified by the hospital. Please call the hospital to ask about blood availability.',
    'ब्लड संबंधी सुविधा अस्पताल के पोस्टर में सूचीबद्ध है। सेवा के सटीक स्वरूप की पुष्टि अस्पताल द्वारा की जा रही है। रक्त की उपलब्धता के लिए कृपया अस्पताल को फ़ोन करें।',
    [V('Blood availability inquiry', 'रक्त उपलब्धता संबंधी पूछताछ')],
    { form_type: 'inquiry', is_facility: 1,
      note_en: 'The exact nature of this service and its required authorization are being verified. It is not advertised here as a licensed blood bank.',
      note_hi: 'इस सेवा के सटीक स्वरूप और आवश्यक अनुमति की पुष्टि की जा रही है। इसे यहाँ लाइसेंस प्राप्त ब्लड बैंक के रूप में प्रचारित नहीं किया गया है।' }),
  D('medicine', 'Medicine', 'मेडिसिन विभाग',
    'The medicine department provides consultation for general medical conditions. Available services will be confirmed by the hospital.',
    'मेडिसिन विभाग सामान्य रोगों के लिए परामर्श उपलब्ध कराता है। उपलब्ध सेवाओं की पुष्टि अस्पताल द्वारा की जाएगी।',
    [V('General medicine consultation', 'सामान्य चिकित्सा परामर्श'), V('Follow-up consultation', 'फॉलो-अप परामर्श')]),
  D('dialysis', 'Dialysis', 'डायलिसिस की सुविधा',
    'Dialysis is listed on the hospital poster. Operating hours, capacity and equipment have not been published. Please send an inquiry or call the hospital.',
    'डायलिसिस की सुविधा अस्पताल के पोस्टर में सूचीबद्ध है। संचालन समय, क्षमता और उपकरणों की जानकारी अभी प्रकाशित नहीं की गई है। कृपया पूछताछ भेजें या अस्पताल को फ़ोन करें।',
    [V('Dialysis inquiry', 'डायलिसिस संबंधी पूछताछ', { is_diagnostic: 1 })], { form_type: 'diagnostic', is_facility: 1 }),
  D('ent', 'ENT (Ear, Nose and Throat)', 'कान, नाक, गला रोग विभाग',
    'The ENT department provides consultation for ear, nose and throat conditions. Available services will be confirmed by the hospital.',
    'कान, नाक, गला रोग विभाग कान, नाक और गले की समस्याओं के लिए परामर्श उपलब्ध कराता है। उपलब्ध सेवाओं की पुष्टि अस्पताल द्वारा की जाएगी।',
    [V('ENT consultation', 'कान, नाक, गला परामर्श')]),
  D('radiology', 'Radiology and Diagnostic Imaging', 'रेडियोलॉजी विभाग',
    'The radiology department is listed for diagnostic imaging. Which imaging services are operational, and their timings, will be confirmed by the hospital. Imaging is done on a doctor\'s advice.',
    'रेडियोलॉजी विभाग जाँच संबंधी इमेजिंग के लिए सूचीबद्ध है। कौन-सी इमेजिंग सेवाएँ चालू हैं और उनका समय क्या है, इसकी पुष्टि अस्पताल द्वारा की जाएगी। इमेजिंग चिकित्सक की सलाह पर की जाती है।',
    [V('X-ray', 'एक्स-रे', { is_diagnostic: 1 }), V('Ultrasound (USG)', 'अल्ट्रासाउंड (यूएसजी)', { is_diagnostic: 1 }),
     V('CT scan', 'सीटी स्कैन', { is_diagnostic: 1 }), V('Digital imaging', 'डिजिटल इमेजिंग', { is_diagnostic: 1 })],
    { form_type: 'diagnostic', is_facility: 1 }),
];

const faqs = [
  ['How do I request an appointment?', 'अपॉइंटमेंट का अनुरोध कैसे करूँ?',
    'Use the Book Appointment page, choose a department and send your details. You will get a booking reference. Hospital staff will contact you to confirm the doctor and time.',
    'अपॉइंटमेंट बुक करें पेज पर विभाग चुनकर अपनी जानकारी भेजें। आपको एक बुकिंग संदर्भ संख्या मिलेगी। अस्पताल का स्टाफ आपसे संपर्क कर चिकित्सक और समय की पुष्टि करेगा।'],
  ['Is my appointment confirmed after I submit the form?', 'फ़ॉर्म भेजने के बाद क्या मेरा अपॉइंटमेंट पक्का हो जाता है?',
    'No. Submitting the form means your request has been received. It is confirmed only when the hospital confirms it. Check the status using your booking reference and mobile number.',
    'नहीं। फ़ॉर्म भेजने का अर्थ है कि आपका अनुरोध प्राप्त हो गया है। अपॉइंटमेंट तभी पक्का होता है जब अस्पताल उसकी पुष्टि करे। अपनी बुकिंग संदर्भ संख्या और मोबाइल नंबर से स्थिति देखें।'],
  ['Can I use the online form in an emergency?', 'क्या आपातकाल में ऑनलाइन फ़ॉर्म का उपयोग कर सकते हैं?',
    'No. The online form is not an emergency service. In an emergency call the national emergency number 112 or go to the nearest hospital immediately.',
    'नहीं। ऑनलाइन फ़ॉर्म आपातकालीन सेवा नहीं है। आपातकाल में राष्ट्रीय आपातकालीन नंबर 112 पर कॉल करें या तुरंत निकटतम अस्पताल जाएँ।'],
  ['Which doctor will I see?', 'मुझे कौन-से चिकित्सक को दिखाना होगा?',
    'If you do not choose a doctor, the hospital will assign an appropriate doctor and contact you to confirm the time.',
    'यदि आप चिकित्सक नहीं चुनते हैं, तो अस्पताल उपयुक्त चिकित्सक निर्धारित करेगा और समय की पुष्टि के लिए आपसे संपर्क करेगा।'],
  ['Will I receive SMS messages?', 'क्या मुझे एसएमएस संदेश मिलेंगे?',
    'SMS notifications are optional and are sent only if you consent and the hospital has enabled SMS. Your booking reference is always shown on screen.',
    'एसएमएस सूचनाएँ वैकल्पिक हैं और केवल तभी भेजी जाती हैं जब आप सहमति दें और अस्पताल ने एसएमएस सेवा चालू की हो। आपकी बुकिंग संदर्भ संख्या हमेशा स्क्रीन पर दिखाई जाती है।'],
  ['What are the hospital opening hours?', 'अस्पताल के खुलने का समय क्या है?',
    'Opening hours are being confirmed by the hospital. Please call 01494-246333 or 09799107439.',
    'खुलने के समय की पुष्टि अस्पताल द्वारा की जा रही है। कृपया 01494-246333 या 09799107439 पर फ़ोन करें।'],
];

const content = [
  ['home_intro', 'Homepage introduction',
    'SACHKHAND HOSPITAL in Mundawar, Rajasthan is managed by Sachkhand Charitable Trust. Use this website to learn about our departments and to send an appointment request.',
    'मुंडावर (राजस्थान) स्थित सचखंड हॉस्पिटल का संचालन सचखंड चैरिटेबल ट्रस्ट द्वारा किया जाता है। हमारे विभागों की जानकारी पाने और अपॉइंटमेंट का अनुरोध भेजने के लिए इस वेबसाइट का उपयोग करें।'],
  ['about_intro', 'About: hospital introduction',
    'SACHKHAND HOSPITAL is located on Sarai Road, Mundawar, in the Khairthal-Tijara district of Rajasthan, and is managed by Sachkhand Charitable Trust. Our motto is "Always Dedicated to Your Health."',
    'सचखंड हॉस्पिटल राजस्थान के खैरथल-तिजारा जिले के मुंडावर में सराय रोड पर स्थित है और इसका संचालन सचखंड चैरिटेबल ट्रस्ट द्वारा किया जाता है। हमारा ध्येय है: "आपके स्वास्थ्य के लिए सदैव समर्पित।"'],
  ['mission', 'About: mission (draft)',
    'To provide patient-centred care with respect, honesty and dedication to the health of every patient who comes to us.',
    'हर मरीज़ को सम्मान, ईमानदारी और स्वास्थ्य के प्रति समर्पण के साथ मरीज़-केंद्रित देखभाल उपलब्ध कराना।'],
  ['vision', 'About: vision (draft)',
    'To be a hospital that the community trusts for caring and dependable health services.',
    'एक ऐसा अस्पताल बनना जिस पर समाज देखभाल करने वाली और भरोसेमंद स्वास्थ्य सेवाओं के लिए विश्वास करे।'],
  ['philosophy', 'About: patient-care philosophy (draft)',
    'We listen to patients, explain things clearly, protect privacy and treat everyone with dignity.',
    'हम मरीज़ों की बात सुनते हैं, बातें स्पष्ट रूप से समझाते हैं, निजता की रक्षा करते हैं और सभी के साथ गरिमा से पेश आते हैं।'],
  ['trust_intro', 'Charitable Trust introduction',
    'SACHKHAND HOSPITAL is managed by Sachkhand Charitable Trust. Further details about the Trust will be added once approved by the Trust.',
    'सचखंड हॉस्पिटल का संचालन सचखंड चैरिटेबल ट्रस्ट द्वारा किया जाता है। ट्रस्ट के बारे में अधिक जानकारी ट्रस्ट की स्वीकृति के बाद जोड़ी जाएगी।'],
  ['patient_rights', 'Patient rights',
    'Patients have the right to respectful care, clear information about their condition and options in a language they understand, privacy and confidentiality of their information, and the right to ask questions and seek another opinion.',
    'मरीज़ों को सम्मानजनक देखभाल, अपनी स्थिति और विकल्पों की स्पष्ट जानकारी अपनी समझ की भाषा में, अपनी जानकारी की निजता और गोपनीयता, तथा प्रश्न पूछने और दूसरी राय लेने का अधिकार है।'],
  ['patient_responsibilities', 'Patient responsibilities',
    "Patients are requested to give accurate information, follow the care plan agreed with their doctor, respect hospital staff and other patients, and inform the hospital if they need to change or cancel an appointment.",
    'मरीज़ों से अनुरोध है कि वे सही जानकारी दें, अपने चिकित्सक के साथ तय उपचार योजना का पालन करें, अस्पताल कर्मचारियों और अन्य मरीज़ों का सम्मान करें, और अपॉइंटमेंट बदलना या रद्द करना हो तो अस्पताल को सूचित करें।'],
  ['patient_info', 'Patient information (home page)',
    'Please carry any earlier prescriptions or reports when you visit. Visiting arrangements, fees and documents required will be confirmed by the hospital when it contacts you.',
    'अस्पताल आते समय कृपया पुरानी पर्चियाँ या रिपोर्ट साथ लाएँ। मिलने की व्यवस्था, शुल्क और आवश्यक दस्तावेज़ों की पुष्टि अस्पताल आपसे संपर्क करते समय करेगा।'],
];

const settings = {
  hospital_name_en: 'SACHKHAND HOSPITAL', hospital_name_hi: 'सचखंड हॉस्पिटल',
  trust_name_en: 'Sachkhand Charitable Trust', trust_name_hi: 'सचखंड चैरिटेबल ट्रस्ट',
  tagline_en: 'Always Dedicated to Your Health.', tagline_hi: 'आपके स्वास्थ्य के लिए सदैव समर्पित...',
  address_en: 'Sarai Road, Mundawar, District Khairthal-Tijara, Rajasthan, PIN 301707',
  address_hi: 'सराय रोड, मुंडावर, जिला खैरथल-तिजारा, राजस्थान, पिन 301707',
  phone1: '01494-246333', phone2: '09799107439',
  email: '',
  hours_confirmed: '0', hours_en: '', hours_hi: '',
  emergency_status: 'unconfirmed',          // unconfirmed | available | unavailable (nothing is claimed unless set)
  emergency_note_en: '', emergency_note_hi: '',
  map_verified: '0', map_url: '',
  hero_image_url: '',
  facebook_url: '',
  instagram_url: '',
  sms_reminders_enabled: '0',
};

module.exports = { departments, faqs, content, settings, STATUS_DEFAULT: S };

// Policy texts (editable in admin). DRAFTS: must be reviewed by the hospital / legal counsel before launch.
module.exports.content.push(
  ['privacy', 'Privacy policy (DRAFT - needs legal review)',
`This website collects only the information needed to handle your appointment request or inquiry: your name, mobile number, age or date of birth, optional email and the details you enter in the form.

We use this information only to contact you, confirm or manage your appointment and improve our service. We do not sell it. It is visible only to authorised hospital staff.

SMS messages are sent only if you tick the consent box and the hospital has enabled SMS. SMS messages never contain medical details.

Please do not enter medical records or detailed medical history in the website forms. Do not use the forms in an emergency.

Appointment records are kept for as long as the hospital needs them for administration and then deleted or anonymised according to the hospital's retention plan. You may ask the hospital to correct or delete your request by calling the hospital.

This website uses only essential cookies (security, session and language preference).`,
`इस वेबसाइट पर केवल वही जानकारी ली जाती है जो आपके अपॉइंटमेंट अनुरोध या पूछताछ को संभालने के लिए आवश्यक है: आपका नाम, मोबाइल नंबर, आयु या जन्म तिथि, वैकल्पिक ईमेल और फ़ॉर्म में दी गई जानकारी।

हम इस जानकारी का उपयोग केवल आपसे संपर्क करने, आपके अपॉइंटमेंट की पुष्टि या प्रबंधन करने और अपनी सेवा सुधारने के लिए करते हैं। हम इसे बेचते नहीं हैं। यह केवल अधिकृत अस्पताल कर्मचारियों को दिखाई देती है।

एसएमएस संदेश केवल तभी भेजे जाते हैं जब आप सहमति बॉक्स चुनें और अस्पताल ने एसएमएस सेवा चालू की हो। एसएमएस में चिकित्सकीय विवरण कभी नहीं होते।

कृपया वेबसाइट के फ़ॉर्म में मेडिकल रिकॉर्ड या विस्तृत चिकित्सा इतिहास न लिखें। आपातकाल में फ़ॉर्म का उपयोग न करें।

अपॉइंटमेंट रिकॉर्ड उतने समय तक रखे जाते हैं जितना अस्पताल को प्रशासन के लिए आवश्यक हो, फिर अस्पताल की प्रतिधारण योजना के अनुसार हटाए या गुमनाम किए जाते हैं। अपना अनुरोध सुधारने या हटाने के लिए आप अस्पताल को फ़ोन कर सकते हैं।

यह वेबसाइट केवल आवश्यक कुकीज़ (सुरक्षा, सत्र और भाषा पसंद) का उपयोग करती है।`],
  ['terms', 'Terms of use (DRAFT - needs legal review)',
`The information on this website is general and is not medical advice. Always consult a qualified doctor.

Submitting an online form sends a request to the hospital. It does not guarantee an appointment. An appointment is confirmed only when hospital staff confirm it to you.

The online forms are not an emergency service. In an emergency call 112 or go to the nearest hospital.

Services listed as "Availability to be confirmed" have not yet been verified as operational. Please call the hospital to check.

Please give accurate information. The hospital may cancel requests that appear to be false or abusive.`,
`इस वेबसाइट की जानकारी सामान्य है और चिकित्सकीय सलाह नहीं है। हमेशा योग्य चिकित्सक से परामर्श करें।

ऑनलाइन फ़ॉर्म भेजने से अस्पताल को अनुरोध प्राप्त होता है। इससे अपॉइंटमेंट की गारंटी नहीं मिलती। अपॉइंटमेंट तभी पक्का होता है जब अस्पताल का स्टाफ आपको उसकी पुष्टि करे।

ऑनलाइन फ़ॉर्म आपातकालीन सेवा नहीं हैं। आपातकाल में 112 पर कॉल करें या निकटतम अस्पताल जाएँ।

"उपलब्धता की पुष्टि बाकी है" वाली सेवाओं के चालू होने की पुष्टि अभी नहीं हुई है। कृपया अस्पताल को फ़ोन करके पूछें।

कृपया सही जानकारी दें। झूठे या अपमानजनक प्रतीत होने वाले अनुरोधों को अस्पताल रद्द कर सकता है।`]
);
