import React from "react";

export function renderMarkdown(text: string) {
  if (!text) return null;
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let listItems: string[] = [];
  let listType: "ul"|"ol"|null = null;
  let keyIdx = 0;

  function flushList() {
    if (listItems.length === 0) return;
    const Tag = listType === "ol" ? "ol" : "ul";
    elements.push(
      <Tag key={keyIdx++} style={{margin:"6px 0",paddingLeft:22,lineHeight:1.75}}>
        {listItems.map((li,i) => <li key={i} style={{marginBottom:2}}>{inlineFormat(li)}</li>)}
      </Tag>
    );
    listItems = [];
    listType = null;
  }

  function inlineFormat(s: string): React.ReactNode {
    const parts: React.ReactNode[] = [];
    const regex = /(\*\*(.+?)\*\*|__(.+?)__|`(.+?)`|\*(.+?)\*|_(.+?)_)/g;
    let last = 0;
    let match;
    let pKey = 0;
    while ((match = regex.exec(s)) !== null) {
      if (match.index > last) parts.push(s.slice(last, match.index));
      if (match[2] || match[3]) {
        parts.push(<strong key={pKey++}>{match[2] || match[3]}</strong>);
      } else if (match[4]) {
        parts.push(<code key={pKey++} style={{background:"rgba(128,128,128,0.15)",padding:"1px 5px",borderRadius:4,fontSize:"0.9em",fontFamily:"monospace"}}>{match[4]}</code>);
      } else if (match[5] || match[6]) {
        parts.push(<em key={pKey++}>{match[5] || match[6]}</em>);
      }
      last = match.index + match[0].length;
    }
    if (last < s.length) parts.push(s.slice(last));
    return parts.length === 1 ? parts[0] : <>{parts}</>;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const h3 = line.match(/^###\s+(.+)/);
    if (h3) { flushList(); elements.push(<div key={keyIdx++} style={{fontWeight:700,fontSize:15,marginTop:10,marginBottom:4}}>{inlineFormat(h3[1])}</div>); continue; }
    const h2 = line.match(/^##\s+(.+)/);
    if (h2) { flushList(); elements.push(<div key={keyIdx++} style={{fontWeight:800,fontSize:16,marginTop:12,marginBottom:4}}>{inlineFormat(h2[1])}</div>); continue; }
    const h1 = line.match(/^#\s+(.+)/);
    if (h1) { flushList(); elements.push(<div key={keyIdx++} style={{fontWeight:800,fontSize:17,marginTop:14,marginBottom:6}}>{inlineFormat(h1[1])}</div>); continue; }

    if (/^[-━─═]{3,}$/.test(line.trim())) { flushList(); elements.push(<hr key={keyIdx++} style={{border:"none",borderTop:"1px solid rgba(0,0,0,0.1)",margin:"8px 0"}}/>); continue; }

    const ul = line.match(/^\s*[-•*]\s+(.+)/);
    if (ul) { if (listType === "ol") flushList(); listType = "ul"; listItems.push(ul[1]); continue; }

    const ol = line.match(/^\s*\d+[.)]\s+(.+)/);
    if (ol) { if (listType === "ul") flushList(); listType = "ol"; listItems.push(ol[1]); continue; }

    if (line.trim() === "") { flushList(); elements.push(<div key={keyIdx++} style={{height:6}}/>); continue; }

    flushList();
    elements.push(<div key={keyIdx++} style={{marginBottom:2}}>{inlineFormat(line)}</div>);
  }
  flushList();
  return <>{elements}</>;
}
