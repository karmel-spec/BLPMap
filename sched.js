/* ================= NATIVE SCHEDULING DASHBOARD =================
 * The Shop Manager's Dashboard / Weekly Review / Planner / Week Schedule /
 * Sequence / Pipeline / Walk-the-Shop pages, ported verbatim from
 * BLPShop/manager.html into the Store Map (Brigham 8/29: the Shop App is
 * being sunset — no more iframes, no second sign-in). Everything lives in
 * this IIFE so the manager's own $/esc/CONFIG/PHASES never collide with
 * app.js. Exposes window.renderSchedNative(tab) + window.schedRerender. */
(function () {
'use strict';
let LANG = "en";
const I18N = {
  /* navigation + shell */
  nav_review:["Weekly Review","Revisión semanal"], nav_walk:["Walk-Around","Recorrido"],
  nav_week:["Week Board","Tablero semanal"], nav_sequence:["Sequence","Secuencia"],
  nav_pipeline:["Pipeline","Flujo de pianos"], nav_qc:["Quality Control","Control de calidad"],
  sign_out:["Sign out","Cerrar sesión"], open_app:["Open Shop Reports","Abrir Reportes del Taller"],
  nav_apps:["BLP Apps","Apps BLP"],
  loading:["Loading shop data…","Cargando datos del taller…"],
  wk_ending:["Week ending","Semana que termina"],
  connect_cal:["Connect Google Calendar","Conectar Google Calendar"],
  cal_connected:["Calendar connected","Calendario conectado"],

  /* weekly review */
  review_title:["Weekly Review","Revisión semanal"],
  review_sub:["Go technician by technician: read the Friday report, review the work, make sure next week is assigned. Nothing gets forgotten — the list stays red until everyone is done.","Técnico por técnico: lee el reporte del viernes, revisa el trabajo y asegúrate de asignar la próxima semana. Nada se olvida: la lista sigue en rojo hasta terminar con todos."],
  review_progress:["Weekly review: %1 of %2 technicians complete","Revisión semanal: %1 de %2 técnicos completados"],
  fr_all:["FRIDAY REPORTS — all %1 in 🎉","REPORTES DEL VIERNES — los %1 entregados 🎉"],
  fr_some:["FRIDAY REPORTS — %1 of %2 in","REPORTES DEL VIERNES — %1 de %2 entregados"],
  ck_report:["Report in","Reporte recibido"], ck_reviewed:["Reviewed","Revisado"], ck_assigned:["Week assigned","Semana asignada"],
  mark_reviewed:["Mark reviewed ✓","Marcar revisado ✓"], unmark:["Un-mark","Desmarcar"],
  this_week_report:["This week's report","Reporte de esta semana"], no_report:["No report submitted yet.","Aún no hay reporte."],
  carryovers:["Carry-overs & waiting items","Pendientes y en espera"],
  walk_notes_for:["Your walk-around notes on their pianos","Tus notas del recorrido sobre sus pianos"],
  next_up:["Next up in their sequence","Siguiente en su secuencia"],
  bump_title:["Not reported complete last week","No reportado como terminado la semana pasada"],
  bump:["Bump to next week","Pasar a la próxima semana"], bumped:["Bumped ✓","Pasado ✓"],
  bump_hint:["Connect the calendar to see last week's events and bump unfinished ones forward with one click.","Conecta el calendario para ver los eventos de la semana pasada y pasar los no terminados con un clic."],
  assigned_evts:["events on next week's calendar","eventos en el calendario de la próxima semana"],
  mark_assigned:["Mark assigned ✓","Marcar asignado ✓"],

  /* walk-around */
  walk_title:["Saturday Walk-Around","Recorrido del sábado"],
  walk_sub:["Capture notes as you walk the shop. Pick a category, name the piano (serial or spot number), write the note. Everything lands on the Week Board.","Captura notas mientras recorres el taller. Elige una categoría, identifica el piano (serie o número de lugar) y escribe la nota. Todo aparece en el Tablero semanal."],
  piano_ph:["Piano — type serial or spot number (optional)","Piano — escribe la serie o número de lugar (opcional)"],
  note_ph:["What needs to happen? / ¿Qué se necesita hacer?","¿Qué se necesita hacer?"],
  add_note:["Add note","Agregar nota"],
  notes_this_week:["This week's walk-around notes","Notas del recorrido de esta semana"],
  copy_column:["Copy for spreadsheet column","Copiar para la columna de la hoja"], copied:["Copied ✓","Copiado ✓"],
  no_notes:["No notes yet this week.","Aún no hay notas esta semana."],

  /* boards */
  week_title:["Week Board","Tablero semanal"],
  week_sub:["This week's plan by department — live from the scheduling sheet, plus your walk-around notes (marked ●).","El plan de esta semana por departamento — en vivo desde la hoja de programación, más tus notas del recorrido (marcadas ●)."],
  seq_title:["Sequence by Technician","Secuencia por técnico"],
  seq_sub:["Each technician's ordered pipeline of jobs, live from the sequence tab, enriched with the latest reported progress.","La lista ordenada de trabajos de cada técnico, en vivo desde la hoja de secuencia, con el último avance reportado."],
  empty_lane:["nothing listed","sin trabajos"],

  /* pipeline */
  pipe_title:["Piano Pipeline","Flujo de pianos"],
  pipe_sub:["Every piano in play, by its live CURRENT PHASE from the Store Map cards. Fix a wrong phase on the piano's card and it updates here.","Cada piano en proceso, según su FASE ACTUAL en vivo de las tarjetas del Store Map. Corrige una fase errónea en la tarjeta del piano y se actualiza aquí."],
  handbook:["Handbook","Manual"], open_handbook:["Open the BLP Handbook →","Abrir el Manual BLP →"],
  hb_sections:["Relevant handbook sections","Secciones relevantes del manual"],

  /* QC */
  qc_title:["Quality Control","Control de calidad"],
  qc_sub:["The QC checklist, digital: pick the piano, work down the list, and every ‘needs fix’ is recorded with a note. The paper binder becomes an archive.","La lista de control de calidad, digital: elige el piano, recorre la lista y cada ‘necesita arreglo’ queda registrado con una nota. La carpeta de papel pasa a ser archivo."],
  qc_piano_ph:["Piano being checked — serial or name","Piano a revisar — serie o nombre"],
  qc_start:["Start / resume QC","Iniciar / continuar CC"],
  pass:["Pass","Bien"], fix:["Needs fix","Arreglar"],
  fix_note_ph:["What needs fixing?","¿Qué hay que arreglar?"],
  qc_done_n:["%1 of %2 items checked","%1 de %2 puntos revisados"],
  qc_ready:["READY FOR AFTER PHOTOS & VIDEO 🎉","LISTO PARA FOTOS Y VIDEO FINALES 🎉"],
  qc_mark_ready:["Mark ready for after photos & video","Marcar listo para fotos y video finales"],
  qc_fixes_open:["fix items still open","arreglos pendientes"],
  qc_records:["QC records","Registros de CC"], qc_print:["Print record","Imprimir registro"],
  qc_by:["Checked by","Revisado por"], view_doc:["View original doc","Ver documento original"],

  /* client reports */
  nav_client:["Client Reports","Reportes a clientes"],
  cli_title:["Client Reports","Reportes a clientes"],
  cli_sub:["Monthly progress emails, drafted from the technicians' own reports in Brigham's voice. Review, edit, attach photos in Gmail, and send — nothing goes out without your approval.","Correos mensuales de avance, redactados desde los reportes de los técnicos con la voz de Brigham. Revisa, edita, adjunta fotos en Gmail y envía — nada sale sin tu aprobación."],
  cli_due:["Due for an update","Pendientes de actualización"],
  cli_rest:["Other client pianos","Otros pianos de clientes"],
  cli_last:["Last update","Última actualización"],
  cli_never:["never","nunca"],
  cli_include:["Monthly updates","Actualizaciones mensuales"],
  cli_generate:["Generate draft","Generar borrador"],
  cli_generating:["Drafting…","Redactando…"],
  cli_template_note:["AI drafting isn't configured yet (ANTHROPIC_API_KEY in Netlify) — this is a template draft. It still uses the real shop evidence below.","La redacción con IA aún no está configurada (ANTHROPIC_API_KEY en Netlify) — este es un borrador de plantilla. Aun así usa la evidencia real del taller."],
  cli_evidence:["Shop evidence this period","Evidencia del taller en este periodo"],
  cli_phase_log:["Phase sign-offs (piano log)","Fases firmadas (registro de pianos)"],
  cli_subject:["Subject","Asunto"],
  cli_copy:["Copy email","Copiar correo"],
  cli_gmail:["Open in Gmail","Abrir en Gmail"],
  cli_sent:["Mark sent","Marcar enviado"],
  cli_sent_done:["Sent ✓","Enviado ✓"],
  cli_no_evidence:["No report mentions since the last update — the draft will be a brief check-in.","Sin menciones en reportes desde la última actualización — el borrador será un saludo breve."],
  cli_signin_needed:["Sign in again (session token expired) and retry.","Vuelve a iniciar sesión (el token expiró) e inténtalo de nuevo."],

  /* team */
  nav_team:["Team","Equipo"],
  team_title:["Team Roster","Plantilla del equipo"],
  team_sub:["Add technicians when they're hired — they appear in the report name picker and Weekly Review immediately. Deactivate them when they leave — their report history stays intact, they just drop off the active lists. Changes save to a Roster tab on the report spreadsheet, shared across all devices.","Agrega técnicos al contratarlos — aparecen de inmediato en el selector de reportes y en la Revisión semanal. Desactívalos cuando se van — su historial se conserva, solo salen de las listas activas. Los cambios se guardan en una pestaña Roster de la hoja de reportes, compartida entre todos los dispositivos."],
  team_active:["Active technicians","Técnicos activos"],
  team_inactive:["Deactivated","Desactivados"],
  team_add_ph:["New technician's first name (as it should appear on reports)","Nombre del nuevo técnico (como aparecerá en los reportes)"],
  team_add:["Add to team","Agregar al equipo"],
  team_deactivate:["Deactivate","Desactivar"],
  team_reactivate:["Reactivate","Reactivar"],
  team_src_reports:["from reports","por reportes"],
  team_src_roster:["roster","roster"],
  team_saving:["Saving…","Guardando…"],
  team_bridge_old:["The bridge script needs a quick update before Team changes can save — the new Code.gs is in the repo; paste it into the Shop Reports Bridge (Extensions → Apps Script) and deploy a new version.","El script del puente necesita una actualización antes de poder guardar cambios de equipo — el nuevo Code.gs está en el repositorio; pégalo en el Shop Reports Bridge y publica una nueva versión."],
  /* curtis harper work orders */
  nav_curtis:["Curtis Harper","Curtis Harper"],
  cur_title:["Curtis Harper — Work Orders","Curtis Harper — Órdenes de trabajo"],
  cur_sub:["Two-way sync with the “Curtis Harper work orders” sheet — click any cell to edit, changes save straight to the spreadsheet (and edits made in the sheet show up here).","Sincronización bidireccional con la hoja “Curtis Harper work orders” — toca cualquier celda para editar; los cambios se guardan directo en la hoja (y las ediciones en la hoja aparecen aquí)."],
  cur_open_sheet:["Open sheet ↗","Abrir hoja ↗"],
  cur_refresh:["Refresh","Actualizar"],
  cur_addrow:["+ Add work order","+ Agregar orden"],
  cur_loading:["Loading work orders…","Cargando órdenes de trabajo…"],
  cur_rows:["%1 rows · synced %2","%1 filas · sincronizado %2"],
  cur_pass:["BLP app passcode (asked once on this device)","Código de acceso BLP (una vez en este dispositivo)"],
  cur_unlock:["Unlock","Entrar"],
  auth_need:["Your session expired — sign in again to keep editing:","Tu sesión expiró — inicia sesión de nuevo para seguir editando:"],
  cur_added:["Work order added (row %1) — fill in the details.","Orden agregada (fila %1) — completa los detalles."],
  /* brigham task list */
  /* shop dashboard + assignment planner (moved from the tech app) */
  nav_dashboard:["Shop Dashboard","Panel del Taller"],
  nav_planner:["Assignment Planner","Planificador"],
  nav_shopboard:["Shop Board","Tablero del Taller"],
  nav_requests:["App Requests","Solicitudes de Apps"],
  week_ending:["Week ending %1","Semana que termina %1"],
  dash_sub:["Shop overview · %1 active technicians · %2 reports on file since 2017","Resumen del taller · %1 técnicos activos · %2 reportes archivados desde 2017"],
  st_reports_in:["Reports in","Reportes entregados"],
  st_pending:["%1 pending","faltan: %1"],
  st_everyone:["everyone reported","todos reportaron"],
  st_lastweek:["Last week","Semana pasada"],
  st_reports_for:["reports for %1","reportes del %1"],
  st_pianos:["Pianos mentioned","Pianos mencionados"],
  st_pianos_d:["distinct pianos, last 4 weeks","pianos distintos, últimas 4 semanas"],
  st_hours:["Hours logged","Horas registradas"],
  st_hours_d:["parsed from reports, last 4 weeks","extraídas de los reportes, últimas 4 semanas"],
  st_year:["Reports in %1","Reportes en %1"],
  st_year_d:["%1 technicians","%1 técnicos"],
  card_week:["This week's reports","Reportes de esta semana"],
  card_12w:["Reports submitted","Reportes entregados"],
  lite_12w:["last 12 weeks","últimas 12 semanas"],
  card_activity:["Latest activity","Actividad reciente"],
  pill_in:["Submitted","Entregado"],
  pill_out:["Missing","Falta"],
  planner_title:["Monday assignment planner","Planificador de asignaciones del lunes"],
  planner_sub:["Carry-overs and unfinished work from this week's reports, grouped per technician — draft material for next week's calendar assignments.","Pendientes y trabajo sin terminar de los reportes de esta semana, agrupados por técnico — borrador para las asignaciones de la próxima semana."],
  copy_plan:["Copy full plan","Copiar plan completo"],
  copied:["Copied ✓","Copiado ✓"],
  planner_status:["<b>%1 of %2</b> reports in for %3. ","<b>%1 de %2</b> reportes entregados para %3. "],
  planner_good:["Most reports are in — good time to plan next week.","La mayoría de los reportes están — buen momento para planear la próxima semana."],
  planner_wait:["The plan fills in as Friday reports arrive; technicians without a report this week fall back to last week's.","El plan se llena conforme llegan los reportes del viernes; los técnicos sin reporte esta semana usan el de la semana pasada."],
  no_recent:["No recent report","Sin reporte reciente"],
  nothing_carry:["Nothing to carry over — assign fresh work.","Nada pendiente — asignar trabajo nuevo."],
  from_date:["from %1","del %1"],
  carry_one:["1 carry-over","1 pendiente"],
  carry_many:["%1 carry-overs","%1 pendientes"],
  nothing_flagged:["nothing flagged","nada marcado"],
  no_carry_found:["No carry-over language found — likely finished assignments","No se detectaron pendientes — probablemente terminó sus asignaciones"],
  in_flight:[" (pianos in flight: %1)"," (pianos en proceso: %1)"],
  /* team roster (BLP TEAM sheet) */
  nav_roster:["Team Roster","Plantilla"],

  /* training */
  nav_training:["Training","Capacitación"],
  train_title:["Training","Capacitación"],
  train_sub:["Guides and training materials for the shop — more will be added over time.","Guías y materiales de capacitación para el taller — se agregarán más con el tiempo."],
  train_open:["Open ↗","Abrir ↗"],
  train_video:["▶ Watch video","▶ Ver video"],
  ros_title:["Team Roster","Plantilla del equipo"],
  ros_sub:["Two-way sync with the “BLP TEAM” spreadsheet — edit names, positions, phones, uniform sizes and notes right here (sensitive columns like passwords and tax forms stay sheet-only). Click any cell to edit.","Sincronización con la hoja “BLP TEAM” — edita nombres, puestos, teléfonos, tallas y notas aquí (las columnas sensibles como contraseñas quedan solo en la hoja). Toca cualquier celda para editar."],
  ros_addrow:["+ Add person","+ Agregar persona"],
  /* whiteboard */
  nav_whiteboard:["Whiteboard","Pizarrón"],
  wb_title:["Shop Whiteboard","Pizarrón del Taller"],
  wb_sub:["The technicians' request board (Parts · Supplies · Tools) — mark items Ordered when you place the order (they move to the waiting area) and Arrived when the box shows up. Same board the techs see.","El pizarrón de pedidos de los técnicos — marca Ordenado al hacer el pedido (pasa al área de espera) y Recibido cuando llegue. El mismo pizarrón que ven los técnicos."],
  wb_parts_note:["running low on","se está acabando"],
  wb_tools_note:["suggestions & upgrades","sugerencias y mejoras"],
  wb_add:["+ add","+ agregar"],
  wb_item_ph:["what do we need?","¿qué necesitamos?"],
  wb_none:["nothing requested","nada pedido"],
  wb_showdone:["Show arrived items","Ver artículos recibidos"],
  wb_hidedone:["Hide arrived items","Ocultar recibidos"],
  wb_ordered:["Ordered","Ordenado"],
  wb_arrived:["Arrived","Recibido"],
  wb_waiting:["Ordered — waiting to arrive","Ordenado — esperando llegada"],
  wb_arrived_sect:["Arrived","Recibido"],
  wb_orderat:["Order at:","Ordenar en:"],
  /* team schedules */
  nav_schedule:["Schedules","Horarios"],
  sched_title:["Team Schedules","Horarios del equipo"],
  sched_sub:["Weekly shift hours per person — edit any cell (e.g. “8:00-4:00”, blank = off). One-off exceptions go in Notes. The weekly work-plan drafts read this tab as the source of truth.","Horario semanal por persona — edita cualquier celda (p. ej. “8:00-4:00”, vacío = descanso). Excepciones puntuales van en Notas. Los borradores del plan semanal leen esta pestaña como fuente de verdad."],
  sched_addrow:["+ Add person","+ Agregar persona"],
  nav_brigham:["Brigham","Brigham"],
  brig_title:["Brigham — Priority List","Brigham — Lista de prioridades"],
  brig_sub:["Tasks requested for Brigham — from the Store Map's “Request Brigham Task” button or added here. Set the priority number, check off what's done. Everything lives on the “Brigham Tasks” tab of the report sheet.","Tareas solicitadas para Brigham — desde el botón “Request Brigham Task” del Store Map o agregadas aquí. Asigna prioridad y marca lo terminado. Todo vive en la pestaña “Brigham Tasks” de la hoja de reportes."],
  brig_add:["+ Add task","+ Agregar tarea"],
  brig_note_ph:["What does Brigham need to do?","¿Qué necesita hacer Brigham?"],
  brig_piano_ph:["Piano / subject (optional)","Piano / asunto (opcional)"],
  brig_save:["Add to the list","Agregar a la lista"],
  brig_open:["Open","Pendientes"],
  brig_done:["Done","Terminadas"],
  brig_none:["Nothing on the list — enjoy it while it lasts.","Nada en la lista — disfrútalo mientras dure."],
  brig_pri:["priority","prioridad"],
  cur_wrongpass:["Wrong passcode — click Refresh to try again.","Código incorrecto — toca Actualizar para reintentar."],
  cur_err:["Couldn't reach the work-orders bridge: %1","No se pudo conectar con el puente de órdenes: %1"],
  cur_saved:["Saved ✓","Guardado ✓"],
  cur_savefail:["Save failed: %1","No se guardó: %1"],
  /* sequence recommendations */
  rec_title:["🧠 Recommended next from the queue","🧠 Recomendados de la cola"],
  rec_sub:["Suggestions for each technician's next piano, drawn from the shop queue (queue order, track vs. specialty, current lane load). Nothing moves until a manager or owner approves it.","Sugerencias del siguiente piano para cada técnico, según la cola del taller (orden de cola, tipo de trabajo vs. especialidad, carga actual). Nada se mueve hasta que un gerente o dueño lo apruebe."],
  rec_add:["✓ Add to sequence","✓ Agregar a la secuencia"],
  rec_skip:["✕ Not this one","✕ Este no"],
  rec_none:["No queue pianos are waiting for a recommendation right now.","No hay pianos en cola esperando recomendación por ahora."],
  rec_loading:["Sizing up the queue…","Analizando la cola…"],
  rec_added:["Added ✓","Agregado ✓"],
  /* card audit */
  aud_title:["Report vs. Card Audit","Auditoría reporte vs. tarjeta"],
  aud_sub:["Does each technician's latest weekly report line up with the piano data cards? Serials from every report are checked against the card's live CURRENT PHASE — mismatches usually mean the card wasn't updated. It's keyword-based, so read the line before texting anyone.","¿Coincide el último reporte semanal de cada técnico con las tarjetas de datos? Los seriales de cada reporte se comparan con la FASE ACTUAL de la tarjeta — las diferencias suelen significar que la tarjeta no se actualizó. Es por palabras clave: lee la línea antes de escribirle a alguien."],
  aud_clean:["No conflicts found between this tech's report and the cards.","Sin conflictos entre el reporte de este técnico y las tarjetas."],
  aud_noreport:["No weekly report for this week.","Sin reporte semanal esta semana."],
  /* specialties */
  lad_title:["Skill Ladder","Escalera de habilidades"],
  lad_sub:["Each specialty's ranked ladder — the scheduler reads straight down: if #1 isn't available, go to #2. Change a level with the selector, reorder with ▲▼, add someone with ＋. Greyed rows aren't scheduled today. The ⏱/✅/⚡ line is live evidence from the work clock and mini-QC log — it informs your rankings but never changes them by itself.","La escalera de cada especialidad en orden — el programador lee hacia abajo: si el #1 no está disponible, sigue el #2. Cambia el nivel con el selector, reordena con ▲▼, agrega con ＋. Las filas grises no trabajan hoy. La línea ⏱/✅/⚡ es evidencia en vivo del reloj y los mini-QC — informa tu criterio pero nunca cambia niveles sola."],
  mat_title:["Versatility Matrix","Matriz de versatilidad"],
  mat_sub:["Everyone × every specialty. Tap a cell to raise a level (cycles back to — after 🏆). Tap a column header for that skill's ranked ladder with today's availability. The small number in a cell is the live ⚡ performance index: work-clock hours vs the phase standard × mini-QC first-pass rate.","Todos × cada especialidad. Toca una celda para subir el nivel (vuelve a — después de 🏆). Toca el encabezado de columna para ver la escalera de esa habilidad con la disponibilidad de hoy. El número pequeño es el índice ⚡ en vivo: horas de reloj vs. estándar × tasa de mini-QC aprobados."],
  spec_legend:["Levels: 🎓 Trainee (never alone) · ✅ Trained · 💪 Competent · 🛡 Reliable · ⭐ Expert · 🏆 Best in Shop (one per skill). ⚡ index: 100 ≈ standard hours with clean mini-QCs; higher is faster + cleaner.","Niveles: 🎓 Aprendiz (nunca solo) · ✅ Entrenado · 💪 Competente · 🛡 Confiable · ⭐ Experto · 🏆 Mejor del taller (uno por habilidad). Índice ⚡: 100 ≈ horas estándar con mini-QCs limpios; más alto = más rápido y limpio."],
};
const t = (k, ...args) => {
  let s = (I18N[k] || [k,k])[LANG === "es" ? 1 : 0];
  args.forEach((a,i)=>{ s = s.replace("%"+(i+1), a); });
  return s;
};
function setLang(l){ LANG=l; localStorage.setItem("blpmgr.lang", l); schedRerender(); }

/* ================= HELPERS ================= */
const $ = s => document.querySelector(s);
const esc = s => String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
function parseCSV(text){
  const rows=[];let row=[],cur="",q=false;
  for(let i=0;i<text.length;i++){const c=text[i];
    if(q){ if(c==='"'){ if(text[i+1]==='"'){cur+='"';i++;} else q=false; } else cur+=c; }
    else{ if(c==='"')q=true; else if(c===","){row.push(cur);cur="";} else if(c==="\n"){row.push(cur);rows.push(row);row=[];cur="";} else if(c!=="\r")cur+=c; } }
  if(cur!==""||row.length){row.push(cur);rows.push(row);}
  return rows;
}
async function gviz(sheetId, gidOrName){
  const sel = /^\d+$/.test(String(gidOrName)) ? `gid=${gidOrName}` : `sheet=${encodeURIComponent(gidOrName)}`;
  const r = await fetch(`https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&headers=0&${sel}`);
  return parseCSV(await r.text());
}
function thisFriday(d=new Date()){const x=new Date(d);x.setHours(0,0,0,0);x.setDate(x.getDate()+((5-x.getDay()+7)%7));return x;}
// Reports land on Fridays: review the Friday just passed (or today, on a Friday).
function reportFriday(d=new Date()){const x=new Date(d);x.setHours(0,0,0,0);x.setDate(x.getDate()-((x.getDay()+2)%7));return x;}
const iso = d => d.toISOString().slice(0,10);
function fmtShort(s){ if(!s)return "—"; const [y,m,d]=String(s).split("-"); return `${+m}/${+d}/${String(y).slice(2)}`; }
function mondayOf(f){const m=new Date(f);m.setDate(m.getDate()-4);return m;}

/* ---- data (verbatim from the Shop Manager) ---- */
const CONFIG = {
  REPORT_SHEET: "11RoeVRETag5rZYX6_tEH-rf6x8JL0JeZU0P5AT0WI-I",
  SCHED_SHEET:  "1k9ToAeueEg5WOtaY91xXzL-a0l_AJsSZWw23tcAWECU",
  SEQ_GID: "0", NOTES_GID: "1448465358",
  REFINISH_SHEET: "1bfF4pmuGv7TefVlDG4lo_04gRjiX9QYerK4o9qih6kc",
  PIANOLOG_SHEET: "1ZunbPKygpQlcXfTyPowDHdUE9spJ3uV1XA4iX1eoKRc",
  STOREMAP_BRIDGE: "https://script.google.com/macros/s/AKfycbxY4BKnr_Tr0iCTc9itCWhNYLvgszmkI1IoYSkbBWpyAqRtWI-yaUkJQjcVdgG58KXt/exec",
  PIANOLOG_URL: "https://pianologapp.netlify.app/",
  HANDBOOK_APP: "https://blpshop.netlify.app/index.html#handbook",
  QC_DOC_URL: "https://docs.google.com/document/d/1f7AU5PtX1bP4-b48MHMSn1nzpN5FbMmTd1Yh0kaBcVY/edit",
};
const HISTORY_URL = "https://blpshop.netlify.app/data/report-history.json";
let REPORTS={entries:[]}, SEQ=[], NOTES=[], REFINISH=[], PLOG=[], ROSTER=[];
let PIANOS=new Map();   // serialKey -> {serial, label, spot, level, progress, lastDate, techs:Set}
const SERIAL_DATES=new Map();  // any serial token -> latest report date (brand-independent)
const YEAR = new Date().getFullYear();

async function boot(){
  const [hist, seq, notes, refin, plog] = await Promise.all([
    fetch(HISTORY_URL).then(r=>r.json()).catch(()=>({entries:[],tabs:{}})),
    gviz(CONFIG.SCHED_SHEET, CONFIG.SEQ_GID).catch(()=>[]),
    gviz(CONFIG.SCHED_SHEET, CONFIG.NOTES_GID).catch(()=>[]),
    gviz(CONFIG.REFINISH_SHEET, "0").catch(()=>[]),
    gviz(CONFIG.PIANOLOG_SHEET, "Piano Log").catch(()=>[]),
  ]);
  REPORTS = hist; SEQ = seq; NOTES = notes; REFINISH = refin; PLOG = plog;
  // live refresh of current-year reports
  try{
    const gid = Object.keys(hist.tabs||{}).find(g=>hist.tabs[g].year===YEAR);
    if(gid){
      const rows = await gviz(CONFIG.REPORT_SHEET, gid);
      const dates = rows[0].slice(1);
      const fresh=[];
      rows.slice(1).forEach(r=>{ const tech=(r[0]||"").trim(); if(!tech)return;
        r.slice(1).forEach((cell,i)=>{ cell=(cell||"").trim(); if(!cell||/^n\/?a$/i.test(cell))return;
          const m=/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec((dates[i]||"").trim());
          const isoD = m?`${m[3].length===2?"20"+m[3]:m[3]}-${String(m[1]).padStart(2,"0")}-${String(m[2]).padStart(2,"0")}`:null;
          fresh.push({tech,date:isoD,year:YEAR,text:cell}); });
      });
      if(fresh.length) REPORTS.entries = REPORTS.entries.filter(e=>e.year!==YEAR).concat(fresh);
    }
  }catch(e){}
  await fetchRosterOverrides();
  buildRoster(); buildPianoIndex();
  schedRerender();
}

const validTechName = n => /^[A-Za-z][A-Za-z'’.-]+( [A-Za-z'’.-]+)?$/.test(n) && n.length<=22 && !/complete/i.test(n);
function seqRows(){ return SEQ.filter(r=>validTechName((r[1]||"").trim()) && r.slice(2).some(c=>(c||"").trim())); }
let ROSTER_OVR=null;   // {name -> 'active'|'inactive'} from the Roster tab via the bridge
async function fetchRosterOverrides(){
  try{
    // served by the Store Map bridge (the Shop Reports Bridge deployment is
    // owner-locked); same "Roster" tab either way
    const r=await fetch(CONFIG.STOREMAP_BRIDGE+"?fn=shoproster",{redirect:"follow"});
    const out=await r.json();
    if(out.ok && Array.isArray(out.roster)){
      ROSTER_OVR={};
      out.roster.forEach(x=>{ ROSTER_OVR[x.name.toLowerCase()]=x.status; });
      return true;
    }
  }catch(e){}
  ROSTER_OVR=ROSTER_OVR||{};
  return false;
}
function buildRoster(){
  // Weekly Review covers the ACTIVE Friday-report roster (same rule as the
  // shop app), plus Roster-tab additions, minus Roster-tab deactivations.
  const cutoff=new Date(thisFriday()); cutoff.setDate(cutoff.getDate()-8*7);
  const active=new Set(REPORTS.entries.filter(e=>e.date&&e.date>=iso(cutoff)).map(e=>e.tech));
  REPORTS.entries.filter(e=>e.year===YEAR).forEach(e=>active.add(e.tech));
  const ovr=ROSTER_OVR||{};
  Object.entries(ovr).forEach(([lc,status])=>{
    if(status!=="active") return;
    if(![...active].some(n=>n.toLowerCase()===lc)){
      const orig=(REPORTS.entries.find(e=>e.tech.toLowerCase()===lc)||{}).tech;
      active.add(orig || lc.replace(/(^|\s)\w/g,c=>c.toUpperCase()));
    }
  });
  ROSTER=[...active].filter(n=>ovr[n.toLowerCase()]!=="inactive").sort();
}
function seqRowFor(tech){
  const f=tech.split(/\s+/)[0].toLowerCase();
  return seqRows().find(r=>(r[1]||"").trim().split(/\s+/)[0].toLowerCase()===f);
}

const BRANDS=["Steinway","Yamaha","Kawai","Baldwin","Knabe","Chickering","Mason & Hamlin","Wurlitzer","Kimball","Cable-Nelson","Cable Nelson","Weber","Bosendorfer","Bösendorfer","Everett","Sohmer","Petrof","Samick","Young Chang","Schimmel","Bechstein","Heintzman","Hailun","Kohler & Campbell","Gulbransen","Hamilton","Acrosonic","Ivers & Pond","Lester","Winter","Emerson","Vose","Steck","Brambach","Pearl River","Ritmuller","Essex","Boston","Fazioli","Seiler","Ludwig","Ellington","Kranich & Bach","Kranich Bach","Decker","Hallet Davis","Universal","Promberger","Geyer","Mathushek","Sherman Clay","Wing","Walworth","Kreiter","Rudolf","Waterlox","Whitney","Wellington","Story & Clark"];
const BRAND_RE = new RegExp("\\b("+BRANDS.map(b=>b.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("|")+")\\b[ #:]*([0-9]{4,8})?","gi");
const skey = s => String(s||"").replace(/\D/g,"");

function notePiano(brand, serial, extra){
  if(!serial) return null;
  const k=skey(serial); if(k.length<4) return null;
  const rec = PIANOS.get(k) || {serial:serial, brand:brand||"", label:(brand?brand+" ":"")+serial, spot:"", level:"", progress:null, lastDate:null, techs:new Set(), request:""};
  if(brand && !rec.brand){ rec.brand=brand; rec.label=brand+" "+serial; }
  Object.assign(rec, extra||{});
  PIANOS.set(k, rec);
  return rec;
}

function buildPianoIndex(){
  // refinishing sheet: priority order, level, request, location
  let pri=0;
  REFINISH.forEach(r=>{
    const brand=(r[1]||"").trim(), serial=(r[2]||"").trim(), loc=(r[3]||"").trim(), lvl=(r[4]||"").trim(), req=(r[5]||"").trim();
    if(!brand||!serial||/^brand$/i.test(brand)) return;
    pri++;
    notePiano(brand, serial, {spot:loc, level:lvl, request:req, refinishPri:pri});
  });
  // sequence tab: jobs per tech (only active-roster lanes count as "in play")
  const rosterFirsts=new Set(ROSTER.map(n=>n.split(/\s+/)[0].toLowerCase()));
  seqRows().forEach(r=>{
    const tech=(r[1]||"").trim();
    const activeLane=rosterFirsts.has(tech.split(/\s+/)[0].toLowerCase());
    r.slice(2).forEach(job=>{ job=(job||"").trim(); if(!job)return;
      BRAND_RE.lastIndex=0; const m=BRAND_RE.exec(job);
      if(m&&m[2]){ const rec=notePiano(m[1],m[2],activeLane?{inSeq:true}:{}); if(rec) rec.techs.add(tech); }
    });
  });
  // report mentions: latest date + progress %
  const sorted=[...REPORTS.entries].filter(e=>e.date).sort((a,b)=>a.date.localeCompare(b.date));
  SERIAL_DATES.clear();
  sorted.forEach(e=>{ (e.text.match(/\d{4,8}/g)||[]).forEach(tok=>SERIAL_DATES.set(tok, e.date)); });
  sorted.forEach(e=>{
    BRAND_RE.lastIndex=0; let m;
    while((m=BRAND_RE.exec(e.text))){
      if(!m[2]) continue;
      const rec=notePiano(m[1],m[2],{lastDate:e.date}); if(!rec) continue;
      rec.techs.add(e.tech);
      const after=e.text.slice(m.index, m.index+160);
      rec.snip=after;
      const pm=/(\d{1,3})\s?%/.exec(after);
      if(pm && +pm[1]<=100) rec.progress=+pm[1];
    }
  });
}

/* ================= CALENDAR ================= */
let calToken=null, CAL_MAP={}; // tech -> calendarId
function connectCalendar(cb){
  const s=document.createElement("script"); s.src="https://accounts.google.com/gsi/client"; s.async=true;
  s.onload=()=>{
    const tc=google.accounts.oauth2.initTokenClient({
      client_id:"110628682621-v65mkaoanv87sp75ggdfcrglfr7bkr8p.apps.googleusercontent.com",
      scope:"https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events",
      callback:async(resp)=>{ calToken=resp.access_token; await mapCalendars(); schedRerender(); if(cb)cb(); }
    });
    tc.requestAccessToken();
  };
  document.head.appendChild(s);
}
async function gcal(path, opts){
  const r=await fetch("https://www.googleapis.com/calendar/v3/"+path,{...(opts||{}),headers:{Authorization:"Bearer "+calToken,"Content-Type":"application/json",...((opts||{}).headers||{})}});
  return r.json();
}
async function mapCalendars(){
  const out=await gcal("users/me/calendarList?maxResults=250");
  CAL_MAP={};
  (out.items||[]).forEach(c=>{
    const s=(c.summary||"").toLowerCase();
    ROSTER.forEach(tech=>{ if(s.includes(tech.toLowerCase()) && !CAL_MAP[tech]) CAL_MAP[tech]=c.id; });
  });
}
async function eventsFor(tech, from, to){
  if(!CAL_MAP[tech]) return [];
  const out=await gcal(`calendars/${encodeURIComponent(CAL_MAP[tech])}/events?singleEvents=true&orderBy=startTime&timeMin=${from.toISOString()}&timeMax=${to.toISOString()}&maxResults=100`);
  return (out.items||[]).filter(e=>e.status!=="cancelled");
}
async function createEvent(tech, summary, dayISO){
  if(!CAL_MAP[tech]) return null;
  return gcal(`calendars/${encodeURIComponent(CAL_MAP[tech])}/events`,{method:"POST",
    body:JSON.stringify({summary, start:{date:dayISO}, end:{date:dayISO}})});
}

/* ================= STATE (per week) ================= */
const FRI = reportFriday(), FRI_ISO = iso(FRI);
const NEXT_FRI = new Date(FRI); NEXT_FRI.setDate(NEXT_FRI.getDate()+7);
const store = {
  get(k, d){ try{ return JSON.parse(localStorage.getItem(k)) ?? d; }catch(e){ return d; } },
  set(k, v){ localStorage.setItem(k, JSON.stringify(v)); }
};
const REV_KEY=`blpmgr.review.${FRI_ISO}`, WALK_KEY=`blpmgr.walk.${FRI_ISO}`, QC_KEY="blpmgr.qc", PH_KEY="blpmgr.phase";
function extractPianos(text){
  const found=[]; let m; BRAND_RE.lastIndex=0;
  while((m=BRAND_RE.exec(text))){
    const brand=m[1].replace(/\s+/g," ");
    const serial=m[2]||null;
    found.push({brand,serial,label:serial?`${brand} ${serial}`:brand});
  }
  return found;
}
function sumHours(text){
  let s=0,m; const re=/(\d+(?:\.\d+)?)\s*(?:hrs?\b|hours?\b)/gi;
  while((m=re.exec(text))){ const v=parseFloat(m[1]); if(v>0&&v<200) s+=v; }
  return s;
}
const weekEntries=isoD=>REPORTS.entries.filter(e=>e.date===isoD);
function fmtLong(d){ return d.toLocaleDateString(LANG==="es"?"es-MX":"en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"}); }
function complianceHTML(){
  const weeks=[]; for(let i=0;i<12;i++){ const d=new Date(FRI); d.setDate(d.getDate()-7*i); weeks.push(iso(d)); }
  return ROSTER.map(tc=>({tc,n:weeks.filter(w=>REPORTS.entries.some(e=>e.tech===tc&&e.date===w)).length}))
    .sort((a,b)=>b.n-a.n)
    .map(c=>`<div class="brow"><span>${esc(c.tc)}</span><div class="btrack"><i class="bfill ${c.n<6?"hot":""}" style="width:${Math.round(c.n/12*100)}%"></i></div><b class="num">${c.n}/12</b></div>`).join("");
}
function weekReports(){ return REPORTS.entries.filter(e=>e.date===FRI_ISO); }
function reviewState(){ return store.get(REV_KEY,{}); }
/* ================= WEEKLY REVIEW ================= */
let OPEN_TECH = null, BUMP_CACHE={};
function carryLines(text){
  return String(text||"").split(/\n|(?<=\.)\s+/).filter(l=>
    /carry|next week|didn'?t|did not|not (yet )?(done|finished|complete)|waiting|still needs|unfinished|left off|to do|pendiente|esperando|falta/i.test(l) && l.trim().length>8).slice(0,6);
}
function renderReview(){
  const el=$("#sview-review"); if(!el.classList.contains("on") && el.innerHTML && false) return;
  const st=reviewState();
  const rows=ROSTER.map(tech=>{
    const rep=weekReports().find(e=>e.tech===tech);
    const s=st[tech]||{};
    const assignedAuto = s.autoEvents!=null ? s.autoEvents>0 : null;
    const assigned = s.assignedManual || assignedAuto===true;
    const open = OPEN_TECH===tech;
    return `
    <div class="rev-row" data-tech="${esc(tech)}">
      <span class="tech">${esc(tech)}</span>
      <span class="ck ${rep?"yes":"no"}"><span class="dot">✓</span>${t("ck_report")}</span>
      <span class="ck ${s.reviewed?"yes":"no"}"><span class="dot">✓</span>${t("ck_reviewed")}</span>
      <span class="ck ${assigned?"yes":"no"}"><span class="dot">✓</span>${t("ck_assigned")}${s.autoEvents!=null?` <span class="num">(${s.autoEvents})</span>`:""}</span>
      <span style="color:var(--mut2)">${open?"▲":"▼"}</span>
    </div>
    ${open?revPanel(tech,rep,s):""}`;
  }).join("");
  el.innerHTML = `
    <div class="row1"><div><h2 class="page">${t("review_title")}</h2><div class="sub">${t("review_sub")}</div></div>
      <button class="btn2" id="calBtn">${calToken?("✓ "+t("cal_connected")):t("connect_cal")}</button></div>
    <div class="card">${rows}</div>`;
  $("#calBtn").onclick=()=>{ if(!calToken) connectCalendar(refreshAssignCounts); };
  document.querySelectorAll(".rev-row").forEach(r=>r.onclick=()=>{ OPEN_TECH = OPEN_TECH===r.dataset.tech?null:r.dataset.tech; schedRerender(); if(OPEN_TECH&&calToken) loadBumps(OPEN_TECH); });
  wireRevPanel();
}
function revPanel(tech, rep, s){
  const carries = rep?carryLines(rep.text):[];
  const walks = store.get(WALK_KEY,[]).filter(n=>{
    if(!n.serial) return false;
    const rec=PIANOS.get(skey(n.serial));
    return rec && rec.techs.has(tech);
  });
  const seqRow = seqRowFor(tech);
  const nextJobs = seqRow ? seqRow.slice(2).map(s=>s.trim()).filter(Boolean).slice(0,3) : [];
  const bumps = BUMP_CACHE[tech];
  return `<div class="revpanel">
    <div>
      <h5>${t("this_week_report")} · ${fmtShort(FRI_ISO)}</h5>
      <div class="reptext">${rep?esc(rep.text):`<span style="color:var(--mut2)">${t("no_report")}</span>`}</div>
      <div class="rev-actions">
        <button class="btn" id="rvBtn">${s.reviewed?t("unmark"):t("mark_reviewed")}</button>
        ${!calToken?`<button class="btn3" id="maBtn">${s.assignedManual?t("unmark"):t("mark_assigned")}</button>`:""}
      </div>
    </div>
    <div>
      ${calToken?`<h5>${t("bump_title")}</h5>
        ${bumps===undefined?`<div class="item" style="color:var(--mut2)">…</div>`:
          bumps.length?bumps.map((b,i)=>`<div class="item"><span class="src">${esc(b.when)}</span><br>${esc(b.summary)}<div class="rev-actions"><button class="btn3 bumpBtn" data-i="${i}" ${b.done?"disabled":""}>${b.done?t("bumped"):t("bump")}</button></div></div>`).join(""):
          `<div class="item" style="color:var(--good)">✓</div>`}`
        :`<h5>${t("bump_title")}</h5><div class="item" style="color:var(--mut2)">${t("bump_hint")}</div>`}
      ${carries.length?`<h5 style="margin-top:12px">${t("carryovers")}</h5>${carries.map(c=>`<div class="item">${esc(c)}</div>`).join("")}`:""}
      ${walks.length?`<h5 style="margin-top:12px">${t("walk_notes_for")}</h5>${walks.map(w=>`<div class="item"><span class="src">${esc(w.cat)}</span><br>${esc((w.label?w.label+": ":"")+w.text)}</div>`).join("")}`:""}
      ${nextJobs.length?`<h5 style="margin-top:12px">${t("next_up")}</h5>${nextJobs.map(j=>`<div class="item">${esc(j)}</div>`).join("")}`:""}
    </div>
  </div>`;
}
function wireRevPanel(){
  const tech=OPEN_TECH; if(!tech) return;
  const st=reviewState();
  const rv=$("#rvBtn"); if(rv) rv.onclick=(e)=>{e.stopPropagation(); st[tech]={...(st[tech]||{}),reviewed:!(st[tech]||{}).reviewed}; store.set(REV_KEY,st); schedRerender();};
  const ma=$("#maBtn"); if(ma) ma.onclick=(e)=>{e.stopPropagation(); st[tech]={...(st[tech]||{}),assignedManual:!(st[tech]||{}).assignedManual}; store.set(REV_KEY,st); schedRerender();};
  document.querySelectorAll(".bumpBtn").forEach(b=>b.onclick=async(e)=>{
    e.stopPropagation();
    const item=BUMP_CACHE[tech][+b.dataset.i];
    const day=iso(new Date(mondayOf(NEXT_FRI)));
    await createEvent(tech, item.summary, day);
    item.done=true; refreshAssignCounts(); schedRerender();
  });
}
async function loadBumps(tech){
  if(BUMP_CACHE[tech]) { schedRerender(); return; }
  const mon=mondayOf(FRI), sat=new Date(FRI); sat.setDate(sat.getDate()+1);
  const evs=await eventsFor(tech, mon, sat);
  const rep=weekReports().find(e=>e.tech===tech);
  const reptext=(rep?rep.text:"").toLowerCase();
  BUMP_CACHE[tech]=evs.filter(e=>{
    const words=(e.summary||"").toLowerCase().split(/\W+/).filter(w=>w.length>3);
    const mentioned=words.some(w=>reptext.includes(w));
    return !mentioned;  // not mentioned in report -> candidate for bump
  }).map(e=>({summary:e.summary||"(no title)", when:(e.start?.date||e.start?.dateTime||"").slice(0,10), done:false}));
  schedRerender();
}
async function refreshAssignCounts(){
  if(!calToken) return;
  const st=reviewState();
  const monN=mondayOf(NEXT_FRI), satN=new Date(NEXT_FRI); satN.setDate(satN.getDate()+1);
  for(const tech of ROSTER){
    try{ const evs=await eventsFor(tech, monN, satN); st[tech]={...(st[tech]||{}),autoEvents:evs.length,assigned:evs.length>0}; }
    catch(e){}
  }
  store.set(REV_KEY,st); schedRerender();
}

/* ================= WALK-AROUND ================= */
const CATS=["tuning","moving","showroom repairs","admin","PRSB","Refurb","Shop","Refinishing","Brigham","Curtis"];
let WA_CAT=CATS[0], WA_PIANO=null;
function renderWalk(){
  const notes=store.get(WALK_KEY,[]);
  $("#sview-walk").innerHTML=`
    <div class="row1"><div><h2 class="page">${t("walk_title")}</h2><div class="sub">${t("walk_sub")}</div></div></div>
    <div class="cats">${CATS.map(c=>`<button class="cat ${WA_CAT===c?"on":""}" data-c="${esc(c)}">${esc(c)}</button>`).join("")}</div>
    <div class="card wa-form">
      <div class="suggest"><input id="waPiano" placeholder="${t("piano_ph")}" autocomplete="off" value="${WA_PIANO?esc(WA_PIANO.label):""}"><div class="list" id="waList" style="display:none"></div></div>
      <textarea id="waText" placeholder="${t("note_ph")}"></textarea>
      <button class="btn" id="waAdd">${t("add_note")}</button>
    </div>
    <div class="row1" style="margin-top:22px"><h2 class="page" style="font-size:19px">${t("notes_this_week")} <span class="num" style="color:var(--mut2)">(${notes.length})</span></h2>
      <button class="btn2" id="waCopy">${t("copy_column")}</button></div>
    <div class="card">${notes.length?notes.map((n,i)=>`
      <div class="wa-note"><span class="cat-tag">${esc(n.cat)}</span>
        <span>${n.label?`<b>${esc(n.label)}</b>: `:""}${esc(n.text)}</span>
        <button data-i="${i}" class="waDel">×</button></div>`).join(""):`<div style="padding:16px;color:var(--mut)">${t("no_notes")}</div>`}
    </div>`;
  document.querySelectorAll(".cat").forEach(b=>b.onclick=()=>{WA_CAT=b.dataset.c;renderWalk();});
  const inp=$("#waPiano");
  inp.oninput=()=>{ WA_PIANO=null; suggest(inp.value); };
  $("#waAdd").onclick=()=>{
    const text=$("#waText").value.trim(); if(!text&&!WA_PIANO)return;
    const notes=store.get(WALK_KEY,[]);
    notes.push({cat:WA_CAT,text,serial:WA_PIANO?.serial||null,label:WA_PIANO?.label||inp.value.trim()||null,ts:Date.now()});
    store.set(WALK_KEY,notes); WA_PIANO=null; renderWalk(); $("#waText")?.focus();
  };
  document.querySelectorAll(".waDel").forEach(b=>b.onclick=()=>{
    const notes=store.get(WALK_KEY,[]); notes.splice(+b.dataset.i,1); store.set(WALK_KEY,notes); renderWalk();
  });
  $("#waCopy").onclick=async()=>{
    const notes=store.get(WALK_KEY,[]);
    const byCat={}; notes.forEach(n=>{(byCat[n.cat]=byCat[n.cat]||[]).push((n.label?n.label+": ":"")+n.text);});
    const out=CATS.filter(c=>byCat[c]).map(c=>c.toUpperCase()+"\n"+byCat[c].join("\n")).join("\n\n");
    await navigator.clipboard.writeText(out);
    $("#waCopy").textContent=t("copied"); setTimeout(renderWalk,1400);
  };
}
function suggest(q){
  const list=$("#waList"); q=q.trim().toLowerCase();
  if(q.length<2){ list.style.display="none"; return; }
  const hits=[...PIANOS.values()].filter(p=>
    p.label.toLowerCase().includes(q) || skey(p.serial).startsWith(skey(q)) || (p.spot&&p.spot.toLowerCase()===q)
  ).slice(0,8);
  list.innerHTML=hits.map(p=>`<div data-k="${skey(p.serial)}">${esc(p.label)}${p.spot?` <span style="color:var(--mut2)">\u00b7 ${esc(p.spot)}</span>`:""}</div>`).join("");
  list.style.display=hits.length?"block":"none";
  list.querySelectorAll("div").forEach(d=>d.onclick=()=>{ WA_PIANO=PIANOS.get(d.dataset.k); $("#waPiano").value=WA_PIANO.label; list.style.display="none"; });
}
function renderDash(){
  const v=$("#sview-dash"); if(!v) return;
  if(!REPORTS.entries.length){ v.innerHTML=`<div class="curmsg">${t("cur_loading")}</div>`; return; }
  const wk=weekEntries(FRI_ISO), inSet=new Set(wk.map(e=>e.tech));
  const missing=ROSTER.filter(x=>!inSet.has(x));
  const year=new Date().getFullYear();
  const yearEntries=REPORTS.entries.filter(e=>e.year===year);
  const prevFri=new Date(FRI); prevFri.setDate(prevFri.getDate()-7);
  const prevCount=weekEntries(iso(prevFri)).length;
  const monthAgo=new Date(FRI); monthAgo.setDate(monthAgo.getDate()-28);
  const pianosMo=new Set();
  REPORTS.entries.filter(e=>e.date&&e.date>=iso(monthAgo)).forEach(e=>extractPianos(e.text).forEach(p=>pianosMo.add(p.serial||p.label)));
  const hrsMo=REPORTS.entries.filter(e=>e.date&&e.date>=iso(monthAgo)).reduce((s,e)=>s+sumHours(e.text),0);
  const recent=[...REPORTS.entries].filter(e=>e.date).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,6);
  v.innerHTML=`
    <div class="row1"><div><h2 class="page">${t("week_ending",fmtLong(FRI))}</h2>
      <div class="sub">${t("dash_sub",ROSTER.length,REPORTS.entries.length.toLocaleString())}</div></div></div>
    <div class="stats">
      <div class="stat"><div class="k">${t("st_reports_in")}</div><div class="v num">${inSet.size}<small>/${ROSTER.length}</small></div>
        <div class="d ${missing.length?"warn":"good"}">${missing.length?t("st_pending",esc(missing.slice(0,4).join(", "))+(missing.length>4?` +${missing.length-4}`:"")):t("st_everyone")}</div></div>
      <div class="stat"><div class="k">${t("st_lastweek")}</div><div class="v num">${prevCount}</div><div class="d">${t("st_reports_for",fmtShort(iso(prevFri)))}</div></div>
      <div class="stat"><div class="k">${t("st_pianos")}</div><div class="v num">${pianosMo.size}</div><div class="d">${t("st_pianos_d")}</div></div>
      <div class="stat"><div class="k">${t("st_hours")}</div><div class="v num">${hrsMo?hrsMo.toFixed(0):"—"}</div><div class="d">${t("st_hours_d")}</div></div>
      <div class="stat"><div class="k">${t("st_year",year)}</div><div class="v num">${yearEntries.length}</div><div class="d">${t("st_year_d",new Set(yearEntries.map(e=>e.tech)).size)}</div></div>
    </div>
    <div class="cols">
      <div class="card"><h4><span>${t("card_week")}</span> <span class="lite num">${fmtShort(FRI_ISO)}</span></h4>
        <table class="list"><tbody>${ROSTER.map(tc=>{
          const e=wk.find(x=>x.tech===tc);
          return e
            ? `<tr><td class="tech-name">${esc(tc)}</td><td class="excerpt">${esc(e.text.slice(0,160))}${e.text.length>160?"…":""}</td><td><span class="pill in">${t("pill_in")}</span></td></tr>`
            : `<tr><td class="tech-name">${esc(tc)}</td><td class="excerpt" style="color:var(--mut2)">—</td><td><span class="pill out">${t("pill_out")}</span></td></tr>`;
        }).join("")}</tbody></table></div>
      <div>
        <div class="card"><h4><span>${t("card_12w")}</span> <span class="lite">${t("lite_12w")}</span></h4>
          <div style="padding:8px 0">${complianceHTML()}</div></div>
        <div class="card" style="margin-top:18px"><h4>${t("card_activity")}</h4>
          <table class="list"><tbody>${recent.map(e=>`
            <tr><td class="date-cell">${fmtShort(e.date)}</td><td><span class="tech-name">${esc(e.tech)}</span>
            <div class="excerpt" style="font-size:12.5px;color:var(--mut)">${esc(e.text.slice(0,90))}${e.text.length>90?"…":""}</div></td></tr>`).join("")}</tbody></table></div>
      </div>
    </div>`;
}
const PROP_DAYS=["Monday","Tuesday","Wednesday","Thursday","Friday"];
// bridge timestamps are UTC ISO — show them in shop (Denver) time
function fmtDenver(iso){
  if(!iso) return "";
  const d=new Date(iso);
  if(isNaN(d)) return String(iso).slice(0,16).replace("T"," ");
  return d.toLocaleString("en-US",{timeZone:"America/Denver",
    month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
}
// 🕘 Adjustment history — the Adjustment Log tab (written by the adjust /
// bottleneck background functions) rendered newest-first so Brigham can see
// every past submission: what he wrote, what changed, rules banked, saved?
async function loadAdjustHistory(panel){
  panel.innerHTML=`<div class="curmsg">Loading history…</div>`;
  try{
    const key=encodeURIComponent(localStorage.getItem("blp.appkey")||"pianoman");
    const r=await fetch("https://blpsalesapp.netlify.app/.netlify/functions/adjust-log?key="+key);
    const j=await r.json();
    if(j.error) throw new Error(j.error);
    if(!(j.rows||[]).length){
      panel.innerHTML=`<div class="curmsg">No adjustment history yet — every "Apply adjustments"
        and bottleneck-answer run from Aug 10, 2026 onward is recorded here.</div>`;
      return;
    }
    panel.innerHTML=j.rows.map(row=>{
      const [when,by,kind,input,outcome,rules,questions,saved]=row.map(x=>String(x||""));
      const ok=saved.toLowerCase().startsWith("yes");
      return `<details class="ahentry">
        <summary><b>${esc(when)}</b> · ${esc(by)} · <i>${esc(kind)}</i>
          <span class="ahbadge ${ok?"ok":"bad"}">${ok?"✓ saved":"⚠ "+esc(saved)}</span></summary>
        ${input?`<div class="ahsec"><b>What you wrote</b><pre>${esc(input)}</pre></div>`:""}
        ${outcome?`<div class="ahsec"><b>What Claude did</b><pre>${esc(outcome)}</pre></div>`:""}
        ${rules?`<div class="ahsec"><b>📌 Rules remembered for future weeks</b><pre>${esc(rules)}</pre></div>`:""}
        ${questions?`<div class="ahsec qq"><b>Questions for you</b><pre>${esc(questions)}</pre></div>`:""}
      </details>`;
    }).join("");
  }catch(e){
    panel.innerHTML=`<div class="curmsg" style="color:var(--red)">Couldn't load history: ${esc(e.message)}</div>`;
  }
}
async function loadProposal(box){
  if(!box) return;
  box.innerHTML=`<div class="curmsg">Loading proposed week…</div>`;
  let got=null;
  try{
    const r=await fetch(CONFIG.STOREMAP_BRIDGE+"?fn=proposal",{redirect:"follow"});
    const j=await r.json();
    if(j.ok) got=j;
    // a double-encoded save leaves plan as a JSON string — parse, don't blank
    if(got&&typeof got.plan==="string"){ try{got.plan=JSON.parse(got.plan);}catch(e2){got=null;} }
  }catch(e){/* bridge not deployed yet — fall through */}
  if(!got){
    try{
      const r2=await fetch("https://blpshop.netlify.app/data/schedule-proposal.json?ts="+Date.now());
      if(r2.ok){ const plan=await r2.json(); got={ok:true,plan,meta:{week:plan.week,savedAt:plan.generatedAt||"",applied:false,fallback:true}}; }
    }catch(e){}
  }
  if(!got){ box.innerHTML=`<div class="curmsg">No weekly proposal yet — the Saturday draft publishes here, or ask Claude to generate one.</div>`; return; }
  const {plan,meta}=got;
  const colors=plan.colors||{};
  box.innerHTML=`<div class="propwrap">
    <div class="prophead">
      <h3>📅 Proposed Technician Week — ${esc(plan.week||"")}</h3>
      <span class="meta">${meta.fallback?"from repo snapshot":"from the weekly proposal"} · saved ${esc(fmtDenver(meta.savedAt))}
        ${meta.applied?" · <b style='color:#7fc48f'>APPLIED "+esc((meta.appliedAt||"").slice(0,10))+"</b>":""}</span>
      <button class="applybtn" id="applySched" ${meta.applied||meta.fallback?"disabled":""}>
        ${meta.applied?"✓ Applied to calendars":meta.fallback?"Apply (needs bridge update)":(meta.appliedTechs&&meta.appliedTechs.length?"✅ Approve more — "+meta.appliedTechs.length+" of "+((plan&&plan.techs)||[]).length+" applied":"✅ Approve — apply to live tech calendars")}</button>
    </div>
    <div class="propbody">
      <div class="adjustbar">
        <textarea id="adjGlobal" placeholder="Overall notes to Claude for this week — adjustments across techs, and standing rules ('from now on…', 'always…', 'never…') that should be remembered for every future week."></textarea>
        <button class="abtn" id="adjApply">🪄 Apply adjustments</button>
        <button class="abtn" id="adjHistBtn" style="background:none;border:1px solid var(--line);color:inherit">🕘 History</button>
      </div>
      <div class="adjustout" id="adjOut"></div>
      <div class="adjhist" id="adjHist" hidden></div>
      ${(plan.techs||[]).map(tc=>`<div class="proptech">
        <h5>${esc(tc.name)} <small>${esc(tc.hours||"")}</small><small style="margin-left:auto">${esc(tc.who||"")}</small></h5>
        <div class="ptflex"><div class="ptmain">
        <div class="propgrid">${PROP_DAYS.map((dn,di)=>{
          const blocks=(tc.days&&tc.days[di])||[];
          return `<div class="propday"><div class="dh">${dn}</div>${blocks.map(b=>
            `<div class="propblock" style="border-left-color:${colors[b[2]]||"#9aa3ac"}">
               <div class="bt">${esc(b[0])}–${esc(b[1])}</div>
               <div class="bl">${esc(b[3]||"")}</div>
               ${b[4]?`<div class="bn">${esc(b[4])}</div>`:""}</div>`).join("")}</div>`;
        }).join("")}</div>
        </div><aside class="ptnotes"><div class="ntag">Notes to Claude — ${esc(tc.name)}</div>
        <textarea data-tech="${esc(tc.name)}" placeholder="Adjustments for ${esc(tc.name)}'s week… ('swap Tue/Wed', 'he's out Thursday', 'rule: never schedule him on QC')"></textarea>
        </aside></div>
      </div>`).join("")}
      ${(plan.bottlenecks||[]).length?`<div class="bnhead"><h4>🛎 Manager Clarification Needed</h4>
        <div class="bnsub">Answer any of these in its box — Claude will make the Store Map / schedule updates, clear the resolved items, and remember any standing rules.</div></div>`:""}
      <div class="propboxes">${(plan.bottlenecks||[]).map((bn,i)=>
        `<div class="propbn" data-bi="${i}"><b>⚠ ${esc(bn[0])}</b>${esc(bn[1])}
           <textarea class="bnanswer" data-title="${esc(bn[0])}" data-body="${esc(bn[1])}"
             placeholder="Your answer / clarification for Claude… ('put it in spot 84', 'yes it spans both', 'the serial is actually …')"></textarea></div>`).join("")}</div>
      ${(plan.bottlenecks||[]).length?`<div class="bnbar"><button class="abtn" id="bnApply">🪄 Send answers to Claude</button></div>
      <div class="adjustout" id="bnOut"></div>`:""}
    </div>
    <div id="applyOut"></div>
  </div>`;
  const bna=box.querySelector("#bnApply");
  if(bna) bna.onclick=async()=>{
    const items=[];
    box.querySelectorAll(".bnanswer").forEach(t=>{ if(t.value.trim()) items.push({title:t.dataset.title,body:t.dataset.body,answer:t.value.trim()}); });
    const out=box.querySelector("#bnOut");
    if(!items.length){ out.className="adjustout err"; out.textContent="Write an answer in at least one box first."; return; }
    bna.disabled=true; bna.textContent="Working… (usually 30–90s)";
    try{
      const j=await aiJob("bottleneck-resolve-background",
        {key:localStorage.getItem("blp.appkey")||"pianoman",items,
          by:localStorage.getItem("blpmgr.name")||"Shop Manager"},
        s=>{ bna.textContent="Working… "+s+"s (usually 30–90s)"; });
      if(j.error) throw new Error(j.error);
      clearDrafts(".bnanswer");
      out.className="adjustout ok";
      out.innerHTML="✓ Answers processed"
        +(j.executed&&j.executed.length?"<ul>"+j.executed.map(c=>`<li>${esc(c)}</li>`).join("")+"</ul>":"")
        +(j.rules_saved&&j.rules_saved.length?`<div style="margin-top:6px"><b>📌 Remembered for future weeks:</b><ul>${j.rules_saved.map(c=>`<li>${esc(c)}</li>`).join("")}</ul></div>`:"")
        +(j.followups&&j.followups.length?`<div style="margin-top:6px"><b>👤 Still needs a human:</b><ul>${j.followups.map(c=>`<li>${esc(c)}</li>`).join("")}</ul></div>`:"")
        +(j.questions&&j.questions.length?`<div style="margin-top:6px;color:#8a6a00"><b>Questions back:</b><ul>${j.questions.map(c=>`<li>${esc(c)}</li>`).join("")}</ul></div>`:"");
      if(j.planSaved){ const keep=out.innerHTML;
        setTimeout(async()=>{ await loadProposal(box);
          const o2=box.querySelector("#bnOut")||box.querySelector("#adjOut");
          if(o2){ o2.className="adjustout ok"; o2.innerHTML=keep; } },2500); }
    }catch(e){ out.className="adjustout err"; out.textContent="✗ "+e.message; }
    bna.disabled=false; bna.textContent="🪄 Send answers to Claude";
  };
  // Draft persistence — typed notes/answers survive refreshes and reloads.
  // Saved per box on every keystroke, restored on render, cleared on send.
  const draftKey=el=>"draft_"+((el.id||el.dataset.tech||el.dataset.title||"")+"").slice(0,90);
  box.querySelectorAll(".ptnotes textarea, #adjGlobal, .bnanswer").forEach(t=>{
    const k=draftKey(t);
    const v=localStorage.getItem(k);
    if(v && !t.value) t.value=v;
    t.addEventListener("input",()=>{ t.value.trim()?localStorage.setItem(k,t.value):localStorage.removeItem(k); });
  });
  const clearDrafts=sel=>box.querySelectorAll(sel).forEach(t=>{ localStorage.removeItem(draftKey(t)); t.value=""; });
  // Cmd/Ctrl+Enter in any box = fire the matching send button (plain Enter stays a newline)
  box.querySelectorAll(".ptnotes textarea, #adjGlobal").forEach(t=>
    t.addEventListener("keydown",e=>{ if(e.key==="Enter"&&(e.metaKey||e.ctrlKey)){ e.preventDefault(); box.querySelector("#adjApply")?.click(); } }));
  box.querySelectorAll(".bnanswer").forEach(t=>
    t.addEventListener("keydown",e=>{ if(e.key==="Enter"&&(e.metaKey||e.ctrlKey)){ e.preventDefault(); box.querySelector("#bnApply")?.click(); } }));
  // Heavy AI jobs run as Netlify BACKGROUND functions (a schedule revision
  // takes 30-90s, past the sync limit). POST returns 202 instantly; the
  // result lands in a blob keyed by our nonce, which we poll here.
  const aiJob=async(fn,payload,onTick)=>{
    const nonce="adj_"+Date.now().toString(36)+"_"+Math.random().toString(36).slice(2,10);
    // adjust-submit is a sync relay: browsers can't POST straight to Netlify
    // background functions cross-origin (preflight gets an empty 202)
    const r=await fetch("https://blpsalesapp.netlify.app/.netlify/functions/adjust-submit",{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({fn:fn.startsWith("bottleneck")?"bottleneck":"schedule",payload:{...payload,nonce}})});
    if(r.status>=400) throw new Error("request failed ("+r.status+")");
    const t0=Date.now();
    while(Date.now()-t0<210000){
      await new Promise(res=>setTimeout(res,4000));
      if(onTick) onTick(Math.round((Date.now()-t0)/1000));
      const pr=await fetch("https://blpsalesapp.netlify.app/.netlify/functions/adjust-result?nonce="+nonce);
      if(pr.status===200) return pr.json();
    }
    throw new Error("timed out after 3½ min — the job may still finish; reload in a minute");
  };
  const ahb=box.querySelector("#adjHistBtn"), ahp=box.querySelector("#adjHist");
  if(ahb) ahb.onclick=()=>{
    if(ahp.hidden){ ahp.hidden=false; loadAdjustHistory(ahp); ahb.textContent="🕘 Hide history"; }
    else { ahp.hidden=true; ahb.textContent="🕘 History"; }
  };
  const adj=box.querySelector("#adjApply");
  if(adj) adj.onclick=async()=>{
    const notes={};
    box.querySelectorAll(".ptnotes textarea").forEach(t=>{ if(t.value.trim()) notes[t.dataset.tech]=t.value.trim(); });
    const globalTxt=(box.querySelector("#adjGlobal").value||"").trim();
    const out=box.querySelector("#adjOut");
    if(!Object.keys(notes).length && !globalTxt){ out.className="adjustout err"; out.textContent="Write a note first — per-tech or in the overall box."; return; }
    adj.disabled=true; adj.textContent="Thinking… (usually 30–90s)";
    try{
      const j=await aiJob("schedule-adjust-background",
        {key:localStorage.getItem("blp.appkey")||"pianoman",notes,global:globalTxt,
          by:localStorage.getItem("blpmgr.name")||"Shop Manager"},
        s=>{ adj.textContent="Thinking… "+s+"s (usually 30–90s)"; });
      if(j.error) throw new Error(j.error);
      clearDrafts(".ptnotes textarea, #adjGlobal");
      out.className="adjustout ok";
      out.innerHTML="✓ Adjustments applied"+(j.saved?" and saved":" (⚠ save to bridge failed: "+esc(j.saveErr||"pending bridge update")+")")
        +(j.changes.length?"<ul>"+j.changes.map(c=>`<li>${esc(c)}</li>`).join("")+"</ul>":"")
        +(j.rules_saved.length?`<div style="margin-top:6px"><b>📌 Remembered for future weeks:</b><ul>${j.rules_saved.map(c=>`<li>${esc(c)}</li>`).join("")}</ul></div>`:"")
        +(j.questions&&j.questions.length?`<div style="margin-top:6px;color:#8a6a00"><b>Questions:</b><ul>${j.questions.map(c=>`<li>${esc(c)}</li>`).join("")}</ul></div>`:"");
      { const keep=out.innerHTML;
        setTimeout(async()=>{ await loadProposal(box);
          const o2=box.querySelector("#adjOut");
          if(o2){ o2.className="adjustout ok"; o2.innerHTML=keep; } }, j.saved?1500:6000); }
    }catch(e){
      out.className="adjustout err"; out.textContent="✗ "+e.message;
    }
    adj.disabled=false; adj.textContent="🪄 Apply adjustments";
  };
  const ab=box.querySelector("#applySched");
  // prompt()/confirm() are blocked in embedded browsers (why the button
  // seemed dead) — inline confirm + PIN instead
  const doApply=async(pin,techs)=>{
    ab.disabled=true; ab.textContent="Applying…";
    const out=box.querySelector("#applyOut");
    try{
      const r=await fetch(CONFIG.STOREMAP_BRIDGE,{method:"POST",redirect:"follow",
        headers:{"content-type":"text/plain;charset=utf-8"},
        body:JSON.stringify({action:"applyschedule",pin,techs,user:{name:(localStorage.getItem("blpmgr.name")||"Shop Manager")+" (Shop Manager)"}})});
      const j=await r.json();
      if(j.error) throw new Error(j.error);
      out.className="applyout";
      out.innerHTML="✓ Applied — "+j.results.map(x=>`<b>${esc(x.tech)}</b>: ${x.events!=null?x.events+" events":esc(x.skipped||x.error||"?")}`).join(" · ");
      if(j.applied){ ab.textContent="✓ Applied to calendars"; }
      else { ab.disabled=false; ab.textContent="✅ Approve — apply to live tech calendars"; }
      setTimeout(()=>loadProposal(box),2500);
    }catch(e){
      out.className="applyout err"; out.textContent="✗ "+e.message;
      ab.disabled=false; ab.textContent="✅ Approve — apply to live tech calendars";
    }
  };
  if(ab&&!ab.disabled) ab.onclick=()=>{
    const out=box.querySelector("#applyOut");
    if(box.querySelector("#applyPin")){ box.querySelector("#applyPin").focus(); return; }
    const appliedSet=new Set((meta.appliedTechs||[]).map(n=>n.toLowerCase()));
    out.className="applyout";
    out.innerHTML=`Pick who goes live — only checked technicians' proposed weeks are written to their REAL
      Google Calendars (add-only; nothing existing is deleted; techs without a calendar on the Tech Calendars tab are skipped).<br>
      <div id="applyTechs" style="display:flex;gap:6px 14px;flex-wrap:wrap;margin:9px 0 4px">
        ${(plan.techs||[]).map(tc=>{
          const done=appliedSet.has(tc.name.toLowerCase());
          return `<label style="display:inline-flex;gap:5px;align-items:center;font-size:13px;${done?"color:var(--mut2)":""}">
            <input type="checkbox" value="${esc(tc.name)}" ${done?"":"checked"}> ${esc(tc.name)}${done?" ✓applied":""}</label>`;
        }).join("")}
      </div>
      <span style="display:inline-flex;gap:7px;margin-top:4px;align-items:center;flex-wrap:wrap">
        <button class="abtn" id="applyNone" style="background:none;border:1px solid var(--line)">none</button>
        <button class="abtn" id="applyAll" style="background:none;border:1px solid var(--line)">all</button>
        <input id="applyPin" type="password" placeholder="Team PIN" autocomplete="off"
          style="border:1px solid #cfc9bf;border-radius:6px;padding:8px 11px;font:inherit;font-size:13.5px">
        <button class="abtn" id="applyGo2">Apply selected</button>
        <button class="abtn" id="applyCancel" style="background:none;border:1px solid var(--line)">Cancel</button>
      </span>`;
    const pin=box.querySelector("#applyPin");
    const picked=()=>[...box.querySelectorAll("#applyTechs input:checked")].map(c=>c.value);
    box.querySelector("#applyAll").onclick=()=>box.querySelectorAll("#applyTechs input").forEach(c=>c.checked=true);
    box.querySelector("#applyNone").onclick=()=>box.querySelectorAll("#applyTechs input").forEach(c=>c.checked=false);
    const go=()=>{
      const sel=picked();
      if(!sel.length){ out.insertAdjacentHTML("beforeend","<br><b style='color:var(--red)'>Check at least one technician.</b>"); return; }
      if(!pin.value.trim()){ pin.focus(); return; }
      doApply(pin.value.trim(),sel);
    };
    box.querySelector("#applyGo2").onclick=go;
    box.querySelector("#applyCancel").onclick=()=>{ out.innerHTML=""; };
    pin.onkeydown=e=>{ if(e.key==="Enter") go(); };
  };
}
function renderPlanner(){
  const v=$("#sview-planner"); if(!v) return;
  v.innerHTML=`<div id="proposalBox"></div>`;
  loadProposal(v.querySelector("#proposalBox"));
}
/* Week Board tab retired 9/4 (Brigham) — renderWeek/currentWeekColumn removed. */

/* ===== live Store Map data (queue positions, phases, tracks) + roster
 * positions — shared by the Sequence recommendations and the Pipeline's
 * live For Sale / Sale Pending columns ===== */
let MAPD=null, MAPD_LOADING=false, ROSTER_POS={};
function needMapData(){
  if(MAPD || MAPD_LOADING) return !!MAPD;
  MAPD_LOADING=true;
  Promise.all([
    fetch("/api/data").then(r=>r.json()).catch(()=>null),
    fetch("https://blpsalesapp.netlify.app/.netlify/functions/team-roster?key=pianoman")
      .then(r=>r.json()).catch(()=>null),
  ]).then(([d,ro])=>{
    if(d && d.pianos) MAPD=d;
    ((((ro||{}).tabs||{})["Current Team"])||[]).slice(1).forEach(r=>{
      const first=String(r[0]||"").trim().toLowerCase();
      if(first) ROSTER_POS[first]=String(r[2]||"");
    });
    schedRerender();
  }).catch(()=>{}).then(()=>{ MAPD_LOADING=false; });
  return false;
}
const digitsOf = s => String(s||"").replace(/\D/g,"");
function livePhase(ph){
  return ((MAPD&&MAPD.pianos)||[]).filter(x=>x.active && String(x.phase||"").trim()===ph);
}

function linkSerials(html){
  return html.replace(/\b(\d{4,8})\b/g,(m,d)=> PIANOS.has(skey(d))
    ? `<a class="serial-link" target="_blank" rel="noreferrer" href="${CONFIG.PIANOLOG_URL}?q=${d}">${d}</a>` : m);
}

/* ================= SEQUENCE BOARD ================= */
function seqLaneHTML(r){
  const tech=(r[1]||"").trim();
  const jobs=r.slice(2).map(s=>s.trim()).filter(Boolean);
  return `<div class="lane"><h4>${esc(tech)} <span class="n num">${jobs.length}</span></h4>
    ${jobs.length?jobs.map(j=>{
      BRAND_RE.lastIndex=0; const m=BRAND_RE.exec(j);
      const rec = m&&m[2] ? PIANOS.get(skey(m[2])) : null;
      return `<div class="job">${linkSerials(esc(j))}
        ${rec&&rec.progress!=null?`<div class="meta"><div class="prog"><i style="width:${rec.progress}%"></i></div><span class="num" style="font-size:11px;color:var(--mut2)">${rec.progress}%</span></div>`:""}
        ${rec&&rec.lastDate?`<div class="meta" style="font-size:11px;color:var(--mut2)">${t("ck_report")}: ${fmtShort(rec.lastDate)}</div>`:""}
      </div>`;
    }).join(""):`<div class="job" style="color:var(--mut2)">${t("empty_lane")}</div>`}
  </div>`;
}
/* ---- 🧠 next-piano recommendations (Brigham 9/4) ----
 * Candidates = queue pianos not started (no phase / In Queue / New Arrival)
 * and not already named in ANY sequence lane. Ranked by queue order; a
 * refinisher gets refinish-track pianos first, everyone else the opposite;
 * techs with the emptiest lanes are served first. Approving writes the job
 * into that tech's row on the Sequence tab via the bridge — nothing changes
 * until a manager/owner taps Approve. */
const REC_DISMISS_KEY="blpmgr.recdismiss";
function buildRecs(activeRows){
  if(!needMapData()) return null;   // kicks off the fetch; rerenders when in
  const inSeq=new Set();
  seqRows().forEach(r=>r.slice(2).forEach(j=>(String(j||"").match(/\d{4,8}/g)||[]).forEach(s=>inSeq.add(s))));
  const dism=store.get(REC_DISMISS_KEY,{});
  const pool=MAPD.pianos.filter(p=>p.active && p.queuePos && p.serial
      && !/pre[\s-]?queue/i.test(p.status||"")
      && ["","In Queue","New Arrival - Admin"].includes(String(p.phase||"").trim())
      && digitsOf(p.serial).length>=4 && !inSeq.has(digitsOf(p.serial))
      && !dism[digitsOf(p.serial)])
    .sort((a,b)=>a.queuePos-b.queuePos);
  const lanes=activeRows.map(r=>{
    const tech=(r[1]||"").trim();
    return {tech, load:r.slice(2).filter(c=>(c||"").trim()).length,
      refin:/refinish/i.test(ROSTER_POS[tech.split(/\s+/)[0].toLowerCase()]||"")};
  }).sort((a,b)=>a.load-b.load);
  const recs=[];
  lanes.forEach(l=>{
    if(!pool.length) return;
    let i=pool.findIndex(p=>l.refin===/refinish/i.test(p.track||""));
    if(i<0) i=0;
    const p=pool.splice(i,1)[0];
    const why=[`queue #${p.queuePos}`];
    if(p.track) why.push(String(p.track).split(",")[0].trim());
    why.push(l.load?`${l.load} in lane`:"open lane");
    if(l.refin&&/refinish/i.test(p.track||"")) why.push(LANG==="es"?"acabado ↔ acabador":"refinish ↔ refinisher");
    recs.push({tech:l.tech, p, why:why.join(" · ")});
  });
  return recs;
}
function recRowHTML(r){
  const sn=digitsOf(r.p.serial);
  return `<div class="job recrow" data-sn="${esc(sn)}" data-tech="${esc(r.tech)}" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
    <b style="min-width:76px">${esc(r.tech.split(/\s+/)[0].toUpperCase())}</b>
    <span style="flex:1;min-width:180px">${linkSerials(esc((r.p.summary||"piano")+" "+r.p.serial))}
      <div class="meta" style="font-size:11px;color:var(--mut2)">${esc(r.why)}</div></span>
    <button class="btn2 recok" data-entry="${esc(((r.p.summary||"")+" "+r.p.serial).trim())}">${t("rec_add")}</button>
    <button class="btn2 recno" style="color:var(--mut)">${t("rec_skip")}</button>
    <span class="recmsg" style="font-size:12px"></span></div>`;
}
async function recApprove(row){
  const tech=row.dataset.tech, entry=row.querySelector(".recok").dataset.entry;
  const msg=row.querySelector(".recmsg");
  const auth=(window.writeAuth?writeAuth():{pin:"",ok:true});
  msg.textContent="…";
  try{
    const r=await fetch(CONFIG.STOREMAP_BRIDGE,{method:"POST",redirect:"follow",
      headers:{"content-type":"text/plain;charset=utf-8"},
      body:JSON.stringify({pin:auth.pin,action:"seqadd",tech,entry,
        ...(window.authFields?authFields():{})})});
    const j=await r.json();
    if(j.error) throw new Error(j.error);
    // the bridge serves its ping response to POSTs for a minute after a
    // deploy — {ok:true, service:…} with no cell means nothing was written
    if(!j.cell) throw new Error("bridge is busy — try again in a minute");
    msg.textContent=t("rec_added"); msg.style.color="#2c7a3f";
    // optimistic: put it in the lane locally so the board matches the sheet
    const f=tech.split(/\s+/)[0].toLowerCase();
    const lane=SEQ.find(x=>(x[1]||"").trim().split(/\s+/)[0].toLowerCase()===f);
    if(lane) lane.push(entry);
    setTimeout(renderSequence,700);
  }catch(e){ msg.textContent="✗ "+(e.message||e); msg.style.color="#9e2020"; }
}
function renderSequence(){
  const firsts=new Set(ROSTER.map(n=>n.split(/\s+/)[0].toLowerCase()));
  const active=[], others=[];
  seqRows().forEach(r=>{
    (firsts.has((r[1]||"").trim().split(/\s+/)[0].toLowerCase())?active:others).push(r);
  });
  const recs=buildRecs(active);
  const recsHTML=`<div class="lane" style="margin:0 0 16px;border:1px dashed #b9a76b;background:#fdfaf1">
    <h4>${t("rec_title")}</h4>
    <div class="sub" style="margin:2px 0 8px">${t("rec_sub")}</div>
    ${recs===null?`<div class="job" style="color:var(--mut2)">${t("rec_loading")}</div>`
      :(recs.length?recs.map(recRowHTML).join(""):`<div class="job" style="color:var(--mut2)">${t("rec_none")}</div>`)}
  </div>`;
  $("#sview-sequence").innerHTML=`
    <div class="row1"><div><h2 class="page">${t("seq_title")}</h2><div class="sub">${t("seq_sub")}</div></div></div>
    ${recsHTML}
    <div class="lanes">${active.map(seqLaneHTML).join("")}</div>
    ${others.length?`<details style="margin-top:18px"><summary style="cursor:pointer;color:var(--mut);font-size:13.5px">+ ${others.length}</summary>
      <div class="lanes" style="margin-top:12px">${others.map(seqLaneHTML).join("")}</div></details>`:""}`;
  document.querySelectorAll("#sview-sequence .recrow").forEach(row=>{
    const ok=row.querySelector(".recok"), no=row.querySelector(".recno");
    ok.onclick=()=>{ ok.disabled=true; recApprove(row); };
    no.onclick=()=>{
      const d=store.get(REC_DISMISS_KEY,{}); d[row.dataset.sn]=Date.now();
      store.set(REC_DISMISS_KEY,d); renderSequence();
    };
  });
}

/* ================= PIPELINE ================= */
/* Rebuilt 9/4 (Brigham): columns now come STRAIGHT from each piano's live
 * CURRENT PHASE on the Store Map — no more keyword guessing from old
 * reports (which kept long-gone tech names on the board). Order: shop
 * phases left-to-right, then Waiting/Paused, For Sale, Sale Pending,
 * Delivered at the far right. */
const PHASES=[
  {id:"QUEUE",    ph:"In Queue",                 en:"In Queue",           es:"En cola",             code:"", hb:[]},
  {id:"INTAKE",   ph:"New Arrival - Admin",      en:"New Arrival",        es:"Recién llegado",      code:"", hb:["Storing Cabinetry"]},
  {id:"ASSESS",   ph:"Assessment",               en:"Assessment",         es:"Evaluación",          code:"", hb:["Tear-down Sheet (§16)","Upright Teardown: Cleaning & Prep","Grand Teardown: Cleaning & Prep","Storing Cabinetry (§14)"]},
  {id:"CAP",      ph:"CAP",                      en:"CAP",                es:"CAP",                 code:"Cleaning · Action Prep", hb:["Cleaning and Prep","Action Prep","Reshape Hammers","Hammer Prep & Hanging","Keys (§13)"]},
  {id:"PRSBA",    ph:"PRSBa - Pre-Plate",        en:"PRSBa · Pre-Plate",  es:"PRSBa · sin placa",   code:"Perimeter · Ribs · Soundboard · Bridge — mini-QC before the plate", hb:["Find Proper Downbearing: Targets","How to Chisel a Bridge"]},
  {id:"PRSBB",    ph:"PRSBb - Plate In",         en:"PRSBb · Plate In",   es:"PRSBb · placa puesta",code:"Plate back in — finish out", hb:[]},
  {id:"LACQUER",  ph:"Lacquer Soundboard",       en:"Lacquer Soundboard", es:"Laca de tabla",       code:"", hb:[]},
  {id:"RESTRING", ph:"Restringing",              en:"Restringing",        es:"Encordado",           code:"", hb:["Restringing (§12)","Removing Tuning Pins"]},
  {id:"CHIPTUNE", ph:"Chip Tuning",              en:"Chip Tuning",        es:"Afinación de asiento",code:"", hb:[]},
  {id:"DHRT",     ph:"DHRT",                     en:"DHRT",               es:"DHRT",                code:"Dampers · Hammers · Regulation · Trapwork", hb:["Upright Regulation","Grand Piano Regulation Theory","Key Leveling","Tricks for Let Off Regulation","Aligning Backchecks","Damper Lift","Damper Spoon Regulation","Spring Strength, Drop, and Dip"]},
  {id:"TUNING1",  ph:"1st Tuning",               en:"1st Tuning",         es:"1.ª afinación",       code:"", hb:[]},
  {id:"REFINISH", ph:"Refinishing",              en:"Refinishing",        es:"Acabado",             code:"L1 · L2 · L3", hb:["Buffing Basics","Buffing Casters","Hardware (§3)"]},
  {id:"QC",       ph:"QC & Assembly",            en:"QC & Assembly",      es:"QC y ensamblaje",     code:"", hb:["QC Checklist (doc)","Storing Cabinetry (§14)","Hardware (§3)"]},
  {id:"TUNING2",  ph:"2nd Tuning",               en:"2nd Tuning",         es:"2.ª afinación",       code:"", hb:[]},
  {id:"EXIT",     ph:"Exit Prep - Admin",        en:"Exit Prep",          es:"Preparación de salida", code:"", hb:[]},
  {id:"WAITING",  ph:"",                         en:"Waiting / Paused",   es:"En espera / pausa",   code:"", hb:[]},
  {id:"FORSALE",  ph:"For Sale",                 en:"For Sale",           es:"En venta",            code:"", hb:[]},
  {id:"SALEPEND", ph:"Sale Pending",             en:"Sale Pending",       es:"Venta pendiente",     code:"", hb:[]},
  {id:"DELIVERED",ph:"Delivered",                en:"Delivered",          es:"Entregado",           code:"", hb:[]},
];
const phaseName=p=>LANG==="es"?p.es:p.en;
function renderPipeline(){
  if(!needMapData()){
    $("#sview-pipeline").innerHTML=`<div class="row1"><div><h2 class="page">${t("pipe_title")}</h2>
      <div class="sub">${t("pipe_sub")}</div></div></div>
      <div style="color:var(--mut2);padding:22px 0">Loading the live shop data…</div>`;
    return;
  }
  const cols={}; PHASES.forEach(p=>cols[p.id]=[]);
  const byPh=new Map(PHASES.map(p=>[p.ph,p.id]));
  MAPD.pianos.forEach(x=>{
    const ph=String(x.phase||"").trim();
    if(!x.active){ if(ph==="Delivered") cols.DELIVERED.push(x); return; }
    if(/^(Waiting|Paused)/i.test(ph)) return cols.WAITING.push(x);
    if(ph==="Sold"||ph==="Sale Pending") return cols.SALEPEND.push(x);
    if(byPh.has(ph)&&ph) return cols[byPh.get(ph)].push(x);
    if(!ph && x.queuePos) return cols.QUEUE.push(x);
  });
  Object.values(cols).forEach(a=>a.sort((p,q)=>(p.queuePos||9e5)-(q.queuePos||9e5)
    || String(p.summary||"").localeCompare(String(q.summary||""))));
  const recentCut=new Date(); recentCut.setDate(recentCut.getDate()-120);
  const cutIso=iso(recentCut);
  const card=x=>{
    const rec=PIANOS.get(skey(x.serial));
    const recent = rec && rec.lastDate && rec.lastDate>=cutIso;
    return `<div class="pcard2"><a class="serial-link" target="_blank" rel="noreferrer" href="${CONFIG.PIANOLOG_URL}?q=${skey(x.serial)}">${esc(x.summary||("#"+x.serial))}</a>
      <div class="meta" style="margin-top:4px">
        ${x.location?`<span class="pill lvl">${esc(x.location)}</span>`:""}
        ${x.queuePos?`<span class="pill lvl num">Q-${x.queuePos}</span>`:""}
        ${String(x.phase||"")==="Sold"?`<span class="pill ok">SOLD</span>`:""}
        ${x.price?`<span class="pill ok num">${esc(String(x.price))}</span>`:""}
        ${recent&&rec.progress!=null?`<span class="pill ok num">${rec.progress}%</span>`:""}
      </div>
      ${/^(Waiting|Paused)/i.test(String(x.phase||""))?`<div style="font-size:11px;color:var(--mut2);margin-top:4px">${esc(String(x.phase))}${(x.waitNote||"").trim()?" — "+esc(x.waitNote):""}</div>`:""}
    </div>`;
  };
  const colBody=rows=>{
    const first=rows.slice(0,15), rest=rows.slice(15);
    return first.map(card).join("")+(rest.length?`<details><summary style="cursor:pointer;color:var(--mut2);font-size:12px;padding:6px 2px">+ ${rest.length} more</summary>${rest.map(card).join("")}</details>`:"");
  };
  $("#sview-pipeline").innerHTML=`
    <div class="row1"><div><h2 class="page">${t("pipe_title")}</h2><div class="sub">${t("pipe_sub")}</div></div></div>
    <div class="pipe">${PHASES.map(p=>`
      <div class="pcol"><h4>${phaseName(p)} <span style="display:flex;gap:5px;align-items:center"><span class="n num">${cols[p.id].length}</span>${p.hb.length?`<button class="hb" data-p="${p.id}">?</button>`:""}</span></h4>
        <div class="code">${p.code}</div>
        ${colBody(cols[p.id])}
      </div>`).join("")}
    </div>`;
  document.querySelectorAll(".pcol .hb").forEach(b=>b.onclick=()=>{
    const p=PHASES.find(x=>x.id===b.dataset.p);
    let pop=document.getElementById("shbpop");
    if(!pop){ pop=document.createElement("div"); pop.id="shbpop";
      pop.innerHTML='<div id="shbcard"><button id="shbx">✕</button><div id="hbbox"></div></div>';
      document.body.appendChild(pop);
      pop.onclick=ev=>{ if(ev.target===pop||ev.target.id==="shbx") pop.classList.remove("on"); }; }
    $("#hbbox").innerHTML=`<h3>${phaseName(p)}</h3><div style="color:var(--mut2);font-size:12px">${p.code}</div>
      <div style="font-weight:700;font-size:12px;letter-spacing:.1em;text-transform:uppercase;margin-top:12px;color:#57524b">${t("hb_sections")}</div>
      <ul>${p.hb.map(h=>{
        const sec=/§(\d+[a-z]?)/.exec(h);   // items tagged (§N) deep-link into the in-app handbook
        return sec?`<li><a target="_blank" rel="noreferrer" href="https://blpshop.netlify.app/index.html#handbook-s${sec[1]}">${esc(h)}</a></li>`:`<li>${esc(h)}</li>`;
      }).join("")}</ul>
      <a class="btn" style="display:inline-block;text-decoration:none" target="_blank" rel="noreferrer" href="${p.id==="QC"?CONFIG.QC_DOC_URL:CONFIG.HANDBOOK_APP}">${t("open_handbook")}</a>`;
    document.getElementById("shbpop").classList.add("on");
  });
}
/* ================= 🧪 REPORT vs CARD AUDIT (Brigham 9/4) =================
 * Are techs keeping the piano data cards updated? Every serial in each
 * tech's latest weekly report is checked against the card's live CURRENT
 * PHASE. Keyword-based — a coaching aid, not a verdict. */
const AUD_STEMS=[
  ["Restringing",/restring|strung|stringing/],
  ["Chip Tuning",/chip/],
  ["CAP",/\bcap\b|action prep|hammers hung|reshap/],
  ["PRSB",/prsb|soundboard|bridge|pinblock|downbearing|ribs/],
  ["Lacquer Soundboard",/lacquer/],
  ["Refinishing",/refinish|sanding|sanded|spray|stain|filler|buff/],
  ["DHRT",/dhrt|regulat|voic|damper|trapwork|let ?off|key level/],
  ["QC & Assembly",/\bqc\b|quality|assembl/],
  ["Tuning",/tun(e|ed|ing)/],
  ["Exit Prep - Admin",/exit prep/],
];
const PH_ORDER=["New Arrival - Admin","Assessment","CAP","PRSBa - Pre-Plate","PRSBb - Plate In",
  "Lacquer Soundboard","Restringing","Chip Tuning","DHRT","1st Tuning","Refinishing",
  "QC & Assembly","2nd Tuning","Exit Prep - Admin"];
const AUD_FAMILY=ph=>{
  const s=String(ph||"");
  if(/^PRSB/i.test(s)) return "PRSB";
  if(/Tuning/i.test(s)) return "Tuning";
  return s;
};
function audClaim(line){
  const l=line.toLowerCase();
  for(const [ph,re] of AUD_STEMS){ if(re.test(l)) return ph; }
  return null;
}
function renderAudit(){
  if(!needMapData()){
    $("#sview-audit").innerHTML=`<div class="row1"><div><h2 class="page">${t("aud_title")}</h2>
      <div class="sub">${t("aud_sub")}</div></div></div>
      <div style="color:var(--mut2);padding:22px 0">Loading the live shop data…</div>`;
    return;
  }
  const bySn=new Map();
  MAPD.pianos.forEach(p=>{ const k=digitsOf(p.serial); if(k.length>=4) bySn.set(k,p); });
  const DONE_RE=/finish|finished|done|complete|completed|100\s*%|wrapped up|ready for/i;
  const techs=ROSTER.map(tc=>{
    const mine=REPORTS.entries.filter(e=>e.tech===tc&&e.date).sort((a,b)=>b.date.localeCompare(a.date));
    const rep=mine.find(e=>e.date===FRI_ISO)||mine[0];
    const rows=[]; let flags=0;
    if(rep){
      const lines=String(rep.text||"").split(/\n|(?<=[.;!])\s+(?=[A-Z0-9])/).map(s=>s.trim()).filter(Boolean);
      const seen=new Set();
      lines.forEach(line=>{
        (line.match(/\d{4,8}/g)||[]).forEach(tok=>{
          if(seen.has(tok)) return; seen.add(tok);
          const p=bySn.get(tok);
          if(!p){ rows.push({kind:"ghost",tok,line}); return; }
          const card=String(p.phase||"").trim();
          const claim=audClaim(line);
          const done=DONE_RE.test(line);
          if(!card && !p.queuePos){
            rows.push({kind:"nocard",tok,line,p,card:"(no phase set)"}); flags++;
          } else if(claim && card && !/^(Waiting|Paused|For Sale|Sale Pending|Sold|In Queue)/i.test(card)
              && AUD_FAMILY(claim)!==AUD_FAMILY(card)
              // tuners tune pianos in every phase — a Tuning claim only flags
              // when the card is clearly BEHIND the first tuning of the flow
              && (AUD_FAMILY(claim)!=="Tuning"
                  || (PH_ORDER.indexOf(card)>=0 && PH_ORDER.indexOf(card)<PH_ORDER.indexOf("Chip Tuning")))){
            rows.push({kind:"mismatch",tok,line,p,card,claim}); flags++;
          } else if(done && claim && AUD_FAMILY(claim)===AUD_FAMILY(card)){
            rows.push({kind:"stale",tok,line,p,card,claim}); flags++;
          }
        });
      });
    }
    return {tc,rep,rows,flags};
  }).sort((a,b)=>b.flags-a.flags || (a.rep?0:1)-(b.rep?0:1));
  const badge=n=>n?`<span class="pill" style="background:#f6e3e3;color:#9e2020;font-weight:700">${n} to check</span>`
                  :`<span class="pill ok">clean</span>`;
  const kindLabel={mismatch:"card says a different phase",stale:"reported done/finished — card phase unchanged",
    nocard:"worked on, but the card has no phase",ghost:"serial not found on the map (typo? sold?)"};
  const rowHTML=r=>`<div class="job" style="border-left:3px solid ${r.kind==="ghost"?"#b9b2a6":"#9e2020"};padding-left:9px;margin:7px 0">
      <div><b>${r.p?linkSerials(esc((r.p.summary||"")+" "+r.tok)):esc("#"+r.tok)}</b>
        ${r.card?`<span class="pill lvl">card: ${esc(r.card)}</span>`:""}
        ${r.claim?`<span class="pill lvl">report: ${esc(r.claim)}</span>`:""}</div>
      <div style="font-size:11.5px;color:var(--mut2);margin-top:3px">${esc(kindLabel[r.kind])}</div>
      <div style="font-size:12px;margin-top:3px;color:var(--mut)">“${esc(r.line.slice(0,180))}”</div>
    </div>`;
  $("#sview-audit").innerHTML=`
    <div class="row1"><div><h2 class="page">${t("aud_title")}</h2><div class="sub">${t("aud_sub")}</div></div></div>
    <div class="lanes" style="grid-template-columns:1fr">${techs.map(x=>`
      <div class="lane"><h4>${esc(x.tc)} ${badge(x.flags)}
          ${x.rep?`<span style="font-weight:400;color:var(--mut2);font-size:12px">· report ${fmtShort(x.rep.date)}</span>`
                 :`<span style="font-weight:400;color:#9e2020;font-size:12px">· ${t("aud_noreport")}</span>`}</h4>
        ${x.rows.length?x.rows.map(rowHTML).join("")
          :(x.rep?`<div class="job" style="color:var(--mut2)">${t("aud_clean")}</div>`:"")}
      </div>`).join("")}
    </div>`;
}

/* ================= 🪜 SPECIALTIES — Skill Ladder + Versatility Matrix =====
 * Store: "Specialties" tab on the report sheet (Skill|Tech|Level|Rank|Note),
 * served by bridge fn=specialties, edited via action specset (managers/
 * owners). Seeded 9/4 from Brigham's tech-specialties notes + report history
 * + work-clock history. Levels 0-6; rank = ladder order within a skill.
 * ⚡ performance = live work-clock hours vs phase standard × mini-QC
 * first-pass rate — shown as evidence, never auto-changes a level. */
const SPEC_LVLS=[
  {label:"—",       pill:"",                     cls:""},
  {label:"Trainee", pill:"🎓 TRAINEE",           cls:"spl1"},
  {label:"Trained", pill:"✅ TRAINED",           cls:"spl2"},
  {label:"Competent",pill:"💪 COMPETENT",        cls:"spl3"},
  {label:"Reliable",pill:"🛡 RELIABLE",          cls:"spl4"},
  {label:"Expert",  pill:"⭐ EXPERT",            cls:"spl5"},
  {label:"Best in Shop",pill:"🏆 BEST IN SHOP",  cls:"spl6"},
];
const SPEC_CELL=["—","🎓","✅","💪","🛡","⭐","🏆"];
const SPEC_STDH={CAP:40,PRSB:40,"lacquer soundboard":12,restringing:40,"chip tuning":2,
  tuning:2,"DHRT for uprights":48,"DHRT for grands":48,refurbishing:48,repairs:8,
  "QC and assembly":17,keys:22,refinishing:62};
const SPEC_PH2SK={"CAP":"CAP","PRSB & Plate Refinishing":"PRSB","PRSBa - Pre-Plate":"PRSB",
  "PRSBb - Plate In":"PRSB","Lacquer Soundboard":"lacquer soundboard","Restringing":"restringing",
  "Chip Tuning":"chip tuning","1st Tuning":"tuning","2nd Tuning":"tuning","DHRT":"DHRT for uprights",
  "Refinishing":"refinishing","QC & Assembly":"QC and assembly","Key Service":"keys",
  "Refurb checklist":"refurbishing","Repair Work":"repairs"};
let SPEC=null, SPEC_LOADING=false, SPERF=null, SPERF_LOADING=false;
function needSpec(){
  if(SPEC||SPEC_LOADING) return !!SPEC;
  SPEC_LOADING=true;
  fetch(CONFIG.STOREMAP_BRIDGE+"?fn=specialties",{redirect:"follow"}).then(r=>r.json()).then(j=>{
    if(j&&j.ok) SPEC=j;
    schedRerender();
  }).catch(()=>{}).then(()=>{SPEC_LOADING=false;});
  return false;
}
function needSpecPerf(){
  if(SPERF||SPERF_LOADING) return !!SPERF;
  SPERF_LOADING=true;
  const K="sb_publishable_MamcjSX0CHTdYlpKDWSkmQ_-nbuQ1z-";
  Promise.all([
    fetch(CONFIG.STOREMAP_BRIDGE+"?fn=timelog&days=180",{redirect:"follow"}).then(r=>r.json()).catch(()=>null),
    fetch("https://ismacawxfvvllfinibbf.supabase.co/rest/v1/qc_requests?select=by,phase,status&limit=1000",
      {headers:{apikey:K,Authorization:"Bearer "+K}}).then(r=>r.json()).catch(()=>[]),
  ]).then(([tl,qc])=>{
    const agg={};   // "first|skill" -> {min, pianos:Set, pass, rework}
    const get=(f,sk)=>{ const k=f+"|"+sk; return agg[k]||(agg[k]={min:0,pianos:new Set(),pass:0,rework:0}); };
    (((tl||{}).rows)||[]).forEach(r=>{
      const sk=SPEC_PH2SK[String(r.phase||"").trim()]; if(!sk) return;
      const f=String(r.tech||"").split(/\s+/)[0].toLowerCase();
      if(!f||f==="claude") return;
      const a=get(f,sk); a.min+=r.minutes||0; if(r.serial) a.pianos.add(r.serial);
    });
    (Array.isArray(qc)?qc:[]).forEach(q=>{
      const sk=SPEC_PH2SK[String(q.phase||"").trim()]; if(!sk) return;
      const f=String(q.by||"").split(/\s+/)[0].toLowerCase(); if(!f) return;
      if(q.status==="passed") get(f,sk).pass++;
      else if(q.status==="rework") get(f,sk).rework++;
    });
    SPERF=agg;
    schedRerender();
  }).catch(()=>{ SPERF={}; }).then(()=>{SPERF_LOADING=false;});
  return false;
}
function specPerf(tech,skill){
  if(!SPERF) return null;
  const a=SPERF[String(tech||"").split(/\s+/)[0].toLowerCase()+"|"+skill];
  if(!a||(!a.min&&!a.pass&&!a.rework)) return null;
  const n=a.pianos.size||0, std=SPEC_STDH[skill]||0;
  const avg=n?a.min/60/n:0;
  const qcN=a.pass+a.rework;
  const qual=qcN?(a.pass/qcN):null;
  let score=null;
  if(avg&&std){ const eff=Math.min(1.5,std/avg); score=Math.round(100*(qual==null?0.85:(a.pass+1)/(qcN+2))*eff); }
  const bits=[];
  if(avg) bits.push("⏱ "+(avg<10?avg.toFixed(1):Math.round(avg))+"h/piano"+(std?" · std "+std+"h":"")+" · "+n+" piano"+(n===1?"":"s"));
  if(qcN) bits.push("✅ "+a.pass+"/"+qcN+" mini-QC first-pass");
  if(score!=null) bits.push("⚡ "+score);
  return {text:bits.join(" · "), score};
}
function specLadder(skill){
  return SPEC.rows.filter(r=>r.skill===skill&&r.level>0)
    .sort((a,b)=>a.rank-b.rank||b.level-a.level||a.tech.localeCompare(b.tech));
}
function specOffToday(tech){
  const v=window.TEAM&&TEAM.sched;
  if(!v||!v.length) return false;
  const dowIdx={Mon:2,Tue:3,Wed:4,Thu:5,Fri:6,Sat:7}[new Date().toLocaleDateString("en-US",{weekday:"short",timeZone:"America/Denver"})];
  if(!dowIdx) return false;
  const f=String(tech).split(/\s+/)[0].toLowerCase();
  const row=v.find(r=>String(r[0]||"").split(/\s+/)[0].toLowerCase()===f);
  return row?!String(row[dowIdx-1]||"").trim():false;
}
async function specWrite(body,msgEl){
  const auth=(window.writeAuth?writeAuth():{pin:"",ok:true});
  if(msgEl) msgEl.textContent="…";
  try{
    const r=await fetch(CONFIG.STOREMAP_BRIDGE,{method:"POST",redirect:"follow",
      headers:{"content-type":"text/plain;charset=utf-8"},
      body:JSON.stringify({pin:auth.pin,action:"specset",...body,...(window.authFields?authFields():{})})});
    const j=await r.json();
    if(j.error) throw new Error(j.error);
    if(!j.ok) throw new Error("bridge is busy — try again in a minute");
    if(msgEl){ msgEl.textContent="✓"; msgEl.style.color="#2c7a3f"; }
    return true;
  }catch(e){ if(msgEl){ msgEl.textContent="✗ "+(e.message||e); msgEl.style.color="#9e2020"; } return false; }
}
function specLvlSelect(r){
  return `<select class="splvl" data-skill="${esc(r.skill)}" data-tech="${esc(r.tech)}"
    style="font:700 11px/1 inherit;border:1px solid #cfc9bf;border-radius:8px;padding:3px 4px;background:#fff">
    ${SPEC_LVLS.map((L,n)=>`<option value="${n}" ${r.level===n?"selected":""}>${n===0?"— remove":L.pill||L.label}</option>`).join("")}
  </select>`;
}
function specCSS(){
  return `<style>
    .splpill{font-size:10px;font-weight:800;letter-spacing:.4px;padding:2.5px 8px;border-radius:999px;white-space:nowrap}
    .spl1{background:#eee9df;color:#8a847b;border:1px dashed #c9c2b6}.spl2{background:#f0e2b6;color:#6b5030}
    .spl3{background:#c9a227;color:#fff}.spl4{background:#7fc48f;color:#1c3a26}
    .spl5{background:#2f7d4f;color:#fff}.spl6{background:#2b2f33;color:#ffd76e}
    .sprow{display:flex;align-items:center;gap:8px;border:1px solid #eee9df;border-radius:10px;padding:6px 9px;margin:6px 0;background:#fdfcfa;flex-wrap:wrap}
    .sprow.spoff{opacity:.42}
    .sprk{width:20px;height:20px;border-radius:50%;background:#2b2f33;color:#fff;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;flex:0 0 auto}
    .spud button{border:1px solid #ddd6c9;background:#fff;border-radius:6px;width:22px;height:20px;font-size:10px;cursor:pointer;padding:0}
    .spperf{flex-basis:100%;font-size:10.5px;color:#6f6a63;margin-top:-2px;padding-left:28px}
    .spmtable{border-collapse:collapse;background:#fff;font-size:12px}
    .spmtable th,.spmtable td{border:1px solid #eee9df;padding:5px 6px;text-align:center}
    .spmtable th{background:#2b2f33;color:#fff;font-size:10px;letter-spacing:.4px;cursor:pointer;max-width:74px}
    .spmtable td.spname{text-align:left;font-weight:700;background:#fdfcfa;white-space:nowrap;position:sticky;left:0}
    .spmcell{cursor:pointer;font-size:14px}
    .spmc1{background:#f4f1ec}.spmc2{background:#faf0d4}.spmc3{background:#f3d97a}
    .spmc4{background:#a9d9b4}.spmc5{background:#2f7d4f}.spmc6{background:#2b2f33}
  </style>`;
}
function renderLadder(){
  const ready=needSpec(); needSpecPerf();
  if(window.TEAM&&!TEAM.sched&&!TEAM.loading&&window.teamFetchAll) try{teamFetchAll();}catch(e){}
  const host=$("#sview-ladder"); if(!host) return;
  if(!ready){ host.innerHTML=`<div class="row1"><div><h2 class="page">🪜 ${t("lad_title")}</h2></div></div><div style="color:var(--mut2);padding:20px 0">Loading specialties…</div>`; return; }
  host.innerHTML=specCSS()+`
    <div class="row1"><div><h2 class="page">🪜 ${t("lad_title")}</h2><div class="sub">${t("lad_sub")}</div></div></div>
    <div class="lanes">${SPEC.skills.map(sk=>{
      const lad=specLadder(sk);
      return `<div class="lane" data-skill="${esc(sk)}"><h4>${esc(sk)} <span class="n num">${lad.length}</span></h4>
        ${lad.map((r,i)=>{
          const off=specOffToday(r.tech);
          const pf=specPerf(r.tech,sk);
          return `<div class="sprow ${off?"spoff":""}" data-tech="${esc(r.tech)}">
            <span class="sprk">${i+1}</span><b style="flex:1">${esc(r.tech)}</b>
            ${off?`<span style="font-size:10px;color:#9e2020">off today</span>`:""}
            <span class="splpill ${SPEC_LVLS[r.level].cls}" title="${esc(r.note||"")}">${SPEC_LVLS[r.level].pill}</span>
            ${specLvlSelect(r)}
            <span class="spud"><button class="spup" title="move up">▲</button><button class="spdn" title="move down">▼</button></span>
            ${pf?`<span class="spperf">${esc(pf.text)}</span>`:""}
          </div>`;
        }).join("")||`<div style="color:var(--mut2);font-size:12px;padding:6px 0">nobody ranked yet</div>`}
        <div style="display:flex;gap:6px;margin-top:8px;align-items:center">
          <input class="spadd" placeholder="add a tech…" style="flex:1;font:500 12px/1.3 inherit;padding:5px 8px;border:1px solid #ddd6c9;border-radius:8px">
          <button class="spaddgo" style="border:1px solid #cfc9bf;background:none;border-radius:8px;padding:4px 9px;font-size:11.5px">＋</button>
          <span class="spmsg" style="font-size:11px"></span></div>
      </div>`;
    }).join("")}</div>
    <div class="sub" style="margin-top:12px">${t("spec_legend")}</div>`;
  wireSpec(host,renderLadder);
}
function wireSpec(host,rerender){
  host.querySelectorAll(".splvl").forEach(sel=>sel.onchange=async()=>{
    const lane=sel.closest("[data-skill]")||sel.closest("th")||sel;
    const skill=sel.dataset.skill, tech=sel.dataset.tech, lvl=+sel.value;
    const msg=(sel.closest(".sprow,.lane,.spmpop")||host).querySelector(".spmsg");
    if(await specWrite({skill,tech,level:lvl},msg)){
      const row=SPEC.rows.find(r=>r.skill===skill&&r.tech===tech);
      if(row) row.level=lvl; else SPEC.rows.push({skill,tech,level:lvl,rank:999,note:""});
      setTimeout(rerender,500);
    }
  });
  host.querySelectorAll(".spup,.spdn").forEach(b=>b.onclick=async()=>{
    const lane=b.closest("[data-skill]"); const skill=lane.dataset.skill;
    const tech=b.closest(".sprow").dataset.tech;
    const lad=specLadder(skill).map(r=>r.tech);
    const i=lad.indexOf(tech); const j=b.classList.contains("spup")?i-1:i+1;
    if(j<0||j>=lad.length) return;
    [lad[i],lad[j]]=[lad[j],lad[i]];
    const msg=lane.querySelector(".spmsg");
    if(await specWrite({skill,order:lad},msg)){
      lad.forEach((tn,ix)=>{ const row=SPEC.rows.find(r=>r.skill===skill&&r.tech===tn); if(row) row.rank=ix+1; });
      rerender();
    }
  });
  host.querySelectorAll(".spaddgo").forEach(b=>b.onclick=async()=>{
    const lane=b.closest("[data-skill]"); const skill=lane.dataset.skill;
    const inp=lane.querySelector(".spadd"); const tech=(inp.value||"").trim();
    if(!tech){ inp.focus(); return; }
    const msg=lane.querySelector(".spmsg");
    if(await specWrite({skill,tech,level:1,note:"added in app"},msg)){
      SPEC.rows.push({skill,tech,level:1,rank:999,note:"added in app"});
      rerender();
    }
  });
}
function renderMatrix(){
  const ready=needSpec(); needSpecPerf();
  const host=$("#sview-matrix"); if(!host) return;
  if(!ready){ host.innerHTML=`<div class="row1"><div><h2 class="page">🔢 ${t("mat_title")}</h2></div></div><div style="color:var(--mut2);padding:20px 0">Loading specialties…</div>`; return; }
  const techs=[...new Set(SPEC.rows.filter(r=>r.level>0).map(r=>r.tech))];
  const lvlOf={}; SPEC.rows.forEach(r=>{ lvlOf[r.tech+"|"+r.skill]=r.level; });
  techs.sort((a,b)=>{
    const vs=tn=>SPEC.rows.filter(r=>r.tech===tn).reduce((s,r)=>s+r.level,0);
    return vs(b)-vs(a)||a.localeCompare(b);
  });
  host.innerHTML=specCSS()+`
    <div class="row1"><div><h2 class="page">🔢 ${t("mat_title")}</h2><div class="sub">${t("mat_sub")}</div></div></div>
    <div style="overflow-x:auto"><table class="spmtable">
      <tr><th style="cursor:default"></th>${SPEC.skills.map(sk=>`<th class="spmhead" data-skill="${esc(sk)}">${esc(sk)} ▾</th>`).join("")}<th style="cursor:default">Σ</th></tr>
      ${techs.map(tn=>{
        const tot=SPEC.rows.filter(r=>r.tech===tn).reduce((s,r)=>s+r.level,0);
        return `<tr><td class="spname">${esc(tn)}</td>
          ${SPEC.skills.map(sk=>{
            const lv=lvlOf[tn+"|"+sk]||0;
            const pf=lv?specPerf(tn,sk):null;
            return `<td class="spmcell ${lv?"spmc"+lv:""}" data-skill="${esc(sk)}" data-tech="${esc(tn)}"
              title="${esc(tn+" · "+sk+" — "+SPEC_LVLS[lv].label+(pf?"\n"+pf.text:"")+"\n(tap to raise the level, long-press logic: cycles 0→6)")}">${SPEC_CELL[lv]}${pf&&pf.score!=null?`<div style="font-size:8.5px;opacity:.85">${pf.score}</div>`:""}</td>`;
          }).join("")}
          <td class="num" style="font-weight:800;background:#f4f1ec">${tot}</td></tr>`;
      }).join("")}
    </table></div>
    <div class="spmpop" id="spmpop" style="display:none;margin-top:14px;background:#fff;border:2px solid #2b2f33;border-radius:12px;padding:12px;max-width:460px"></div>
    <div class="sub" style="margin-top:10px">${t("spec_legend")} <span class="spmsg" style="font-size:11px"></span></div>`;
  host.querySelectorAll(".spmcell").forEach(td=>td.onclick=async()=>{
    const skill=td.dataset.skill, tech=td.dataset.tech;
    const cur=(SPEC.rows.find(r=>r.skill===skill&&r.tech===tech)||{level:0}).level;
    const lvl=(cur+1)%7;
    const msg=host.querySelector(".spmsg");
    if(await specWrite({skill,tech,level:lvl},msg)){
      const row=SPEC.rows.find(r=>r.skill===skill&&r.tech===tech);
      if(row) row.level=lvl; else SPEC.rows.push({skill,tech,level:lvl,rank:999,note:""});
      renderMatrix();
    }
  });
  host.querySelectorAll(".spmhead").forEach(th=>th.onclick=()=>{
    const sk=th.dataset.skill;
    const pop=host.querySelector("#spmpop");
    const lad=specLadder(sk);
    pop.style.display="block";
    pop.innerHTML=`<h3 style="margin:0 0 6px">${esc(sk)} — ranked ladder</h3>
      ${lad.map((r,i)=>{
        const off=specOffToday(r.tech); const pf=specPerf(r.tech,sk);
        return `<div style="display:flex;gap:8px;align-items:center;padding:5px 0;border-top:1px solid #f0ece5;${off?"opacity:.45":""}">
          <span class="sprk">${i+1}</span><b style="flex:1">${esc(r.tech)}</b>
          ${off?`<span style="font-size:10px;color:#9e2020">off today</span>`:""}
          <span class="splpill ${SPEC_LVLS[r.level].cls}">${SPEC_LVLS[r.level].pill}</span>
          ${pf?`<span style="font-size:10px;color:#6f6a63">${esc(pf.text)}</span>`:""}</div>`;
      }).join("")||"nobody ranked"}
      <div style="font-size:11px;color:#8a847b;margin-top:8px">reorder the ladder on the 🪜 Skill Ladder tab</div>`;
    pop.scrollIntoView({block:"nearest"});
  });
}

/* ---- Store Map integration ---- */
const S_TABS = ["dash","review","planner","schedule","sequence","pipeline","walk","audit","ladder","matrix"];
const RENDERERS = {dash:renderDash, review:renderReview, planner:renderPlanner,
  sequence:renderSequence, pipeline:renderPipeline, walk:renderWalk, audit:renderAudit,
  ladder:renderLadder, matrix:renderMatrix};
let ACTIVE_S = null, BOOTED = false, BOOTING = false;
function schedRerender(){
  if(ACTIVE_S && RENDERERS[ACTIVE_S]) RENDERERS[ACTIVE_S]();
}
window.schedRerender = schedRerender;
window.renderSchedNative = function(tab, host){
  ACTIVE_S = tab;
  host.innerHTML = '<div id="sview-' + tab + '" class="smgr">'
    + '<div style="color:#8a929a;padding:26px 0">Loading the shop data\u2026</div></div>';
  const go = () => { if(RENDERERS[tab]) RENDERERS[tab](); };
  if(BOOTED){ go(); return; }
  if(!BOOTING){
    BOOTING = true;
    boot().then(()=>{ BOOTED = true; }).catch(e=>{
      const el = document.getElementById("sview-" + (ACTIVE_S||tab));
      if(el) el.innerHTML = '<div style="color:#9e2020;padding:26px 0">Couldn\u2019t load the shop data \u2014 ' + esc(String(e && e.message || e)) + '</div>';
    }).then(()=>{ if(BOOTED) schedRerender(); });
  }
};
})();
