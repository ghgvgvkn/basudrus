// Replicate parseAssistantMessage logic from mobile/src/lib/parseChoices.ts
const OPTION_BLOCK_RE = /<<\s*options?\s*>>\s*([\s\S]*?)\s*<<\s*(?:end\s+options?|\/\s*options?)\s*>>/i;
const FENCED_BLOCK_RE = /```\s*(?:options?|choices)\s*\n([\s\S]*?)\n```/i;
const PARTIAL_OPEN_RE = /<<\s*options?\s*>>|```\s*(?:options?|choices)\s*\n/i;
function linesFromBlock(inner){
  return inner.split('\n').map(l=>l.replace(/^\s*(?:[-•*]|\d+\.)\s+/,'').replace(/^["'`]+|["'`]+$/g,'').trim()).filter(l=>l.length>0);
}
function parse(text){
  if(!text) return {prose:'',choices:null};
  let m=text.match(OPTION_BLOCK_RE); let re=OPTION_BLOCK_RE;
  if(!m){ m=text.match(FENCED_BLOCK_RE); re=FENCED_BLOCK_RE; }
  if(!m){
    const pi=text.search(PARTIAL_OPEN_RE);
    if(pi>=0) return {prose:text.slice(0,pi).trimEnd(),choices:null};
    return {prose:text,choices:null};
  }
  const lines=linesFromBlock(m[1]??'');
  if(lines.length===0) return {prose:text,choices:null};
  const prose=text.replace(re,'').replace(/\n{3,}/g,'\n\n').trim();
  return {prose,choices:lines.map(l=>({label:l}))};
}
const t=(name,cond)=>{console.log(cond?"✅":"❌",name); return cond;};
let all=true;
// 1. standard <<option>>
let r=parse("Want a check-in?\n\n<<option>>\nYes\nMaybe later\nNo\n<<end option>>");
all&=t("standard markers → 3 choices", r.choices?.length===3 && r.choices[0].label==="Yes");
all&=t("standard markers → prose stripped", r.prose==="Want a check-in?");
// 2. plural <<options>> ... <<end options>>
r=parse("Pick:\n<<options>>\nA\nB\n<<end options>>");
all&=t("plural markers → 2 choices", r.choices?.length===2);
// 3. XML-style close <</option>>
r=parse("Pick:\n<<option>>\nA\nB\n<</option>>");
all&=t("xml-close markers → 2 choices", r.choices?.length===2);
// 4. bullets stripped
r=parse("Q\n<<option>>\n- Yes\n• Maybe\n1. No\n<<end option>>");
all&=t("bullets/numbers stripped", r.choices?.[0].label==="Yes" && r.choices[1].label==="Maybe" && r.choices[2].label==="No");
// 5. fenced ```choices fallback
r=parse("Q\n```choices\nYes\nNo\n```");
all&=t("fenced choices fallback → 2", r.choices?.length===2);
// 6. partial mid-stream (no close) → hide marker, no card
r=parse("Thinking...\n<<option>>\nYes");
all&=t("partial stream → no card, marker hidden", r.choices===null && !r.prose.includes("<<option>>"));
// 7. plain text → no card
r=parse("Just a normal reply with no options.");
all&=t("plain text → no choices", r.choices===null && r.prose==="Just a normal reply with no options.");
// 8. arabic options
r=parse("تحب نبلش؟\n<<option>>\nآه يلا\nبعدين\n<<end option>>");
all&=t("arabic options → 2 choices", r.choices?.length===2 && r.choices[0].label==="آه يلا");
console.log(`\nChoice parser: ${all?"ALL PASSED":"SOME FAILED"}`);
process.exit(all?0:1);
