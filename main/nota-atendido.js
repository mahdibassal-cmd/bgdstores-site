/* Nota nova: nome do cliente obrigatório + "Atendido por (WhatsApp)".
   Opções fixas (mesmas do banco: notas_atendido_por_chk). Notas antigas ficam sem valor. */
(function (root) {
  "use strict";
  const OPCOES = ["1", "2", "3", "4", "Bagda Official", "Boss"];
  const SEM = "__sem";
  function valido(v) { return OPCOES.includes(String(v ?? "")); }
  function label(v) { if (v == null || v === "") return ""; const s = String(v); return /^[1-4]$/.test(s) ? "WhatsApp " + s : s; }
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function optionsHtml(sel) {
    return `<option value="">— selecione —</option>` + OPCOES.map(o => `<option value="${esc(o)}"${o === sel ? " selected" : ""}>${esc(label(o))}</option>`).join("");
  }
  function filtroHtml(sel) {
    return `<option value="">Todos</option>` + OPCOES.map(o => `<option value="${esc(o)}"${o === sel ? " selected" : ""}>${esc(label(o))}</option>`).join("") + `<option value="${SEM}"${sel === SEM ? " selected" : ""}>Sem registro (notas antigas)</option>`;
  }
  /* Nome que vai para a nota: cliente cadastrado, senão o nome digitado, senão o texto da busca. */
  function nomeCliente(cli, ref, busca) {
    const n = cli && cli.nome ? cli.nome : (String(ref ?? "").trim() || String(busca ?? "").trim());
    return String(n ?? "").replace(/\s+/g, " ").trim();
  }
  /* "" = ok; senão a mensagem de bloqueio. */
  function validar(nome, atendido) {
    if (String(nome ?? "").trim().length < 2) return "Informe o nome do cliente (cadastrado ou digitado)";
    if (!valido(atendido)) return "Escolha Atendido por (WhatsApp)";
    return "";
  }
  function filtrar(list, v) {
    if (!v) return list;
    if (v === SEM) return list.filter(n => !n.atendido_por);
    return list.filter(n => n.atendido_por === v);
  }
  const api = { OPCOES, SEM, valido, label, optionsHtml, filtroHtml, nomeCliente, validar, filtrar };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BAGDA_ATENDIDO = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
