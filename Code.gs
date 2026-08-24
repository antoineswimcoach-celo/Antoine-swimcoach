const CALENDAR_ID = '3aa320aacf52fc727abcee7e7745a19abceb81a662519fddf18f8d98c9c6105e@group.calendar.google.com';
const TIME_ZONE = 'Europe/Paris';
const BOOKING_PREFIX = 'RÉSERVATION';
const DEFAULT_DAYS = 120;
const MAX_DAYS = 120;

// -----------------------------------------------------------------------------
// MODE TRANSITION : WhatsApp personnel, envoi final manuel
// -----------------------------------------------------------------------------
// 1. Remplacez l'adresse ci-dessous par votre adresse Gmail.
// 2. Importez les deux PDF dans Google Drive.
// 3. Copiez leur identifiant dans les deux lignes FILE_ID.
//    Exemple d'URL Drive : https://drive.google.com/file/d/IDENTIFIANT/view
// 4. Exécutez une fois installerRappelJ1() depuis l'éditeur Apps Script.
const EMAIL_ANTOINE = 'antoineswimcoach@gmail.com';
const GUIDE_PISCINE_FILE_ID = '1vgbC-U3rbHDx3hG6Z3ldHYZ21-FTijqe';
const GUIDE_ADULTE_FILE_ID = '1opj9_eJAbWJBnm3yzO8P6xtM2fsBsW6E';
const REMINDER_HOUR = 18;
const LOYALTY_CODE = 'FIDELITE';
const LOYALTY_SMALL_UNIT_PRICE = 30;
const LOYALTY_INDIVIDUAL_UNIT_PRICE = 40;
const TURNSTILE_SECRET_PROPERTY = 'TURNSTILE_SECRET_KEY';
const TURNSTILE_EXPECTED_HOSTNAME = 'antoineswimcoach-celo.github.io';
const TURNSTILE_EXPECTED_ACTION = 'booking';
const SLOT_CACHE_SECONDS = 45;
const SLOT_CACHE_VERSION = 'v3';
const CLIENT_REGISTRY_PREFIX = 'client_seen_v1_';
const SITE_ORIGIN = 'https://antoineswimcoach-celo.github.io';
const STANDARD_PRICING = {
  adult:{
    small:{p1:40,p5:190,p10:360},
    individual:{p1:55,p5:260,p10:500}
  },
  childu8:{
    small:{p1:27.5,p5:130,p10:250},
    individual:{p1:27.5,p5:130,p10:250}
  },
  child8:{
    small:{p1:55,p5:260,p10:500},
    individual:{p1:55,p5:260,p10:500}
  }
};

const TAG_FIRST_SESSION = 'booking_first_session';
const TAG_CONTACT_PREPARED = 'whatsapp_contact_prepared';
const TAG_J1_PREPARED = 'whatsapp_j1_prepared';


function autoriserReservations() {
  const calendar = CalendarApp.getCalendarById(CALENDAR_ID);
  if (!calendar) throw new Error('Agenda introuvable.');
  const start = new Date(Date.now() + 5 * 60000);
  const end = new Date(start.getTime() + 5 * 60000);
  const event = calendar.createEvent('AUTORISATION – suppression automatique', start, end);
  event.deleteEvent();
  return 'Autorisation d’écriture OK';
}

function doGet(e) {
  try {
    const p = e && e.parameter ? e.parameter : {};
    const profile = normalizeProfile_(p.profile);
    const mode = normalizeMode_(p.mode);
    const callback = sanitizeCallback_(p.callback);
    const days = clampDays_(p.days);
    if (!profile) return output_({ok:false,error:'Profil invalide.'}, callback);
    const cache = CacheService.getScriptCache();
    const cacheKey = slotCacheKey_(profile, mode, days);
    const cached = cache.get(cacheKey);
    let slots;
    let cacheHit = false;
    if (cached) {
      try {
        slots = JSON.parse(cached);
        cacheHit = Array.isArray(slots);
      } catch (ignore) {
        slots = null;
      }
    }
    if (!Array.isArray(slots)) {
      const now = new Date();
      const horizon = new Date(now.getTime() + days * 86400000);
      slots = availableSlots_(profile, mode, now, horizon);
      const serialized = JSON.stringify(slots);
      if (serialized.length < 95000) cache.put(cacheKey, serialized, SLOT_CACHE_SECONDS);
    }
    return output_({
      ok:true,
      generatedAt:new Date().toISOString(),
      profile:profile,
      mode:mode,
      slots:slots,
      pricing:publicPricing_(profile, mode),
      cached:cacheHit
    }, callback);
  } catch (err) {
    console.error('Erreur doGet : ' + String(err));
    return output_({ok:false,error:'Erreur serveur.'}, '');
  }
}

function doPost(e) {
  const p = e && e.parameter ? e.parameter : {};
  const nonce = clean_(p.nonce, 120);
  const requestId = clean_(p.requestId, 120);
  if (p.action !== 'book') return bookingResponse_({ok:false,code:'bad_action',message:'Action invalide.',nonce:nonce});

  const captcha = verifyTurnstile_(clean_(p.turnstileToken, 2048));
  if (!captcha.ok) {
    console.warn('Turnstile refusé : ' + captcha.reason);
    return bookingResponse_({
      ok:false,
      code:'captcha_failed',
      message:'La vérification anti-robot a expiré ou a échoué. Veuillez la recommencer.',
      nonce:nonce
    });
  }

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const profile = normalizeProfile_(p.profile);
    const mode = normalizeMode_(p.mode);
    const startISO = clean_(p.startISO, 80);
    const name = clean_(p.name, 120);
    const email = clean_(p.email, 160);
    const phone = clean_(p.phone, 60);
    const goal = clean_(p.goal, 180);
    const reason = clean_(p.reason, 1200);
    const pack = normalizePack_(p.pack);
    const promoCode = clean_(p.promoCode, 60);
    const loyaltyRequested = isLoyaltyCode_(promoCode);
    const childName = clean_(p.childName, 100);
    const childAge = clean_(p.childAge, 10);
    const consent = String(p.consent || '') === 'yes';
    const legalConsent = String(p.legalConsent || '') === 'yes';

    const validation = validateBooking_(profile, mode, startISO, name, email, phone, goal, reason, pack, childName, childAge, consent, legalConsent);
    if (!validation.ok) return bookingResponse_({ok:false,code:'validation',message:validation.message,nonce:nonce});
    if (promoCode && !loyaltyRequested) {
      return bookingResponse_({ok:false,code:'invalid_promo',message:'Le code promotionnel n’est pas reconnu.',nonce:nonce});
    }
    if (loyaltyRequested && !isKnownClient_(email, phone)) {
      return bookingResponse_({
        ok:false,
        code:'loyalty_not_eligible',
        message:'Ce code est réservé aux anciens élèves. Vérifiez que vous utilisez la même adresse e-mail ou le même numéro de téléphone que lors de votre précédente réservation.',
        nonce:nonce
      });
    }
    const loyaltyApplied = loyaltyRequested;

    // Une double validation ou un nouvel essai réseau ne doit jamais créer
    // deux événements pour la même personne et le même créneau.
    const idempotencyKey = requestId || nonce;
    const existing = findExistingBooking_(startISO, email, phone, idempotencyKey);
    if (existing) {
      const existingLoyalty = isLoyaltyEvent_(existing);
      const existingPrice = priceFromEvent_(existing);
      let taskPrepared = existing.getTag(TAG_CONTACT_PREPARED) === 'yes';
      if (!taskPrepared) {
        try {
          const firstExisting = existing.getTag(TAG_FIRST_SESSION) === 'yes';
          prepareBookingWhatsAppTask_(existing, {
            profile:profile, mode:mode, name:name, phone:phone,
            childName:childName, goal:goal, firstSession:firstExisting
          });
          existing.setTag(TAG_CONTACT_PREPARED, 'yes');
          taskPrepared = true;
        } catch (notifyErr) {
          console.error('Préparation WhatsApp impossible : ' + String(notifyErr));
        }
      }
      return bookingResponse_({
        ok:true, code:'confirmed', message:'Réservation déjà enregistrée.', nonce:nonce,
        bookingId:existing.getId(), reused:true, whatsappTaskPrepared:taskPrepared,
        loyaltyApplied:existingLoyalty,
        loyaltyTotal:existingLoyalty ? existingPrice.total : 0,
        priceTotal:existingPrice.total,
        pricePerSession:existingPrice.perSession,
        slot:eventSlot_(existing)
      });
    }

    const now = new Date();
    const horizon = new Date(now.getTime() + MAX_DAYS * 86400000);
    const slots = availableSlots_(profile, mode, now, horizon);
    const slot = slots.find(function(s) { return s.startISO === startISO; });
    if (!slot) return bookingResponse_({ok:false,code:'slot_unavailable',message:'Ce créneau n’est plus disponible. Choisissez-en un autre.',nonce:nonce});

    const calendar = CalendarApp.getCalendarById(CALENDAR_ID);
    if (!calendar) return bookingResponse_({ok:false,code:'calendar',message:'Agenda introuvable.',nonce:nonce});

    const titleName = profile === 'adult' ? name : childName + ' – parent ' + name;
    const price = bookingPrice_(profile, mode, pack, loyaltyApplied);
    const loyaltyTotal = loyaltyApplied ? price.total : 0;
    const title = 'RÉSERVATION' + (loyaltyApplied ? ' • FIDÉLITÉ' : '') + ' – ' + short_(titleName, 90);
    const description = [
      'TYPE=RESERVATION','MODE=' + mode,'PROFILE=' + profile,'PACK=' + pack,
      'CLIENT=' + (loyaltyApplied ? 'ANCIEN_ELEVE' : 'NOUVEAU'),
      loyaltyApplied ? 'CODE_PROMO=' + LOYALTY_CODE : '',
      loyaltyApplied ? 'TARIF_FIDELITE=' + loyaltyTotal : '',
      'TARIF_TYPE=' + (loyaltyApplied ? 'FIDELITE' : 'STANDARD'),
      'TARIF_TOTAL=' + price.total,
      'TARIF_PAR_SEANCE=' + price.perSession,
      'DEVISE=EUR',
      'NOM=' + oneLine_(name),'EMAIL=' + oneLine_(email),'TELEPHONE=' + oneLine_(phone),
      profile !== 'adult' ? 'ENFANT=' + oneLine_(childName) : '',
      profile !== 'adult' ? 'AGE=' + oneLine_(childAge) : '',
      'OBJECTIF=' + oneLine_(goal),'MOTIF=' + oneLine_(reason),
      idempotencyKey ? 'REQUEST_ID=' + oneLine_(idempotencyKey) : '',
      'Créée le=' + Utilities.formatDate(new Date(), TIME_ZONE, 'yyyy-MM-dd HH:mm:ss')
    ].filter(String).join('\n');

    const event = calendar.createEvent(title,new Date(slot.startISO),new Date(slot.endISO),{description:description});
    event.setTransparency(CalendarApp.EventTransparency.OPAQUE);
    event.setTag('booking_type','booking');
    event.setTag('booking_mode',mode);
    event.setTag('booking_profile',profile);
    event.setTag('booking_client_type',loyaltyApplied ? 'ancien_eleve' : 'nouveau');
    event.setTag('booking_price_total',String(price.total));

    // Les disponibilités publiques sont mises en cache quelques secondes.
    // Une réservation réussie invalide immédiatement toutes les variantes.
    clearAvailabilityCache_();

    // Recalcule l'ordre chronologique des séances de cette personne. Un seul
    // événement peut porter le marqueur "première séance".
    const firstSession = refreshFirstSessionTags_(calendar, email, phone, event);

    // Avec WhatsApp personnel, le script prépare le texte, le lien direct et
    // le bon PDF dans un e-mail envoyé à Antoine. L'envoi WhatsApp reste manuel.
    let taskPrepared = false;
    try {
      prepareBookingWhatsAppTask_(event, {
        profile:profile, mode:mode, name:name, phone:phone,
        childName:childName, goal:goal, firstSession:firstSession
      });
      event.setTag(TAG_CONTACT_PREPARED, 'yes');
      taskPrepared = true;
    } catch (notifyErr) {
      console.error('Réservation créée, mais préparation WhatsApp impossible : ' + String(notifyErr));
    }

    return bookingResponse_({
      ok:true, code:'confirmed', message:loyaltyApplied ? 'Créneau pré-réservé. Tarif fidélité appliqué.' : 'Créneau pré-réservé.', nonce:nonce,
      bookingId:event.getId(), whatsappTaskPrepared:taskPrepared,
      loyaltyApplied:loyaltyApplied, loyaltyTotal:loyaltyTotal,
      priceTotal:price.total, pricePerSession:price.perSession,
      slot:{date:slot.date,heure:slot.heure,fin:slot.fin,dureeMinutes:slot.dureeMinutes}
    });
  } catch (err) {
    console.error('Erreur doPost : ' + String(err));
    return bookingResponse_({ok:false,code:'server_error',message:'La réservation n’a pas pu être enregistrée. Réessayez.',nonce:nonce});
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

function availableSlots_(profile, mode, fromDate, toDate) {
  const calendar = CalendarApp.getCalendarById(CALENDAR_ID);
  if (!calendar) throw new Error('Agenda introuvable.');
  const events = calendar.getEvents(fromDate, toDate);
  const availability = events.filter(isAvailabilityEvent_);
  const bookings = events.filter(isBookingEvent_);
  let slots = [];

  availability.forEach(function(ev) {
    const start = ev.getStartTime();
    const availEnd = ev.getEndTime();
    const day = Number(Utilities.formatDate(start, TIME_ZONE, 'u'));

    if (day === 5) {
      if (profile !== 'adult') return;
      addIfBookable_(slots, bookings, start, new Date(start.getTime()+30*60000), availEnd, mode, 'vendredi');
      return;
    }

    if (day === 7) {
      if (profile === 'childu8') {
        addIfBookable_(slots, bookings, start, new Date(start.getTime()+30*60000), availEnd, mode, 'dimanche-enfant');
        return;
      }
      const defs = [{offset:90},{offset:150},{offset:30}];
      const states = defs.map(function(d) {
        const s = new Date(start.getTime()+d.offset*60000);
        const en = new Date(s.getTime()+60*60000);
        return {start:s,end:en,inside:en<=availEnd,state:slotState_(bookings,s,en)};
      });
      const active = [true,states[0].state.opensNext,states[0].state.opensNext && states[1].state.opensNext];
      states.forEach(function(x,i) {
        if (active[i] && x.inside && canBook_(x.state,mode)) slots.push(makeSlot_(x.start,x.end,mode,x.state,'dimanche'));
      });
      return;
    }

    if (day === 1 || day === 4) {
      if (profile === 'childu8') {
        for (let offset = 0; offset < 60; offset += 30) {
          const s = new Date(start.getTime()+offset*60000);
          const en = new Date(s.getTime()+30*60000);
          addIfBookable_(slots, bookings, s, en, availEnd, mode, day===1?'lundi':'jeudi');
        }
      } else {
        addIfBookable_(slots, bookings, start, new Date(start.getTime()+60*60000), availEnd, mode, day===1?'lundi':'jeudi');
      }
    }
  });

  const seen = {};
  slots = slots.filter(function(s){ if (seen[s.id]) return false; seen[s.id] = true; return true; });
  slots.sort(function(a,b){ return a.startISO.localeCompare(b.startISO); });
  return slots;
}

function addIfBookable_(arr, bookings, start, end, availEnd, mode, type) {
  if (end > availEnd) return;
  const state = slotState_(bookings,start,end);
  if (canBook_(state,mode)) arr.push(makeSlot_(start,end,mode,state,type));
}
function isAvailabilityEvent_(ev) { return (ev.getTitle()||'').toLowerCase().indexOf('disponib') !== -1; }
function isBookingEvent_(ev) { return (ev.getTitle()||'').toUpperCase().indexOf(BOOKING_PREFIX) === 0; }
function slotState_(bookings,start,end) {
  let count = 0, individual = false;
  bookings.forEach(function(ev) {
    const bs = ev.getStartTime(), be = ev.getEndTime();
    if (!(bs < end && be > start)) return;
    count++;
    const taggedMode = normalizeStoredMode_(ev.getTag('booking_mode'));
    if (taggedMode) {
      if (taggedMode === 'individual') individual = true;
      return;
    }
    // Compatibilité avec les anciennes réservations créées avant l'ajout du tag.
    const txt = ((ev.getTitle()||'')+'\n'+(ev.getDescription()||'')).toLowerCase();
    if (txt.indexOf('mode=individual') !== -1 || txt.indexOf('mode=indiv') !== -1 || txt.indexOf('100 % individuel') !== -1) individual = true;
  });
  return {count:count,individual:individual,full:individual||count>=3,opensNext:individual||count>=2};
}
function canBook_(state,mode) { if (mode === 'individual') return state.count === 0; return !state.individual && state.count < 3; }
function normalizeStoredMode_(value) {
  const mode = String(value || '').toLowerCase().trim();
  if (mode === 'individual' || mode === 'indiv' || mode === 'individuel') return 'individual';
  if (mode === 'small' || mode === 'petit_comite' || mode === 'petit comité') return 'small';
  return '';
}
function makeSlot_(start,end,mode,state,type) {
  const date = Utilities.formatDate(start,TIME_ZONE,'yyyy-MM-dd');
  const h1 = Utilities.formatDate(start,TIME_ZONE,'HH:mm');
  const h2 = Utilities.formatDate(end,TIME_ZONE,'HH:mm');
  return {id:date+'_'+h1.replace(':',''),date:date,heure:h1,fin:h2,dureeMinutes:Math.round((end-start)/60000),type:type,placesRestantes:mode==='individual'?1:Math.max(0,3-state.count),startISO:start.toISOString(),endISO:end.toISOString()};
}

function findExistingBooking_(startISO, email, phone, requestId) {
  const calendar = CalendarApp.getCalendarById(CALENDAR_ID);
  if (!calendar) return null;

  const start = new Date(startISO);
  if (isNaN(start.getTime())) return null;

  // Fenêtre étroite autour du créneau demandé.
  const from = new Date(start.getTime() - 5 * 60000);
  const to = new Date(start.getTime() + 125 * 60000);
  const events = calendar.getEvents(from, to).filter(isBookingEvent_);

  const wantedEmail = oneLine_(email).toLowerCase();
  const wantedPhone = String(phone || '').replace(/\D/g, '');

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (Math.abs(ev.getStartTime().getTime() - start.getTime()) > 1000) continue;

    const desc = ev.getDescription() || '';
    const lower = desc.toLowerCase();

    if (requestId && lower.indexOf(('request_id=' + requestId).toLowerCase()) !== -1) {
      return ev;
    }

    const emailMatch = wantedEmail && lower.indexOf(('email=' + wantedEmail).toLowerCase()) !== -1;
    const phoneLine = (desc.match(/TELEPHONE=([^\n\r]*)/i) || [,''])[1].replace(/\D/g, '');
    const phoneMatch = wantedPhone && phoneLine === wantedPhone;

    // Même personne + même créneau = même tentative de réservation.
    if (emailMatch && phoneMatch) return ev;
  }

  return null;
}

// =============================================================================
// PRÉPARATION WHATSAPP - MODE SEMI-AUTOMATIQUE GRATUIT
// =============================================================================

function installerRappelJ1() {
  validateEmailConfig_();
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'preparerRappelsJ1') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  // Le contrôle est horaire afin de prendre aussi les réservations tardives.
  // La fonction n'agit réellement qu'entre 18 h et minuit, heure de Paris.
  ScriptApp.newTrigger('preparerRappelsJ1').timeBased().everyHours(1).create();
  return 'Rappel J-1 installé. Contrôle horaire, envoi préparé à partir de 18 h.';
}

function verifierConfigurationSemiAutomatique() {
  validateEmailConfig_();
  const result = {
    emailAntoine: EMAIL_ANTOINE,
    guidePiscineConfigure: isConfiguredValue_(GUIDE_PISCINE_FILE_ID),
    guideAdulteConfigure: isConfiguredValue_(GUIDE_ADULTE_FILE_ID),
    rappelJ1Installe: ScriptApp.getProjectTriggers().some(function(trigger) {
      return trigger.getHandlerFunction() === 'preparerRappelsJ1';
    })
  };
  console.log(JSON.stringify(result));
  return result;
}

function preparerRappelsJ1() {
  validateEmailConfig_();
  const currentHour = Number(Utilities.formatDate(new Date(), TIME_ZONE, 'H'));
  if (currentHour < REMINDER_HOUR) {
    return 'Aucun traitement avant ' + REMINDER_HOUR + ' h.';
  }

  const calendar = CalendarApp.getCalendarById(CALENDAR_ID);
  if (!calendar) throw new Error('Agenda introuvable.');

  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60000);
  const tomorrowKey = Utilities.formatDate(tomorrow, TIME_ZONE, 'yyyy-MM-dd');
  const from = new Date(now.getTime() + 4 * 60 * 60000);
  const to = new Date(now.getTime() + 42 * 60 * 60000);
  const events = calendar.getEvents(from, to, {search:BOOKING_PREFIX})
    .filter(isBookingEvent_)
    .filter(function(ev) {
      return Utilities.formatDate(ev.getStartTime(), TIME_ZONE, 'yyyy-MM-dd') === tomorrowKey;
    })
    .sort(function(a, b) { return a.getStartTime() - b.getStartTime(); });

  let prepared = 0;
  let skipped = 0;
  let errors = 0;

  events.forEach(function(ev) {
    if (ev.getTag(TAG_J1_PREPARED) === 'yes') {
      skipped++;
      return;
    }
    try {
      const fields = descriptionFields_(ev);
      const profile = ev.getTag('booking_profile') || normalizeProfile_(fields.PROFILE);
      const firstSession = ev.getTag(TAG_FIRST_SESSION) === 'yes';
      prepareJ1WhatsAppTask_(ev, {
        profile:profile,
        name:fields.NOM || '',
        phone:fields.TELEPHONE || '',
        childName:fields.ENFANT || '',
        goal:fields.OBJECTIF || '',
        firstSession:firstSession
      });
      ev.setTag(TAG_J1_PREPARED, 'yes');
      prepared++;
    } catch (err) {
      errors++;
      console.error('Rappel J-1 non préparé pour ' + ev.getTitle() + ' : ' + String(err));
    }
  });

  return 'Rappels J-1 : ' + prepared + ' préparé(s), ' + skipped + ' déjà fait(s), ' + errors + ' erreur(s).';
}

function prepareBookingWhatsAppTask_(event, data) {
  validateEmailConfig_();
  data.loyaltyApplied = isLoyaltyEvent_(event);
  const message = bookingWhatsAppMessage_(event, data);
  const loyaltyLabel = loyaltyEmailLabel_(event);
  const priceLabel = priceEmailLabel_(event);
  const adultBeginnerFirstSession = data.firstSession === true && isAdultBeginner_(data) && !data.loyaltyApplied;
  const attachments = adultBeginnerFirstSession ? [
    guideBlob_(GUIDE_PISCINE_FILE_ID, 'ebook-premiere-seance.pdf')
  ] : [];
  const documentNote = adultBeginnerFirstSession
    ? 'Ajoutez le PDF « ebook-premiere-seance.pdf » à la conversation avant d’envoyer.'
    : data.profile !== 'adult'
      ? 'Réservation enfant : aucun e-book à joindre.'
      : 'Aucun document à joindre pour cette réservation.';
  const paymentNote = data.firstSession === true
    ? 'Indiquez les coordonnées de virement : le créneau est pré-réservé 24 h et confirmé après règlement de la première séance.'
    : '';
  const note = [loyaltyLabel, priceLabel, paymentNote, documentNote].filter(String).join(' — ');

  sendWhatsAppPreparationEmail_({
    subject:(loyaltyLabel ? '[ANCIEN ÉLÈVE] ' : '') + 'WhatsApp à envoyer - réservation de ' + displayClient_(data),
    phone:data.phone,
    message:message,
    note:note,
    attachments:attachments,
    event:event
  });
}

function prepareJ1WhatsAppTask_(event, data) {
  validateEmailConfig_();
  data.loyaltyApplied = isLoyaltyEvent_(event);
  const loyaltyLabel = loyaltyEmailLabel_(event);
  const priceLabel = priceEmailLabel_(event);
  const adultBeginnerFirstSession = data.firstSession === true && isAdultBeginner_(data) && !data.loyaltyApplied;
  const attachments = adultBeginnerFirstSession ? [
    guideBlob_(GUIDE_ADULTE_FILE_ID, 'ebook-avant-premiere-seance.pdf')
  ] : [];
  const documentNote = adultBeginnerFirstSession
    ? 'Première séance adulte débutant : ajoutez le PDF « ebook-avant-premiere-seance.pdf » avant d’envoyer.'
    : data.profile === 'adult'
      ? 'Rappel adulte standard : aucun document à joindre.'
      : 'Réservation enfant : ne joignez jamais l’e-book destiné aux adultes.';
  const note = [loyaltyLabel, priceLabel, documentNote].filter(String).join(' — ');

  sendWhatsAppPreparationEmail_({
    subject:(loyaltyLabel ? '[ANCIEN ÉLÈVE] ' : '') + 'WhatsApp J-1 - ' + displayClient_(data) + ' - ' + frenchDate_(event.getStartTime()),
    phone:data.phone,
    message:j1WhatsAppMessage_(event, data),
    note:note,
    attachments:attachments,
    event:event
  });
}

function sendWhatsAppPreparationEmail_(options) {
  const waUrl = whatsappUrl_(options.phone, options.message);
  const when = frenchDate_(options.event.getStartTime()) + ' à ' + hourLabel_(options.event.getStartTime());
  const plain = [
    options.note,
    '',
    'Séance : ' + when,
    '',
    'MESSAGE À ENVOYER :',
    options.message,
    '',
    'OUVRIR WHATSAPP :',
    waUrl
  ].join('\n');

  const html = [
    '<div style="font-family:Arial,sans-serif;max-width:650px;color:#173e4d">',
    '<h2 style="margin-bottom:8px">Message WhatsApp prêt</h2>',
    '<p><strong>Séance :</strong> ' + htmlEscape_(when) + '</p>',
    '<p style="background:#fff3dc;padding:12px;border-radius:8px"><strong>À faire :</strong> ' + htmlEscape_(options.note) + '</p>',
    '<div style="white-space:pre-wrap;background:#eef8f7;padding:16px;border-radius:10px;line-height:1.5">' + htmlEscape_(options.message) + '</div>',
    '<p style="margin:22px 0"><a href="' + htmlEscape_(waUrl) + '" style="background:#25D366;color:white;text-decoration:none;padding:13px 20px;border-radius:8px;font-weight:bold">Ouvrir la conversation WhatsApp</a></p>',
    '<p style="font-size:12px;color:#657b89">Le système prépare le message, mais ne l’envoie pas à votre place avec votre WhatsApp personnel.</p>',
    '</div>'
  ].join('');

  MailApp.sendEmail({
    to:EMAIL_ANTOINE,
    subject:options.subject,
    body:plain,
    htmlBody:html,
    attachments:options.attachments || []
  });
}

function bookingWhatsAppMessage_(event, data) {
  const firstName = firstName_(data.name);
  const when = frenchDate_(event.getStartTime()) + ' à ' + hourLabel_(event.getStartTime());
  if (data.firstSession) {
    if (!isAdultBeginner_(data) || data.loyaltyApplied) {
      return 'Bonjour ' + firstName + ', c’est Antoine. J’ai bien vu votre réservation pour ' + when + '. ' +
        'Le créneau est pré-réservé pendant 24 h et sera confirmé après le règlement de la première séance par virement. ' +
        'Je vous envoie les coordonnées bancaires juste après. Si vous avez une question, écrivez-moi directement ici.';
    }
    return 'Bonjour ' + firstName + ', c’est Antoine. J’ai bien vu votre réservation pour ' + when + '. ' +
      'Le créneau est pré-réservé pendant 24 h et sera confirmé après le règlement de la première séance par virement. ' +
      'Je vous envoie les coordonnées bancaires juste après. ' +
      'Je vous joins un petit guide avec tout ce qu’il faut savoir pour votre arrivée à la piscine. ' +
      'Si vous avez une question d’ici là, écrivez-moi directement ici.';
  }
  return 'Bonjour ' + firstName + ', c’est Antoine. Votre séance du ' + when +
    ' est bien réservée. Si vous avez une question d’ici là, écrivez-moi directement ici. À bientôt.';
}

function j1WhatsAppMessage_(event, data) {
  const firstName = firstName_(data.name);
  const time = hourLabel_(event.getStartTime());
  if (data.profile !== 'adult') {
    const child = data.childName || 'votre enfant';
    return 'Bonjour ' + firstName + ', petit rappel pour la séance de ' + child + ' demain à ' + time + '. ' +
      'Je vous attends directement au bord du bassin. Pensez au maillot et au bonnet. À demain 🙂';
  }
  if (data.firstSession && isAdultBeginner_(data) && !data.loyaltyApplied) {
    return 'Bonjour ' + firstName + ', petit rappel pour votre première séance demain à ' + time + '. ' +
      'Je vous attends directement au bord du bassin. Pensez à votre maillot, à votre bonnet et à régler votre entrée à l’accueil. ' +
      'Je vous joins également un petit document à lire tranquillement avant de venir. À demain 🙂';
  }
  if (data.firstSession) {
    return 'Bonjour ' + firstName + ', petit rappel pour votre première séance demain à ' + time + '. ' +
      'Je vous attends directement au bord du bassin. Pensez à votre maillot, à votre bonnet et à régler votre entrée à l’accueil. À demain 🙂';
  }
  return 'Bonjour ' + firstName + ', petit rappel pour votre séance demain à ' + time + '. ' +
    'Je vous attends directement au bord du bassin. Pensez à votre maillot et à votre bonnet. À demain 🙂';
}

function isAdultBeginner_(data) {
  if (!data || data.profile !== 'adult') return false;
  const goal = oneLine_(data.goal).toLowerCase();
  return goal.indexOf('apprendre') !== -1 ||
    goal.indexOf('aquaphobie') !== -1 ||
    goal.indexOf('confiance') !== -1;
}

function normalizePromoCode_(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

function isLoyaltyCode_(value) {
  return normalizePromoCode_(value) === LOYALTY_CODE;
}

function loyaltyTotal_(mode, pack) {
  const unitPrice = mode === 'individual' ? LOYALTY_INDIVIDUAL_UNIT_PRICE : LOYALTY_SMALL_UNIT_PRICE;
  const sessionCount = pack === 'p10' ? 10 : pack === 'p5' ? 5 : 1;
  return unitPrice * sessionCount;
}

function packSessionCount_(pack) {
  return pack === 'p10' ? 10 : pack === 'p5' ? 5 : 1;
}

function publicPricing_(profile, mode) {
  const profilePrices = STANDARD_PRICING[profile] || STANDARD_PRICING.adult;
  const prices = profilePrices[mode] || profilePrices.small;
  return {
    currency:'EUR',
    p1:{total:prices.p1,perSession:prices.p1,sessions:1},
    p5:{total:prices.p5,perSession:prices.p5/5,sessions:5},
    p10:{total:prices.p10,perSession:prices.p10/10,sessions:10}
  };
}

function bookingPrice_(profile, mode, pack, loyaltyApplied) {
  const sessions = packSessionCount_(pack);
  if (loyaltyApplied) {
    const total = loyaltyTotal_(mode, pack);
    return {type:'FIDELITE',total:total,perSession:total/sessions,sessions:sessions};
  }
  const pricing = publicPricing_(profile, mode)[pack];
  if (!pricing) throw new Error('Tarif introuvable pour cette réservation.');
  return {type:'STANDARD',total:pricing.total,perSession:pricing.perSession,sessions:pricing.sessions};
}

function priceFromEvent_(event) {
  const fields = descriptionFields_(event);
  const pack = normalizePack_(fields.PACK) || 'p1';
  const sessions = packSessionCount_(pack);
  let total = Number(fields.TARIF_TOTAL || fields.TARIF_FIDELITE || event.getTag('booking_price_total') || 0);
  let perSession = Number(fields.TARIF_PAR_SEANCE || 0);
  if (!perSession && total) perSession = total/sessions;
  return {total:total,perSession:perSession,sessions:sessions};
}

function isLoyaltyEvent_(event) {
  const fields = descriptionFields_(event);
  return fields.CLIENT === 'ANCIEN_ELEVE' || normalizePromoCode_(fields.CODE_PROMO) === LOYALTY_CODE;
}

function loyaltyEmailLabel_(event) {
  if (!isLoyaltyEvent_(event)) return '';
  const fields = descriptionFields_(event);
  const total = Number(fields.TARIF_FIDELITE || 0);
  return 'ANCIEN ÉLÈVE — tarif fidélité' + (total > 0 ? ' : ' + total + ' €' : '');
}

function priceEmailLabel_(event) {
  const price = priceFromEvent_(event);
  if (!(price.total > 0)) return '';
  const fields = descriptionFields_(event);
  const type = String(fields.TARIF_TYPE || '').toUpperCase() === 'FIDELITE' || isLoyaltyEvent_(event)
    ? 'tarif fidélité'
    : 'tarif standard';
  return 'MONTANT À DEMANDER — ' + type + ' : ' + formatEuro_(price.total);
}

function formatEuro_(value) {
  const number = Number(value);
  if (!isFinite(number)) return '';
  return (Math.round(number * 100) / 100).toFixed(number % 1 ? 2 : 0).replace('.', ',') + ' €';
}

function isKnownClient_(email, phone) {
  const properties = PropertiesService.getScriptProperties();
  return clientRegistryKeys_(email, phone).some(function(key) {
    return !!properties.getProperty(key);
  });
}

function refreshFirstSessionTags_(calendar, email, phone, currentEvent) {
  // Ne parcourt plus tout le calendrier depuis 2020 à chaque réservation.
  // Le verrou de doPost garantit que deux créations simultanées ne peuvent pas
  // revendiquer toutes les deux le statut de première séance.
  const properties = PropertiesService.getScriptProperties();
  const keys = clientRegistryKeys_(email, phone);
  const alreadySeen = keys.some(function(key) {
    return !!properties.getProperty(key);
  });
  const firstSession = !alreadySeen;
  const marker = currentEvent.getId() + '|' + currentEvent.getStartTime().toISOString();

  keys.forEach(function(key) {
    if (!properties.getProperty(key)) properties.setProperty(key, marker);
  });
  currentEvent.setTag(TAG_FIRST_SESSION, firstSession ? 'yes' : 'no');
  return firstSession;
}

function migrerRegistreClientsDepuisCalendrier() {
  // À exécuter une seule fois après l'installation de cette version. Le scan
  // historique devient ensuite inutile pendant les réservations publiques.
  const calendar = CalendarApp.getCalendarById(CALENDAR_ID);
  if (!calendar) throw new Error('Agenda introuvable.');
  const from = new Date(2020, 0, 1);
  const to = new Date(Date.now() + 2 * 365 * 86400000);
  const events = calendar.getEvents(from, to, {search:BOOKING_PREFIX})
    .filter(isBookingEvent_)
    .sort(function(a, b) { return a.getStartTime() - b.getStartTime(); });
  const properties = PropertiesService.getScriptProperties();
  const known = properties.getProperties();
  const updates = {};
  let clientsAdded = 0;

  events.forEach(function(event) {
    const fields = descriptionFields_(event);
    const keys = clientRegistryKeys_(fields.EMAIL || '', fields.TELEPHONE || '');
    if (!keys.length) return;
    const alreadySeen = keys.some(function(key) { return !!known[key] || !!updates[key]; });
    event.setTag(TAG_FIRST_SESSION, alreadySeen ? 'no' : 'yes');
    if (!alreadySeen) clientsAdded++;
    const marker = event.getId() + '|' + event.getStartTime().toISOString();
    keys.forEach(function(key) {
      if (!known[key] && !updates[key]) updates[key] = marker;
    });
  });

  if (Object.keys(updates).length) properties.setProperties(updates, false);
  return 'Migration terminée : ' + events.length + ' réservation(s) analysée(s), ' +
    clientsAdded + ' client(s) indexé(s). Les prochaines réservations ne scanneront plus l’historique.';
}

function clientRegistryKeys_(email, phone) {
  const keys = [];
  const normalizedEmail = oneLine_(email).toLowerCase();
  const normalizedPhone = normalizePhoneDigits_(phone);
  if (normalizedEmail) keys.push(clientRegistryKey_('email:' + normalizedEmail));
  if (normalizedPhone) keys.push(clientRegistryKey_('phone:' + normalizedPhone));
  return keys.filter(function(key, index, array) { return array.indexOf(key) === index; });
}

function clientRegistryKey_(identity) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    identity,
    Utilities.Charset.UTF_8
  );
  const hex = digest.map(function(value) {
    return ('0' + ((value + 256) % 256).toString(16)).slice(-2);
  }).join('');
  return CLIENT_REGISTRY_PREFIX + hex.slice(0, 40);
}

function slotCacheKey_(profile, mode, days) {
  return ['slots', SLOT_CACHE_VERSION, profile, mode, days].join('_');
}

function clearAvailabilityCache_() {
  const cache = CacheService.getScriptCache();
  ['adult','childu8','child8'].forEach(function(profile) {
    ['small','individual'].forEach(function(mode) {
      [DEFAULT_DAYS, MAX_DAYS].forEach(function(days) {
        cache.remove(slotCacheKey_(profile, mode, days));
      });
    });
  });
}

function sameClient_(event, email, phone) {
  const fields = descriptionFields_(event);
  const wantedPhone = normalizePhoneDigits_(phone);
  const eventPhone = normalizePhoneDigits_(fields.TELEPHONE || '');
  if (wantedPhone && eventPhone && wantedPhone === eventPhone) return true;
  const wantedEmail = oneLine_(email).toLowerCase();
  const eventEmail = oneLine_(fields.EMAIL).toLowerCase();
  return !!wantedEmail && wantedEmail === eventEmail;
}

function descriptionFields_(event) {
  const fields = {};
  String(event.getDescription() || '').split(/\r?\n/).forEach(function(line) {
    const pos = line.indexOf('=');
    if (pos <= 0) return;
    fields[line.slice(0, pos).trim().toUpperCase()] = line.slice(pos + 1).trim();
  });
  return fields;
}

function eventSlot_(event) {
  const start = event.getStartTime();
  const end = event.getEndTime();
  return {
    date:Utilities.formatDate(start, TIME_ZONE, 'yyyy-MM-dd'),
    heure:Utilities.formatDate(start, TIME_ZONE, 'HH:mm'),
    fin:Utilities.formatDate(end, TIME_ZONE, 'HH:mm'),
    dureeMinutes:Math.round((end.getTime() - start.getTime()) / 60000)
  };
}

function whatsappUrl_(phone, message) {
  const digits = whatsappPhone_(phone);
  if (!digits) throw new Error('Numéro WhatsApp invalide : ' + phone);
  return 'https://wa.me/' + digits + '?text=' + encodeURIComponent(message);
}

function whatsappPhone_(phone) {
  let digits = normalizePhoneDigits_(phone);
  if (digits.indexOf('00') === 0) digits = digits.slice(2);
  if (digits.length === 10 && digits.charAt(0) === '0') digits = '33' + digits.slice(1);
  return digits;
}

function normalizePhoneDigits_(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function testerConfigurationTurnstile() {
  const secret = PropertiesService.getScriptProperties().getProperty(TURNSTILE_SECRET_PROPERTY);
  if (!secret) {
    throw new Error('Ajoutez la propriété de script TURNSTILE_SECRET_KEY avant de continuer.');
  }
  const response = UrlFetchApp.fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method:'post',
    payload:{secret:secret,response:'test-autorisation'},
    muteHttpExceptions:true
  });
  return 'Clé secrète trouvée et accès Cloudflare autorisé. HTTP ' + response.getResponseCode() + '.';
}

function verifyTurnstile_(token) {
  const secret = PropertiesService.getScriptProperties().getProperty(TURNSTILE_SECRET_PROPERTY);
  if (!secret) return {ok:false,reason:'secret_missing'};
  if (!token) return {ok:false,reason:'token_missing'};
  try {
    const response = UrlFetchApp.fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method:'post',
      payload:{
        secret:secret,
        response:token,
        idempotency_key:Utilities.getUuid()
      },
      muteHttpExceptions:true
    });
    if (response.getResponseCode() !== 200) {
      return {ok:false,reason:'http_' + response.getResponseCode()};
    }
    const result = JSON.parse(response.getContentText() || '{}');
    const hostnameOk = String(result.hostname || '') === TURNSTILE_EXPECTED_HOSTNAME;
    const actionOk = String(result.action || '') === TURNSTILE_EXPECTED_ACTION;
    if (result.success === true && hostnameOk && actionOk) return {ok:true,reason:'ok'};
    return {
      ok:false,
      reason:'rejected:' + (result['error-codes'] || []).join(',') +
        ':host=' + String(result.hostname || '') + ':action=' + String(result.action || '')
    };
  } catch (err) {
    console.error('Erreur de validation Turnstile : ' + String(err));
    return {ok:false,reason:'verification_error'};
  }
}

function guideBlob_(fileId, filename) {
  if (!isConfiguredValue_(fileId)) {
    throw new Error('Identifiant Google Drive manquant pour ' + filename + '.');
  }
  return DriveApp.getFileById(fileId).getBlob().setName(filename);
}

function validateEmailConfig_() {
  if (!isConfiguredValue_(EMAIL_ANTOINE) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(EMAIL_ANTOINE)) {
    throw new Error('Remplacez EMAIL_ANTOINE en haut du fichier par votre adresse Gmail.');
  }
}

function isConfiguredValue_(value) {
  const text = String(value || '').trim();
  return !!text && text.indexOf('A_REMPLACER') === -1;
}

function firstName_(name) {
  return oneLine_(name).split(/\s+/)[0] || 'bonjour';
}

function displayClient_(data) {
  return data.profile === 'adult' ? oneLine_(data.name) : oneLine_(data.childName) + ' - parent ' + oneLine_(data.name);
}

function frenchDate_(date) {
  const days = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
  const months = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
  const dayIndex = Number(Utilities.formatDate(date, TIME_ZONE, 'u')) % 7;
  const dayNumber = Number(Utilities.formatDate(date, TIME_ZONE, 'd'));
  const monthIndex = Number(Utilities.formatDate(date, TIME_ZONE, 'M')) - 1;
  return days[dayIndex] + ' ' + dayNumber + ' ' + months[monthIndex];
}

function hourLabel_(date) {
  return Utilities.formatDate(date, TIME_ZONE, 'HH:mm').replace(':', 'h');
}

function htmlEscape_(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function validateBooking_(profile, mode, startISO, name, email, phone, goal, reason, pack, childName, childAge, consent, legalConsent) {
  if (!profile) return {ok:false,message:'Choisissez le nageur.'};
  if (mode !== 'small' && mode !== 'individual') return {ok:false,message:'Choisissez un accompagnement.'};
  if (!startISO || isNaN(new Date(startISO).getTime())) return {ok:false,message:'Choisissez un créneau.'};
  if (name.length < 2) return {ok:false,message:'Indiquez votre prénom et votre nom.'};
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return {ok:false,message:'Indiquez une adresse e-mail valide.'};
  if (phone.replace(/\D/g,'').length < 8) return {ok:false,message:'Indiquez un numéro de téléphone valide.'};
  if (!goal) return {ok:false,message:'Choisissez votre objectif.'};
  if (!pack) return {ok:false,message:'Choisissez votre rythme.'};
  if (!consent) return {ok:false,message:'Vous devez accepter la règle d’annulation.'};
  if (!legalConsent) return {ok:false,message:'Vous devez accepter les conditions générales et la politique de confidentialité.'};
  if (profile !== 'adult') {
    if (childName.length < 2) return {ok:false,message:'Indiquez le prénom de l’enfant.'};
    const age = Number(childAge);
    if (!isFinite(age) || age < 4 || age > 17) return {ok:false,message:'Indiquez l’âge de l’enfant.'};
    if (profile === 'childu8' && age >= 8) return {ok:false,message:'Pour cet âge, choisissez « Enfant de 8 ans et + ».'};
    if (profile === 'child8' && age < 8) return {ok:false,message:'Pour cet âge, choisissez « Enfant de moins de 8 ans ».'};
  }
  return {ok:true};
}

function normalizeProfile_(v) { v=String(v||'').toLowerCase().trim(); if(v==='adult'||v==='adulte')return'adult'; if(v==='childu8'||v==='enfantmoins8'||v==='moins8')return'childu8'; if(v==='child8'||v==='enfant8plus'||v==='8plus')return'child8'; return''; }
function normalizeMode_(v) { v=String(v||'').toLowerCase().trim(); if(v==='individual'||v==='indiv'||v==='individuel')return'individual'; return'small'; }
function normalizePack_(v) { v=String(v||'').toLowerCase().trim(); return(v==='p1'||v==='p5'||v==='p10')?v:''; }
function clampDays_(v) { const n=Number(v); if(!isFinite(n)||n<=0)return DEFAULT_DAYS; return Math.min(MAX_DAYS,Math.max(1,Math.floor(n))); }
function sanitizeCallback_(v) { v=String(v||'').trim(); if(!v)return''; return /^[A-Za-z_$][A-Za-z0-9_$]{0,60}$/.test(v)?v:''; }
function clean_(v,max) { return String(v==null?'':v).trim().slice(0,max||500); }
function oneLine_(v) { return String(v||'').replace(/[\r\n]+/g,' ').trim(); }
function short_(v,max) { return oneLine_(v).slice(0,max||90); }
function output_(payload,callback) { const json=JSON.stringify(payload); if(callback)return ContentService.createTextOutput(callback+'('+json+');').setMimeType(ContentService.MimeType.JAVASCRIPT); return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON); }
function bookingResponse_(payload) {
  payload.source = 'antoine-booking';
  const safeJson = JSON.stringify(payload).replace(/</g,'\\u003c');
  const safeOrigin = JSON.stringify(SITE_ORIGIN);
  const html = '<!doctype html><html><head><meta charset="utf-8"></head><body><script>' +
    '(function(){var data=' + safeJson + ';' +
    'try{window.parent.postMessage(data,' + safeOrigin + ');}catch(e){}' +
    '})();' +
    '</script></body></html>';
  return HtmlService.createHtmlOutput(html).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
