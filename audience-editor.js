const DIMENSIONS = {
  gender: { title: 'Par sexe', labels: ['Femmes', 'Hommes', 'Non renseigné'] },
  ages: { title: 'Par tranche d’âge', labels: ['13–17', '18–24', '25–34', '35–44', '45–54', '55–64', '65+', 'Non renseigné'] },
  cities: { title: 'Par ville', labels: [] },
};
const METRICS = { impressions: 'Impressions', clicks: 'Clics', reach: 'Reach' };
const number = new Intl.NumberFormat('fr-FR');
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

/** Optional campaign breakdowns. Missing values stay blank; zero is a measurement. */
export function createAudienceEditor(container) {
  let sequence = 0;
  let totals = {};
  let activeDimension = 'gender';
  container.innerHTML = `<details class="audience-editor" id="audience-editor-details">
    <summary><span><strong>Répartition de l’audience</strong><small>Sexe, tranche d’âge et ville</small></span><span class="audience-optional">FACULTATIF <i aria-hidden="true">＋</i></span></summary>
    <div class="audience-editor-content">
      <p class="audience-editor-help">Recopiez les <strong>nombres</strong> fournis par vos plateformes pour cette campagne et cette période. Chaque répartition est indépendante. Laissez vide ce qui n’est pas disponible ; saisissez 0 uniquement pour un résultat nul.</p>
      <div class="audience-editor-tabs" role="group" aria-label="Répartition à renseigner">${Object.entries(DIMENSIONS).map(([key, dimension]) => `<button type="button" data-audience-tab="${key}" aria-controls="audience-panel-${key}" aria-pressed="${key === activeDimension}">${dimension.title}</button>`).join('')}</div>
      ${Object.entries(DIMENSIONS).map(([key, dimension]) => `<section class="audience-editor-panel" id="audience-panel-${key}" aria-label="Audience ${dimension.title.toLowerCase()}" ${key !== activeDimension ? 'hidden' : ''}>
        <div class="audience-editor-scroll"><table class="audience-editor-table"><caption class="sr-only">Saisie de l’audience ${dimension.title.toLowerCase()}</caption><thead><tr><th scope="col">${key === 'gender' ? 'Sexe' : key === 'ages' ? 'Tranche d’âge' : 'Ville'}</th>${Object.values(METRICS).map(label => `<th scope="col">${label}</th>`).join('')}${key === 'cities' ? '<th scope="col"><span class="sr-only">Action</span></th>' : ''}</tr></thead><tbody data-audience-rows="${key}"></tbody></table></div>
        ${key === 'cities' ? '<button type="button" class="audience-add-city" data-add-city>＋ Ajouter une ville</button>' : ''}
        <div class="audience-editor-totals" data-audience-totals="${key}" aria-live="polite"></div>
      </section>`).join('')}
      <p class="audience-editor-help audience-editor-limit">Les valeurs renseignées pour une répartition ne peuvent pas dépasser les totaux de la campagne. Le Reach de plusieurs campagnes n’est pas additionné dans le dashboard.</p>
      <p class="message error" data-audience-error role="alert" tabindex="-1" hidden></p>
    </div>
  </details>`;
  const details = container.querySelector('details');
  const errorMessage = container.querySelector('[data-audience-error]');
  const body = dimension => container.querySelector(`[data-audience-rows="${dimension}"]`);
  const rows = dimension => [...body(dimension).querySelectorAll('tr')];
  const changed = () => container.dispatchEvent(new Event('input', { bubbles: true }));

  function showDimension(dimension) {
    activeDimension = dimension;
    container.querySelectorAll('[data-audience-tab]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.audienceTab === dimension)));
    container.querySelectorAll('.audience-editor-panel').forEach(panel => { panel.hidden = panel.id !== `audience-panel-${dimension}`; });
  }

  function appendRow(dimension, data = {}) {
    const row = document.createElement('tr');
    const id = ++sequence;
    const label = data.label || '';
    row.dataset.label = label;
    const identity = dimension === 'cities' ? `Ville ${rows(dimension).length + 1}` : label;
    row.innerHTML = `<th scope="row">${dimension === 'cities' ? `<label class="sr-only" for="audience-city-${id}">${identity}</label><input id="audience-city-${id}" data-city-label type="text" maxlength="80" placeholder="Ex. Casablanca" value="${escape(label)}">` : escape(label)}</th>${Object.entries(METRICS).map(([metric, title]) => `<td><label class="sr-only" for="audience-${id}-${metric}">${escape(`${title} · ${identity}`)}</label><input id="audience-${id}-${metric}" data-metric="${metric}" type="number" min="0" max="9000000000000" step="1" inputmode="numeric" placeholder="—" value="${data[metric] == null ? '' : escape(data[metric])}"></td>`).join('')}${dimension === 'cities' ? `<td><button type="button" class="audience-remove-city" data-remove-city aria-label="Retirer ${escape(label || identity)}">×</button></td>` : ''}`;
    body(dimension).append(row);
    return row;
  }

  function clearErrors() {
    errorMessage.hidden = true;
    container.querySelectorAll('input').forEach(input => input.setCustomValidity(''));
  }

  function renumberCities() {
    rows('cities').forEach((row, index) => {
      const identity = `Ville ${index + 1}`;
      row.querySelector('th label').textContent = identity;
      for (const [metric, title] of Object.entries(METRICS)) {
        row.querySelector(`[data-metric="${metric}"]`).previousElementSibling.textContent = `${title} · ${identity}`;
      }
      row.querySelector('[data-remove-city]').setAttribute('aria-label', `Retirer ${row.querySelector('[data-city-label]').value.trim() || identity}`);
    });
  }

  function showError(message, dimension = activeDimension, control) {
    details.open = true;
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
        const cityControl = row.querySelector('[data-city-label]');
        const label = cityControl ? cityControl.value.trim() : row.dataset.label;
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
        if (!label) fail('Indiquez le nom de la ville correspondant à ces chiffres.', dimension, cityControl);
        const key = label.toLowerCase();
        if (seen.has(key)) fail(`${config.title} : « ${label} » est renseigné plusieurs fois.`, dimension, cityControl);
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
    container.querySelector('[data-add-city]').disabled = rows('cities').length >= 100;
  }

  function load(data = null) {
    clearErrors();
    for (const [dimension, config] of Object.entries(DIMENSIONS)) {
      body(dimension).replaceChildren();
      const saved = data?.[dimension] || [];
      if (dimension === 'cities') (saved.length ? saved : [{}]).forEach(row => appendRow(dimension, row));
      else config.labels.forEach(label => appendRow(dimension, saved.find(row => row.label === label) || { label }));
    }
    details.open = Object.keys(DIMENSIONS).some(dimension => data?.[dimension]?.length);
    showDimension('gender');
    updateTotals(totals);
  }

  container.addEventListener('click', event => {
    const tab = event.target.closest('[data-audience-tab]');
    if (tab) { showDimension(tab.dataset.audienceTab); return; }
    if (event.target.closest('[data-add-city]')) {
      if (rows('cities').length >= 100) return;
      appendRow('cities').querySelector('input').focus();
      changed();
    }
    const remove = event.target.closest('[data-remove-city]');
    if (remove) {
      remove.closest('tr').remove();
      if (!rows('cities').length) appendRow('cities');
      renumberCities();
      changed();
    }
  });
  container.addEventListener('input', clearErrors);
  container.addEventListener('invalid', event => {
    const panel = event.target.closest('.audience-editor-panel');
    if (panel) { details.open = true; showDimension(panel.id.replace('audience-panel-', '')); }
  }, true);
  load();
  return { read, load, clearErrors, showError, updateTotals };
}
