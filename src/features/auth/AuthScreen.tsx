import type { Theme } from "@/lib/constants";
import { makeCSS } from "@/shared/makeCSS";
import { Logo } from "@/shared/Logo";

type AuthMode = "signup" | "login" | "reset" | "reset-sent" | "new-password";
type AuthForm = { email: string; password: string; name: string };

interface AuthScreenProps {
  T: Theme;
  authMode: AuthMode;
  setAuthMode: (m: AuthMode) => void;
  authForm: AuthForm;
  setAuthForm: React.Dispatch<React.SetStateAction<AuthForm>>;
  authError: string;
  setAuthError: (e: string) => void;
  authLoading: boolean;
  resetEmail: string;
  setResetEmail: (v: string) => void;
  newPassword: string;
  setNewPassword: (v: string) => void;
  handleAuth: () => void;
  handleOAuth: (provider: "google" | "apple") => void;
  handleResetPassword: () => void;
  handleNewPassword: () => void;
  setScreen: (s: string) => void;
}

export function AuthScreen({
  T, authMode, setAuthMode, authForm, setAuthForm, authError, setAuthError,
  authLoading, resetEmail, setResetEmail, newPassword, setNewPassword,
  handleAuth, handleOAuth, handleResetPassword, handleNewPassword, setScreen,
}: AuthScreenProps) {
  return (
    <div style={{minHeight:"100dvh",background:T.bg,display:"flex",flexDirection:"column"}}>
      <style>{makeCSS(T)}</style>
      <nav className="nav-inner" style={{padding:"16px 28px",display:"flex",justifyContent:"space-between",alignItems:"center",background:T.navBg,borderBottom:`1px solid ${T.border}`}}>
        <Logo T={T} size={21} compact onClick={()=>setScreen("landing")}/>
      </nav>
      <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",padding:"32px 20px"}}>
        <div className="fade-in card auth-card" style={{padding:36,width:"100%",maxWidth:420,boxShadow:"0 8px 48px rgba(0,0,0,0.10)"}}>

          {/* ── New Password (after reset link clicked) ── */}
          {authMode==="new-password"&&(
            <>
              <h2 style={{fontSize:22,fontWeight:700,color:T.navy,marginBottom:4}}>Set new password</h2>
              <p style={{fontSize:13,color:T.muted,marginBottom:24}}>Choose a strong password for your account.</p>
              <div className="field" style={{marginBottom:authError?10:24}}>
                <label>New Password</label>
                <input type="password" placeholder="Min. 6 characters" value={newPassword} onChange={e=>setNewPassword(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleNewPassword()} maxLength={128}/>
              </div>
              {authError&&<div style={{background:T.redSoft,border:`1px solid ${T.red}33`,borderRadius:11,padding:"10px 14px",fontSize:13,color:T.red,marginBottom:16}}>{authError}</div>}
              <button className="btn-primary" style={{width:"100%",padding:14,fontSize:15,borderRadius:14,opacity:authLoading?0.7:1}} onClick={handleNewPassword} disabled={authLoading}>
                {authLoading?"Updating...":"Update Password →"}
              </button>
            </>
          )}

          {/* ── Reset sent confirmation ── */}
          {authMode==="reset-sent"&&(
            <>
              <div style={{fontSize:48,textAlign:"center",marginBottom:16}}>📬</div>
              <h2 style={{fontSize:20,fontWeight:700,color:T.navy,textAlign:"center",marginBottom:8}}>Check your inbox</h2>
              <p style={{fontSize:13,color:T.muted,textAlign:"center",marginBottom:24,lineHeight:1.7}}>We sent a password reset link to <strong>{resetEmail}</strong>. Click the link in the email to set a new password.</p>
              <button className="btn-primary" style={{width:"100%",padding:14,fontSize:15,borderRadius:14}} onClick={()=>{setAuthMode("login");setAuthError("");}}>
                Back to Log In →
              </button>
            </>
          )}

          {/* ── Forgot password form ── */}
          {authMode==="reset"&&(
            <>
              <h2 style={{fontSize:22,fontWeight:700,color:T.navy,marginBottom:4}}>Reset password</h2>
              <p style={{fontSize:13,color:T.muted,marginBottom:24}}>Enter your email and we'll send you a reset link.</p>
              <div className="field" style={{marginBottom:authError?10:24}}>
                <label>Email Address</label>
                <input type="email" placeholder="you@university.edu" value={resetEmail} onChange={e=>setResetEmail(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleResetPassword()} maxLength={254}/>
              </div>
              {authError&&<div style={{background:T.redSoft,border:`1px solid ${T.red}33`,borderRadius:11,padding:"10px 14px",fontSize:13,color:T.red,marginBottom:16}}>{authError}</div>}
              <button className="btn-primary" style={{width:"100%",padding:14,fontSize:15,borderRadius:14,opacity:authLoading?0.7:1}} onClick={handleResetPassword} disabled={authLoading}>
                {authLoading?"Sending...":"Send Reset Link →"}
              </button>
              <p style={{textAlign:"center",marginTop:16,fontSize:13,color:T.accent,cursor:"pointer",fontWeight:600}} onClick={()=>{setAuthMode("login");setAuthError("");}}>← Back to Log In</p>
            </>
          )}

          {/* ── Sign up / Log in form ── */}
          {(authMode==="signup"||authMode==="login")&&(
            <>
              <div style={{display:"flex",background:T.bg,borderRadius:13,padding:4,marginBottom:28,border:`1px solid ${T.border}`}}>
                {(["signup","login"] as const).map(m=>(
                  <button key={m} onClick={()=>{setAuthMode(m);setAuthError("");}}
                    style={{flex:1,padding:"9px 0",border:"none",borderRadius:10,fontSize:13,fontWeight:700,cursor:"pointer",transition:"background-color 0.2s,color 0.2s,box-shadow 0.2s",background:authMode===m?T.surface:"transparent",color:authMode===m?T.navy:T.muted,boxShadow:authMode===m?"0 2px 8px rgba(0,0,0,0.08)":"none"}}>
                    {m==="signup"?"Create Account":"Log In"}
                  </button>
                ))}
              </div>

              {/* Social buttons */}
              <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:20}}>
                <button onClick={()=>handleOAuth("google")} disabled={authLoading}
                  style={{display:"flex",alignItems:"center",justifyContent:"center",gap:10,width:"100%",padding:"12px 0",border:`1.5px solid ${T.border}`,borderRadius:12,background:T.surface,cursor:"pointer",fontSize:14,fontWeight:600,color:T.navy,transition:"box-shadow 0.2s",opacity:authLoading?0.7:1}}>
                  <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.97 6.19C12.43 13.72 17.74 9.5 24 9.5z"/></svg>
                  Continue with Google
                </button>
              </div>

              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
                <div style={{flex:1,height:1,background:T.border}}/>
                <span style={{fontSize:12,color:T.muted,flexShrink:0}}>or continue with email</span>
                <div style={{flex:1,height:1,background:T.border}}/>
              </div>

              {authMode==="signup"&&(
                <div className="field"><label>Full Name</label><input placeholder="e.g. Ahmad Khalil" value={authForm.name} onChange={e=>setAuthForm(p=>({...p,name:e.target.value}))} maxLength={100}/></div>
              )}
              <div className="field"><label>Email Address</label><input type="email" placeholder="you@university.edu" value={authForm.email} onChange={e=>setAuthForm(p=>({...p,email:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&handleAuth()} maxLength={254}/></div>
              <div className="field" style={{marginBottom:2}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                  <label style={{margin:0}}>Password</label>
                  {authMode==="login"&&(
                    <span style={{fontSize:12,color:T.accent,cursor:"pointer",fontWeight:600}} onClick={()=>{setAuthMode("reset");setResetEmail(authForm.email);setAuthError("");}}>Forgot password?</span>
                  )}
                </div>
                <input type="password" placeholder={authMode==="signup"?"Min. 6 characters":"Your password"} value={authForm.password} onChange={e=>setAuthForm(p=>({...p,password:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&handleAuth()} maxLength={128}/>
              </div>
              {authError&&(
                <div style={{background:T.redSoft,border:`1px solid ${T.red}33`,borderRadius:11,padding:"10px 14px",fontSize:13,color:T.red,marginTop:10,marginBottom:6}}>{authError}</div>
              )}
              <button className="btn-primary" style={{width:"100%",padding:14,fontSize:15,borderRadius:14,marginTop:18,opacity:authLoading?0.7:1}} onClick={handleAuth} disabled={authLoading}>
                {authLoading ? "Please wait..." : authMode==="signup"?"Find my study partner 🎯":"Log in →"}
              </button>
              <p style={{textAlign:"center",marginTop:16,fontSize:13,color:T.muted}}>
                {authMode==="signup"?"Already have an account? ":"Don't have an account? "}
                <span style={{color:T.accent,cursor:"pointer",fontWeight:700}} onClick={()=>{setAuthMode(authMode==="signup"?"login":"signup");setAuthError("");}}>
                  {authMode==="signup"?"Log in":"Join free →"}
                </span>
              </p>
            </>
          )}

          <p style={{textAlign:"center",marginTop:12,fontSize:12,color:T.muted,cursor:"pointer"}} onClick={()=>setScreen("landing")}>← Back to home</p>
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
