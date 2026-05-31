// Test detectUrls/extractUrls logic by replicating the regex + cleaning.
const URL_RE = /\bhttps?:\/\/[^\s<>"')]+/gi;
function extractUrls(userMessage, max = 3) {
  if (!userMessage) return [];
  const found = userMessage.match(URL_RE);
  if (!found) return [];
  const cleaned = []; const seen = new Set();
  for (const raw of found) {
    const u = raw.replace(/[.,;:!?)\]]+$/, "");
    if (u.length < 12 || u.length > 2000) continue;
    if (seen.has(u)) continue;
    seen.add(u); cleaned.push(u);
    if (cleaned.length >= max) break;
  }
  return cleaned;
}
const cases = [
  ["Can you read https://en.wikipedia.org/wiki/Calculus please?", ["https://en.wikipedia.org/wiki/Calculus"]],
  ["No link here, just text", []],
  ["Two: https://a.com/x and https://b.com/y and https://c.com/z and https://d.com/w", ["https://a.com/x","https://b.com/y","https://c.com/z"]], // capped at 3
  ["trailing punct https://x.com/page.", ["https://x.com/page"]],
  ["dupe https://x.com/a https://x.com/a", ["https://x.com/a"]],
  ["ftp://nope.com and mailto:a@b.com", []], // no http(s)
];
let pass=0, fail=0;
for (const [input, expect] of cases) {
  const got = extractUrls(input);
  const ok = JSON.stringify(got)===JSON.stringify(expect);
  console.log(ok?"✅":"❌", JSON.stringify(input).slice(0,55), "→", JSON.stringify(got));
  ok?pass++:fail++;
}
console.log(`\nURL detection: ${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
