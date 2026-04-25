import { motion } from "framer-motion";
import type { Theme } from "@/lib/constants";
import { makeCSS } from "@/shared/makeCSS";
import { Logo } from "@/shared/Logo";
import { getUniCards } from "@/services/uniData";

interface LandingScreenProps {
  T: Theme;
  setAuthMode: (m: "signup" | "login" | "reset" | "reset-sent" | "new-password") => void;
  setScreen: (s: string) => void;
}

export function LandingScreen({ T, setAuthMode, setScreen }: LandingScreenProps) {
  return (
    <div style={{minHeight:"100dvh",background:T.bg,transition:"background-color 0.3s",overflowX:"hidden",position:"relative"}}>
      <style>{makeCSS(T)}</style>
      {/* ── Full-screen background glow ── */}
      <div className="mesh-glow" style={{position:"fixed",top:0,left:0,right:0,bottom:0,zIndex:0,pointerEvents:"none"}} />
      {/* ── STICKY NAV ── */}
      <nav className="landing-nav" style={{padding:"12px 20px",display:"flex",justifyContent:"space-between",alignItems:"center",background:T.navBg,borderBottom:`1px solid ${T.border}`,position:"sticky",top:0,zIndex:50,backdropFilter:"blur(18px)",WebkitBackdropFilter:"blur(18px)"}}>
        <Logo T={T} size={22} compact/>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          <button className="btn-ghost" style={{padding:"8px 16px",fontSize:12,borderRadius:99}} onClick={()=>{setAuthMode("login");setScreen("auth");}}>Log in</button>
          <button className="btn-primary" style={{padding:"8px 18px",fontSize:12,borderRadius:99,background:"#E8722A",boxShadow:"0 4px 16px rgba(232,114,42,0.3)"}} onClick={()=>{setAuthMode("signup");setScreen("auth");}}>Get started free</button>
        </div>
      </nav>

      {/* ── HERO ── */}
      <div className="landing-hero" style={{maxWidth:960,margin:"0 auto",padding:"72px 24px 48px",display:"flex",flexDirection:"column",alignItems:"center",gap:36,position:"relative"}}>

        <div style={{textAlign:"center",maxWidth:720,zIndex:1,position:"relative"}}>
          <div style={{display:"inline-flex",alignItems:"center",gap:6,background:T.surface,border:`1px solid ${T.border}`,padding:"6px 16px",borderRadius:99,fontSize:11,color:T.textSoft,marginBottom:24,boxShadow:"0 2px 12px rgba(0,0,0,0.04)"}}>
            <span style={{width:7,height:7,background:T.green,borderRadius:"50%",display:"inline-block",boxShadow:`0 0 0 3px ${T.greenSoft}`}}/>
            Built for Jordanian university students
          </div>
          <h1 style={{fontSize:"clamp(56px, 10vw, 84px)",fontWeight:800,letterSpacing:"-0.04em",lineHeight:1.05,color:T.navy,marginBottom:20,zIndex:1,position:"relative"}}>
            Find your ultimate <span style={{background:"linear-gradient(135deg, #4A7CF7, #43C59E)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>study partner</span>
          </h1>
          <p style={{fontSize:18,color:T.textSoft,lineHeight:1.75,maxWidth:540,marginBottom:32,textAlign:"center",margin:"0 auto 32px"}}>
            Match with students at your university who take the exact same course — study together online or on campus. Free, fast, and built just for you.
          </p>
          <div style={{display:"flex",gap:10,justifyContent:"center",marginBottom:16}}>
            <button className="btn-primary hero-cta" style={{padding:"18px 48px",fontSize:18,background:"#E8722A",boxShadow:"0 6px 24px rgba(232,114,42,0.3)",border:"none",color:"#fff",borderRadius:16,fontWeight:700,cursor:"pointer",letterSpacing:"-0.01em"}} onClick={()=>{setAuthMode("signup");setScreen("auth");}}>Find my study partner →</button>
          </div>
          <p style={{fontSize:13,color:T.muted}}>Free forever · No credit card · 60 seconds to sign up</p>
        </div>
        {/* Trust indicators — horizontal row below */}
        <div style={{display:"flex",flexDirection:"column",gap:14,alignItems:"center",width:"100%",maxWidth:800}}>
          <div className="hero-trust" style={{width:"100%",background:T.surface,border:`1px solid ${T.border}`,borderRadius:20,padding:"24px 28px",boxShadow:"0 4px 24px rgba(0,0,0,0.06)",display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:20}}>
            {[
              {bg:T.accentSoft,icon:"📚",title:"Course-level matching",desc:"Same class, same exams, same struggle"},
              {bg:T.greenSoft,icon:"🤖",title:"AI study tools",desc:"Tutor, planner, and mental health support"},
              {bg:T.goldSoft||T.accentSoft,icon:"🇯🇴",title:"Made in Jordan",desc:"Your courses, your campus, your language"},
            ].map((item,i)=>(
              <div key={i} className="hero-trust-item" style={{display:"flex",alignItems:"center",gap:10}}>
                <div className="hero-trust-icon" style={{width:42,height:42,borderRadius:14,background:item.bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>{item.icon}</div>
                <div>
                  <div className="hero-trust-title" style={{fontSize:13,fontWeight:700,color:T.navy}}>{item.title}</div>
                  <div className="hero-trust-desc" style={{fontSize:11,color:T.muted}}>{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{display:"flex",gap:8,justifyContent:"center",alignItems:"center"}}>
            {(getUniCards().length > 0 ? getUniCards().map(u=>u.uni) : ["PSUT","UJ","GJU","AAU","ASU","MEU","AUM"]).map(u=>(
              <div key={u} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:12,padding:"8px 16px",fontSize:12,fontWeight:700,color:T.navy,boxShadow:"0 2px 8px rgba(0,0,0,0.04)"}}>{u}</div>
            ))}
          </div>
        </div>
      </div>

      {/* ── SOCIAL PROOF TICKER ── */}
      <div style={{background:T.surface,borderTop:`1px solid ${T.border}`,borderBottom:`1px solid ${T.border}`,padding:"14px 20px",textAlign:"center"}}>
        <div style={{display:"flex",justifyContent:"center",gap:24,flexWrap:"wrap",fontSize:13,color:T.muted}}>
          <span style={{display:"flex",alignItems:"center",gap:6}}><span style={{width:8,height:8,background:T.green,borderRadius:"50%",display:"inline-block"}}/>Students online now</span>
          <span>🤝 Matches made daily</span>
          <span>🎓 8 Universities</span>
          <span>📚 27,000+ Courses</span>
        </div>
      </div>

      {/* ── HOW IT WORKS ── */}
      <div className="landing-section" style={{background:T.bg,padding:"56px 24px"}}>
        <div style={{maxWidth:900,margin:"0 auto"}}>
          <div style={{textAlign:"center",marginBottom:36}}>
            <div style={{display:"inline-block",background:T.accentSoft,color:T.accent,fontSize:11,fontWeight:700,letterSpacing:2,padding:"5px 14px",borderRadius:99,marginBottom:14,textTransform:"uppercase"}}>How It Works</div>
            <h2 style={{fontFamily:"'Instrument Serif',serif",fontSize:"clamp(26px,5.5vw,44px)",color:T.navy,marginBottom:8,lineHeight:1.12}}>Three steps to your <span style={{fontStyle:"italic",color:T.accent}}>study partner</span></h2>
            <p className="section-subtitle" style={{fontSize:14,color:T.textSoft,maxWidth:460,margin:"0 auto",lineHeight:1.7}}>Takes less than a minute. No complicated setup.</p>
          </div>
          <div className="landing-grid" style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:16}}>
            {[
              {step:"1",icon:"✍️",title:"Create your profile",desc:"Sign up with your email, pick your university and courses. Tell us how you like to study."},
              {step:"2",icon:"🎯",title:"Get matched",desc:"Our AI finds students in your exact courses who match your style — online, in-person, or both."},
              {step:"3",icon:"💬",title:"Study together",desc:"Message your partner, schedule sessions, and use our AI tutor to ace your exams as a team."}
            ].map((item,i)=>(
              <motion.div key={i} className="landing-step" initial={{opacity:0,y:40}} whileInView={{opacity:1,y:0}} viewport={{once:true,margin:"-50px"}} transition={{duration:0.5,delay:i*0.1}} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:18,padding:"28px 22px",textAlign:"left",position:"relative",overflow:"hidden",boxShadow:"0 2px 16px rgba(0,0,0,0.04)",transition:"transform 0.2s,box-shadow 0.2s"}}>
                <div className="landing-step-num" style={{width:34,height:34,borderRadius:10,background:T.accentSoft,display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,fontWeight:800,color:T.accent,marginBottom:14}}>{item.step}</div>
                <div className="landing-step-icon" style={{fontSize:24,marginBottom:10}}>{item.icon}</div>
                <h3 style={{fontSize:16,fontWeight:700,color:T.navy,marginBottom:6}}>{item.title}</h3>
                <p style={{fontSize:13,color:T.textSoft,lineHeight:1.7,margin:0}}>{item.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </div>

      {/* ── FEATURES ── */}
      <div className="landing-section" style={{padding:"56px 24px",background:T.surface,borderTop:`1px solid ${T.border}`,borderBottom:`1px solid ${T.border}`}}>
        <div style={{maxWidth:960,margin:"0 auto"}}>
          <div style={{textAlign:"center",marginBottom:36}}>
            <div style={{display:"inline-block",background:T.greenSoft,color:T.green,fontSize:11,fontWeight:700,letterSpacing:2,padding:"5px 14px",borderRadius:99,marginBottom:14,textTransform:"uppercase"}}>Features</div>
            <h2 style={{fontFamily:"'Instrument Serif',serif",fontSize:"clamp(26px,5.5vw,44px)",color:T.navy,marginBottom:8,lineHeight:1.12}}>Everything you need to <span style={{fontStyle:"italic",color:T.accent}}>study smarter</span></h2>
            <p className="section-subtitle" style={{fontSize:14,color:T.textSoft,maxWidth:500,margin:"0 auto",lineHeight:1.7}}>More than a matching app — a complete study ecosystem built around Jordanian students.</p>
          </div>
          <div className="bento-grid">
            {[
              {icon:"🤝",title:"Study Partner Matching",desc:"AI pairs you with students in your exact course, matching study style and schedule preferences."},
              {icon:"🎓",title:"AI Tutor — Ustaz",desc:"Your personal AI teaching assistant. Upload course materials, ask questions, get explanations 24/7."},
              {icon:"💚",title:"Mental Health Support",desc:"A caring AI companion for when stress hits. Breathing exercises, coping tools, and gentle bilingual support."},
              {icon:"🏠",title:"Study Rooms",desc:"Create or join group study sessions. Set times, invite classmates, and keep each other accountable."},
              {icon:"📅",title:"AI Study Planner",desc:"Get a personalized weekly study schedule based on your courses, exams, and available time."},
              {icon:"🎯",title:"Smart Matchmaking",desc:"Psychology-based questionnaire finds your ideal study partner based on learning style and personality."}
            ].map((feat,i)=>(
              <motion.div key={i} className="landing-feat" initial={{opacity:0,y:40}} whileInView={{opacity:1,y:0}} viewport={{once:true,margin:"-50px"}} transition={{duration:0.5,delay:i*0.1}} style={{background:T.bg,border:`1px solid ${T.border}`,borderRadius:18,padding:"26px 22px",textAlign:"left",boxShadow:"0 2px 12px rgba(0,0,0,0.03)",transition:"transform 0.2s,box-shadow 0.2s"}}>
                <div className="landing-feat-icon" style={{fontSize:30,marginBottom:12}}>{feat.icon}</div>
                <h3 style={{fontSize:16,fontWeight:700,color:T.navy,marginBottom:6}}>{feat.title}</h3>
                <p style={{fontSize:13,color:T.textSoft,lineHeight:1.7,margin:0}}>{feat.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </div>

      {/* ── UNIVERSITIES ── */}
      <div className="landing-section" style={{background:T.bg,padding:"56px 24px"}}>
        <div style={{maxWidth:900,margin:"0 auto",textAlign:"center"}}>
          <div style={{display:"inline-block",background:T.goldSoft||T.accentSoft,color:T.gold||T.accent,fontSize:11,fontWeight:700,letterSpacing:2,padding:"5px 14px",borderRadius:99,marginBottom:14,textTransform:"uppercase"}}>Universities</div>
          <h2 style={{fontFamily:"'Instrument Serif',serif",fontSize:"clamp(26px,5.5vw,44px)",color:T.navy,marginBottom:8,lineHeight:1.12}}>Built for <span style={{fontStyle:"italic",color:T.accent}}>your campus</span></h2>
          <p className="section-subtitle" style={{fontSize:14,color:T.textSoft,maxWidth:500,margin:"0 auto 32px",lineHeight:1.7}}>Every course, every major, every campus. We built Bas Udrus from the ground up for Jordanian universities.</p>
          <div className="landing-grid" style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:18,marginBottom:32}}>
            {getUniCards().map((u,i)=>(
              <motion.div key={i} className="landing-uni-card" initial={{opacity:0,y:40}} whileInView={{opacity:1,y:0}} viewport={{once:true,margin:"-50px"}} transition={{duration:0.5,delay:i*0.1}} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:18,padding:"28px 22px",textAlign:"center",boxShadow:"0 2px 16px rgba(0,0,0,0.04)",transition:"transform 0.2s,box-shadow 0.2s"}}>
                <div className="landing-uni-emoji" style={{fontSize:34,marginBottom:10}}>{u.emoji}</div>
                <div className="landing-uni-name" style={{fontSize:22,fontWeight:800,color:T.navy,marginBottom:4}}>{u.uni}</div>
                <div style={{fontSize:13,color:T.textSoft,lineHeight:1.5}}>{u.full}</div>
              </motion.div>
            ))}
          </div>
          <p style={{fontSize:13,color:T.muted}}>7 Jordanian universities and growing — request yours after signing up!</p>
        </div>
      </div>

      {/* ── ABOUT US ── */}
      <div className="landing-section" style={{padding:"56px 24px",background:T.surface,borderTop:`1px solid ${T.border}`,borderBottom:`1px solid ${T.border}`}}>
        <div style={{maxWidth:720,margin:"0 auto"}}>
          <div style={{textAlign:"center",marginBottom:32}}>
            <div style={{display:"inline-block",background:T.accentSoft,color:T.accent,fontSize:11,fontWeight:700,letterSpacing:2,padding:"5px 14px",borderRadius:99,marginBottom:14,textTransform:"uppercase"}}>About Us</div>
            <h2 style={{fontFamily:"'Instrument Serif',serif",fontSize:"clamp(26px,5.5vw,44px)",color:T.navy,marginBottom:8,lineHeight:1.12}}>Built by a student, <span style={{fontStyle:"italic",color:T.accent}}>for students</span></h2>
          </div>
          <motion.div className="landing-about" initial={{opacity:0,y:40}} whileInView={{opacity:1,y:0}} viewport={{once:true,margin:"-50px"}} transition={{duration:0.5}} style={{background:T.bg,border:`1px solid ${T.border}`,borderRadius:20,padding:"28px 24px",boxShadow:"0 4px 24px rgba(0,0,0,0.05)"}}>
            <div style={{display:"flex",alignItems:"flex-start",gap:16,marginBottom:20,flexWrap:"wrap"}}>
              <div className="bu-logo" style={{width:52,height:52,borderRadius:16,background:"linear-gradient(135deg,#4A7CF7,#6C8EF5)",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:800,fontSize:18,flexShrink:0}}>BU</div>
              <div style={{flex:1,minWidth:200}}>
                <div className="story-title" style={{fontSize:17,fontWeight:800,color:T.navy,marginBottom:6}}>Our Story</div>
                <p className="story-text" style={{fontSize:14,color:T.textSoft,lineHeight:1.8,margin:"0 0 12px"}}>
                  Bas Udrus started from a simple frustration: studying alone in Jordan is hard. You sit in a lecture hall with hundreds of students, yet finding someone to review with before the exam feels impossible.
                </p>
                <p className="story-text" style={{fontSize:14,color:T.textSoft,lineHeight:1.8,margin:"0 0 12px"}}>
                  We built this platform at PSUT because we believe every Jordanian student deserves a study partner who understands their courses, their campus, and their challenges — whether it is Calculus at UJ, Data Structures at PSUT, Engineering at GJU, or Pharmacy at AAU.
                </p>
                <p className="story-text" style={{fontSize:14,color:T.textSoft,lineHeight:1.8,margin:0}}>
                  Bas Udrus is not a big company. It is a student project that grew into something real. We are still building, still improving, and every suggestion from our users makes it better.
                </p>
              </div>
            </div>
            <div style={{borderTop:`1px solid ${T.border}`,paddingTop:20,display:"flex",gap:24,flexWrap:"wrap"}}>
              {[
                {icon:"🎯",label:"Mission",value:"Every student finds their study partner"},
                {icon:"🇯🇴",label:"Origin",value:"Built in Amman, Jordan"},
                {icon:"💡",label:"Status",value:"Active development — your feedback shapes us"},
              ].map(item=>(
                <div key={item.label} style={{flex:"1 1 160px",minWidth:140}}>
                  <div style={{fontSize:20,marginBottom:6}}>{item.icon}</div>
                  <div style={{fontSize:11,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:3}}>{item.label}</div>
                  <div style={{fontSize:14,color:T.navy,fontWeight:600,lineHeight:1.5}}>{item.value}</div>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>

      {/* ── FINAL CTA ── */}
      <div className="landing-cta-section" style={{padding:"60px 24px",textAlign:"center",background:`linear-gradient(180deg,${T.bg} 0%,${T.accentSoft} 100%)`}}>
        <div style={{maxWidth:580,margin:"0 auto"}}>
          <h2 style={{fontFamily:"'Instrument Serif',serif",fontSize:"clamp(28px,6vw,48px)",color:T.navy,marginBottom:14,lineHeight:1.08,letterSpacing:"-0.02em"}}>Ready to find your <span style={{fontStyle:"italic",color:T.accent}}>study partner?</span></h2>
          <p style={{fontSize:16,color:T.textSoft,lineHeight:1.75,maxWidth:420,margin:"0 auto 28px"}}>Join Jordanian students who stopped studying alone. It is free, takes 60 seconds, and might just save your GPA.</p>
          <button className="btn-primary hero-cta" style={{padding:"15px 36px",fontSize:16,background:"#E8722A",boxShadow:"0 6px 28px rgba(232,114,42,0.3)",border:"none",color:"#fff",borderRadius:14,fontWeight:700,cursor:"pointer"}} onClick={()=>{setAuthMode("signup");setScreen("auth");}}>Get started free →</button>
          <p style={{fontSize:12,color:T.muted,marginTop:16}}>Free forever · No credit card required</p>
        </div>
      </div>

      {/* ── FOOTER ── */}
      <div className="landing-footer" style={{borderTop:`1px solid ${T.border}`,padding:"40px 24px",textAlign:"center",background:T.surface}}>
        <div style={{fontSize:15,color:T.muted,lineHeight:2}}>
          <span style={{fontWeight:700,color:T.navy,fontSize:16}}>Bas Udrus</span> — Study Smarter, Together.
          <br/>Made with care in Amman, Jordan.
          <br/>
          <span style={{fontSize:13}}>Questions? Contact us at <a href="mailto:basudrusjo@gmail.com" style={{color:T.accent,textDecoration:"none",fontWeight:600}}>basudrusjo@gmail.com</a></span>
        </div>
      </div>
    </div>
  );
}
