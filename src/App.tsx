import { lazy, Suspense } from "react";
import { SpeedInsights } from "@vercel/speed-insights/react";

const BasUdrus = lazy(() => import("@/pages/BasUdrus"));

function LoadingShell() {
  return (
    <div style={{minHeight:"100dvh",background:"#F5F4F0",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{textAlign:"center"}}>
        <svg width="260" height="104" viewBox="0 0 400 160" style={{marginBottom:12}}><text x="200" y="88" textAnchor="middle" fontFamily="Georgia, serif" fontWeight="500" fontSize="52" fill="#1a1f36" letterSpacing="-1">Bas Udrus</text><circle cx="318" cy="50" r="5" fill="#4F7EF7"/><line x1="130" y1="105" x2="270" y2="105" stroke="#4F7EF7" strokeWidth="2"/><text x="200" y="124" textAnchor="middle" fontFamily="Arial, sans-serif" fontSize="11" fill="#888888" letterSpacing="4">STUDY SMARTER</text></svg>
        <div style={{color:"#5A6370",fontSize:14}}>Loading…</div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <>
      <Suspense fallback={<LoadingShell />}>
        <BasUdrus />
      </Suspense>
      <SpeedInsights />
    </>
  );
}
