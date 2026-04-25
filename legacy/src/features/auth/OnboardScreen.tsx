import type { Profile } from "@/lib/supabase";
import type { Theme } from "@/lib/constants";
import { makeCSS } from "@/shared/makeCSS";
import { Logo } from "@/shared/Logo";
import { getUniversities, getAllMajors, getMajorsForUni } from "@/services/uniData";

interface OnboardScreenProps {
  T: Theme;
  notif: { msg: string; type: string } | null;
  profile: Partial<Profile>;
  setProfile: React.Dispatch<React.SetStateAction<Partial<Profile>>>;
  authFormName: string;
  step: number;
  setStep: (n: number) => void;
  onboardMajorRef: React.RefObject<HTMLDivElement | null>;
  onboardMajorOpen: boolean;
  setOnboardMajorOpen: (v: boolean) => void;
  onboardMajorSearch: string;
  setOnboardMajorSearch: (v: string) => void;
  showNotif: (msg: string, type?: string) => void;
  onboardLoading: boolean;
  handleOnboard: () => void;
  setScreen: (s: string) => void;
}

export function OnboardScreen({
  T, notif, profile, setProfile, authFormName, step, setStep,
  onboardMajorRef, onboardMajorOpen, setOnboardMajorOpen,
  onboardMajorSearch, setOnboardMajorSearch, showNotif,
  onboardLoading, handleOnboard, setScreen,
}: OnboardScreenProps) {
  return (
    <div style={{minHeight:"100dvh",background:T.bg,display:"flex",flexDirection:"column"}}>
      <style>{makeCSS(T)}</style>
      {notif&&<div className="notif" style={{background:notif.type==="err"?T.red:T.navy,color:"#fff"}}>{notif.msg}</div>}
      <nav className="nav-inner" style={{padding:"16px 28px",display:"flex",alignItems:"center",justifyContent:"space-between",background:T.navBg,borderBottom:`1px solid ${T.border}`}}>
        <Logo T={T} size={21} compact onClick={()=>setScreen("landing")}/>
        <div style={{display:"flex",gap:6}}>
          {[1,2].map(i=><div key={i} style={{width:32,height:5,borderRadius:99,background:step>=i?T.accent:T.border,transition:"background-color 0.3s"}}/>)}
        </div>
        <span style={{fontSize:13,color:T.muted}}>Step {step} of 2</span>
      </nav>
      <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",padding:"32px 20px"}}>
        <div className="fade-in card" style={{padding:36,width:"100%",maxWidth:440,boxShadow:"0 8px 48px rgba(0,0,0,0.10)"}}>
          {step===1&&(
            <>
              <div style={{fontSize:32,marginBottom:10}}>👋</div>
              <h2 style={{fontSize:21,fontWeight:700,color:T.navy,marginBottom:4}}>Hey {(profile.name||authFormName).split(" ")[0]}!</h2>
              <p style={{fontSize:13,color:T.muted,marginBottom:24}}>Tell us about yourself — we'll match you with the right people.</p>
              <div className="field"><label>University *</label>
                <select value={profile.uni||""} onChange={e=>setProfile(p=>({...p,uni:e.target.value}))}>
                  <option value="">Select your university</option>
                  {getUniversities().map(u=><option key={u}>{u}</option>)}
                </select>
              </div>
              <div className="field"><label>Major *</label>
                <div ref={onboardMajorRef} style={{position:"relative"}}>
                  <div style={{display:"flex",alignItems:"center",gap:6,padding:"12px 14px",border:`1.5px solid ${profile.major?T.accent:T.border}`,borderRadius:14,fontSize:16,background:T.surface,cursor:"text"}} onClick={()=>setOnboardMajorOpen(true)}>
                    <span style={{fontSize:15,flexShrink:0}}>🎓</span>
                    <input type="text" placeholder={profile.major||"Search your major..."} value={onboardMajorOpen?onboardMajorSearch:(profile.major||"")} onChange={e=>{setOnboardMajorSearch(e.target.value);setOnboardMajorOpen(true);}} onFocus={()=>{setOnboardMajorOpen(true);setOnboardMajorSearch("");}} style={{border:"none",outline:"none",background:"transparent",flex:1,fontSize:16,fontWeight:profile.major&&!onboardMajorOpen?600:400,color:T.text,minWidth:0,width:"100%"}}/>
                    {profile.major&&(<button onMouseDown={e=>{e.preventDefault();e.stopPropagation();setProfile(p=>({...p,major:""}));setOnboardMajorSearch("");setOnboardMajorOpen(false);}} style={{background:"none",border:"none",cursor:"pointer",color:T.muted,fontSize:17,padding:0,lineHeight:1,flexShrink:0}}>×</button>)}
                  </div>
                  {onboardMajorOpen&&(()=>{
                    const majors = profile.uni ? getMajorsForUni(profile.uni) : getAllMajors();
                    const q = onboardMajorSearch.toLowerCase();
                    const filtered = q ? majors.filter(m=>m.toLowerCase().includes(q)) : majors;
                    return (<div style={{position:"absolute",top:"calc(100% + 6px)",left:0,right:0,zIndex:300,background:T.surface,border:`1.5px solid ${T.border}`,borderRadius:14,boxShadow:"0 8px 32px rgba(0,0,0,0.13)",maxHeight:220,overflowY:"auto"}}>
                      {filtered.length===0?(<div style={{padding:"20px 14px",textAlign:"center",fontSize:13,color:T.muted}}>No majors match "{onboardMajorSearch}"</div>):(
                        filtered.map(m=>(<div key={m} onMouseDown={e=>{e.preventDefault();setProfile(p=>({...p,major:m}));setOnboardMajorSearch("");setOnboardMajorOpen(false);}} style={{padding:"9px 14px",cursor:"pointer",fontSize:13,color:m===profile.major?T.accent:T.text,fontWeight:m===profile.major?700:400,background:m===profile.major?T.accentSoft:"transparent"}} onMouseEnter={e=>{if(m!==profile.major)(e.currentTarget as HTMLDivElement).style.background=T.border;}} onMouseLeave={e=>{(e.currentTarget as HTMLDivElement).style.background=m===profile.major?T.accentSoft:"transparent";}}>{m}</div>))
                      )}
                    </div>);
                  })()}
                </div>
              </div>
              <div className="field"><label>Year *</label>
                <select value={profile.year||""} onChange={e=>setProfile(p=>({...p,year:e.target.value}))}>
                  <option value="">Select year</option>
                  {["Year 1","Year 2","Year 3","Year 4","Year 5"].map(y=><option key={y}>{y}</option>)}
                </select>
              </div>
              <button className="btn-primary" style={{width:"100%",padding:13,fontSize:15,borderRadius:14,marginTop:4}}
                onClick={()=>{if(!profile.uni||!profile.major||!profile.year)return showNotif("Please fill all required fields","err");setStep(2);}}>
                Next →
              </button>
            </>
          )}
          {step===2&&(
            <>
              <div style={{fontSize:32,marginBottom:10}}>📝</div>
              <h2 style={{fontSize:21,fontWeight:700,color:T.navy,marginBottom:4}}>How do you want to study?</h2>
              <p style={{fontSize:13,color:T.muted,marginBottom:24}}>This helps others decide if you're a good match for them.</p>
              <div className="field"><label>Meet preference</label>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                  {[["online","🎥","Online"],["face","📍","On Campus"],["flexible","💬","Flexible"]].map(([val,icon,lbl])=>(
                    <div key={val} className={`meet-opt ${profile.meet_type===val?"active":""}`} onClick={()=>setProfile(p=>({...p,meet_type:val}))}>
                      <div style={{fontSize:22}}>{icon}</div>
                      <div style={{fontSize:11,fontWeight:700,marginTop:4,color:profile.meet_type===val?T.accent:T.textSoft}}>{lbl}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="field"><label>Short bio (optional)</label>
                <textarea rows={3} placeholder="e.g. I need help with Calculus before finals, available weekends." value={profile.bio||""} onChange={e=>setProfile(p=>({...p,bio:e.target.value}))} maxLength={500}/>
              </div>
              <div style={{display:"flex",gap:10}}>
                <button className="btn-ghost" style={{flex:0.45}} onClick={()=>setStep(1)}>← Back</button>
                <button className="btn-primary" style={{flex:1,padding:13,borderRadius:14,opacity:onboardLoading?0.7:1}} onClick={handleOnboard} disabled={onboardLoading}>{onboardLoading?"Saving...":"Let's go! 🎯"}</button>
              </div>
            </>
          )}
        </div>
      </div>
      <div style={{borderTop:`1px solid ${T.border}`,padding:"14px 20px",textAlign:"center",background:T.surface,marginTop:"auto"}}>
        <div style={{fontSize:11,color:T.muted,lineHeight:1.6}}>
          <span style={{fontWeight:700,color:T.navy}}>Bas Udrus</span> — Study Smarter, Together. · Made in Amman 🇯🇴
        </div>
      </div>
    </div>
  );
}
