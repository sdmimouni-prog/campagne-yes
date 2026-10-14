const DIMENSIONS = {
  gender: { title: 'Par sexe', field: 'Sexe', add: 'Ajouter une catégorie', labels: ['Femmes', 'Hommes', 'Non renseigné'] },
  ages: { title: 'Par tranche d’âge', field: 'Tranche d’âge', add: 'Ajouter une tranche d’âge', labels: ['13–17', '18–24', '25–34', '35–44', '45–54', '55–64', '65+', 'Non renseigné'] },
  cities: { title: 'Par ville', field: 'Ville', add: 'Ajouter une ville', labels: [] },
};
const METRICS = { impressions: 'Impressions', clicks: 'Clics', reach: 'Reach' };
const number = new Intl.NumberFormat('fr-FR');
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

/** Dynamic campaign audience form. Blank metrics stay unknown; zero is a measurement. */
export function createAudienceEditor(container) {
  let sequence = 0;
  let totals = {};
  let activeDimension = 'gender';
  container.innerHTML = `<section class="audience-editor" aria-labelledby="audience-form-title">
    <div class="audience-editor-heading"><div><h3 id="audience-form-title">Répartition de l’audience</h3><p>Ajoutez vos données par sexe, tranche d’âge et ville.</p></div><span class="audience-optional">FACULTATIF</span></div>
    <div class="audience-editor-content">
      <p class="audience-editor-help">Choisissez une catégorie, saisissez ses <strong>impressions, clics et Reach</strong>, puis ajoutez une ligne si nécessaire. Utilisez les chiffres de cette campagne et de cette période.</p>
      <div class="audience-editor-tabs" role="group" aria-label="Répartition à renseigner">${Object.entries(DIMENSIONS).map(([key, dimension]) => `<button type="button" data-audience-tab="${key}" aria-controls="audience-panel-${key}" aria-pressed="${key === activeDimension}">${dimension.title}</button>`).join('')}</div>
      ${Object.entries(DIMENSIONS).map(([key, dimension]) => `<section class="audience-editor-panel" id="audience-panel-${key}" aria-label="Audience ${dimension.title.toLowerCase()}" ${key !== activeDimension ? 'hidden' : ''}>
        <div class="audience-entries" data-audience-rows="${key}"></div>
        <p class="audience-empty" data-audience-empty="${key}" hidden>Aucune ligne. Cliquez sur « ${dimension.add} » pour commencer.</p>
        <button type="button" class="audience-add-row" data-add-row="${key}"><span aria-hidden="true">＋</span> ${dimension.add}</button>
        <div class="audience-editor-totals" data-audience-totals="${key}" aria-live="polite"></div>
      </section>`).join('')}
      <p class="audience-editor-help audience-editor-limit">Laissez vide une mesure inconnue ; saisissez 0 pour un résultat nul. Chaque répartition est indépendante et ne peut pas dépasser les totaux de la campagne.</p>
      <p class="audience-save-help">Les lignes seront sauvegardées avec le bouton <strong>Enregistrer la campagne</strong> ou <strong>Enregistrer les modifications</strong> ci-dessous.</p>
      <p class="message error" data-audience-error role="alert" tabindex="-1" hidden></p>
    </div>
  </section>`;
  const errorMessage = container.querySelector('[data-audience-error]');
  const body = dimension => container.querySelector(`[data-audience-rows="${dimension}"]`);
  const rows = dimension => [...body(dimension).querySelectorAll('[data-audience-row]')];
  const changed = () => container.dispatchEvent(new Event('input', { bubbles: true }));
  const limit = dimension => DIMENSIONS[dimension].labels.length || 100;

  function showDimension(dimension) {
    activeDimension = dimension;
    container.querySelectorAll('[data-audience-tab]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.audienceTab === dimension)));
    container.querySelectorAll('.audience-editor-panel').forEach(panel => { panel.hidden = panel.id !== `audience-panel-${dimension}`; });
  }

  function appendRow(dimension, data = {}) {
    const row = document.createElement('div');
    const id = ++sequence;
    const config = DIMENSIONS[dimension];
    const label = data.label || '';
    row.className = 'audience-entry';
    row.dataset.audienceRow = dimension;
    const category = config.labels.length
      ? `<select data-audience-label><option value="">Choisir…</option>${config.labels.map(value => `<option value="${escape(value)}"${value === label ? ' selected' : ''}>${escape(value)}</option>`).join('')}</select>`
      : `<input data-audience-label type="text" maxlength="80" placeholder="Ex. Casablanca" value="${escape(label)}">`;
    row.innerHTML = `<label class="audience-category"><span>${config.field}</span>${category}</label>${Object.entries(METRICS).map(([metric, title]) => `<label><span>${title}</span><input id="audience-${id}-${metric}" data-metric="${metric}" type="number" min="0" max="9000000000000" step="1" inputmode="numeric" placeholder="—" value="${data[metric] == null ? '' : escape(data[metric])}"></label>`).join('')}<button type="button" class="audience-remove-row" data-remove-row aria-label="Retirer la ligne"><span aria-hidden="true">×</span></button>`;
    body(dimension).append(row);
    refreshRows(dimension);
    return row;
  }

  function refreshRows(dimension) {
    const config = DIMENSIONS[dimension];
    const entries = rows(dimension);
    const selected = entries.map(row => row.querySelector('[data-audience-label]').value);
    entries.forEach((row, index) => {
      const category = row.querySelector('[data-audience-label]');
      const identity = category.value.trim() || `${config.field} ${index + 1}`;
      category.setAttribute('aria-label', `${config.field} · ligne ${index + 1}`);
      for (const [metric, title] of Object.entries(METRICS)) row.querySelector(`[data-metric="${metric}"]`).setAttribute('aria-label', `${title} · ${identity}`);
      row.querySelector('[data-remove-row]').setAttribute('aria-label', `Retirer ${identity}`);
      if (config.labels.length) [...category.options].forEach(option => {
        option.disabled = Boolean(option.value && option.value !== category.value && selected.includes(option.value));
      });
    });
    container.querySelector(`[data-audience-empty="${dimension}"]`).hidden = entries.length > 0;
    container.querySelector(`[data-add-row="${dimension}"]`).disabled = entries.length >= limit(dimension);
  }

  function clearErrors() {
    errorMessage.hidden = true;
    container.querySelectorAll('input, select').forEach(input => input.setCustomValidity(''));
  }

  function showError(message, dimension = activeDimension, control) {
    showDimension(dimension);
    errorMessage.textContent = message;
    errorMessage.hidden = false;
    if (control) {
      control.setCustomValidity(message);
      control.focus();
    } else errorMessage.focus();
  }

  function fail(message, dimension, control) {
    showError(message, dimension, control);
    throw new Error(message);
  }

  function read() {
    const data = { gender: [], ages: [], cities: [] };
    for (const [dimension, config] of Object.entries(DIMENSIONS)) {
      const seen = new Set();
      for (const row of rows(dimension)) {
        const category = row.querySelector('[data-audience-label]');
        const label = category.value.trim();
        const item = { label };
        for (const metric of Object.keys(METRICS)) {
          const input = row.querySelector(`[data-metric="${metric}"]`);
          const value = input.value === '' ? null : input.valueAsNumber;
          if (input.validity.badInput || value !== null && (!Number.isSafeInteger(value) || value < 0 || value > 9e12)) {
            fail(`${config.title} : saisissez des nombres entiers positifs ou nuls.`, dimension, input);
          }
          item[metric] = value;
        }
        if (Object.keys(METRICS).every(metric => item[metric] === null)) continue;
        if (!label) fail(`${config.title} : ${dimension === 'cities' ? 'indiquez la ville' : 'choisissez une catégorie'} correspondant à ces chiffres.`, dimension, category);
        const key = label.toLowerCase();
        if (seen.has(key)) fail(`${config.title} : « ${label} » est renseigné plusieurs fois.`, dimension, category);
        seen.add(key);
        data[dimension].push(item);
      }
      for (const [metric, title] of Object.entries(METRICS)) {
        const total = totals[metric];
        const sum = data[dimension].reduce((value, row) => value + (row[metric] ?? 0), 0);
        if (Number.isFinite(total) && sum > total) fail(`${config.title} : le total ${title.toLowerCase()} (${number.format(sum)}) dépasse celui de la campagne (${number.format(total)}).`, dimension);
      }
    }
    return data;
  }

  function updateTotals(nextTotals) {
    totals = nextTotals;
    for (const dimension of Object.keys(DIMENSIONS)) {
      container.querySelector(`[data-audience-totals="${dimension}"]`).innerHTML = Object.entries(METRICS).map(([metric, label]) => {
        const inputs = rows(dimension).map(row => row.querySelector(`[data-metric="${metric}"]`));
        const known = inputs.filter(input => input.value !== '' && Number.isFinite(input.valueAsNumber));
        const sum = known.reduce((value, input) => value + Math.max(0, input.valueAsNumber), 0);
        const total = totals[metric];
        const excess = Number.isFinite(total) && sum > total;
        return `<span${excess ? ' class="audience-total-error"' : ''}>${label}<strong>${known.length ? number.format(sum) : '—'} <small>/ ${Number.isFinite(total) ? number.format(total) : '—'}</small></strong><small>${excess ? 'Dépasse le total' : 'Renseigné / campagne'}</small></span>`;
      }).join('');
    }
  }

  function load(data = null, { preserveView = false } = {}) {
    clearErrors();
    for (const dimension of Object.keys(DIMENSIONS)) {
      body(dimension).replaceChildren();
      const saved = data?.[dimension] || [];
      (saved.length ? saved : [{}]).forEach(row => appendRow(dimension, row));
    }
    showDimension(preserveView ? activeDimension : Object.keys(DIMENSIONS).find(dimension => data?.[dimension]?.length) || 'gender');
    updateTotals(totals);
  }

  container.addEventListener('click', event => {
    const tab = event.target.closest('[data-audience-tab]');
    if (tab) { showDimension(tab.dataset.audienceTab); return; }
    const add = event.target.closest('[data-add-row]');
    if (add) {
      const dimension = add.dataset.addRow;
      if (rows(dimension).length >= limit(dimension)) return;
      appendRow(dimension).querySelector('[data-audience-label]').focus();
      changed();
    }
    const remove = event.target.closest('[data-remove-row]');
    if (remove) {
      const row = remove.closest('[data-audience-row]');
      const dimension = row.dataset.audienceRow;
      const next = row.nextElementSibling || row.previousElementSibling;
      row.remove();
      refreshRows(dimension);
      (next?.querySelector('[data-audience-label]') || container.querySelector(`[data-add-row="${dimension}"]`)).focus();
      changed();
    }
  });
  container.addEventListener('input', event => {
    clearErrors();
    const row = event.target.closest('[data-audience-row]');
    if (row) refreshRows(row.dataset.audienceRow);
  });
  container.addEventListener('change', event => {
    if (event.target.matches('[data-audience-label]')) { clearErrors(); refreshRows(event.target.closest('[data-audience-row]').dataset.audienceRow); }
  });
  container.addEventListener('invalid', event => {
    const panel = event.target.closest('.audience-editor-panel');
    if (panel) showDimension(panel.id.replace('audience-panel-', ''));
  }, true);
  load();
  return { read, load, clearErrors, showError, updateTotals };
}
