/* Origem da venda: Principal (loja), Especial (Depósito Especial) ou BRASCOL.
   BRASCOL is admin-only in the UI and in the database. Não transfere estoque.
   Cada linha usa só a origem escolhida. */
(function (root) {
  "use strict";
  const ORIGENS = { principal: "Principal", especial: "Especial", brascol: "BRASCOL" };
  function origemOf(item) {
    const o = item && item.origem;
    return o === "especial" || o === "brascol" ? o : "principal";
  }
  function origemLabel(origem) {
    return ORIGENS[origemOf({ origem })] || "Principal";
  }
  function reserved(items, sku, origem) {
    const want = origemOf({ origem });
    return (items || []).filter(x => x.sku === sku && origemOf(x) === want).reduce((a, x) => a + (Number(x.qtd) || 0), 0);
  }
  function available(estoqueLoja, estoqueEspecial, origem, estoqueBrascol) {
    const o = origemOf({ origem });
    const n = Number(o === "especial" ? estoqueEspecial : o === "brascol" ? estoqueBrascol : estoqueLoja);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }
  function checkQty(estoqueLoja, estoqueEspecial, items, sku, origem, qtd, estoqueBrascol) {
    const o = origemOf({ origem });
    const have = available(estoqueLoja, estoqueEspecial, o, estoqueBrascol);
    const ja = reserved(items, sku, o);
    const q = Number(qtd) || 0;
    return { origem: o, have, ja, ok: Number.isInteger(q) && q >= 1 && q + ja <= have };
  }
  root.BAGDA_VENDA_ORIGEM = { origemOf, origemLabel, reserved, available, checkQty };
})(typeof globalThis !== "undefined" ? globalThis : this);
