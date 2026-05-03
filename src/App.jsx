import { useState, useEffect, useRef } from "react";

const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyulP43RWyq8kkpDudVtGPyZLZZgNStaswZMIlKd-49SUoMWOAJjITbwMPwfQtaFgXy/exec";
const CATEGORIES = ["🍽️ Comida","🛒 Super","⛽ Gas","🎬 Ocio","✈️ Viaje","🏥 Salud","🛍️ Compras","📦 Otro"];
function today() { return new Date().toISOString().slice(0,10); }
function fmt(n) { return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(n||0); }
function parseAmt(s) { return parseFloat(String(s).replace(/[$,]/g,""))||0; }

const EMPTY_FORM = { desc:"", amount:"", category:CATEGORIES[7], date:today(), owed:[] };

async function sheetRead() {
  const res = await fetch(`${SCRIPT_URL}?action=read`);
  const data = await res.json();
  return data.expenses || [];
}
async function sheetAppend(expense) {
  const owedStr = (expense.owed||[]).map(p=>`${p.name}:${p.type==="pct"?p.value+"%":"$"+p.value}`).join(", ");
  await fetch(SCRIPT_URL, { method:"POST", body:JSON.stringify({ action:"append", desc:expense.desc, amount:expense.amount, date:expense.date, category:expense.category, owed:owedStr }) });
}
async function sheetUpdate(expense) {
  await fetch(SCRIPT_URL, { method:"POST", body:JSON.stringify({ action:"update", desc:expense.desc, date:expense.date, amount:expense.amount, added:expense.added }) });
}
async function sheetDelete(expense) {
  await fetch(SCRIPT_URL, { method:"POST", body:JSON.stringify({ action:"delete", desc:expense.desc, date:expense.date, amount:expense.amount }) });
}
function parseOwedStr(s) {
  if (!s||s.trim()==="") return [];
  return s.split(",").map(part=>{ const [name,val]=(part||"").split(":").map(x=>x.trim()); if (!val) return null; const isPct=val.endsWith("%"); return {name:name||"?",type:isPct?"pct":"fixed",value:val.replace(/[$%]/g,"")}; }).filter(Boolean);
}

export default function App() {
  const [expenses,setExpenses]=useState([]);
  const [form,setForm]=useState(EMPTY_FORM);
  const [editId,setEditId]=useState(null);
  const [filter,setFilter]=useState("all");
  const [tab,setTab]=useState("list");
  const [loading,setLoading]=useState(false);
  const [syncing,setSyncing]=useState(false);
  const [status,setStatus]=useState("idle");
  const [toast,setToast]=useState(null);
  const [confirmDelete,setConfirmDelete]=useState(null);
  const [calcInput,setCalcInput]=useState({total:"",people:"2",mode:"equal",rows:[{name:"",amount:""},{name:"",amount:""}]});
  const descRef=useRef();

  useEffect(()=>{loadSheet();},[]);

  async function loadSheet() {
    setLoading(true); setStatus("idle");
    try {
      const rows=await sheetRead();
      const normalized=rows.map((e,i)=>({ id:e.id||String(Date.now()+i), desc:e.desc||"", amount:parseAmt(e.amount), date:e.date||today(), category:e.category||CATEGORIES[7], owed:typeof e.owed==="string"?parseOwedStr(e.owed):(e.owed||[]), added:e.added===true||e.added==="SI" }));
      setExpenses(normalized); setStatus("ok"); showToast(`${normalized.length} gastos cargados ✓`);
    } catch { setStatus("error"); showToast("No se pudo conectar al Sheet","warn"); }
    setLoading(false);
  }

  function showToast(msg,type="ok"){setToast({msg,type});setTimeout(()=>setToast(null),2500);}
  function owedTotalFromForm(){const base=parseFloat(form.amount)||0;return form.owed.reduce((s,p)=>p.type==="pct"?s+(base*(parseFloat(p.value)||0)/100):s+(parseFloat(p.value)||0),0);}
  function owedForExp(ex){return(ex.owed||[]).reduce((s,p)=>p.type==="pct"?s+(ex.amount*(parseFloat(p.value)||0)/100):s+(parseFloat(p.value)||0),0);}
  function addPerson(){setForm(f=>({...f,owed:[...f.owed,{name:"",type:"fixed",value:""}]}));}
  function removePerson(i){setForm(f=>({...f,owed:f.owed.filter((_,j)=>j!==i)}));}
  function updatePerson(i,k,v){setForm(f=>({...f,owed:f.owed.map((p,j)=>j===i?{...p,[k]:v}:p)}));}

  async function submitForm(e) {
    e.preventDefault(); if(!form.desc.trim()||!form.amount)return;
    const expense={id:editId??Date.now(),desc:form.desc,amount:parseFloat(form.amount),category:form.category,date:form.date,owed:form.owed.filter(p=>p.value),added:editId?(expenses.find(x=>x.id===editId)?.added??false):false};
    if(editId){setExpenses(ex=>ex.map(x=>x.id===editId?expense:x));setEditId(null);showToast("Gasto actualizado ✓");}
    else{setExpenses(ex=>[expense,...ex]);setSyncing(true);try{await sheetAppend(expense);showToast("Guardado en Google Sheets ✓");}catch{showToast("Error al guardar","warn");}setSyncing(false);}
    setForm(EMPTY_FORM); descRef.current?.focus();
  }

  async function toggleAdded(id){const updated=expenses.map(x=>x.id===id?{...x,added:!x.added}:x);setExpenses(updated);const exp=updated.find(x=>x.id===id);setSyncing(true);try{await sheetUpdate(exp);}catch{}setSyncing(false);}

  async function doDelete(){const ex=confirmDelete;setConfirmDelete(null);setExpenses(prev=>prev.filter(x=>x.id!==ex.id));setSyncing(true);try{await sheetDelete(ex);showToast("Eliminado del Sheet ✓");}catch{showToast("Error al eliminar","warn");}setSyncing(false);}

  function startEdit(ex){setEditId(ex.id);setForm({desc:ex.desc,amount:String(ex.amount),category:ex.category,date:ex.date,owed:ex.owed||[]});setTab("list");setTimeout(()=>descRef.current?.focus(),50);}
  function cancelEdit(){setEditId(null);setForm(EMPTY_FORM);}

  const filtered=expenses.filter(ex=>filter==="pending"?!ex.added:filter==="added"?ex.added:true);
  const pending=expenses.filter(e=>!e.added);
  const totalCard=pending.reduce((s,e)=>s+e.amount,0);
  const totalOwed=pending.reduce((s,e)=>s+owedForExp(e),0);
  const netPending=totalCard-totalOwed;
  function calcEqual(){const t=parseFloat(calcInput.total)||0,n=parseInt(calcInput.people)||1;return Array.from({length:n},(_,i)=>({name:`Persona ${i+1}`,amount:(t/n).toFixed(2)}));}

  const C={bg:"#08090d",card:"#0e111a",border:"#1a2035",orange:"#ff6200",green:"#00d68f",purple:"#9b81ff",muted:"#5a6580",text:"#dde2f0"};
  const statusDot=status==="ok"?C.green:status==="error"?"#ff4466":C.muted;

  return (
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:"'IBM Plex Mono','Courier New',monospace",color:C.text,paddingBottom:60}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500&family=Syne:wght@700;800;900&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}input,select{outline:none;}
        input:focus,select:focus{border-color:#ff6200!important;box-shadow:0 0 0 2px #ff620015;}
        .inp{background:#0e111a;border:1px solid #1a2035;color:#dde2f0;padding:9px 12px;border-radius:6px;font-family:'IBM Plex Mono',monospace;font-size:13px;width:100%;transition:border .15s,box-shadow .15s;}
        .sel{background:#0e111a;border:1px solid #1a2035;color:#dde2f0;padding:9px 12px;border-radius:6px;font-family:'IBM Plex Mono',monospace;font-size:13px;cursor:pointer;}
        .btn{cursor:pointer;border:none;font-family:'IBM Plex Mono',monospace;font-size:12px;border-radius:6px;padding:8px 14px;transition:all .15s;font-weight:500;}
        .btn:hover:not(:disabled){filter:brightness(1.12);transform:translateY(-1px);}.btn:active{transform:translateY(0);}.btn:disabled{opacity:.4;cursor:default;}
        .btn-p{background:#ff6200;color:#fff;}.btn-g{background:transparent;color:#5a6580;border:1px solid #1a2035;}.btn-g:hover:not(:disabled){color:#dde2f0;border-color:#3a4560;}.btn-danger{background:#ff4466;color:#fff;}.btn-sm{padding:5px 10px;font-size:11px;}
        .tab{padding:8px 16px;border-radius:6px;cursor:pointer;font-size:12px;border:none;font-family:'IBM Plex Mono',monospace;background:transparent;color:#5a6580;transition:all .15s;}.tab.on{background:#ff6200;color:#fff;}.tab:hover:not(.on){color:#dde2f0;background:#1a2035;}
        .row{display:flex;align-items:flex-start;gap:10px;padding:12px 14px;border-radius:8px;border:1px solid #1a2035;background:#0e111a;margin-bottom:6px;transition:border .2s;}.row:hover{border-color:#2a3550;}.row.dim{opacity:.4;}
        .chk{width:20px;height:20px;border-radius:4px;border:2px solid #2a3550;background:transparent;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .15s;margin-top:2px;}.chk.on{background:#00d68f;border-color:#00d68f;}
        .stat{background:#0e111a;border:1px solid #1a2035;border-radius:10px;padding:14px 18px;}
        .tog{padding:6px 13px;border-radius:20px;font-size:11px;cursor:pointer;border:1px solid #1a2035;background:transparent;color:#5a6580;font-family:'IBM Plex Mono',monospace;transition:all .15s;}.tog.on{background:#ff6200;color:#fff;border-color:#ff6200;}
        .ptt{display:flex;border:1px solid #1a2035;border-radius:6px;overflow:hidden;}.pto{flex:1;padding:7px 8px;text-align:center;font-size:11px;cursor:pointer;border:none;background:transparent;color:#5a6580;font-family:'IBM Plex Mono',monospace;transition:all .15s;}.pto.on{background:#1e2a40;color:#ff6200;}
        .toast{position:fixed;bottom:20px;right:20px;padding:10px 18px;border-radius:8px;font-size:12px;z-index:999;animation:pop .2s ease;}.tok{background:#00d68f;color:#08090d;}.twarn{background:#ff4466;color:#fff;}
        @keyframes pop{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:translateY(0);}}
        .spin{display:inline-block;animation:spin .7s linear infinite;}@keyframes spin{from{transform:rotate(0deg);}to{transform:rotate(360deg);}}
        .pulse{animation:pulse 1.5s ease-in-out infinite;}@keyframes pulse{0%,100%{opacity:1;}50%{opacity:.4;}}
        hr{border:none;border-top:1px solid #1a2035;margin:12px 0;}
        .overlay{position:fixed;inset:0;background:#000000bb;z-index:998;display:flex;align-items:center;justify-content:center;}.modal{background:#0e111a;border:1px solid #ff446660;border-radius:12px;padding:24px;max-width:360px;width:90%;}
      `}</style>

      {confirmDelete&&(<div className="overlay" onClick={()=>setConfirmDelete(null)}><div className="modal" onClick={e=>e.stopPropagation()}><div style={{fontSize:10,letterSpacing:2.5,color:"#ff4466",marginBottom:12}}>CONFIRMAR ELIMINACIÓN</div><div style={{fontSize:14,marginBottom:4}}>{confirmDelete.desc}</div><div style={{fontSize:12,color:C.muted,marginBottom:20}}>{fmt(confirmDelete.amount)} · {confirmDelete.date}</div><div style={{fontSize:11,color:C.muted,marginBottom:20,lineHeight:1.6}}>Se borrará de la app <strong style={{color:C.text}}>y de tu Google Sheet</strong>.</div><div style={{display:"flex",gap:8}}><button className="btn btn-danger" style={{flex:1}} onClick={doDelete}>Sí, eliminar</button><button className="btn btn-g" onClick={()=>setConfirmDelete(null)}>Cancelar</button></div></div></div>)}

      <div style={{maxWidth:700,margin:"0 auto",padding:"28px 20px 0"}}>
        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:20}}>
          <div><div style={{fontSize:10,letterSpacing:3,color:C.orange,marginBottom:4}}>DISCOVER · TRACKER</div><div style={{fontFamily:"'Syne',sans-serif",fontSize:28,fontWeight:900,letterSpacing:-1}}>Control de Gastos</div></div>
          <div style={{display:"flex",gap:8,alignItems:"center",marginTop:10}}>{syncing&&<span style={{fontSize:11,color:C.muted}} className="pulse">⟳ Guardando...</span>}<button className="btn btn-g btn-sm" onClick={loadSheet} disabled={loading}>{loading?<span className="spin">⟳</span>:"⟳"} Sincronizar</button></div>
        </div>

        <div style={{background:"#0a1520",border:"1px solid #0d2035",borderRadius:8,padding:"8px 14px",marginBottom:16,display:"flex",alignItems:"center",gap:8,fontSize:11}}>
          <span style={{color:statusDot,fontSize:8}}>●</span><span style={{color:C.muted}}>Budget Personal</span><span style={{color:C.muted}}>→</span><span style={{color:C.purple}}>Credit card</span>
          <span style={{marginLeft:"auto",color:statusDot,fontSize:10}}>{status==="ok"?"Conectado":status==="error"?"Sin conexión":"..."}</span>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:20}}>
          <div className="stat"><div style={{fontSize:9,letterSpacing:2.5,color:C.muted,marginBottom:5}}>DEBO A TARJETA</div><div style={{fontFamily:"'Syne',sans-serif",fontSize:21,fontWeight:800,color:C.orange}}>{fmt(totalCard)}</div><div style={{fontSize:10,color:C.muted,marginTop:4}}>pendiente</div></div>
          <div className="stat"><div style={{fontSize:9,letterSpacing:2.5,color:C.muted,marginBottom:5}}>ME DEBEN</div><div style={{fontFamily:"'Syne',sans-serif",fontSize:21,fontWeight:800,color:C.purple}}>{fmt(totalOwed)}</div><div style={{fontSize:10,color:C.muted,marginTop:4}}>de compartidos</div></div>
          <div className="stat"><div style={{fontSize:9,letterSpacing:2.5,color:C.muted,marginBottom:5}}>MI COSTO NETO</div><div style={{fontFamily:"'Syne',sans-serif",fontSize:21,fontWeight:800,color:C.green}}>{fmt(netPending)}</div><div style={{fontSize:10,color:C.muted,marginTop:4}}>real</div></div>
        </div>

        <div style={{display:"flex",gap:6,marginBottom:20}}>{[["list","📋 Gastos"],["calc","÷ Dividir"]].map(([v,l])=>(<button key={v} className={`tab ${tab===v?"on":""}`} onClick={()=>setTab(v)}>{l}</button>))}</div>

        {tab==="list"&&<>
          <div style={{background:C.card,border:`1px solid ${editId?"#ff620050":C.border}`,borderRadius:10,padding:18,marginBottom:18}}>
            <div style={{fontSize:10,letterSpacing:2.5,color:editId?C.orange:C.muted,marginBottom:12}}>{editId?"✏️  EDITANDO":"+ NUEVO GASTO"}</div>
            <form onSubmit={submitForm}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 120px",gap:8,marginBottom:8}}>
                <input ref={descRef} className="inp" placeholder="Descripción" value={form.desc} onChange={e=>setForm(f=>({...f,desc:e.target.value}))} required/>
                <input className="inp" type="number" placeholder="$ Total" value={form.amount} min="0.01" step="0.01" onChange={e=>setForm(f=>({...f,amount:e.target.value}))} required/>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 150px",gap:8,marginBottom:12}}>
                <select className="inp sel" value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))}>{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select>
                <input className="inp" type="date" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))}/>
              </div>
              <div style={{background:"#080b12",border:"1px solid #1a2035",borderRadius:8,padding:"12px 14px",marginBottom:12}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                  <div><span style={{fontSize:10,letterSpacing:2,color:C.purple}}>ME DEBEN </span><span style={{fontSize:10,color:C.muted}}>(el total va a la tarjeta)</span></div>
                  <button type="button" className="btn btn-g btn-sm" onClick={addPerson}>+ persona</button>
                </div>
                {form.owed.length===0&&<div style={{fontSize:11,color:C.muted}}>Nadie te debe en este gasto.</div>}
                {form.owed.map((p,i)=>(<div key={i} style={{display:"flex",gap:6,alignItems:"center",marginTop:6}}>
                  <input className="inp" placeholder="Nombre" value={p.name} onChange={e=>updatePerson(i,"name",e.target.value)} style={{flex:2}}/>
                  <div className="ptt" style={{flexShrink:0}}><button type="button" className={`pto ${p.type==="fixed"?"on":""}`} onClick={()=>updatePerson(i,"type","fixed")}>$</button><button type="button" className={`pto ${p.type==="pct"?"on":""}`} onClick={()=>updatePerson(i,"type","pct")}>%</button></div>
                  <input className="inp" type="number" min="0" step="0.01" placeholder={p.type==="pct"?"50":"25.00"} value={p.value} onChange={e=>updatePerson(i,"value",e.target.value)} style={{flex:1}}/>
                  <button type="button" className="btn btn-g btn-sm" style={{color:"#ff4466",borderColor:"#ff446630",padding:"5px 8px"}} onClick={()=>removePerson(i)}>✕</button>
                </div>))}
                {form.owed.length>0&&form.amount&&(<div style={{marginTop:10,display:"flex",gap:20,fontSize:11}}><span style={{color:C.muted}}>Cobras: <span style={{color:C.purple}}>{fmt(owedTotalFromForm())}</span></span><span style={{color:C.muted}}>Tu parte: <span style={{color:C.green}}>{fmt(Math.max(0,parseFloat(form.amount)-owedTotalFromForm()))}</span></span></div>)}
              </div>
              <div style={{display:"flex",gap:8}}>
                <button type="submit" className="btn btn-p" style={{flex:1}} disabled={syncing}>{syncing?"Guardando...":editId?"Guardar cambios":"Agregar y guardar en Sheet"}</button>
                {editId&&<button type="button" className="btn btn-g" onClick={cancelEdit}>Cancelar</button>}
              </div>
            </form>
          </div>

          <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:12}}>
            <span style={{fontSize:10,color:C.muted,letterSpacing:1}}>VER:</span>
            {[["all","Todos"],["pending","Pendientes"],["added","Ingresados"]].map(([v,l])=>(<button key={v} className={`tog ${filter===v?"on":""}`} onClick={()=>setFilter(v)}>{l}</button>))}
            <span style={{marginLeft:"auto",fontSize:10,color:C.muted}}>{filtered.length} gastos</span>
          </div>

          {loading?(<div style={{textAlign:"center",padding:"30px 0",color:C.muted,fontSize:12}}><span className="spin" style={{fontSize:20,display:"block",marginBottom:8}}>⟳</span>Cargando desde Google Sheets...</div>):<>
            {filtered.length===0&&<div style={{textAlign:"center",padding:"40px 0",color:"#2a3550",fontSize:12}}>{expenses.length===0?"Presiona Sincronizar para cargar tus gastos.":"Sin gastos aquí."}</div>}
            {filtered.map(ex=>{const owedAmt=owedForExp(ex);return(
              <div key={ex.id} className={`row ${ex.added?"dim":""}`}>
                <div className={`chk ${ex.added?"on":""}`} onClick={()=>toggleAdded(ex.id)}>{ex.added&&<span style={{fontSize:12,color:"#08090d"}}>✓</span>}</div>
                <span style={{fontSize:18,flexShrink:0}}>{ex.category.split(" ")[0]}</span>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ex.desc}</div>
                  <div style={{fontSize:10,color:C.muted,marginTop:3,display:"flex",flexWrap:"wrap",gap:6}}><span>{ex.date}</span>{(ex.owed||[]).map((p,i)=>(<span key={i} style={{color:C.purple}}>{p.name}: {p.type==="pct"?`${p.value}%`:fmt(p.value)}</span>))}</div>
                </div>
                <div style={{textAlign:"right",flexShrink:0}}>
                  <div style={{fontSize:14,fontWeight:500}}>{fmt(ex.amount)}</div>
                  {owedAmt>0&&<div style={{fontSize:10,color:C.purple}}>cobras {fmt(owedAmt)}</div>}
                  {owedAmt>0&&<div style={{fontSize:10,color:C.green}}>neto {fmt(ex.amount-owedAmt)}</div>}
                </div>
                <span style={{fontSize:9,padding:"2px 7px",borderRadius:4,flexShrink:0,border:`1px solid ${ex.added?"#00d68f40":"#ff620040"}`,color:ex.added?C.green:C.orange,background:ex.added?"#00d68f10":"#ff620010"}}>{ex.added?"✓ ingresado":"○ pendiente"}</span>
                <div style={{display:"flex",gap:4,flexShrink:0}}>
                  <button className="btn btn-g btn-sm" onClick={()=>startEdit(ex)}>✏️</button>
                  <button className="btn btn-g btn-sm" style={{color:"#ff4466",borderColor:"#ff446630"}} onClick={()=>setConfirmDelete(ex)}>🗑</button>
                </div>
              </div>);})}
            {expenses.some(e=>!e.added)&&(<button className="btn btn-g" style={{width:"100%",marginTop:12,borderStyle:"dashed",fontSize:11}} onClick={()=>{setExpenses(ex=>ex.map(e=>({...e,added:true})));showToast("Todos marcados ✓");}}>Marcar todos como ingresados ({fmt(totalCard)})</button>)}
          </>}
        </>}

        {tab==="calc"&&(
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:20}}>
            <div style={{fontSize:10,letterSpacing:2.5,color:C.muted,marginBottom:16}}>CALCULADORA DE DIVISIÓN</div>
            <div style={{fontSize:11,color:C.muted,marginBottom:16}}>El total siempre va a tu tarjeta. Aquí calculas cuánto te debe cada quien.</div>
            <div style={{display:"flex",gap:8,marginBottom:20}}>{[["equal","Partes iguales"],["custom","Montos específicos"]].map(([v,l])=>(<button key={v} className={`btn ${calcInput.mode===v?"btn-p":"btn-g"}`} onClick={()=>setCalcInput(c=>({...c,mode:v}))}>{l}</button>))}</div>
            {calcInput.mode==="equal"&&<>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:16}}>
                <div><div style={{fontSize:10,color:C.muted,marginBottom:4}}>TOTAL DEL GASTO</div><input className="inp" type="number" placeholder="0.00" value={calcInput.total} onChange={e=>setCalcInput(c=>({...c,total:e.target.value}))}/></div>
                <div><div style={{fontSize:10,color:C.muted,marginBottom:4}}>ENTRE CUÁNTAS PERSONAS</div><input className="inp" type="number" min="2" max="20" value={calcInput.people} onChange={e=>setCalcInput(c=>({...c,people:e.target.value}))}/></div>
              </div>
              {calcInput.total&&<><hr/><div style={{fontSize:11,color:C.muted,marginBottom:10}}>Tú pagas <strong style={{color:C.text}}>{fmt(calcInput.total)}</strong> a Discover. Los demás te deben:</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>{calcEqual().map((r,i)=>(<div key={i} style={{background:"#080b12",border:"1px solid #1a2035",borderRadius:8,padding:"10px 14px",display:"flex",justifyContent:"space-between",alignItems:"center"}}><span style={{color:C.muted,fontSize:12}}>{r.name}</span><span style={{color:i===0?C.green:C.purple,fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:16}}>{fmt(r.amount)}</span></div>))}</div>
              <div style={{marginTop:14,textAlign:"right"}}><button className="btn btn-p" onClick={()=>{const n=parseInt(calcInput.people)||2;const share=(parseFloat(calcInput.total)/n).toFixed(2);setTab("list");setForm({...EMPTY_FORM,amount:calcInput.total,owed:Array.from({length:n-1},(_,i)=>({name:`Persona ${i+2}`,type:"fixed",value:share}))});}}>Crear gasto con esto →</button></div></>}
            </>}
            {calcInput.mode==="custom"&&<>
              <div style={{fontSize:11,color:C.muted,marginBottom:12}}>Ingresa cuánto te debe cada persona.</div>
              {calcInput.rows.map((r,i)=>(<div key={i} style={{display:"flex",gap:8,marginBottom:6}}><input className="inp" placeholder={`Persona ${i+1}`} value={r.name} onChange={e=>setCalcInput(c=>({...c,rows:c.rows.map((rr,j)=>j===i?{...rr,name:e.target.value}:rr)}))}/><input className="inp" type="number" placeholder="$ monto" value={r.amount} onChange={e=>setCalcInput(c=>({...c,rows:c.rows.map((rr,j)=>j===i?{...rr,amount:e.target.value}:rr)}))} style={{maxWidth:120}}/>{calcInput.rows.length>2&&(<button className="btn btn-g btn-sm" style={{color:"#ff4466"}} onClick={()=>setCalcInput(c=>({...c,rows:c.rows.filter((_,j)=>j!==i)}))}>✕</button>)}</div>))}
              <button className="btn btn-g btn-sm" style={{marginTop:4}} onClick={()=>setCalcInput(c=>({...c,rows:[...c.rows,{name:"",amount:""}]}))}>+ persona</button>
              {calcInput.rows.some(r=>r.amount)&&<><hr/><div style={{display:"flex",justifyContent:"space-between",fontSize:13,marginTop:8}}><span style={{color:C.muted}}>Total que te deben:</span><span style={{color:C.purple,fontWeight:500}}>{fmt(calcInput.rows.reduce((s,r)=>s+(parseFloat(r.amount)||0),0))}</span></div></>}
            </>}
          </div>
        )}
      </div>
      {toast&&<div className={`toast ${toast.type==="warn"?"twarn":"tok"}`}>{toast.msg}</div>}
    </div>
  );
}
