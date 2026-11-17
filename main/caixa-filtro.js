/* Filtro por período do caixa (somente admin).
   Período livre (de/até) + atalhos, Tipo Entrada/Saída/Ambos, valor mínimo (≥),
   opção de ocultar transferências/estornos, agrupado por dia com subtotais.
   Só filtra linhas que o banco já devolveu (RLS do admin). Não grava nada e não lê custo. */
(function (root) {
  "use strict";
  const TZ = "America/Sao_Paulo";
  const PRESETS = [
    { id: "hoje", label: "Hoje", dias: 1 },
    { id: "5d", label: "5 dias", dias: 5 },
    { id: "7d", label: "7 dias", dias: 7 },
    { id: "mes", label: "Mês", dias: 0 }
  ];
  const MINIMOS = [10000, 50000, 100000, 200000];
  const TL = { venda: "Venda", entrada: "Entrada", saida: "Saída", estorno: "Estorno" };

  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const brl = v => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const r2 = v => Math.round(Number(v || 0) * 100) / 100;
  const isoDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
  const dmy = s => String(s || "").split("-").reverse().join("/");
  const kfmt = v => v >= 1000 && v % 1000 === 0 ? `${v / 1000}K` : brl(v);

  function addDays(iso, n) {
    const [y, m, d] = iso.split("-").map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + n));
    return t.toISOString().slice(0, 10);
  }
  /* Dia (São Paulo) de um timestamp. */
  function diaSP(ts) { return new Date(ts).toLocaleDateString("sv-SE", { timeZone: TZ }); }
  function presetRange(id, hoje) {
    const p = PRESETS.find(x => x.id === id);
    if (!p || !isoDate(hoje)) return null;
    if (p.id === "mes") return { de: hoje.slice(0, 8) + "01", ate: hoje };
    return { de: addDays(hoje, -(p.dias - 1)), ate: hoje };
  }
  /* Normaliza de/até: datas válidas, de ≤ até (troca se vier invertido). */
  function normRange(de, ate, hoje) {
    let a = isoDate(de) ? de : hoje, b = isoDate(ate) ? ate : hoje;
    if (a > b) [a, b] = [b, a];
    return { de: a, ate: b };
  }
  function diasNoPeriodo(de, ate) {
    const [y1, m1, d1] = de.split("-").map(Number), [y2, m2, d2] = ate.split("-").map(Number);
    return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 864e5) + 1;
  }
  function parseMin(v) {
    if (v == null || v === "") return 0;
    const s = String(v).trim().replace(/\s|R\$/g, "");
    const n = /,\d{1,2}$/.test(s) ? Number(s.replace(/\./g, "").replace(",", ".")) : Number(s.replace(/[.,](?=\d{3}(\D|$))/g, ""));
    return Number.isFinite(n) && n > 0 ? r2(n) : 0;
  }

  const sinal = m => Number(m.valor_assinado != null ? m.valor_assinado : (m.tipo === "venda" || m.tipo === "entrada" ? m.valor : -m.valor));
  const isTransfer = m => /^\s*transfer[eê]ncia (para|de)\b/i.test(m.motivo || "");
  const isEstorno = m => m.tipo === "estorno" || m.estorno_de != null || /^\s*estorno\b/i.test(m.motivo || "");
  /* Para "ocultar transferências/estornos": a transferência, o estorno e a linha que foi estornada. */
  const isTecnico = m => isTransfer(m) || isEstorno(m) || !!m.estornado;

  /* Caixa Especial (ledger separado) no mesmo formato do extrato. */
  function fromEspecial(rows) {
    return (rows || []).map(m => ({
      id: m.id, data: diaSP(m.created_at), created_at: m.created_at, caixa_id: "cxesp", caixa: "CAIXA ESPECIAL",
      tipo: m.tipo, valor: Number(m.valor), valor_assinado: m.tipo === "entrada" ? Number(m.valor) : -Number(m.valor),
      motivo: m.motivo, handle: m.handle, estorno_de: m.estorno_de, estornado: !!m.estornado, cliente: m.cliente || null, especial: true
    }));
  }

  function apply(rows, f) {
    const de = f.de, ate = f.ate, min = Number(f.min) || 0, tipo = f.tipo || "ambos";
    return (rows || []).filter(m => {
      const d = m.data || diaSP(m.created_at);
      if (d < de || d > ate) return false;
      if (f.caixa != null && f.caixa !== "" && f.caixa !== "todos" && String(m.caixa_id) !== String(f.caixa)) return false;
      const s = sinal(m);
      if (tipo === "entrada" && !(s > 0)) return false;
      if (tipo === "saida" && !(s < 0)) return false;
      if (min > 0 && Math.abs(s) + 1e-9 < min) return false;
      if (f.ocultar && isTecnico(m)) return false;
      return true;
    }).sort((a, b) => String(a.data).localeCompare(String(b.data)) || String(a.created_at).localeCompare(String(b.created_at)) || (a.id - b.id));
  }
  function totals(rows) {
    let ent = 0, sai = 0;
    for (const m of rows) { const s = sinal(m); if (s > 0) ent += s; else sai += -s; }
    return { ent: r2(ent), sai: r2(sai), liq: r2(ent - sai), n: rows.length };
  }
  function groupByDay(rows) {
    const map = new Map();
    for (const m of rows) { const d = m.data || diaSP(m.created_at); if (!map.has(d)) map.set(d, []); map.get(d).push(m); }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([data, list]) => ({ data, rows: list, ...totals(list) }));
  }

  const WD = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  function diaLabel(iso) { const [y, m, d] = iso.split("-").map(Number); return `${WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${dmy(iso)}`; }

  /* Controles. caixas: [{caixa_id, nome, somente_admin}]; especial: mostra a opção Caixa Especial. */
  function controlsHtml(f, opt) {
    const o = opt || {}, caixas = o.caixas || [];
    const sel = v => String(f.caixa) === String(v) ? " selected" : "";
    const chip = (cls, v, label, on) => `<button type="button" class="btn ghost cxf-chip ${cls}${on ? " on" : ""}" data-v="${esc(v)}" aria-pressed="${on ? "true" : "false"}">${esc(label)}</button>`;
    return `<div class="cxf-ctl">
  ${o.fixo ? "" : `<div class="cxf-row"><div><label for="cxf-caixa">Caixa</label><select id="cxf-caixa"><option value="todos"${sel("todos")}>Todos os caixas</option>${caixas.map(c => `<option value="${c.caixa_id}"${sel(c.caixa_id)}>${esc(c.nome)}${c.somente_admin ? " (só admin)" : ""}</option>`).join("")}${o.especial ? `<option value="cxesp"${sel("cxesp")}>CAIXA ESPECIAL (só admin)</option>` : ""}</select></div></div>`}
  <div class="cxf-row"><div><label for="cxf-de">De</label><input id="cxf-de" type="date" value="${esc(f.de)}"></div><div><label for="cxf-ate">Até</label><input id="cxf-ate" type="date" value="${esc(f.ate)}"></div>
  <div class="cxf-chips" role="group" aria-label="Atalhos de período">${PRESETS.map(p => chip("cxf-pre", p.id, p.label, f.preset === p.id)).join("")}</div></div>
  <div class="cxf-row"><div class="cxf-chips" role="group" aria-label="Tipo"><span class="cxf-lbl">Tipo</span>${[["ambos", "Ambos"], ["entrada", "Entrada"], ["saida", "Saída"]].map(([v, l]) => chip("cxf-tipo", v, l, f.tipo === v)).join("")}</div></div>
  <div class="cxf-row"><div class="cxf-chips" role="group" aria-label="Valor mínimo"><span class="cxf-lbl">Valor ≥</span>${chip("cxf-min", "0", "Qualquer", !(f.min > 0))}${MINIMOS.map(v => chip("cxf-min", v, kfmt(v), Number(f.min) === v)).join("")}
  <input id="cxf-minv" inputmode="decimal" placeholder="Outro valor (R$)" value="${f.min > 0 && !MINIMOS.includes(Number(f.min)) ? esc(String(f.min).replace(".", ",")) : ""}" aria-label="Valor mínimo personalizado"></div></div>
  <label class="cxf-tog"><input type="checkbox" id="cxf-ocultar"${f.ocultar ? " checked" : ""}> Ocultar transferências e estornos <small class="muted">(e as linhas estornadas)</small></label>
</div>`;
  }

  function resultHtml(rows, f, opt) {
    const o = opt || {}, hm = t => new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(t));
    const G = groupByDay(rows), T = totals(rows), nd = diasNoPeriodo(f.de, f.ate);
    const desc = [`${dmy(f.de)} a ${dmy(f.ate)} (${nd} ${nd === 1 ? "dia" : "dias"})`, f.tipo === "entrada" ? "só entradas" : f.tipo === "saida" ? "só saídas" : "entradas e saídas", f.min > 0 ? `valor ≥ ${brl(f.min)}` : "", f.ocultar ? "sem transferências/estornos" : ""].filter(Boolean).join(" · ");
    const kpis = `<div class="grid cxf-kpis"><div class="kpi"><small>Total entradas</small><b class="cxf-ent">${brl(T.ent)}</b></div><div class="kpi"><small>Total saídas</small><b class="cxf-sai">${brl(-T.sai)}</b></div><div class="kpi"><small>Líquido</small><b class="${T.liq < 0 ? "cxf-sai" : "cxf-ent"}">${brl(T.liq)}</b></div><div class="kpi"><small>Lançamentos</small><b>${T.n}</b></div></div>`;
    if (!rows.length) return `<p class="muted cxf-desc">${esc(desc)}</p>${kpis}<p class="muted">Nenhum lançamento com esses filtros.</p>`;
    const showCx = !o.fixo;
    const cols = showCx ? 7 : 6;
    const body = G.map(g => `<tr class="sep cxf-dia"><th colspan="${cols}">${esc(diaLabel(g.data))} <small class="muted">· ${g.n} lanç.</small></th></tr>
${g.rows.map(m => { const s = sinal(m); return `<tr class="cxf-mv${m.estornado ? " cxf-estornado" : ""}"><td class="c-h">${esc(hm(m.created_at))}</td>${showCx ? `<td class="c-cx">${esc(m.caixa)}</td>` : ""}<td class="c-tp">${esc(TL[m.tipo] || m.tipo)}${isTransfer(m) ? ' <small class="muted">transf.</small>' : ""}${m.estorno_de ? ` <small class="muted">(estorno #${esc(m.estorno_de)})</small>` : ""}</td><td class="c-cl">${esc((m.cliente || "").trim() || "—")}</td><td class="c-mo">${esc(m.motivo || "")}${m.id != null ? ` <small class="muted">#${esc(m.id)}</small>` : ""}</td><td class="c-us">${esc(m.handle || "")}</td><td class="n c-v ${s < 0 ? "cxf-sai" : "cxf-ent"}">${brl(s)}</td></tr>`; }).join("")}
<tr class="cxf-sub"><td colspan="${cols - 1}">Subtotal ${esc(dmy(g.data))} · entradas ${brl(g.ent)} · saídas ${brl(-g.sai)}</td><td class="n"><b>${brl(g.liq)}</b></td></tr>`).join("");
    return `<p class="muted cxf-desc">${esc(desc)}</p>${kpis}
<div style="overflow-x:auto"><table class="stk cxf-tab"><tr class="cxf-hd"><th>Hora</th>${showCx ? "<th>Caixa</th>" : ""}<th>Tipo</th><th>Cliente</th><th>Motivo / nota</th><th>Usuário</th><th class="n">Valor</th></tr>
${body}
<tr class="tot"><th colspan="${cols - 1}">TOTAL DO PERÍODO · entradas ${brl(T.ent)} · saídas ${brl(-T.sai)}</th><th class="n">${brl(T.liq)}</th></tr></table></div>
<p class="muted cxf-nota">Data = dia do lançamento no caixa (horário de São Paulo), não a data do comprovante. Transferências entre caixas aparecem nos dois caixas; use “Ocultar transferências e estornos” para ver só o dinheiro que entrou ou saiu de fato.</p>`;
  }

  /* Exemplo para a prévia (?mock=admin&cxfix=1): valores no formato do período 11–16/11, marcados EXEMPLO. */
  function previewFixtures() {
    const L = [
      ["2026-11-11", "10:00", 1, "Caixa Dinheiro", "saida", 600, "Transferência para CAIXA ESPECIAL: exemplo"],
      ["2026-11-11", "16:57", 14, "CAIXA S2", "saida", 10000, "Estorno recebimento #156 (EXEMPLO) nota 000329"],
      ["2026-11-11", "09:40", 15, "PRESTIGE ROSA", "venda", 12450, "Nota 000480 (EXEMPLO)"],
      ["2026-11-12", "12:27", 15, "PRESTIGE ROSA", "saida", 350000, "Transferência para CAIXA S2: EXEMPLO"],
      ["2026-11-12", "12:27", 14, "CAIXA S2", "entrada", 350000, "Transferência de PRESTIGE ROSA: EXEMPLO"],
      ["2026-11-12", "15:47", 15, "PRESTIGE ROSA", "saida", 131185, "Transferência para CAIXA S2: EXEMPLO"],
      ["2026-11-12", "16:12", 1, "Caixa Dinheiro", "saida", 150, "taxista (EXEMPLO)"],
      ["2026-11-13", "13:31", 1, "Caixa Dinheiro", "entrada", 1328089, "Recebimento cliente EXEMPLO"],
      ["2026-11-13", "13:31", 1, "Caixa Dinheiro", "saida", 1328089, "Estorno recebimento #268 EXEMPLO: coloquei errado"],
      ["2026-11-13", "17:10", 18, "COMPRA PRODUTOS", "saida", 48500, "Compra fornecedor EXEMPLO (só admin)"],
      ["2026-11-14", "08:55", 13, "PRIME", "saida", 40000, "Estorno recebimento #287 EXEMPLO"],
      ["2026-11-14", "11:20", 13, "PRIME", "venda", 22900, "Nota 000500 (EXEMPLO)"],
      ["2026-11-15", "10:05", 12, "GASTOS LOJA", "saida", 14000, "Aluguel Q0011 (EXEMPLO)"],
      ["2026-11-16", "08:57", 1, "Caixa Dinheiro", "saida", 16923, "Transferência para CAIXA ESPECIAL: EXEMPLO"],
      ["2026-11-16", "11:27", 12, "GASTOS LOJA", "saida", 1800, "Pagamento fornecedor EXEMPLO — conta 15"],
      ["2026-11-16", "14:39", 1, "Caixa Dinheiro", "saida", 50, "comida (EXEMPLO)"]
    ];
    let id = 9001;
    return L.map(([data, h, caixa_id, caixa, tipo, valor, motivo]) => ({
      id: id++, data, created_at: `${data}T${h}:00-03:00`, caixa_id, caixa, tipo, valor,
      valor_assinado: tipo === "venda" || tipo === "entrada" ? valor : -valor, motivo, handle: "exemplo", cliente: null,
      estorno_de: null, estornado: /Recebimento cliente EXEMPLO/.test(motivo), exemplo: true
    }));
  }

  root.BAGDA_CAIXA_FILTRO = { PRESETS, MINIMOS, addDays, diaSP, presetRange, normRange, diasNoPeriodo, parseMin, sinal, isTransfer, isEstorno, isTecnico, fromEspecial, apply, totals, groupByDay, controlsHtml, resultHtml, previewFixtures, brl, esc };
})(typeof globalThis !== "undefined" ? globalThis : this);
