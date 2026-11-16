// =============================================================
//  AI Web Access — turn a chat prompt into a clean search query.
//  Conservative on purpose: we only strip conversational noise,
//  never the user's actual meaning.
// =============================================================

const POLITE = /^(please|pls|kindly|hey|hi|hello)\s*[,:]?\s+/i;
const ASK = /^(can you|could you|would you|will you|are you able to|do you know|help me to|help me|i want you to|i need you to|i'd like you to|i would like you to|please)\s+/i;
const ACTION = /^(write|write me|explain|describe|summarize|summarise|translate|create|generate|make|give me|tell me about|tell me|find out|find|search for|search|look up|lookup|research|list|provide|show me|compare|analyze|analyse)\s+/i;

const NOISE = /\b(thank you|thanks|please|if possible|for me|asap|right now)\b/gi;

export function smartQuery(raw) {
  let q = String(raw || '')
    .replace(/```[\s\S]*?```/g, ' ')      // drop code blocks
    .replace(/\[Real-time web search results[\s\S]*$/i, '') // drop our own injected block
    .replace(/\s+/g, ' ')
    .trim();

  // strip conversational wrappers (loop: "please can you explain ...")
  for (let i = 0; i < 3; i++) {
    const before = q;
    q = q.replace(POLITE, '').replace(ASK, '').replace(ACTION, '');
    if (q === before) break;
  }

  q = q.replace(NOISE, ' ').replace(/\s+/g, ' ').trim();
  q = q.replace(/[?.!]+$/g, '').trim();

  // keep questions meaningful
  if (!q) q = String(raw || '').replace(/\s+/g, ' ').trim();

  // long conversational prompts (often Bengali, often with a pasted answer) make
  // a terrible search query. Search the *request itself*: keywords from the end of
  // the message, where the actual ask usually is, minus filler words.
  if (q.length > 120) {
    const tail = q.slice(-280);
    // never start mid-word (Bengali words break into broken fragments)
    const kw = keywords(q.length > 280 ? tail.slice(tail.indexOf(' ') + 1) : tail);
    if (kw.length >= 2) return kw.join(' ');
  }
  return q.slice(0, 200);
}

const FILLER = new Set((
  // Bengali filler / pronouns / auxiliaries
  'আমি আমার আমাকে তুমি তোমাকে তোমার চাই যাতে করে করা করবে করতে এই এটি এটা এবং এবং সেটি সেটা সে ' +
  'যে কোন কোনো না কি কী দিলাম দিয়েছি দিয়ে দিবে দেবে জন্য থেকে সাথে সঙ্গে হবে হয় হয়ে হচ্ছে পারবে পারে ' +
  'সব সকল আর তাদের তার তাই কিন্তু যদি তবে ওই ঐ কিছু আছে নেই থাকবে মাধ্যমে সাহায্যে যেন এখন তো ও বা ' +
  'এর তা তারা তাকে সেই একটি একটা যা যেটি সরাসরি ' +
  // English filler
  'the and for you your with that this are was were have has can will would should could not but any all ' +
  'want need please give gave tell make let get using use via its into from they them their what which'
).split(/\s+/));

function keywords(s) {
  const seen = new Set();
  const out = [];
  for (const t of s.split(/[^\p{L}\p{N}\p{M}]+/u)) {
    const k = t.toLowerCase();
    if (k.length < 2 || FILLER.has(k) || seen.has(k)) continue;
    seen.add(k); out.push(t);
    if (out.length >= 12) break;
  }
  return out;
}
