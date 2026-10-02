document.addEventListener("click", async event => {
  const button = event.target.closest("[data-copy-form]");
  if (!button) return;
  const form = document.getElementById(button.dataset.copyForm);
  const fields = [...form.querySelectorAll("input, textarea, select")];
  const text = fields.map(field => `${field.dataset.label || field.name || field.id}: ${field.value.trim()}`).join("\n");
  const status = form.querySelector("[data-copy-status]");
  try { await navigator.clipboard.writeText(text); status.textContent = "Kopioitu leikepöydälle."; }
  catch { status.textContent = "Kopiointi ei onnistunut selaimessa — valitse teksti käsin."; }
});
