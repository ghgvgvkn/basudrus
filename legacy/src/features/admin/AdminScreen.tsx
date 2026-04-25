import type { Report, HelpRequest, Profile } from "@/lib/supabase";
import type { Theme } from "@/lib/constants";

interface AdminScreenProps {
  T: Theme;
  darkMode: boolean;
  adminTab: string;
  setAdminTab: (tab: string) => void;
  adminReports: Report[];
  adminPosts: HelpRequest[];
  adminAnalytics: any;
  adminDeletePost: (postId: string) => void;
  setViewingProfile: (p: Profile | null) => void;
  initials: (n: string) => string;
}

export function AdminScreen({
  T, darkMode, adminTab, setAdminTab,
  adminReports, adminPosts, adminAnalytics,
  adminDeletePost, setViewingProfile, initials,
}: AdminScreenProps) {
  return (
    <div className="page-scroll">
      <div style={{maxWidth:800,margin:"0 auto",padding:"24px 20px"}}>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:24}}>
          <div style={{width:48,height:48,borderRadius:14,background:T.red+"15",display:"flex",alignItems:"center",justifyContent:"center",fontSize:24}}>🛡️</div>
          <div>
            <h2 style={{fontSize:20,fontWeight:800,color:T.navy,margin:0}}>Admin Dashboard</h2>
            <p style={{fontSize:13,color:T.muted,margin:0}}>Manage reports, posts & analytics</p>
          </div>
        </div>

        <div style={{display:"flex",gap:3,marginBottom:20,background:T.bg,padding:4,borderRadius:99,width:"fit-content",border:`1px solid ${T.border}`,flexWrap:"wrap"}}>
          {[["analytics","📊 Analytics"],["reports","🚩 Reports"],["posts","📢 All Posts"]].map(([tab,lbl])=>(
            <button key={tab} className={`sub-tab ${adminTab===tab?"active":""}`}
              onClick={()=>setAdminTab(tab)}>{lbl}</button>
          ))}
        </div>

        {adminTab==="analytics"&&(
          <div className="slide-in">
            {!adminAnalytics?(
              <div style={{textAlign:"center",padding:"40px 20px",color:T.muted}}>Loading analytics...</div>
            ):(()=>{
              const a = adminAnalytics;
              const SUBJ_COLORS = ["#378ADD","#1D9E75","#7F77DD","#D4537E","#EF9F27","#639922","#D85A30","#185FA5","#0F6E56","#BA7517"];
              const maxSubj = a.topSubjects[0]?.[1] || 1;
              const chartData = a.months6 || [];
              const W=480,H=140,PAD={t:10,b:28,l:40,r:10};
              const vals = chartData.map((d:{posts:number;month:string})=>d.posts);
              const minV = Math.min(...vals), maxV = Math.max(...vals, 1);
              const xs = chartData.map((_:{posts:number;month:string},i:number)=>PAD.l+(i/(Math.max(chartData.length-1,1)))*(W-PAD.l-PAD.r));
              const ys = vals.map((v:number)=>PAD.t+((maxV-v)/(maxV-minV||1))*(H-PAD.t-PAD.b));
              const pts = xs.map((x:number,i:number)=>`${x},${ys[i]}`).join(" ");
              const area = chartData.length>1?`M${xs[0]},${ys[0]} `+xs.slice(1).map((x:number,i:number)=>`L${x},${ys[i+1]}`).join(" ")+` L${xs[xs.length-1]},${H-PAD.b} L${xs[0]},${H-PAD.b} Z`:"";
              const rResolved = a.resolvedReports || 0;
              const rUnresolved = a.unresolvedReports || 0;
              const donutR=48,CX=70,CY=60,sw=14,circ=2*Math.PI*donutR;
              const resolvedArc = a.totalReports>0?(rResolved/a.totalReports)*circ:0;
              const unresolvedArc = a.totalReports>0?(rUnresolved/a.totalReports)*circ:0;

              return(
              <>
                <div style={{marginBottom:20}}>
                  <p style={{fontSize:13,color:T.muted}}>Live data from Supabase</p>
                </div>

                <div className="admin-kpi" style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:16}}>
                  {[
                    {label:"Total posts",value:a.totalPosts,sub:`+${a.postsMonth} this month`,accent:"#378ADD"},
                    {label:"Active users",value:a.totalUsers,sub:`+${a.usersMonth} this month`,accent:"#1D9E75"},
                    {label:"Reported accounts",value:a.totalReports,sub:`${rUnresolved} unresolved`,accent:"#E24B4A"},
                    {label:"New registrations",value:a.usersMonth,sub:"this month",accent:"#7F77DD"},
                  ].map(m=>(
                    <div key={m.label} style={{background:"rgba(128,128,128,0.06)",borderRadius:10,padding:"14px 18px"}}>
                      <p style={{fontSize:12,color:T.muted,marginBottom:6}}>{m.label}</p>
                      <p style={{fontSize:24,fontWeight:600,color:m.accent,lineHeight:1,margin:0}}>{m.value}</p>
                      <p style={{fontSize:12,color:T.muted,marginTop:5,margin:0}}>{m.sub}</p>
                    </div>
                  ))}
                </div>

                <div className="admin-grid2" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
                  <div style={{background:T.surface,border:`0.5px solid ${T.border}`,borderRadius:14,padding:"18px 20px"}}>
                    <p style={{fontSize:14,fontWeight:600,color:T.navy,marginBottom:14}}>Post activity — last 6 months</p>
                    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{display:"block"}}>
                      <defs>
                        <linearGradient id="aGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#378ADD" stopOpacity={0.2}/>
                          <stop offset="100%" stopColor="#378ADD" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      {[0,0.5,1].map(t=>{const y=PAD.t+t*(H-PAD.t-PAD.b);return <line key={t} x1={PAD.l} x2={W-PAD.r} y1={y} y2={y} stroke="rgba(128,128,128,0.12)" strokeWidth="1"/>;})}
                      {area&&<path d={area} fill="url(#aGrad)"/>}
                      {chartData.length>1&&<polyline points={pts} fill="none" stroke="#378ADD" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"/>}
                      {xs.map((x:number,i:number)=><circle key={i} cx={x} cy={ys[i]} r="3.5" fill="#378ADD" stroke={T.surface} strokeWidth="1.5"/>)}
                      {chartData.map((d:any,i:number)=><text key={i} x={xs[i]} y={H-6} textAnchor="middle" fontSize="10" fill={T.muted}>{d.month}</text>)}
                      {[minV,Math.round((minV+maxV)/2),maxV].map((v:number,i:number)=>{const y=PAD.t+((maxV-v)/(maxV-minV||1))*(H-PAD.t-PAD.b);return <text key={i} x={PAD.l-5} y={y+4} textAnchor="end" fontSize="10" fill={T.muted}>{v}</text>;})}
                    </svg>
                  </div>

                  <div style={{background:T.surface,border:`0.5px solid ${T.border}`,borderRadius:14,padding:"18px 20px"}}>
                    <p style={{fontSize:14,fontWeight:600,color:T.navy,marginBottom:14}}>Most popular subjects</p>
                    {a.topSubjects.length===0?(
                      <div style={{fontSize:12,color:T.muted,textAlign:"center",padding:20}}>No posts yet</div>
                    ):(
                      a.topSubjects.map(([subj,cnt]:[string,number],i:number)=>(
                        <div key={subj} style={{marginBottom:8}}>
                          <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                            <span style={{fontSize:12,color:T.textSoft}}>{i+1}. {subj}</span>
                            <span style={{fontSize:12,fontWeight:600,color:T.navy}}>{cnt}</span>
                          </div>
                          <div style={{height:6,background:"rgba(128,128,128,0.1)",borderRadius:4,overflow:"hidden"}}>
                            <div style={{height:"100%",borderRadius:4,width:`${Math.round((cnt/maxSubj)*100)}%`,background:SUBJ_COLORS[i%SUBJ_COLORS.length],transition:"width 0.6s ease"}}/>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="admin-grid2" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                  <div style={{background:T.surface,border:`0.5px solid ${T.border}`,borderRadius:14,padding:"18px 20px"}}>
                    <p style={{fontSize:14,fontWeight:600,color:T.navy,marginBottom:14}}>Most active users</p>
                    {a.topActiveUsers.length===0?(
                      <div style={{fontSize:12,color:T.muted,textAlign:"center",padding:20}}>No activity yet</div>
                    ):(
                      a.topActiveUsers.map((u:any,i:number)=>{
                        const colors = darkMode ? [
                          {bg:"rgba(139,92,246,0.25)",text:"#c4b5fd"},
                          {bg:"rgba(16,185,129,0.25)",text:"#6ee7b7"},
                          {bg:"rgba(244,114,182,0.25)",text:"#f9a8d4"},
                          {bg:"rgba(59,130,246,0.25)",text:"#93c5fd"},
                          {bg:"rgba(250,204,21,0.25)",text:"#fde68a"},
                        ] : [
                          {bg:"#CECBF6",text:"#3C3489"},
                          {bg:"#9FE1CB",text:"#085041"},
                          {bg:"#F4C0D1",text:"#72243E"},
                          {bg:"#B5D4F4",text:"#0C447C"},
                          {bg:"#FAC775",text:"#633806"},
                        ];
                        const c = colors[i%colors.length];
                        const ini = u.name.split(" ").map((w:string)=>w[0]).join("").slice(0,2).toUpperCase();
                        return(
                          <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:`0.5px solid ${T.border}`}}>
                            <div style={{width:30,height:30,borderRadius:"50%",background:c.bg,color:c.text,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:600,flexShrink:0}}>{ini}</div>
                            <span style={{flex:1,fontSize:13,color:T.navy}}>{u.name}</span>
                            <span style={{fontSize:12,color:T.muted}}>{u.count} posts</span>
                          </div>
                        );
                      })
                    )}
                  </div>

                  <div style={{background:T.surface,border:`0.5px solid ${T.border}`,borderRadius:14,padding:"18px 20px"}}>
                    <p style={{fontSize:14,fontWeight:600,color:T.navy,marginBottom:14}}>Reports overview</p>
                    <div style={{display:"flex",alignItems:"center",gap:24}}>
                      <svg viewBox="0 0 140 120" width="140" style={{display:"block",flexShrink:0}}>
                        <circle cx={CX} cy={CY} r={donutR} fill="none" stroke="rgba(128,128,128,0.1)" strokeWidth={sw}/>
                        {a.totalReports>0&&<circle cx={CX} cy={CY} r={donutR} fill="none" stroke="#1D9E75" strokeWidth={sw} strokeDasharray={`${resolvedArc} ${circ}`} strokeDashoffset={circ/4} strokeLinecap="round"/>}
                        {a.totalReports>0&&<circle cx={CX} cy={CY} r={donutR} fill="none" stroke="#E24B4A" strokeWidth={sw} strokeDasharray={`${unresolvedArc} ${circ}`} strokeDashoffset={circ/4-resolvedArc} strokeLinecap="round"/>}
                        <text x={CX} y={CY-4} textAnchor="middle" fontSize="18" fontWeight="600" fill={T.navy}>{a.totalReports}</text>
                        <text x={CX} y={CY+14} textAnchor="middle" fontSize="10" fill={T.muted}>total</text>
                      </svg>
                      <div style={{flex:1}}>
                        {[
                          {label:"Resolved",value:rResolved,color:darkMode?"#6ee7b7":"#1D9E75",bg:darkMode?"rgba(16,185,129,0.15)":"#E1F5EE"},
                          {label:"Unresolved",value:rUnresolved,color:darkMode?"#fca5a5":"#A32D2D",bg:darkMode?"rgba(239,68,68,0.15)":"#FCEBEB"},
                        ].map(r=>(
                          <div key={r.label} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",borderRadius:10,background:r.bg,marginBottom:8}}>
                            <span style={{fontSize:13,color:r.color,fontWeight:500}}>{r.label}</span>
                            <span style={{fontSize:20,fontWeight:700,color:r.color}}>{r.value}</span>
                          </div>
                        ))}
                        <p style={{fontSize:11,color:T.muted,marginTop:10}}>
                          {a.totalReports>0?`${Math.round((rResolved/a.totalReports)*100)}% resolution rate`:"No reports yet"}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </>
              );
            })()}
          </div>
        )}

        {adminTab==="reports"&&(
          <div className="slide-in">
            <div style={{marginBottom:16}}>
              <h3 style={{fontSize:16,fontWeight:700,color:T.navy,marginBottom:4}}>Reported Accounts</h3>
              <p style={{fontSize:12,color:T.muted}}>{adminReports.length} report{adminReports.length!==1?"s":""}</p>
            </div>
            {adminReports.length===0?(
              <div style={{textAlign:"center",padding:"50px 20px"}}>
                <div style={{fontSize:40,marginBottom:12}}>✅</div>
                <div style={{fontWeight:600,fontSize:15,color:T.navy}}>No reports yet</div>
                <div style={{fontSize:13,color:T.muted,marginTop:6}}>All accounts are in good standing</div>
              </div>
            ):(
              <div style={{display:"flex",flexDirection:"column",gap:12}}>
                {adminReports.map(r=>{
                  const reported: any = r.reported;
                  const reporter: any = r.reporter;
                  return(
                    <div key={r.id} className="card" style={{padding:18}}>
                      <div style={{display:"flex",alignItems:"flex-start",gap:14}}>
                        <div style={{width:44,height:44,borderRadius:"50%",background:reported?.avatar_color||"#6C8EF5",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:700,fontSize:14,flexShrink:0,overflow:"hidden",cursor:"pointer"}} onClick={()=>reported&&setViewingProfile(reported)}>
                          {reported?.photo_mode==="photo"&&reported?.photo_url?<img src={reported.photo_url} alt={reported?.name?`${reported.name}'s photo`:"Reported user photo"} width={40} height={40} loading="lazy" decoding="async" style={{width:"100%",height:"100%",objectFit:"cover"}} onError={e=>{(e.target as HTMLImageElement).style.display="none";((e.target as HTMLImageElement).parentElement||{} as HTMLElement).textContent=initials(reported?.name||"?");}}/>:initials(reported?.name||"?")}
                        </div>
                        <div style={{flex:1}}>
                          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:4}}>
                            <span style={{fontWeight:700,fontSize:15,color:T.navy,cursor:"pointer"}} onClick={()=>reported&&setViewingProfile(reported)}>{reported?.name||"Unknown"}</span>
                            <span style={{background:T.red+"15",color:T.red,padding:"3px 10px",borderRadius:99,fontSize:11,fontWeight:700}}>Reported</span>
                          </div>
                          <div style={{fontSize:12,color:T.muted,marginBottom:6}}>{reported?.email||"--"} · {reported?.uni||"--"}</div>
                          <div style={{background:T.bg,borderRadius:10,padding:"10px 14px",fontSize:13,color:T.textSoft,lineHeight:1.6,marginBottom:6}}>
                            <strong style={{color:T.navy}}>Reason:</strong> {r.reason}
                          </div>
                          <div style={{fontSize:11,color:T.muted}}>
                            Reported by {reporter?.name||"Unknown"} · {new Date(r.created_at).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {adminTab==="posts"&&(
          <div className="slide-in">
            <div style={{marginBottom:16}}>
              <h3 style={{fontSize:16,fontWeight:700,color:T.navy,marginBottom:4}}>All Discover Posts</h3>
              <p style={{fontSize:12,color:T.muted}}>{adminPosts.length} post{adminPosts.length!==1?"s":""} total</p>
            </div>
            {adminPosts.length===0?(
              <div style={{textAlign:"center",padding:"50px 20px"}}>
                <div style={{fontSize:40,marginBottom:12}}>📭</div>
                <div style={{fontWeight:600,fontSize:15,color:T.navy}}>No posts yet</div>
              </div>
            ):(
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {adminPosts.map(p=>{
                  const pProfile: any = p.profile;
                  return(
                    <div key={p.id} className="card" style={{padding:16}}>
                      <div style={{display:"flex",alignItems:"flex-start",gap:12}}>
                        <div style={{width:40,height:40,borderRadius:"50%",background:pProfile?.avatar_color||"#6C8EF5",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:700,fontSize:13,flexShrink:0,overflow:"hidden"}}>
                          {pProfile?.photo_mode==="photo"&&pProfile?.photo_url?<img src={pProfile.photo_url} alt={pProfile?.name?`${pProfile.name}'s photo`:"User photo"} width={40} height={40} loading="lazy" decoding="async" style={{width:"100%",height:"100%",objectFit:"cover"}} onError={e=>{(e.target as HTMLImageElement).style.display="none";((e.target as HTMLImageElement).parentElement||{} as HTMLElement).textContent=initials(pProfile?.name||"?");}}/>:initials(pProfile?.name||"?")}
                        </div>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:2}}>
                            <span style={{fontWeight:700,fontSize:14,color:T.navy}}>{pProfile?.name||"Unknown"}</span>
                            <span style={{background:T.accentSoft,color:T.accent,padding:"3px 10px",borderRadius:99,fontSize:11,fontWeight:700}}>📚 {p.subject}</span>
                          </div>
                          <div style={{fontSize:12,color:T.muted,marginBottom:4}}>{pProfile?.uni||""} · {new Date(p.created_at).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}</div>
                          {p.detail&&<p style={{fontSize:13,color:T.textSoft,lineHeight:1.5,margin:0}}>{p.detail}</p>}
                        </div>
                        <button className="btn-danger" style={{padding:"8px 14px",fontSize:12,borderRadius:10,flexShrink:0}} onClick={()=>adminDeletePost(p.id)}>Delete</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
