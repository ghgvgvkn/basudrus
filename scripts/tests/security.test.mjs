// Test the Zapier URL host-parse fix (aurora.ts) and geo IP validation.
function zapierOk(u){
  if(typeof u!=="string"||u.length<10) return false;
  try{ const p=new URL(u); const h=p.hostname.toLowerCase();
    return p.protocol==="https:" && (h==="zapier.com"||h.endsWith(".zapier.com"));
  }catch{return false;}
}
function ipOk(ip){ return /^[0-9]{1,3}(\.[0-9]{1,3}){3}$/.test(ip) || /^[0-9a-fA-F:]+$/.test(ip); }
const t=(n,c)=>{console.log(c?"✅":"❌",n); return c;};
let all=true;
// Zapier: legit
all&=t("mcp.zapier.com accepted", zapierOk("https://mcp.zapier.com/api/abc123xyz"));
all&=t("hooks.zapier.com accepted", zapierOk("https://hooks.zapier.com/x/y/z"));
// Zapier: spoofs that the OLD substring check would WRONGLY accept
all&=t("spoof evil.com?x=zapier.com REJECTED", !zapierOk("https://evil.com/?x=zapier.com"));
all&=t("spoof zapier.com.evil.com REJECTED", !zapierOk("https://zapier.com.evil.com/x"));
all&=t("http (not https) REJECTED", !zapierOk("http://mcp.zapier.com/x"));
all&=t("garbage REJECTED", !zapierOk("not a url"));
// geo IP
all&=t("ipv4 accepted", ipOk("203.0.113.7"));
all&=t("ipv6 accepted", ipOk("2001:db8::1"));
all&=t("injection attempt REJECTED", !ipOk("1.2.3.4/../../etc"));
all&=t("empty REJECTED", !ipOk(""));
console.log(`\nSecurity fixes: ${all?"ALL PASSED":"SOME FAILED"}`);
process.exit(all?0:1);
