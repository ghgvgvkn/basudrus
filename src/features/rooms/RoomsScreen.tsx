import type { Profile, GroupRoom } from "@/lib/supabase";
import type { Theme } from "@/lib/constants";
import { getMeetIcon, getMeetLabel } from "@/lib/constants";

interface RoomsScreenProps {
  T: Theme;
  user: { id: string; email: string } | null;
  groups: GroupRoom[];
  setShowGrpModal: (v: boolean) => void;
  openEditRoom: (g: GroupRoom) => void;
  setConfirmDeleteRoom: (id: string | null) => void;
  toggleJoinGroup: (groupId: string, joined: boolean) => void;
  openStudentProfile: (id: string, p?: Profile) => void;
  initials: (n: string) => string;
}

export function RoomsScreen({
  T, user, groups, setShowGrpModal, openEditRoom,
  setConfirmDeleteRoom, toggleJoinGroup, openStudentProfile, initials,
}: RoomsScreenProps) {
  return (
    <div className="page-scroll">
      <div style={{maxWidth:720,margin:"0 auto",padding:"24px 20px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20}}>
          <div><h2 style={{fontSize:17,fontWeight:700,color:T.navy,marginBottom:4}}>Group Study Rooms</h2><p style={{fontSize:12,color:T.muted}}>Join a session or host your own</p></div>
          <button className="btn-primary" style={{padding:"9px 16px",fontSize:12,flexShrink:0}} onClick={()=>setShowGrpModal(true)}>+ Create Room</button>
        </div>
        {groups.length===0?(
          <div style={{textAlign:"center",padding:"60px 20px"}}>
            <div style={{fontSize:44,marginBottom:12}}>🎓</div>
            <div style={{fontWeight:600,fontSize:16,color:T.navy,marginBottom:6}}>No study rooms yet</div>
            <button className="btn-primary" style={{marginTop:8}} onClick={()=>setShowGrpModal(true)}>Create the First Room</button>
          </div>
        ):(
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            {groups.map(g=>{
              const host = g.host as Profile | undefined;
              const joined = g.joined;
              const full = g.filled >= g.spots;
              return(
                <div key={g.id} className="request-card">
                  <div style={{display:"flex",alignItems:"flex-start",gap:12,marginBottom:10}}>
                    <div style={{width:42,height:42,borderRadius:"50%",background:host?.avatar_color||"#6C8EF5",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:700,fontSize:14,flexShrink:0,cursor:"pointer",overflow:"hidden"}} onClick={()=>g.host_id&&openStudentProfile(g.host_id, host as Profile)}>{host?.photo_mode==="photo"&&host?.photo_url?<img src={host.photo_url} alt={host?.name?`${host.name}'s photo`:"Host photo"} width={42} height={42} loading="lazy" decoding="async" style={{width:"100%",height:"100%",objectFit:"cover"}} onError={e=>{(e.target as HTMLImageElement).style.display="none";((e.target as HTMLImageElement).parentElement||{} as HTMLElement).textContent=initials(host?.name||"?");}}/>:initials(host?.name||"?")}</div>
                    <div style={{flex:1}}>
                      <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                        <span style={{fontWeight:700,fontSize:14,color:T.navy}}>{g.subject}</span>
                        <span style={{background:T.accentSoft,color:T.accent,padding:"3px 10px",borderRadius:99,fontSize:11,fontWeight:700}}>{getMeetIcon(g.type)} {getMeetLabel(g.type)}</span>
                      </div>
                      <div style={{fontSize:12,color:T.muted,marginTop:3}}>Hosted by <span style={{cursor:"pointer",fontWeight:600}} onClick={()=>g.host_id&&openStudentProfile(g.host_id, host as Profile)}>{host?.name||"Unknown"}</span></div>
                      <div style={{fontSize:12,color:T.textSoft,marginTop:2}}>📅 {g.date} at {g.time}</div>
                    </div>
                    <div style={{textAlign:"right",flexShrink:0}}>
                      <div style={{fontSize:13,fontWeight:700,color:full?T.red:T.green}}>{g.spots-g.filled} spot{g.spots-g.filled!==1?"s":""} left</div>
                      <div style={{fontSize:11,color:T.muted}}>{g.filled}/{g.spots} joined</div>
                    </div>
                  </div>
                  {(g.link||g.location)&&(
                    <div style={{background:T.bg,borderRadius:10,padding:"8px 12px",fontSize:12,color:T.textSoft,marginBottom:10,wordBreak:"break-all"}}>
                      {g.type==="face"?"📍 ":"🔗 "}{g.link||g.location}
                    </div>
                  )}
                  <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                    <button
                      style={{background:joined?T.greenSoft:full?T.border:T.navy,color:joined?T.green:full?T.muted:T.bg,border:"none",padding:"10px 20px",borderRadius:99,fontSize:13,fontWeight:700,cursor:full&&!joined?"not-allowed":"pointer",transition:"background-color 0.2s,color 0.2s"}}
                      disabled={!!(full&&!joined)}
                      onClick={()=>toggleJoinGroup(g.id, !!joined)}>
                      {joined?"✓ Joined — Leave":full?"Session Full":"Join Session →"}
                    </button>
                    {user&&g.host_id===user.id&&(
                      <>
                        <button onClick={()=>openEditRoom(g)} style={{background:T.accentSoft,color:T.accent,border:"none",padding:"10px 16px",borderRadius:99,fontSize:12,fontWeight:700,cursor:"pointer"}}>✏️ Edit</button>
                        <button onClick={()=>setConfirmDeleteRoom(g.id)} style={{background:"rgba(239,68,68,0.1)",color:"#ef4444",border:"none",padding:"10px 16px",borderRadius:99,fontSize:12,fontWeight:700,cursor:"pointer"}}>🗑 Delete</button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
