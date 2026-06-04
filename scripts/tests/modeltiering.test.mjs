// Mirrors the pure logic of api/_lib/modelTiering.ts decideModelTier().
// If you change the source heuristics, update this mirror too.
const HARD_INTENT_RE = /\b(prove|proof|derive|derivation|step[\s-]?by[\s-]?step|show your work|explain why|walk me through|rigor(?:ous|ously)?|from first principles)\b/i;
const HARD_TOPIC_RE = /\b(integral|integrate|derivative|differentiat|limit|theorem|lemma|matrix|matrices|eigen|differential equation|big[\s-]?o|complexity analysis|dynamic programming|recursion|induction|np[\s-]?complete|asymptotic|stoichiometr|equilibrium constant|thermodynamic|quantum|relativit)\b/i;
const CODE_BLOCK_RE = /```[\s\S]*```/;
const CODE_TASK_RE = /\b(debug|refactor|optimi[sz]e|implement|algorithm|time complexity|space complexity|stack trace|segfault|null pointer|race condition|big o)\b/i;
function looksMathHeavy(text){ const ops=(text.match(/[=+\-*/^√∫∑±≤≥≠]|\\frac|\\int|\\sum|\\sqrt/g)||[]).length; return ops>=4; }
function decide(userText, opts={}){
  const text=(userText||"").trim();
  if(!text) return {escalate:false,reason:"empty"};
  if(text.length<12 && !CODE_BLOCK_RE.test(text)) return {escalate:false,reason:"too_short"};
  if(HARD_INTENT_RE.test(text)) return {escalate:true,reason:"hard_intent"};
  if(CODE_BLOCK_RE.test(text)) return {escalate:true,reason:"code_block"};
  if(HARD_TOPIC_RE.test(text)) return {escalate:true,reason:"hard_topic"};
  if(CODE_TASK_RE.test(text)) return {escalate:true,reason:"code_task"};
  if(looksMathHeavy(text)) return {escalate:true,reason:"math_heavy"};
  if(opts.hasAttachment && text.length>=30) return {escalate:true,reason:"attachment_with_question"};
  return {escalate:false,reason:"default_cheap"};
}

const t=(name,cond)=>{console.log(cond?"✅":"❌",name); return cond;};
let all=true;

// SHOULD escalate (hard)
all&=t("prove a theorem → escalate", decide("Can you prove that sqrt(2) is irrational?").escalate);
all&=t("step by step → escalate", decide("solve this step by step please for me").escalate);
all&=t("integral topic → escalate", decide("how do I find the integral of x*ln(x)").escalate);
all&=t("code block → escalate", decide("why is this broken?\n```js\nfor(let i=0;i<n;i++){}\n```").escalate);
all&=t("debug task → escalate", decide("help me debug this null pointer in my app").escalate);
all&=t("dynamic programming → escalate", decide("explain the dynamic programming approach here").escalate);
all&=t("math heavy → escalate", decide("solve 3x + 2 = 5x - 8 and 2y = x + 1 = 4").escalate);
all&=t("photo + real question → escalate", decide("I don't understand how to start this problem at all", {hasAttachment:true}).escalate);

// SHOULD NOT escalate (easy)
all&=t("greeting → cheap", !decide("hi tony!").escalate);
all&=t("thanks → cheap", !decide("thank you so much").escalate);
all&=t("simple definition → cheap", !decide("what is photosynthesis in short").escalate);
all&=t("casual chat → cheap", !decide("i'm feeling kinda tired today honestly").escalate);
all&=t("short even w/ keyword → cheap", !decide("limit?").escalate); // too short guard
all&=t("empty → cheap", !decide("").escalate);
all&=t("trivial photo → cheap", !decide("what's this?", {hasAttachment:true}).escalate); // too short

console.log(`\nModel tiering: ${all?"ALL PASSED":"SOME FAILED"}`);
process.exit(all?0:1);
