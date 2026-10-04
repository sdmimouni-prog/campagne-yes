import { getPortalMode, isSupabaseConfigured, signIn, requireAccess } from './portal-service.js';

const form = document.getElementById('login-form');
const email = document.getElementById('email');
const password = document.getElementById('password');
const toggle = document.getElementById('toggle-password');
const dialog = document.getElementById('help-dialog');
const status = document.getElementById('login-status');
const submitButton = document.getElementById('sign-in');
const cloudMode = getPortalMode() === 'supabase';
let submitting = false;

function nextPage() {
  const requested = new URLSearchParams(window.location.search).get('next');
  return requested === 'gestion-campagnes.html' ? requested : 'dashboard.html#overview';
}

function clearPassword() {
  password.value = '';
  password.type = 'password';
  toggle.setAttribute('aria-label', 'Afficher le mot de passe');
  toggle.setAttribute('aria-pressed', 'false');
  toggle.querySelector('use').setAttribute('href', '#icon-eye');
}

function setSubmitting(active) {
  submitting = active;
  form.setAttribute('aria-busy', String(active));
  form.querySelectorAll('input, button').forEach(control => { control.disabled = active; });
  submitButton.querySelector('span').textContent = active ? 'Connexion…' : 'Se connecter';
  submitButton.querySelector('.icon').toggleAttribute('hidden', active);
  submitButton.querySelector('.button-spinner').hidden = !active;
}

function signInError(error) {
  if (error?.code === 'CONFIGURATION') return 'La connexion n’est pas encore configurée. Contactez Richmedia.';
  if (error?.code === 'LOCAL_ONLY') return 'Cet aperçu est réservé à cet ordinateur. Contactez Richmedia.';
  if (error?.code === 'ACCESS_DENIED' || error?.status === 403) return 'Cet accès n’est pas autorisé pour votre compte. Contactez Richmedia.';
  if (error?.code === 'AUTH_REQUIRED') return 'Votre session a expiré. Veuillez vous reconnecter.';
  if (error?.code === 'AUTH_INVALID_CREDENTIALS' || error?.status === 401 || error?.code === 'invalid_credentials') return 'E-mail ou mot de passe incorrect.';
  if (error?.status === 429 || error?.code === 'over_request_rate_limit') return 'Trop de tentatives. Patientez avant de réessayer.';
  if (error?.code === 'email_not_confirmed') return 'Votre compte doit être activé. Contactez Richmedia.';
  if (error?.code === 'NETWORK_ERROR' || error?.status === 503) return 'Connexion indisponible. Vérifiez votre réseau et réessayez.';
  return 'Connexion impossible pour le moment. Réessayez ou contactez Richmedia.';
}

if (cloudMode) {
  document.querySelector('.preview-label').textContent = isSupabaseConfigured() ? 'Accès sécurisé' : 'Configuration en cours';
  document.querySelector('.private-access span').textContent = 'Un accès réservé aux comptes invités par Richmedia.';
  if (!isSupabaseConfigured()) status.textContent = signInError({ code: 'CONFIGURATION' });
}

function setError(input, message) {
  const error = document.getElementById(`${input.id}-error`);
  error.textContent = message;
  error.hidden = !message;
  if (message) input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
}

toggle.addEventListener('click', () => {
  const visible = password.type === 'password';
  password.type = visible ? 'text' : 'password';
  toggle.setAttribute('aria-label', visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
  toggle.setAttribute('aria-pressed', String(visible));
  toggle.querySelector('use').setAttribute('href', visible ? '#icon-eye-off' : '#icon-eye');
});

for (const input of [email, password]) {
  input.addEventListener('input', () => {
    setError(input, '');
    status.textContent = '';
  });
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (submitting) return;
  status.textContent = '';
  const emailError = !email.value.trim() ? 'Adresse e-mail requise.' : !email.validity.valid ? 'Adresse e-mail invalide.' : '';
  const passwordError = !password.value ? 'Mot de passe requis.' : '';
  setError(email, emailError);
  setError(password, passwordError);
  if (emailError || passwordError) {
    (emailError ? email : password).focus();
    return;
  }
  const destination = nextPage();
  if (!cloudMode) {
    clearPassword();
    window.location.assign(destination);
    return;
  }
  const enteredPassword = password.value;
  const enteredEmail = email.value.trim();
  const remember = form.elements.remember.checked;
  clearPassword();
  setSubmitting(true);
  try {
    await signIn(enteredEmail, enteredPassword, { remember });
    await requireAccess({ admin: destination === 'gestion-campagnes.html', redirect: false });
    window.location.assign(destination);
  } catch (error) {
    status.textContent = signInError(error);
    setSubmitting(false);
    password.focus();
  }
});

function showHelp(type) {
  document.getElementById('dialog-title').textContent = type === 'reset' ? 'Un mot de passe oublié ?' : 'Votre équipe à vos côtés.';
  document.getElementById('dialog-description').textContent = type === 'reset'
    ? cloudMode
      ? 'Pour réinitialiser votre mot de passe, contactez votre interlocuteur Richmedia à l’adresse ci-dessous.'
      : 'La réinitialisation sera disponible à l’ouverture de votre espace client. En attendant, votre interlocuteur Richmedia reste à votre disposition.'
    : 'Richmedia vous donne accès au suivi de vos campagnes. Pour recevoir votre invitation ou obtenir de l’aide, contactez votre interlocuteur Richmedia.';
  dialog.showModal();
}

document.getElementById('forgot-password').addEventListener('click', () => showHelp('reset'));
document.getElementById('request-access').addEventListener('click', () => showHelp('access'));
document.getElementById('support').addEventListener('click', () => showHelp('access'));
document.getElementById('close-dialog').addEventListener('click', () => dialog.close());
document.getElementById('dialog-done').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => {
  const rect = dialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
});

setSubmitting(false);
