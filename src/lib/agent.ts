// Pal's brain: scope filter → intent → slot-filling dialog. Deterministic and auditable.
import { at, fmtDay, fmtHours, fmtTime, HOUR, startOfDay, type PalId, type PalState, type TaskKind } from './core'
import { clockTime, eventKind, extractTitle, hasSingleDay, isNo, isRelative, isYes, namedDay, parseDays, parseHours, parseRange, parseWhen, taskKind } from './parse'

/** Words around a day/time correction that aren't a new title ("sabing mamayang 10 am", "mamaya ngaaa", "oo lagay mo para today") */
const CORRECTION_FILLER = /\b(oo+|yes|yeah|no+|hindi|di|not|nope|mali|wait|teka|actually|sabi(ng)?|i said|said|nga+h*|na+|lang|po|eh|kasi|para|sa|ng|ang|yung|ung|mo|ko|ilagay|lagay|lagyan|add|put|it|instead( of)?|dapat|make|change|move|to|at|on|the|for|and|please|pls|paki|ulit|ha|ah+|uy|ay|hala|so|ok(ay)?|sige)\b/gi

export interface Draft {
  title: string
  kind: TaskKind
  due?: number
  hours?: number
}
export type Awaiting = null | 'due' | 'hours' | 'confirm'
/** A class/shift we heard but still need weekdays for. */
export interface PendingEvent { title: string; kind: string; start: number; end: number }
/** The event card still waiting for Add it / Never mind, so "no, it's a lunch date" can revise it. */
export interface LastEvent { title: string; kind: string; start: number; end: number; days?: number[] }

export type Card =
  | { type: 'readback'; draft: Draft }
  /** replaces: planned blocks this plan takes over, removed only when it's accepted */
  | { type: 'proposal'; taskId: string; blockIds: string[]; why: string; shortfall: number; freeHours: number; commute?: boolean; replaces?: string[]; taskUpdate?: { due: number; hours: number } }
  | { type: 'checkin'; eventIds: string[] }
  /** conflicts: study blocks it lands on (re-planned on add). clash: other events it overlaps ("Travel to school, 4am–5am"); alt: the nearest free time. */
  | { type: 'event'; title: string; kind: string; start: number; end: number; conflicts: number; whatIf?: boolean; days?: number[]; until?: number; clash?: string[]; alt?: { start: number; end: number }; moveOther?: { id: string; title: string; to: { start: number; end: number } } }
  /** Remove or move something already on the calendar. seriesIds: the same slot on other days, for "remove all". clash: what the new time overlaps. */
  | { type: 'change'; mode: 'remove' | 'move'; eventId: string; title: string; kind: string; start: number; end: number; to?: { start: number; end: number }; seriesIds?: string[]; targets?: { id: string; title: string; start: number; end: number }[]; clash?: string[] }
  /** A file attached in chat, now in the Study library: plan study from it, flashcards, quiz, read aloud */
  | { type: 'file'; fileId: string; name: string; folderName: string; scanned: boolean }
  | { type: 'notify' }
  | { type: 'boundary' }

/** Cards a typed yes/no can answer */
export const ANSWERABLE: Card['type'][] = ['event', 'proposal', 'readback', 'change']

export type Action =
  | { type: 'confirmDraft'; draft: Draft }
  | { type: 'addEvent'; title: string; kind: string; start: number; end: number; whatIf: boolean; days?: number[] }
  | { type: 'summary' }
  | { type: 'weather' }
  | { type: 'pref'; latestHour?: number; blockedDays?: number[]; clear?: boolean }
  | { type: 'freeTime'; day: number }
  | { type: 'energy'; value: 'morning' | 'afternoon' | 'evening' }
  | { type: 'openSyllabus' }
  | { type: 'reviseEvent'; title: string; kind: string; start: number; end: number; days?: number[] }
  | { type: 'confirmEvent' }
  | { type: 'skipEvent' }

export interface Turn {
  text: string
  card?: Card
  chips?: string[]
  mood?: PalState
  draft: Draft | null
  awaiting: Awaiting
  action?: Action
  rule?: string
  /** which canned line answered ("unknown" = the rules didn't understand it) */
  key?: string
  /** undefined = leave as is; null = clear */
  pending?: PendingEvent | null
}

/* ---------- Scope filter (runs on input and on any generated output) ---------- */
const GRADED = /\b(write|solve|answer|summari[sz]e|finish|do|complete|gawin|sagutan|paraphrase|translate)\b.*\b(essay|homework|hw|assignment|problem|problems|quiz|paper|report|thesis|reflection|worksheet|module|code)\b|\b(answers? (to|for)|give me the answers?)\b/i
const GRADES = /\b(will i pass|am i (going to|gonna) (pass|fail)|predict|my grade|grades?|gpa|score will|babagsak|pasado)\b/i
const STRESS = /\b(burn(ed|t)? ?out|stressed|anxious|anxiety|depress|overwhelm|panic|can'?t cope|pagod na pagod|suicid|self[- ]harm)\b/i
const INJECT = /\b(ignore (your|all|previous|the) (rules|instructions)|system prompt|you are now|pretend (to be|you)|jailbreak|developer mode|act as)\b/i
const OFFTOPIC = /^(who|what is|what's the|where is|why is|explain|tell me (a joke|about)|how do i (code|make|cook)|write me a (poem|story|song))\b/i

export const BLOCKED_OUTPUT = /\b(you will (pass|fail)|your grade will|you (are|seem) (burned out|depressed|anxious))\b/i

/* ---------- Voice: same logic, four personalities ---------- */
type Lines = Record<string, string[]>
const BASE: Lines = {
  greet: ["Hey! So what's your week looking like?", "Hi hi. What've you got going on this week?"],
  greetNamed: ["Hey {user}! So what's your week looking like?", 'Hi {user}! What have you got going on this week?'],
  askDue: ["Ooh okay. When's it due?", 'Got it. When do you need it done by?', 'Okay, and the deadline is…?'],
  dueRetry: ['Wait, which day was that? Like "Friday 5pm" or "Oct 18" works.', 'Sorry, missed the day. "Next Tuesday"? "Tomorrow"?'],
  askHours: ["How long do you think it'll take you?", 'Gut feeling, how many hours?'],
  askHoursExam: ['How much study time do you want before it?', 'How many hours of review feels right?'],
  hoursRetry: ['Just a ballpark is fine, like "3 hours". Or say "not sure" and I\'ll guess.'],
  hoursGuess: ["Let's go with {h} for now. Most people need about that. We can change it."],
  readback: ['Okay, so I got:', 'Lemme make sure I got this right:'],
  fix: ['Sure, what should I change? Like "due Thursday" or "4 hours".'],
  proposal: ["Okay so I'd do it like this. Nothing's on your calendar yet, just say the word.", 'What if we split it up like this?'],
  crunch: ["Hmm, real talk: it needs about {need} but you only have around {free} free before it's due. Maybe trim it down, ask for more time, or move something?"],
  accepted: ["Done, it's in! I'll ask how it went after each one.", "Added. I'll check on you after each block."],
  notNow: ['All good, I saved it. Just say "plan it" whenever.', "Okay, I won't touch your calendar."],
  checkin: ['Hey, did you get to this?', 'So… how did this one go?'],
  checkinMany: ['A few of these went by. How did they go?'],
  doneOk: ['Nice!! Checked off.', 'Yesss, done.'],
  reflow: ["That's okay, happens. I moved the {h} left around, does this work?", 'No stress. Redid the last {h}, want this instead?'],
  conflictReflow: ['{what} overlaps some study time, so here are new spots for it. Nothing moves until you accept.', 'That bumps a study block. Want it at these times instead? Your old ones stay until you say yes.'],
  revised: ['Ahh got it. Like this?', 'Oops, fixed it. This one?'],
  reflowNone: ["Nothing left to move. You're good on this one."],
  graded: ["I can't write it for you, but I can save you some focus time for it. How long do you think you need?"],
  grades: ["I honestly can't tell you your grade. I can show how much study time fits before the exam though."],
  stress: ["I can't really tell how you're feeling, but I can look at your week and see what we can move. And if it's getting heavy, the guidance office is there for you."],
  inject: ["Let's stick to your schedule. Anything else coming up?"],
  offtopic: [
    "Ooh, I get what you're asking, but that's outside what I can help with. Want to look at {next} instead?",
    "That one's not really my thing, sorry! I'm better at time stuff. Should we plan around {next}?",
    "I'd love to, but I'm just your planning buddy. How about we block some time for {next}?",
    "Hmm, can't help with that one. What I can do is make your week lighter. Start with {next}?",
  ],
  time: ["It's {t}, {d}.", '{t} right now, {d}.'],
  prefSaved: ["Noted! I'll remember: {what}.", 'Got it, {what}. I\'ll plan around that from now on.'],
  prefCleared: ['Okay, I forgot your planning preferences. Fresh start!'],
  focusStart: ["Focus time! I'll stay right here.", "Okay, 25 minutes. You've got this."],
  breakStart: ['Nice round! Take 5, stretch and drink water.', 'Break time. Look away from the screen for a bit.'],
  longBreak: ['Four rounds done! Take a longer 15-minute break.'],
  sessionDone: ['Session saved. {m} min focused today.'],
  setDone: ["Set complete, four rounds done! Start another whenever you're ready."],
  weatherNone: ["I can't check the weather right now, sorry! Once you're online I'll grab it.", 'No weather info yet, I need internet for that. Try again in a bit?'],
  thanks: ['Anytime!', 'Of course :)'],
  chatHow: ["Doing good, thanks for asking! How's your week going?", 'All good here! Anything coming up for you?'],
  chatWho: ["I'm your planning buddy. Tell me your classes, deadlines or shifts and I'll fit them into your week.", 'I help you plan your week. Try "Bio exam Friday" or "gym tomorrow 5pm".'],
  chatAck: ['Okay! Just tell me whenever something comes up.', "Sure! I'm here if you need to plan something."],
  chatHuh: ['Oops, was I unclear? I can add things to your week, like "study tomorrow 3pm" or "Math quiz Friday".', "Hmm, sorry! Ask me to add a class, shift or deadline and I'll handle it."],
  unknown: [
    'Hmm, not sure I caught that. If it\'s about your schedule, try "Bio exam Friday" or "gym tomorrow 5pm". Or should we look at {next}?',
    "I might've missed that one! I'm best with plans and deadlines. Want to check {next}?",
    "Sorry, I didn't quite get it. Tell me what's coming up and I'll fit it in.",
  ],
  energy: ["Got it, I'll put things in the {v} first."],
  eventAdd: ['Add this?', 'Want me to put this in?'],
  eventAdded: ['Added! {what} is on your calendar.', 'Done, {what} is in.'],
  eventSkipped: ["Okay, I left it off.", 'Sure, not adding it.'],
  nothingWaiting: ["Hmm, I don't have anything ready to add yet. What should I put in, and when?"],
  confirmHint: ["Tap Add it on the card, or just tell me to go ahead, and it's on your calendar.", 'Say the word or tap Add it, and I\'ll put it in.'],
  planHint: ["Tap Accept or just say go, and these are on your calendar.", 'Say yes or tap Accept and they\'re in.'],
  readbackHint: ['Tap Looks right, or just say yes, and I\'ll find the time for it.'],
  changeHint: ["Nothing's changed yet. Tap the button on the card, or say yes, and it's done."],
  nothingRemoved: ["I haven't removed anything yet. Which one should go? I'll show it so you can confirm."],
  nothingMoved: ["I haven't moved anything yet. Which one, and to when? I'll show it first."],
  removeAsk: ['Take this off your calendar?', 'Remove this one?'],
  whereIs: ["It's right here: {what}. I highlighted it on your calendar."],
  timerSet: ['Timer set for {len}.', 'Okay, {len}, starting now.'],
  timerWarnNote: [" I'll tell you at the last {w}."],
  timerWarn: ['{w} left!', 'Heads up, {w} to go!'],
  timerDone: ["Time's up!", "Ding! Time's up."],
  timerStopped: ['Okay, alarm off.'],
  timerLeft: ['{left} left on your timer.'],
  timerAdded: ['Added {len}. {left} to go now.'],
  timerPaused: ['Timer paused with {left} left.'],
  timerResumed: ['Timer back on, {left} to go.'],
  timerCancelled: ['Timer cancelled.'],
  noTimer: ["There's no timer running. Want me to start one?"],
  reminderSet: ["Okay, I'll remind you at {time}: {what}."],
  reminderNow: ['Reminder: {what}!'],
  studyLeft: ['{phase}: {left} left.'],
  noStudy: ['No focus session running. Say "start focus" to begin one.'],
  studyPaused: ['Paused. Say "resume" when you\'re back.'],
  hfOn: ['I\'m listening. Just say "Hi {name}" whenever you need me.'],
  voiceAddAsk: ['Add {what}? Say yes or no.'],
  overlapAsk: ['Heads up, that overlaps {clash}. Want {alt} instead, or add it anyway?', 'Hmm, {clash} is already there. How about {alt}? Or I can add it anyway.'],
  overlapAskNoAlt: ["Heads up, that overlaps {clash}, and nothing else is free that day. Add it anyway?"],
  voiceRemoveAsk: ['Remove {what}? Say yes or no.'],
  voiceMoveAsk: ['Move {what}? Say yes or no.'],
  hfOff: ['Hands-free off. Tap the mic whenever you want to talk.'],
  hfYes: ['Yes?', "I'm here, go ahead."],
  hfIdle: ['I stopped listening after 30 quiet minutes. Turn hands-free back on whenever.'],
  hfQuiet: ["It's quiet hours, so I've stopped listening. Good night!"],
  hfMicBlocked: ['I need the microphone for hands-free. Allow it in your browser or phone settings, then try again.'],
  hfError: ["Hands-free couldn't start on this device. You can still tap the mic or type."],
  studySkipped: ['Skipped. On to the next one.'],
  nextUp: ['Next up: {what}.{more}', 'Coming up: {what}.{more}'],
  nowOn: ['Right now: {what}.{more}'],
  nothingNext: ['Nothing else on your calendar today. Want to plan something?'],
  whoami: ["You're {user}! 😊", '{user}, of course!'],
  whoamiNone: ["You haven't told me your name yet. Add it in Settings and I'll remember it."],
  moveAsk: ['Move it here?', 'Like this?'],
  removed: ['Okay, {what} is off your calendar.', 'Done, {what} is gone.'],
  moved: ['Moved! {what} is at the new time.'],
  kept: ['Okay, left it as is.', 'Sure, keeping it.'],
  confirmWhich: ['Wait, just to be sure: add this one?', 'Just checking, this one?'],
  slowNet: ["My connection's being slow, so simpler answers from me for a bit."],
  quotaLocal: ["My free cloud AI ran out for now, so I'm thinking on your PC instead. A bit slower, same me."],
  quotaOut: ['My free AI limit ran out, so simple answers from me until about {time}.'],
  busy: ["We've been chatting a lot! Simpler answers for a minute while my AI catches its breath."],
  offlineSimple: ["You're offline, so I can only do simple stuff until you're back."],
  whatIf: ['It would look like this:'],
  notify: ['Want a little heads-up before each block starts?'],
  voiceOn: ["Okay, I'll talk out loud now.", 'Voice on! You can just talk to me too.'],
  askDays: ['{what}, got it. Which days?', 'Okay, {what}. What days do you have it?'],
  daysRetry: ['Which days though? Like "MWF", "TTh", or "just today".'],
  askStart: ['{what}. What time does it start?', '{what}. When does it start?'],
  askEnd: ['{what} starts {when}. What time does it end?'],
  addAsk: ['{what}. Add it?'],
  newEventAsk: ['Sure. What would you like to schedule?'],
  declineOk: ['Okay. What would you like to do instead?'],
  examOverlap: ['Your exam is {range}. It overlaps {clash}.{move} Add it anyway?'],
  moveOther: [' I can move {other} to {to} instead.'],
  studyWhich: ['Which exam or deadline is this review for, and when is it?'],
  studyHours: ['How many hours of review would you like before {what}?'],
  examStill: ['Your calendar still has {what}. Should the exam itself move, or should review still finish before it?'],
  removeWhichTime: ['Which event at that time do you mean? Tell me its title and day.'],
  removeWhichPlan: ['Which review plan should I remove? Tell me its day or start time so I can show the exact blocks.'],
  removeWhichBlocks: ['Which review blocks should I remove? I will keep the exam itself.'],
  wrongPal: ["I'm not {wrong}. I'm {me} 🙂", "Close! I'm {me}, not {wrong}."],
  cloudNotSet: ["My cloud brain isn't set up on this device, so I'll keep it simple for now."],
  phoneModelMissed: ["I couldn't work that one out on this phone. Try saying it like \"Bio exam Friday 3pm\"."],
  fileSaved: ['Saved {file} in your {folder} folder. Want me to plan study time from it, make flashcards, or quiz you?'],
  fileScanned: ["Saved {file} in {folder}. It's scanned pages, so I can show it but can't read it out or quiz you on it."],
  fileTooBig: ['{file} is over 25 MB. Try a smaller copy, or split it.'],
  fileUnsupported: ['I can keep PDFs, text files and images. {file} is something else.'],
  fileUnreadable: ["{file} wouldn't open. If it has a password, save a copy without one."],
  planFromFile: ['{file} is about {h} of studying.{topics}'],
  planNeedsDate: ['{file} is about {h} of studying. When is the {what}?'],
  noFilesYet: ['Attach a reviewer first with the paperclip next to the message box, and I can make flashcards or a quiz from it.'],
  openCards: ['Here are flashcards from {file}.'],
  openQuiz: ["Here's a practice quiz from {file}. Good luck!"],
  openRead: ["Opening {file}. Tap Read aloud and I'll read it to you."],
}
const VOICE: Record<PalId, Partial<Lines>> = {
  rei: {
    wrongPal: ["I'm not {wrong}. I'm Rei 🙂"],
    greet: ["Hi, I'm Rei. Tell me about your week, we'll figure it out together."],
    doneOk: ["That one's done. Proud of you.", 'Nice and steady. Checked off.'],
    offtopic: ["I hear you, but that's not something I can help with. Maybe we take a gentle look at {next}?"],
  },
  diel: {
    wrongPal: ["Close, but I'm Diel, not {wrong}."],
    greet: ["Hey, Diel here. Give me your classes, deadlines, shifts. I like a good schedule."],
    askHours: ['How many hours, roughly?', "What's your estimate in hours?"],
    accepted: ["In the calendar. I'll check in after each block."],
    doneOk: ['Done. Love a clean list.'],
    offtopic: ['Outside my parameters, unfortunately. Within them: {next}. Want me to plan it?'],
  },
  jhyvie: {
    greet: ['Hiii, Jhyvie here! Kwento mo naman your week, classes, deadlines, raket, lahat.', 'Uy hello! Anong meron sa week mo?', 'Hi hi! May plano ka ba today?'],
    greetNamed: ['Hiii {user}! Kwento mo naman your week, classes, deadlines, raket, lahat.', 'Uy {user}! Anong meron sa week mo?', 'Hi hi {user}! May plano ka ba today?'],
    slowNet: ['Medyo mabagal connection ko ngayon, simpler replies muna ha.'],
    quotaLocal: ['Naubos yung free cloud AI ko, kaya yung AI sa PC mo muna gamit ko. Medyo mabagal, pero ako pa rin!'],
    quotaOut: ['Naubos yung free AI limit ko, kaya simple replies muna hanggang mga {time}.'],
    busy: ['Ang dami nating napag-usapan! Simple replies muna for a minute ha.'],
    offlineSimple: ['Offline ka ngayon kaya simple lang muna kaya ko hanggang makabalik ka.'],
    confirmWhich: ['Teka, para sure: ito ba idadagdag ko?', 'Ito ba yung sinasabi mo?'],
    conflictReflow: ['Sumabay yung {what} sa study time mo, kaya eto bagong oras. Walang gagalaw hangga\'t di mo ina-accept.'],
    kept: ['Sige, di ko gagalawin.'],
    whereIs: ['Nandito siya: {what}. Naka-highlight na sa calendar mo.'],
    timerSet: ['Sige! {len} na timer, simula na.', 'G! {len}, go na.'],
    timerWarnNote: [' Sasabihan kita sa huling {w}.'],
    timerWarn: ['{w} na lang!', 'Bilis, {w} na lang!'],
    timerDone: ["Time's up! Tapos na yung timer mo."],
    timerStopped: ['Okay, tahimik na.'],
    timerLeft: ['{left} pa sa timer mo.'],
    reminderSet: ['Sige, ipapaalala ko sa {time}: {what}.'],
    reminderNow: ['Paalala: {what}!'],
    nextUp: ['Sunod mo: {what}.{more}'],
    nowOn: ['Ngayon: {what}.{more}'],
    nothingNext: ['Wala ka nang naka-sched ngayon. Gusto mo mag-plan?'],
    whoami: ['{user} ka! 😊', 'Ikaw si {user}, syempre!'],
    whoamiNone: ['Di mo pa sinasabi pangalan mo! Ilagay mo sa Settings para maalala ko.'],
    studyPaused: ['Pause muna. Sabihin mo lang "resume" pag ready ka na.'],
    hfOn: ['Nakikinig na ako! Sabihin mo lang "Hi Jhyvie" pag kailangan mo ako.'],
    voiceAddAsk: ['Idagdag ko ba ang {what}? Sabihin mo lang oo o wag na.'],
    overlapAsk: ["Teka, sabay 'yan sa {clash}. {alt} na lang kaya? O sabihin mo 'add anyway'.", "Uy, may {clash} ka na diyan. {alt} na lang? O i-add ko pa rin?"],
    overlapAskNoAlt: ["Teka, sabay 'yan sa {clash}, at wala nang ibang bakante that day. I-add ko pa rin?"],
    voiceRemoveAsk: ['Tanggalin ko ba ang {what}? Oo o wag na?'],
    voiceMoveAsk: ['Ilipat ko ba ang {what}? Oo o wag na?'],
    hfOff: ['Sige, off na ang hands-free. Tap mo lang yung mic pag gusto mo mag-usap.'],
    hfYes: ['Yes? Ano yun?', 'Nandito ako, go!'],
    hfQuiet: ['Quiet hours na, kaya tumigil muna ako sa pakikinig. Good night!'],
    studySkipped: ['Sige, skip! Tuloy tayo.'],
    askDue: ['Sige! Kailan deadline?', 'Okay! When is it due?'],
    askHours: ['Mga ilang oras kaya yan?', 'How many hours you think?'],
    accepted: ["G! Nasa calendar na. Kamustahin kita after each block ha."],
    doneOk: ['Yay, tapos na yan!', 'Galing! Done!'],
    notNow: ['Sige, later na lang. Sabihin mo lang "plan it".'],
    offtopic: ['Gets ko yan, pero hindi ko talaga forte yan hehe. Tara, {next} na lang natin pag-usapan?', 'Ay, di ko kaya sagutin yan! Pero kaya kitang tulungan sa {next}, game?'],
    time: ['{t} na! {d} ngayon.'],
    focusStart: ['Tara, focus muna! Nandito lang ako.'],
    breakStart: ['Galing! Break muna, 5 minutes. Inom ka tubig!'],
    unknown: ['Hmm, di ko masyado na-gets. Kung sa schedule, try mo "Bio exam Friday" o "gym bukas 5pm". O tingnan natin {next}?', 'Sorry, di ko nakuha. Sabihin mo lang ano meron and ilalagay ko.'],
    eventAdd: ['Idagdag ko ba ito?', 'Ilagay ko na ba?'],
    eventAdded: ['G! Nasa calendar na ang {what}.', 'Done, nailagay ko na ang {what}.'],
    eventSkipped: ['Sige, di ko na ilalagay.'],
    confirmHint: ["Tap mo lang yung Add it, o sabihin mo lang 'go', at ilalagay ko na."],
    removeAsk: ['Tanggalin ko na ba ito?'],
    thanks: ['Walang anuman!', 'Anytime! :)'],
    chatAck: ['Sige! Sabihin mo lang pag may ipaplano tayo.'],
    askDays: ['{what}, gets! Anong mga araw?'],
    askStart: ['{what}. Anong oras magsisimula?', '{what}. Mga anong oras start?'],
    askEnd: ['{what}, simula {when}. Anong oras matatapos?'],
    addAsk: ['{what}. Idagdag ko na?'],
    newEventAsk: ['Sige! Ano ilalagay natin?'],
    declineOk: ['Sige. Ano na lang gagawin natin?'],
    examOverlap: ['Exam mo {range}, pero sabay sa {clash}.{move} I-add ko pa rin?'],
    moveOther: [' Pwede kong ilipat ang {other} sa {to}.'],
    studyWhich: ['Para saang exam o deadline itong review, at kailan?'],
    studyHours: ['Ilang oras ng review gusto mo bago ang {what}?'],
    wrongPal: ["Hindi ako si {wrong}, si {me} 'to! 🙂", "Uy, {me} 'to, hindi si {wrong}!"],
    cloudNotSet: ['Di pa naka-set up ang cloud AI ko dito, kaya simple lang muna ako.'],
    phoneModelMissed: ['Di ko na-gets yun dito sa phone. Try mo ganito: "Bio exam Friday 3pm".'],
    fileSaved: ['Nai-save ko na ang {file} sa {folder} folder mo. Gusto mo i-plan natin ang study time, gawan kita ng flashcards, o quiz?'],
    fileScanned: ['Nai-save ko ang {file} sa {folder}. Scanned pages siya, kaya makikita mo pero di ko mababasa o magagawan ng quiz.'],
    planFromFile: ['Mga {h} ng aral ang {file}.{topics}'],
    planNeedsDate: ['Mga {h} ng aral ang {file}. Kailan ang {what}?'],
    noFilesYet: ['Mag-attach ka muna ng reviewer gamit yung paperclip sa tabi ng message box, tapos gagawan kita ng flashcards o quiz.'],
    openCards: ['Eto flashcards mula sa {file}.'],
    openQuiz: ['Eto practice quiz mula sa {file}. Kaya mo yan!'],
    openRead: ['Binuksan ko ang {file}. Tap mo Read aloud at babasahin ko sa iyo.'],
  },
  jaypee: {
    wrongPal: ["Ha, not {wrong}! It's Jaypee."],
    greet: ["Yo, Jaypee here! What's the week look like?"],
    askDue: ['When is it due?', 'Deadline?'],
    askHours: ['How many hours?'],
    accepted: ["Locked in! Let's go."],
    doneOk: ["Let's gooo, done!", 'Boom. Checked off.'],
    offtopic: ["Ha, not my sport! What I CAN coach is your week. Let's lock in {next}?"],
  },
}

let rot = 0
const lastLine: Record<string, string> = {}
export function say(pal: PalId, key: string, vars: Record<string, string | number> = {}) {
  const pool = VOICE[pal][key] ?? BASE[key] ?? [key]
  let s = pool[rot++ % pool.length]
  // Never the exact same line twice in a row ("hi" then "hello")
  if (pool.length > 1 && s === lastLine[key]) s = pool[rot++ % pool.length]
  lastLine[key] = s
  for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v))
  return BLOCKED_OUTPUT.test(s) ? BASE.inject[0] : s
}

/** Hello, with the user's name when they've told us it (never a raw "{user}") */
export const greetLine = (pal: PalId, user?: string) => (user?.trim() ? say(pal, 'greetNamed', { user: user.trim() }) : say(pal, 'greet'))

export const defaultHours = (k: TaskKind) => (k === 'exam' ? 6 : 4)

/* ---------- One dialog turn ---------- */
/**
 * `waiting`: the card a typed yes/no answers (newest unanswered one).
 * `waitingIsLatest`: false when Pal said something after that card, so a bare "oo" may answer that line instead.
 */
export function turn(input: string, ctx: { pal: PalId; now: number; draft: Draft | null; awaiting: Awaiting; pending?: PendingEvent | null; lastEvent?: LastEvent | null; waiting?: Card['type'] | null; waitingIsLatest?: boolean; facts?: { next: string; user?: string } }): Turn {
  const { pal, now } = ctx
  const text = input.trim()
  const keep = { draft: ctx.draft, awaiting: ctx.awaiting }
  const F = { next: ctx.facts?.next ?? 'your week' }
  const out = (key: string, extra: Partial<Turn> = {}, vars?: Record<string, string | number>): Turn => ({
    ...keep, text: say(pal, key, vars), key, ...extra,
  })

  if (INJECT.test(text)) return out('inject', { rule: 'Scope filter: instruction override' })
  if (STRESS.test(text)) return out('stress', { rule: 'Scope filter: no wellbeing assessment', chips: ['Show my week', 'Find things to move'] })
  if (GRADES.test(text)) return out('grades', { rule: 'Scope filter: no grade predictions' })
  if (GRADED.test(text)) {
    const k = taskKind(text) ?? 'assignment'
    return out('graded', { rule: 'Scope filter: no graded work', draft: { title: extractTitle(text, 'Assignment'), kind: k }, awaiting: 'hours' })
  }

  // Answering "which days?" for a class/shift we already heard
  if (ctx.pending && !parseRange(text, now)) {
    const p = ctx.pending
    const days = parseDays(text)
    const once = /\b(just )?(today|once|this week only|one time|isang beses)\b/i.test(text)
    const single = !days && hasSingleDay(text, now) ? parseWhen(text, now) : null
    if (days || once || single) {
      let { start, end } = p
      if (single) {
        const shift = new Date(single.t).setHours(0, 0, 0, 0) - new Date(start).setHours(0, 0, 0, 0)
        start += shift
        end += shift
      }
      return { ...keep, pending: null, text: '', action: { type: 'addEvent', title: p.title, kind: p.kind, start, end, whatIf: false, days: days ?? undefined } }
    }
    if (isNo(text)) return out('notNow', { pending: null })
    if (text.split(/\s+/).length <= 3) return out('daysRetry', { chips: ['MWF', 'TTh', 'Every weekday', 'Just today'] })
    // They moved on to something else: drop the question and handle the new message
    const r = turn(input, { ...ctx, pending: null })
    return { ...r, pending: r.pending === undefined ? null : r.pending }
  }

  // Safety net for answering the waiting card (event, plan, task or change) when no model answers.
  // Short and time-free only: "yes but make it 3pm" is a change, handled below
  const waiting = ctx.waiting ?? (ctx.lastEvent ? 'event' : null)
  if (waiting && text.split(/\s+/).length <= 4 && !parseRange(text, now) && !parseWhen(text, now)) {
    const le = ctx.lastEvent
    const no = isNo(text) || /^\s*(ayaw|ayoko)\b/i.test(text)
    const yes = !no && (isYes(text) || /^\s*(ok+(ay+)?|oki+|sige+|sge+|oo+|ye+s+|tama+|g+o*|push|ilagay|lagay|add (it|na)|lock it|put it|accept)\b/i.test(text))
    if ((yes || no) && ctx.waitingIsLatest === false) {
      // "oo ikaw na bahala" after Pal asked something else: don't guess, show the card again and ask
      if (waiting === 'event' && le) return { ...keep, text: say(pal, 'confirmWhich'), action: { type: 'addEvent', title: le.title, kind: le.kind, start: le.start, end: le.end, whatIf: false, days: le.days } }
    } else if (no) {
      return waiting === 'event' ? out('eventSkipped', { action: { type: 'skipEvent' } }) : { ...keep, text: '', action: { type: 'skipEvent' } }
    } else if (yes) {
      return waiting === 'event' && le
        ? out('eventAdded', { action: { type: 'confirmEvent' } }, { what: `${le.title}, ${fmtDay(le.start)} ${fmtTime(le.start)}` })
        : { ...keep, text: '', action: { type: 'confirmEvent' } }
    }
  }

  // Correcting the event card still waiting: "no, it's a lunch date", "make it 3pm", "call it Gym"
  // Standing preferences: "I don't study after 9pm", "keep Sundays free", "forget my preferences"
  if (/\b(forget|reset|clear)\b.*\b(pref(erence)?s?|rules?)\b/i.test(text)) return out('prefCleared', { action: { type: 'pref', clear: true } })
  const negates = /\b(don'?t|do not|never|no|ayoko(ng)?|wag|huwag|walang)\b/i.test(text)
  const late = negates && /\b(study|studying|aral|mag-?aral|work|plan|schedule|sched|anything|review)\b/i.test(text)
    ? text.match(/\b(?:after|past|lampas(?: ng)?|beyond)\s+(\d{1,2})(?::00)?\s*(am|pm)?/i) : null
  // A time range means a real event ("keep friday free for my class 9-12"), not a rest day
  const restDays = !parseRange(text, now) && (negates || /\b(keep|leave|rest day|day off)\b/i.test(text)) && /\b(free|rest|off|plans?|study|schedule|sched|anything)\b/i.test(text)
    ? parseDays(`every ${text}`) : null
  if (late || restDays) {
    const h = late ? +late[1] : NaN
    const latestHour = late ? (/am/i.test(late[2] ?? '') ? h % 12 : h < 12 ? h + 12 : h) : undefined
    const names = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays']
    const what = [latestHour != null ? `nothing after ${fmtTime(new Date(now).setHours(latestHour, 0, 0, 0))}` : '', restDays ? `${restDays.map((d) => names[d]).join(' and ')} stay free` : ''].filter(Boolean).join(', ')
    return out('prefSaved', { action: { type: 'pref', latestHour, blockedDays: restDays ?? undefined } }, { what })
  }

  // Today questions: answered from the clock / cached weather, never guessed
  const day = (o: Intl.DateTimeFormatOptions) => new Date(now).toLocaleDateString('en-US', { weekday: 'long', ...o })
  if (/\b(what time is it|what'?s the time|time check|anong oras na|anong oras ngayon|oras na ba)\b/i.test(text) || /^\s*(what time|time|oras)\W*$/i.test(text))
    return out('time', {}, { t: fmtTime(now), d: day({ month: 'short', day: 'numeric' }) })
  if (/\b(what day is (it|today)|what'?s the date|anong araw (na|ngayon)|anong petsa|what'?s today)\b/i.test(text))
    return out('time', {}, { t: fmtTime(now), d: day({ month: 'long', day: 'numeric' }) })
  if (/\b(weather|panahon|forecast|temperature|uulan|maulan|will it rain|is it raining|umuulan)\b/i.test(text)) return { ...keep, text: '', action: { type: 'weather' } }
  if (/\b(am i free|free (ba )?ako|free time|bakante|when am i free|kailan ako free)\b/i.test(text)) {
    const w = hasSingleDay(text, now) ? parseWhen(text, now) : null
    return { ...keep, text: '', action: { type: 'freeTime', day: w ? w.t : now } }
  }

  // The waiting card at the day and time a message gives: a named day keeps the card's time,
  // a time keeps the card's day, a range sets both ends, "in 30 mins" is from now
  const retime = (s: string, le: LastEvent) => {
    const tod = (t: number) => t - startOfDay(t)
    if (isRelative(s)) {
      const t = parseWhen(s, now)!.t
      return { start: t, end: t + (le.end - le.start) }
    }
    const day = namedDay(s, now) ?? startOfDay(le.start)
    const r = parseRange(s, now)
    if (r) return { start: day + tod(r.start), end: day + tod(r.end) }
    const clock = clockTime(s)
    const start = clock ? at(day, clock[0], clock[1]) : day + tod(le.start)
    return { start, end: start + (le.end - le.start) }
  }

  const fix = ctx.lastEvent && text.match(/^\s*(?:no+|nope|hindi|mali|wait|actually|ay)?[\s,.!]*(?:it'?s|its|it is|make it|call it|change (?:it )?to|rename (?:it )?to|dapat|gawin mong)\s+(?:an?\s+|the\s+)?(.+)$/i)
  if (ctx.lastEvent && fix) {
    const le = ctx.lastEvent
    const title = extractTitle(fix[1], le.title)
    return { ...keep, text: say(pal, 'revised'), action: { type: 'reviseEvent', title, kind: eventKind(fix[1]) ?? le.kind, ...retime(fix[1], le), days: le.days } }
  }

  // Only a new day or time for the card still waiting: "mamaya hindi bukas", "today", "sabing mamayang 10 am",
  // "oo lagay mo para mamaya". Rules, so a small model can't keep saying "bukas".
  const le = ctx.lastEvent
  if (le && !le.days?.length && text.split(/\s+/).length <= 8 && !extractTitle(text.replace(CORRECTION_FILLER, ' '), '')
    && (namedDay(text, now) != null || clockTime(text) || parseRange(text, now) || isRelative(text)))
    return { ...keep, text: say(pal, 'revised'), action: { type: 'reviseEvent', title: le.title, kind: le.kind, ...retime(text, le) } }

  // Fixed events first, so a class mid-task doesn't get eaten as a due date
  const range = parseRange(text, now)
  const ek = eventKind(text)
  const whatIf = /\bwhat if\b|\bpaano kung\b/i.test(text)
  if (range && (ek || whatIf || !taskKind(text))) {
    const kind = ek ?? 'shift'
    const title = extractTitle(text.replace(/\bwhat if\b|\bpaano kung\b/gi, ''), kind === 'class' ? 'Class' : kind === 'protected' ? 'Personal' : 'Shift')
    const days = parseDays(text)
    const dated = hasSingleDay(text, now)
    if (!days && !dated && !whatIf && (kind === 'class' || kind === 'shift')) {
      const what = `${title}, ${fmtTime(range.start)} – ${fmtTime(range.end)}`
      return { ...keep, pending: { title, kind, start: range.start, end: range.end }, text: say(pal, 'askDays', { what }), chips: ['MWF', 'TTh', 'Every weekday', 'Just today'] }
    }
    return { ...keep, pending: null, text: '', action: { type: 'addEvent', title, kind, start: range.start, end: range.end, whatIf, days: days ?? undefined } }
  }

  // Single time event (e.g. "gym at 5pm", "lagay mo bukas 3pm study", "review tomorrow 2pm")
  const singleWhen = parseWhen(text, now)
  if (singleWhen?.hadTime && (ek || /\b(gym|workout|study|review|shift|class|klase|pasok|duty|meeting|org|training|practice|lagay|schedule|sched|add|put|set)\b/i.test(text))) {
    const kind = ek ?? (/\b(gym|workout|run|training)\b/i.test(text) ? 'protected' : 'work')
    const title = extractTitle(text.replace(/\b(lagay( mo)?|schedule|add|put|set)\b/gi, ''), kind === 'protected' ? 'Gym' : kind === 'class' ? 'Class' : kind === 'shift' ? 'Shift' : 'Study Session')
    const start = singleWhen.t
    const end = start + 1 * HOUR
    return { ...keep, pending: null, text: '', action: { type: 'addEvent', title, kind, start, end, whatIf: false } }
  }

  // Slot filling for the current draft
  if (ctx.draft && ctx.awaiting) {
    const d = { ...ctx.draft }
    if (ctx.awaiting === 'confirm') {
      if (isYes(text)) return { ...keep, text: '', action: { type: 'confirmDraft', draft: d }, awaiting: null }
      if (isNo(text)) return out('notNow', { draft: null, awaiting: null })
    }
    const w = parseWhen(text, now)
    const h = parseHours(text)
    if (w && (ctx.awaiting === 'due' || ctx.awaiting === 'confirm')) d.due = w.t
    if (h && (ctx.awaiting === 'hours' || ctx.awaiting === 'confirm')) d.hours = h
    if (ctx.awaiting === 'hours' && !h && /\b(not sure|idk|no idea|ewan|di ko alam|you decide|ikaw na)\b/i.test(text)) {
      d.hours = defaultHours(d.kind)
      return next(d, say(pal, 'hoursGuess', { h: fmtHours(d.hours) }) + ' ')
    }
    if (ctx.awaiting === 'due' && !w && !h) return out('dueRetry')
    if (ctx.awaiting === 'hours' && !h && !w) return out('hoursRetry')
    if (w || h) return next(d)
  }

  if (/^\s*(hi|hello|hey|yo|kumusta|musta|good (morning|afternoon|evening))\b/i.test(text) && text.split(/\s+/).length <= 3) return { ...keep, text: greetLine(pal, ctx.facts?.user) } // "hey add plan at 5" falls through
  if (/^\s*(thanks|thank you|ty|salamat|tnx)\b/i.test(text)) return out('thanks')
  if (/\b(how are you|how r u|how'?s it going|kumusta ka|musta ka|kamusta ka)\b/i.test(text)) return out('chatHow')
  if (/\b(who are you|what are you|what can you do|sino ka|anong kaya mo)\b/i.test(text)) return out('chatWho')
  if (/^\s*(what|huh|ha|ano|eh)\W*$/i.test(text)) return out('chatHuh')
  if (/^\s*(ok|okay|sige|ayun|ayos|lol|haha+|hehe+|nice|cool|g|sure|alright|i see)\W*$/i.test(text)) return out('chatAck')
  if (/\b(syllabus|course outline)\b/i.test(text)) return { ...keep, text: 'Paste your syllabus and I\'ll pull out the deadlines for you to confirm.', action: { type: 'openSyllabus' } }
  if (/\b(how'?s my week|my week|how busy|analy[sz]e|workload|kaya ko ba|what'?s (on|up|coming)|anong meron|schedule ko|show my week|what do i have)\b/i.test(text))
    return { ...keep, text: '', action: { type: 'summary' } }
  const en = text.match(/\b(focus|work|study) best (in the |at )?(morning|afternoon|evening|night)s?\b/i)
  if (en) {
    const v = (en[3] === 'night' ? 'evening' : en[3]) as 'morning' | 'afternoon' | 'evening'
    return out('energy', { action: { type: 'energy', value: v } }, { v })
  }

  // "who won the nba finals" is trivia, not a finals exam: off-topic questions that aren't about *their* stuff
  if (OFFTOPIC.test(text) && !/\b(my|me|i|ko|ako|deadline|due|sched(ule)?|plan|free|busy)\b/i.test(text)) return out('offtopic', { rule: 'Scope filter: off-topic' }, F)

  // New task
  const k = taskKind(text)
  if (k) {
    const w = parseWhen(text, now)
    const d: Draft = { title: extractTitle(text, k === 'exam' ? 'Exam' : 'Assignment'), kind: k, due: w?.t, hours: parseHours(text) ?? undefined }
    return next(d)
  }

  if (OFFTOPIC.test(text)) return out('offtopic', { rule: 'Scope filter: off-topic' }, F)
  return out('unknown', {}, F)

  function next(d: Draft, prefix = ''): Turn {
    if (!d.due) return { draft: d, awaiting: 'due', text: prefix + say(pal, 'askDue') }
    if (!d.hours) return { draft: d, awaiting: 'hours', text: prefix + say(pal, d.kind === 'exam' ? 'askHoursExam' : 'askHours'), chips: ['2 hours', '4 hours', 'Not sure'] }
    return { draft: d, awaiting: 'confirm', text: prefix + say(pal, 'readback'), card: { type: 'readback', draft: d } }
  }
}

export function describeDraft(d: Draft) {
  return [d.title, d.due ? `${d.kind === 'exam' ? 'on' : 'due'} ${fmtDay(d.due)}${new Date(d.due).getHours() === 23 ? '' : ' ' + fmtTime(d.due)}` : '', d.hours ? fmtHours(d.hours) : '']
}
