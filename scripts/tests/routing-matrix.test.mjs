// ANGLE 2+3: decision-COMPOSITION test.
// The unit tests check pickModel()/detectSafetySeverity() in isolation. This
// test instead replicates the exact boolean gating that tutor.ts and aurora.ts
// perform when they COMBINE those decisions, and asserts the full truth table.
// Goal: PROVE that with SMART_TIER_MODEL unset (production reality today), the
// only behavior change vs. before is the safety layer — normal chat still routes
// to Groq + Haiku exactly as it did.

// ---- mirror of tutor.ts gating ----
function tutorRouting({ groqKey, hasFile, hasDoc, activeSession, tierEscalate, inCrisis, smartModel }) {
  const useSmartTier = (tierEscalate || inCrisis) && smartModel.length > 0;
  const useGroq = !!groqKey && !hasFile && !hasDoc && !activeSession && !useSmartTier && !inCrisis;
  const model = useSmartTier ? smartModel : "claude-haiku-4-5-20251001";
  return { useGroq, useSmartTier, model };
}
// ---- mirror of aurora.ts gating (Anthropic-only, no Groq) ----
function auroraRouting({ tierEscalate, inCrisis, smartModel }) {
  const useSmartTier = (tierEscalate || inCrisis) && smartModel.length > 0;
  const model = useSmartTier ? smartModel : "claude-haiku-4-5-20251001";
  return { useSmartTier, model };
}

const t = (name, cond) => { console.log(cond ? "✅" : "❌", name); return cond; };
let all = true;
const HAIKU = "claude-haiku-4-5-20251001";
const SONNET = "claude-sonnet-4-6";

// ===== PROD REALITY: SMART_TIER_MODEL unset (smartModel="") =====
// The whole point: nothing changes except safety.
{
  // normal chat, groq available → STILL groq + haiku (unchanged)
  const r = tutorRouting({ groqKey: true, hasFile: false, hasDoc: false, activeSession: false, tierEscalate: false, inCrisis: false, smartModel: "" });
  all &= t("[no env] normal chat → Groq, Haiku (UNCHANGED)", r.useGroq === true && r.useSmartTier === false && r.model === HAIKU);
}
{
  // hard question but NO strong model configured → behaves exactly as before (groq+haiku)
  const r = tutorRouting({ groqKey: true, hasFile: false, hasDoc: false, activeSession: false, tierEscalate: true, inCrisis: false, smartModel: "" });
  all &= t("[no env] hard Q, no strong model → Groq, Haiku (UNCHANGED)", r.useGroq === true && r.useSmartTier === false && r.model === HAIKU);
}
{
  // CRISIS with no strong model → MUST still skip Groq (safety overrides) and use Anthropic Haiku
  const r = tutorRouting({ groqKey: true, hasFile: false, hasDoc: false, activeSession: false, tierEscalate: false, inCrisis: true, smartModel: "" });
  all &= t("[no env] CRISIS → skip Groq, Anthropic Haiku (SAFETY, the only change)", r.useGroq === false && r.model === HAIKU);
}
{
  // file upload → Anthropic (unchanged, files always went to Anthropic)
  const r = tutorRouting({ groqKey: true, hasFile: true, hasDoc: false, activeSession: false, tierEscalate: false, inCrisis: false, smartModel: "" });
  all &= t("[no env] file upload → Anthropic Haiku (UNCHANGED)", r.useGroq === false && r.model === HAIKU);
}

// ===== WITH SMART_TIER_MODEL set (operator opted in) =====
{
  const r = tutorRouting({ groqKey: true, hasFile: false, hasDoc: false, activeSession: false, tierEscalate: true, inCrisis: false, smartModel: SONNET });
  all &= t("[env set] hard Q → skip Groq, strong model", r.useGroq === false && r.useSmartTier === true && r.model === SONNET);
}
{
  const r = tutorRouting({ groqKey: true, hasFile: false, hasDoc: false, activeSession: false, tierEscalate: false, inCrisis: false, smartModel: SONNET });
  all &= t("[env set] normal chat → STILL Groq + Haiku (cheap path preserved)", r.useGroq === true && r.model === HAIKU);
}
{
  const r = tutorRouting({ groqKey: true, hasFile: false, hasDoc: false, activeSession: false, tierEscalate: false, inCrisis: true, smartModel: SONNET });
  all &= t("[env set] CRISIS → skip Groq, strong model", r.useGroq === false && r.useSmartTier === true && r.model === SONNET);
}

// ===== no Groq key at all (Anthropic-only deployments) =====
{
  const r = tutorRouting({ groqKey: false, hasFile: false, hasDoc: false, activeSession: false, tierEscalate: false, inCrisis: false, smartModel: "" });
  all &= t("[no groq] normal chat → Anthropic Haiku (UNCHANGED)", r.useGroq === false && r.model === HAIKU);
}

// ===== aurora =====
{
  const r = auroraRouting({ tierEscalate: false, inCrisis: false, smartModel: "" });
  all &= t("[aurora,no env] normal → Haiku (UNCHANGED)", r.useSmartTier === false && r.model === HAIKU);
}
{
  const r = auroraRouting({ tierEscalate: false, inCrisis: true, smartModel: "" });
  all &= t("[aurora,no env] crisis → Haiku (safety block still prepended elsewhere)", r.model === HAIKU);
}
{
  const r = auroraRouting({ tierEscalate: true, inCrisis: false, smartModel: SONNET });
  all &= t("[aurora,env set] hard Q → strong model", r.useSmartTier === true && r.model === SONNET);
}

console.log(`\nRouting matrix: ${all ? "ALL PASSED" : "SOME FAILED"}`);
process.exit(all ? 0 : 1);
