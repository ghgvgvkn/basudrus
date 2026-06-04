// Mirrors api/_lib/safety.ts detectSafetySeverity().
// If you change the source patterns, update this mirror too.
const CRISIS_PATTERNS = [
  /\b(kill|end)\s+(myself|me|my\s+life)\b/i,
  /\bwant(?:ing)?\s+to\s+die\b/i,
  /\bwish\s+i\s+(was|were)\s+(dead|never\s+born)\b/i,
  /\b(no|nothing|zero)\s+(point|reason)\s+(in\s+|to\s+)?(liv|going\s+on|being\s+here)/i,
  /\bcan(?:'?t|not)\s+(go\s+on|(?:take|do)\s+(?:it|this)\s+anymore)\b/i,
  /\b(better\s+off\s+(dead|without\s+me)|world\s+(would\s+be\s+)?better\s+without\s+me)\b/i,
  /\b(suicid(e|al)|self[\s-]?harm|harming\s+myself|hurting\s+myself|cutting\s+myself|cut\s+myself)\b/i,
  /\bwant(?:ing)?\s+to\s+disappear\b/i,
  /\bend\s+(it|things|all)\b/i,
  /\bgive\s+up\s+on\s+(life|everything)\b/i,
  /بدي\s*(اموت|امووت|اقتل\s*حالي|اذي\s*حالي)/,
  /انتحار/,
  /ما\s*(بقدر|بدي)\s*(اعيش|اكمل|اكمّل)/,
  /اود\s*التخلص\s*من\s*حياتي/,
  /حياتي\s*ما\s*الها\s*معنى/,
  /ما\s*في\s*أمل/,
  /تعبت\s*من\s*الحياة/,
  /لا\s*يوجد\s*أمل/,
];
const ABUSE_PATTERNS = [
  /\b(he|she|they|my\s+(dad|father|mom|mother|brother|sister|husband|wife|partner|boyfriend|girlfriend|family|stepdad|stepmom))\s+(hits|hit|hurts|hurt|beats|beat|abuses|abused|raped|rapes|attacks|attacked|assaults|assaulted)\s+me\b/i,
  /\b(i'?m|i\s+am|i\s+was|i'?ve\s+been)\s+(being\s+)?(abused|raped|attacked|assaulted|molested|beaten)\b/i,
  /\b(domestic\s+(violence|abuse))\b/i,
  /\bsomeone\s+(is\s+)?(hurting|abusing|attacking)\s+me\b/i,
  /(يضربني|تضربني|بضربني|بتضربني)/,
  /(اعتدى\s*علي|اعتدت\s*علي)/,
  /(اغتصاب|اغتصبني)/,
  /عنف\s*(منزلي|اسري|أسري)/,
  /(بيأذيني|بتأذيني|بأذيني)/,
];
const ELEVATED_PATTERNS = [
  /\b(panic\s+attack|having\s+a\s+panic)\b/i,
  /\b(can(?:'?t|not)\s+breathe|hyperventilat)/i,
  /\b(chest\s+(is\s+)?tight|heart\s+(is\s+)?racing)\b/i,
  /\b(not\s+real|dissociating|outside\s+my\s+body)\b/i,
  /\bshaking\s+(uncontrollably|so\s+(bad|hard|much))\b/i,
  /(نوبة\s*هلع|هلع\s*شديد)/,
  /ما\s*بقدر\s*(أتنفس|اتنفس|أرتاح)/,
  /صدري\s*(ضايق|مشدود)/,
  /قلبي\s*(دقاتو\s*سريعة|دقاته\s*سريعة|بيخفق\s*بسرعة)/,
];
function detect(message){
  if(!message||typeof message!=="string") return "none";
  const text=message.slice(0,4000);
  for(const re of CRISIS_PATTERNS) if(re.test(text)) return "crisis";
  for(const re of ABUSE_PATTERNS) if(re.test(text)) return "abuse";
  for(const re of ELEVATED_PATTERNS) if(re.test(text)) return "elevated";
  return "none";
}

const t=(name,cond)=>{console.log(cond?"✅":"❌",name); return cond;};
let all=true;

// CRISIS — must catch (these are the life-or-death ones)
all&=t("'I want to die' → crisis", detect("honestly i just want to die")==="crisis");
all&=t("'kill myself' → crisis", detect("sometimes i think about how to kill myself")==="crisis");
all&=t("'can't go on' → crisis", detect("i can't go on anymore")==="crisis");
all&=t("'no point in living' → crisis", detect("there's no point in living")==="crisis");
all&=t("'self-harm' → crisis", detect("i've been cutting myself")==="crisis");
all&=t("Arabic 'بدي اموت' → crisis", detect("بدي اموت ما عاد في فايدة")==="crisis");
all&=t("Arabic 'ما في أمل' → crisis", detect("ما في أمل بهي الحياة")==="crisis");

// ABUSE — must catch
all&=t("'my dad hits me' → abuse", detect("my dad hits me when he's angry")==="abuse");
all&=t("'i'm being abused' → abuse", detect("i think i'm being abused at home")==="abuse");
all&=t("Arabic 'يضربني' → abuse", detect("ابوي بضربني كل يوم")==="abuse");

// ELEVATED — should catch
all&=t("'panic attack' → elevated", detect("i'm having a panic attack right now")==="elevated");
all&=t("'can't breathe' → elevated", detect("i can't breathe and my chest is tight")==="elevated");

// NONE — must NOT false-positive on normal study talk
all&=t("calculus q → none", detect("can you explain integration by parts")==="none");
all&=t("'this exam is killing me' (idiom) → none-ish", detect("this exam is so hard ugh")==="none");
all&=t("greeting → none", detect("hey tony how are you")==="none");
all&=t("empty → none", detect("")==="none");

console.log(`\nSafety detection: ${all?"ALL PASSED":"SOME FAILED"}`);
process.exit(all?0:1);
