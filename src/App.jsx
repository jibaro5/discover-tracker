import { useState, useEffect, useRef } from "react";

const SCRIPT_URL = "/api/sheet";
const EMPTY_FORM = { desc: "", amount: "", date: new Date().toISOString().slice(0,10), owed: [] };

function today() { return new Date().toISOString().slice(0,10); }
function fmt(n) { return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(n||0); }
function parseAmt(s) { return parseFloat(String(s).replace(/[$,]/g,""))||0; }

function calcOwedAmt(p, totalAmount) {
  if (p.type === "pct") return (totalAmount * (parseFloat(p.value) || 0)) / 100;
  return parseFloat(p.value) || 0;
}

async function sheetRead() {
  const res = await fetch(`${SCRIPT_URL}?action=read`);
  const data = await res.json();
  return data.expenses || [];
}

async function sheetAppend(expense) {
  const owedStr = (expense.owed||[]).map(p => {
    const amt = calcOwedAmt(p, expense.amount).toFixed(2);
    return p.name ? `${p.name}: $${amt}` : `$${amt}`;
  }).join(", ");
  await fetch(SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action:"append", desc:expense.desc, amount:expense.amount, date:expense.date, owed:owedStr }),
  });
}

async function sheetUpdateStatus(expense) {
  await fetch(SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "update",
      id: String(expense.sheetId),
      desc: expense.desc,
      date: expense.date,
      amount: String(expense.amount),
      added: String(expense.added),
      paid: String(expense.paid),
    }),
  });
}

async function sheetDelete(expense) {
  await fetch(SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action:"delete", id:String(expense.sheetId), desc:expense.desc, date:expense.date, amount:String(expense.amount) }),
  });
}

function parseOwedStr(s) {
  if (!s || s.trim() === "") return [];
  return s.split(",").map(part => {
    part = part.trim();
    if (!part) return null;
    const colonIdx = part.lastIndexOf(":");
    if (colonIdx > -1) {
      const name = part.slice(0, colonIdx).trim();
      const val = part.slice(colonIdx + 1).replace(/[$\s]/g, "").trim();
      return { name, type: "fixed", value: val };
    }
    const val = part.replace(/[$\s]/g, "");
    return { name: "", type: "fixed", value: val };
  }).filter(Boolean);
}

function owedForExp(ex) {
  return (ex.owed||[]).reduce((s,p) => s + (parseFloat(p.value)||0), 0);
}

export default function App() {
  const [expenses, setExpenses] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editId, setEditId] = useState(null);
  const [filter, setFilter] = useState("pending");
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [status, setStatus] = useState("idle");
  const [toast, setToast] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const descRef = useRef();

  useEffect(() => { loadSheet(); }, []);

  async function loadSheet() {
    setLoading(true); setStatus("idle");
    try {
      const rows = await sheetRead();
      const normalized = rows.map((e,i) => ({
        id: e.id || String(Date.now()+i),
        sheetId: e.id,
        desc: e.desc||"",
        amount: parseAmt(e.amount),
        date: e.date||today(),
        owed: typeof e.owed==="string" ? parseOwedStr(e.owed) : (e.owed||[]),
        added: e.added===true||e.added==="SI",
        paid: e.paid===true||e.paid==="SI",
      }));
      setExpenses(normalized);
      setStatus("ok");
      showToast(`${normalized.length} gastos cargados`);
    } catch {
      setStatus("error");
      showToast("No se pudo conectar al Sheet","warn");
    }
    setLoading(false);
  }

  function showToast(msg, type="ok") {
    setToast({msg,type});
    setTimeout(()=>setToast(null), 2500);
  }

  function owedTotalFromForm() {
    const base = parseFloat(form.amount)||0;
    return form.owed.reduce((s,p) => s + calcOwedAmt(p, base), 0);
  }

  function addPerson() { setForm(f=>({...f, owed:[...f.owed,{name:"",type:"fixed",value:""}]})); }
  function removePerson(i) { setForm(f=>({...f, owed:f.owed.filter((_,j)=>j!==i)})); }
  function updatePerson(i,k,v) { setForm(f=>({...f, owed:f.owed.map((p,j)=>j===i?{...p,[k]:v}:p)})); }

  async function submitForm(e) {
    e.preventDefault();
    if (!form.desc.trim()||!form.amount) return;
    const base = parseFloat(form.amount);
    const convertedOwed = form.owed
      .filter(p => p.value)
      .map(p => ({
        name: p.name || "",
        type: "fixed",
        value: String(calcOwedAmt(p, base).toFixed(2)),
      }));

    const expense = {
      id: editId ?? Date.now(),
      sheetId: editId ? (expenses.find(x=>x.id===editId)?.sheetId) : null,
      desc: form.desc, amount: base, date: form.date,
      owed: convertedOwed,
      added: editId ? (expenses.find(x=>x.id===editId)?.added??false) : false,
      paid: editId ? (expenses.find(x=>x.id===editId)?.paid??false) : false,
    };

    if (editId) {
      setExpenses(ex=>ex.map(x=>x.id===editId?expense:x));
      setEditId(null);
      showToast("Gasto actualizado");
    } else {
      setExpenses(ex=>[expense,...ex]);
      setSyncing(true);
      try { await sheetAppend(expense); showToast("Guardado en Sheet"); }
      catch { showToast("Error al guardar","warn"); }
      setSyncing(false);
    }
    setForm(EMPTY_FORM);
    descRef.current?.focus();
  }

  async function toggleField(id, field) {
    const updated = expenses.map(x=>x.id===id?{...x,[field]:!x[field]}:x);
    setExpenses(updated);
    const exp = updated.find(x=>x.id===id);
    setSyncing(true);
    try { await sheetUpdateStatus(exp); }
    catch(err) { console.error("Update error:", err); }
    setSyncing(false);
  }

  async function doDelete() {
    const ex = confirmDelete;
    setConfirmDelete(null);
    setExpenses(prev=>prev.filter(x=>x.id!==ex.id));
    setSyncing(true);
    try { await sheetDelete(ex); showToast("Eliminado"); }
    catch { showToast("Error al eliminar","warn"); }
    setSyncing(false);
  }

  function startEdit(ex) {
    setEditId(ex.id);
    setForm({desc:ex.desc, amount:String(ex.amount), date:ex.date, owed:ex.owed||[]});
    window.scrollTo({top:0, behavior:"smooth"});
    setTimeout(()=>descRef.current?.focus(),50);
  }
  function cancelEdit() { setEditId(null); setForm(EMPTY_FORM); }

  const filtered = expenses.filter(ex =>
    filter==="pending" ? !ex.added : filter==="added" ? ex.added : true
  );

  const pending = expenses.filter(e=>!e.added);
  const totalCard = pending.reduce((s,e)=>s+e.amount,0);
  const totalOwed = expenses.filter(e=>!e.paid).reduce((s,e)=>s+owedForExp(e),0);
  const netPending = pending.reduce((s,e)=>s+(e.amount-owedForExp(e)),0);
  const statusDot = status==="ok"?"#059669":status==="error"?"#dc2626":"#94a3b8";

  return (
    <div style={{minHeight:"100vh",background:"#f8fafc",fontFamily:"'DM Sans','Helvetica Neue',sans-serif",color:"#0f172a"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=Playfair+Display:wght@700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        input{outline:none;}
        input:focus{border-color:#0f4c81!important;box-shadow:0 0 0 3px rgba(15,76,129,0.1);}
        .inp{background:#fff;border:1.5px solid #e2e8f0;color:#0f172a;padding:10px 14px;border-radius:8px;font-family:'DM Sans',sans-serif;font-size:14px;width:100%;transition:border .15s,box-shadow .15s;}
        .btn{cursor:pointer;border:none;font-family:'DM Sans',sans-serif;font-size:13px;border-radius:8px;padding:9px 16px;transition:all .15s;font-weight:500;}
        .btn:hover:not(:disabled){filter:brightness(.95);transform:translateY(-1px);}
        .btn:active{transform:translateY(0);}
        .btn:disabled{opacity:.5;cursor:default;}
        .btn-primary{background:#0f4c81;color:#fff;}
        .btn-ghost{background:transparent;color:#64748b;border:1.5px solid #e2e8f0;}
        .btn-ghost:hover:not(:disabled){border-color:#cbd5e1;color:#0f172a;}
        .btn-danger{background:#fee2e2;color:#dc2626;border:none;}
        .btn-sm{padding:6px 12px;font-size:12px;}
        .tog{padding:7px 16px;border-radius:20px;font-size:12px;cursor:pointer;border:1.5px solid #e2e8f0;background:#fff;color:#64748b;font-family:'DM Sans',sans-serif;font-weight:500;transition:all .15s;}
        .tog.on{background:#0f4c81;color:#fff;border-color:#0f4c81;}
        .ptt{display:flex;border:1.5px solid #e2e8f0;border-radius:8px;overflow:hidden;background:#fff;}
        .pto{flex:1;padding:8px;text-align:center;font-size:13px;cursor:pointer;border:none;background:transparent;color:#64748b;font-family:'DM Sans',sans-serif;font-weight:500;transition:all .15s;}
        .pto.on{background:#0f4c81;color:#fff;}
        .row{display:flex;align-items:flex-start;gap:10px;padding:14px 16px;border-radius:10px;border:1.5px solid #e2e8f0;background:#fff;margin-bottom:8px;transition:all .2s;box-shadow:0 1px 3px rgba(0,0,0,.04);}
        .row:hover{border-color:#cbd5e1;box-shadow:0 2px 8px rgba(0,0,0,.07);}
        .row.dim{opacity:.4;}
        .chk{width:22px;height:22px;border-radius:6px;border:2px solid #cbd5e1;background:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .15s;}
        .chk:hover{border-color:#94a3b8;}
        .chk.blue.on{background:#0f4c81;border-color:#0f4c81;}
        .chk.green.on{background:#059669;border-color:#059669;}
        .toast{position:fixed;bottom:24px;right:24px;padding:12px 20px;border-radius:10px;font-size:13px;z-index:999;animation:pop .2s ease;font-weight:500;box-shadow:0 4px 16px rgba(0,0,0,.12);}
        .tok{background:#059669;color:#fff;}
        .twarn{background:#dc2626;color:#fff;}
        @keyframes pop{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:translateY(0);}}
        .spin{display:inline-block;animation:spin .7s linear infinite;}
        @keyframes spin{from{transform:rotate(0deg);}to{transform:rotate(360deg);}}
        .pulse{animation:pulse 1.5s ease-in-out infinite;}
        @keyframes pulse{0%,100%{opacity:1;}50%{opacity:.4;}}
        .overlay{position:fixed;inset:0;background:rgba(15,23,42,.4);z-index:998;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);}
        .modal{background:#fff;border-radius:16px;padding:28px;max-width:380px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,.15);}
        .card{background:#fff;border:1.5px solid #e2e8f0;border-radius:12px;padding:20px;box-shadow:0 1px 4px rgba(0,0,0,.05);}
        @media(max-width:640px){.stats-grid{grid-template-columns:1fr 1fr!important;}.form-row{grid-template-columns:1fr!important;}}
      `}</style>

      {confirmDelete && (
        <div className="overlay" onClick={()=>setConfirmDelete(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:11,letterSpacing:2,color:"#dc2626",marginBottom:12,fontWeight:600}}>CONFIRMAR ELIMINACIÓN</div>
            <div style={{fontSize:15,marginBottom:4,fontWeight:500}}>{confirmDelete.desc}</div>
            <div style={{fontSize:13,color:"#64748b",marginBottom:20}}>{fmt(confirmDelete.amount)} · {confirmDelete.date}</div>
            <div style={{display:"flex",gap:8}}>
              <button className="btn btn-danger" style={{flex:1,padding:"10px"}} onClick={doDelete}>Sí, eliminar</button>
              <button className="btn btn-ghost" onClick={()=>setConfirmDelete(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      <div style={{background:"#fff",borderBottom:"1.5px solid #e2e8f0",padding:"0 24px",position:"sticky",top:0,zIndex:100}}>
        <div style={{maxWidth:720,margin:"0 auto",display:"flex",alignItems:"center",justifyContent:"space-between",height:60}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:34,height:34,background:"#0f4c81",borderRadius:9,display:"flex",alignItems:"center",justifyContent:"center"}}>
              <span style={{color:"#fff",fontSize:17}}>◈</span>
            </div>
            <div>
              <div style={{fontFamily:"'Playfair Display',serif",fontSize:18,fontWeight:700,letterSpacing:-.3}}>Discover</div>
              <div style={{fontSize:9,color:"#94a3b8",letterSpacing:1.5,marginTop:-2}}>CONTROL DE GASTOS</div>
            </div>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            {syncing && <span style={{fontSize:11,color:"#94a3b8"}} className="pulse">Guardando...</span>}
            <div style={{display:"flex",alignItems:"center",gap:5,fontSize:11,color:"#64748b"}}>
              <span style={{width:7,height:7,borderRadius:"50%",background:statusDot,display:"inline-block"}}></span>
              Sheet
            </div>
            <button className="btn btn-ghost btn-sm" onClick={loadSheet} disabled={loading}>
              {loading?<span className="spin">⟳</span>:"⟳"} Sync
            </button>
          </div>
        </div>
      </div>

      <div style={{maxWidth:720,margin:"0 auto",padding:"24px 20px 60px"}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:24}} className="stats-grid">
          <div className="card">
            <div style={{fontSize:9,letterSpacing:2,color:"#94a3b8",marginBottom:6,fontWeight:600}}>A TARJETA</div>
            <div style={{fontFamily:"'Playfair Display',serif",fontSize:22,fontWeight:700,color:"#0f4c81"}}>{fmt(totalCard)}</div>
            <div style={{fontSize:11,color:"#94a3b8",marginTop:4}}>por ingresar</div>
          </div>
          <div className="card">
            <div style={{fontSize:9,letterSpacing:2,color:"#94a3b8",marginBottom:6,fontWeight:600}}>ME DEBEN</div>
            <div style={{fontFamily:"'Playfair Display',serif",fontSize:22,fontWeight:700,color:"#b45309"}}>{fmt(totalOwed)}</div>
            <div style={{fontSize:11,color:"#94a3b8",marginTop:4}}>sin cobrar</div>
          </div>
          <div className="card">
            <div style={{fontSize:9,letterSpacing:2,color:"#94a3b8",marginBottom:6,fontWeight:600}}>COSTO NETO</div>
            <div style={{fontFamily:"'Playfair Display',serif",fontSize:22,fontWeight:700,color:"#059669"}}>{fmt(netPending)}</div>
            <div style={{fontSize:11,color:"#94a3b8",marginTop:4}}>real tuyo</div>
          </div>
        </div>

        <div className="card" style={{marginBottom:20,border:editId?"1.5px solid #0f4c81":"1.5px solid #e2e8f0"}}>
          <div style={{fontSize:10,letterSpacing:2,color:editId?"#0f4c81":"#94a3b8",marginBottom:14,fontWeight:600}}>
            {editId?"✏️  EDITANDO GASTO":"+ NUEVO GASTO"}
          </div>
          <form onSubmit={submitForm}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 120px",gap:10,marginBottom:10}} className="form-row">
              <input ref={descRef} className="inp" placeholder="Descripción" value={form.desc}
                onChange={e=>setForm(f=>({...f,desc:e.target.value}))} required />
              <input className="inp" type="number" placeholder="$ Total" value={form.amount}
                min="0.01" step="0.01" onChange={e=>setForm(f=>({...f,amount:e.target.value}))} required />
            </div>
            <div style={{marginBottom:14}}>
              <input className="inp" type="date" value={form.date}
                onChange={e=>setForm(f=>({...f,date:e.target.value}))} />
            </div>

            <div style={{background:"#fffbeb",border:"1.5px solid #fde68a",borderRadius:10,padding:"14px 16px",marginBottom:14}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                <span style={{fontSize:11,letterSpacing:1.5,color:"#b45309",fontWeight:600}}>ME DEBEN</span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={addPerson}>+ agregar</button>
              </div>
              {form.owed.length===0 && (
                <div style={{fontSize:12,color:"#92400e",opacity:.6}}>Nadie te debe en este gasto.</div>
              )}
              {form.owed.map((p,i)=>(
                <div key={i} style={{display:"flex",gap:8,alignItems:"center",marginTop:8}}>
                  <input className="inp" placeholder="Nombre (opcional)" value={p.name}
                    onChange={e=>updatePerson(i,"name",e.target.value)} style={{flex:2}} />
                  <div className="ptt" style={{flexShrink:0,width:80}}>
                    <button type="button" className={`pto ${p.type==="fixed"?"on":""}`}
                      onClick={()=>updatePerson(i,"type","fixed")}>$</button>
                    <button type="button" className={`pto ${p.type==="pct"?"on":""}`}
                      onClick={()=>updatePerson(i,"type","pct")}>%</button>
                  </div>
                  <input className="inp" type="number" min="0" step="0.01"
                    placeholder={p.type==="pct"?"50":"25.00"} value={p.value}
                    onChange={e=>updatePerson(i,"value",e.target.value)} style={{flex:1}} />
                  <button type="button" className="btn btn-danger btn-sm"
                    style={{padding:"6px 10px"}} onClick={()=>removePerson(i)}>✕</button>
                </div>
              ))}
              {form.owed.length>0 && form.amount && (
                <div style={{marginTop:12,display:"flex",gap:20,fontSize:12,paddingTop:8,borderTop:"1px solid #fde68a"}}>
                  <span style={{color:"#92400e"}}>Cobras: <strong style={{color:"#b45309"}}>{fmt(owedTotalFromForm())}</strong></span>
                  <span style={{color:"#92400e"}}>Tu parte: <strong style={{color:"#059669"}}>{fmt(Math.max(0,(parseFloat(form.amount)||0)-owedTotalFromForm()))}</strong></span>
                </div>
              )}
            </div>

            <div style={{display:"flex",gap:8}}>
              <button type="submit" className="btn btn-primary" style={{flex:1,padding:"11px"}} disabled={syncing}>
                {syncing?"Guardando...":editId?"Guardar cambios":"Agregar gasto"}
              </button>
              {editId && <button type="button" className="btn btn-ghost" onClick={cancelEdit}>Cancelar</button>}
            </div>
          </form>
        </div>

        <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:12}}>
          <span style={{fontSize:11,color:"#94a3b8",letterSpacing:1,fontWeight:600}}>VER:</span>
          {[["all","Todos"],["pending","Pendientes"],["added","Ingresados"]].map(([v,l])=>(
            <button key={v} className={`tog ${filter===v?"on":""}`} onClick={()=>setFilter(v)}>{l}</button>
          ))}
          <span style={{marginLeft:"auto",fontSize:11,color:"#94a3b8"}}>{filtered.length} gastos</span>
        </div>

        <div style={{display:"flex",gap:16,marginBottom:14,fontSize:11,color:"#94a3b8"}}>
          <div style={{display:"flex",alignItems:"center",gap:5}}>
            <div style={{width:16,height:16,borderRadius:4,background:"#0f4c81",display:"flex",alignItems:"center",justifyContent:"center"}}>
              <span style={{color:"#fff",fontSize:10,fontWeight:700}}>✓</span>
            </div>
            Ingresado
          </div>
          <div style={{display:"flex",alignItems:"center",gap:5}}>
            <div style={{width:16,height:16,borderRadius:4,background:"#059669",display:"flex",alignItems:"center",justifyContent:"center"}}>
              <span style={{color:"#fff",fontSize:10,fontWeight:700}}>✓</span>
            </div>
            Me pagaron
          </div>
        </div>

        {loading ? (
          <div style={{textAlign:"center",padding:"50px 0",color:"#94a3b8",fontSize:13}}>
            <span className="spin" style={{fontSize:22,display:"block",marginBottom:10}}>⟳</span>
            Cargando desde Google Sheets...
          </div>
        ) : <>
          {filtered.length===0 && (
            <div style={{textAlign:"center",padding:"50px 0",color:"#cbd5e1",fontSize:13}}>
              {expenses.length===0?"Presiona Sync para cargar tus gastos.":"Sin gastos aquí."}
            </div>
          )}
          {filtered.map(ex => {
            const owedAmt = owedForExp(ex);
            const hasOwed = owedAmt > 0;
            const fullyDone = ex.added && (!hasOwed || ex.paid);
            return (
              <div key={ex.id} className={`row ${fullyDone?"dim":""}`}>
                <div style={{display:"flex",flexDirection:"column",gap:6,flexShrink:0,paddingTop:2}}>
                  <div className={`chk blue ${ex.added?"on":""}`} onClick={()=>toggleField(ex.id,"added")} title="Ingresado" />
                  {hasOwed && (
                    <div className={`chk green ${ex.paid?"on":""}`} onClick={()=>toggleField(ex.id,"paid")} title="Me pagaron">
                      {ex.paid && <span style={{fontSize:12,color:"#fff",fontWeight:700}}>✓</span>}
                    </div>
                  )}
                </div>

                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:14,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ex.desc}</div>
                  <div style={{fontSize:11,color:"#94a3b8",marginTop:3,display:"flex",flexWrap:"wrap",gap:6,alignItems:"center"}}>
                    <span>{ex.date}</span>
                    {hasOwed && !ex.paid && (
                      <span style={{color:"#b45309",fontWeight:500,background:"#fffbeb",padding:"1px 7px",borderRadius:4,border:"1px solid #fde68a"}}>
                        {(ex.owed||[]).map(p=>p.name||"Alguien").join(", ")} debe {fmt(owedAmt)}
                      </span>
                    )}
                    {hasOwed && ex.paid && (
                      <span style={{color:"#059669",fontWeight:500,background:"#f0fdf4",padding:"1px 7px",borderRadius:4,border:"1px solid #bbf7d0"}}>
                        Cobrado {fmt(owedAmt)}
                      </span>
                    )}
                  </div>
                </div>

                <div style={{textAlign:"right",flexShrink:0}}>
                  <div style={{fontSize:15,fontWeight:600}}>{fmt(ex.amount)}</div>
                  {hasOwed && !ex.paid && <div style={{fontSize:11,color:"#b45309"}}>cobras {fmt(owedAmt)}</div>}
                  {hasOwed && <div style={{fontSize:11,color:"#059669"}}>neto {fmt(ex.amount-owedAmt)}</div>}
                </div>

                <div style={{display:"flex",flexDirection:"column",gap:4,flexShrink:0}}>
                  <span style={{fontSize:9,padding:"2px 7px",borderRadius:20,fontWeight:600,whiteSpace:"nowrap",
                    border:`1px solid ${ex.added?"#bfdbfe":"#e2e8f0"}`,
                    color:ex.added?"#0f4c81":"#94a3b8",
                    background:ex.added?"#eff6ff":"#f8fafc"}}>
                    {ex.added?"✓ ingresado":"○ pendiente"}
                  </span>
                  {hasOwed && (
                    <span style={{fontSize:9,padding:"2px 7px",borderRadius:20,fontWeight:600,whiteSpace:"nowrap",
                      border:`1px solid ${ex.paid?"#bbf7d0":"#fde68a"}`,
                      color:ex.paid?"#059669":"#b45309",
                      background:ex.paid?"#f0fdf4":"#fffbeb"}}>
                      {ex.paid?"✓ cobrado":"○ sin cobrar"}
                    </span>
                  )}
                </div>

                <div style={{display:"flex",flexDirection:"column",gap:4,flexShrink:0}}>
                  <button className="btn btn-ghost btn-sm" onClick={()=>startEdit(ex)}>✏️</button>
                  <button className="btn btn-danger btn-sm" onClick={()=>setConfirmDelete(ex)}>🗑</button>
                </div>
              </div>
            );
          })}

          {expenses.some(e=>!e.added) && (
            <button className="btn btn-ghost" style={{width:"100%",marginTop:14,borderStyle:"dashed",fontSize:12,padding:"12px"}}
              onClick={()=>setExpenses(ex=>ex.map(e=>({...e,added:true})))}>
              Marcar todos como ingresados ({fmt(totalCard)})
            </button>
          )}
        </>}
      </div>

      {toast && <div className={`toast ${toast.type==="warn"?"twarn":"tok"}`}>{toast.msg}</div>}
    </div>
  );
}
